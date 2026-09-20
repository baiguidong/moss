import { z } from 'zod/v4'
import { getSessionId } from '../../bootstrap/state.js'
import { getTaskScopeContext } from '../../utils/sessionIdContext.js'
import { buildTool, type ToolDef, type ToolInputJSONSchema, type ToolUseContext } from '../../Tool.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  archiveWorkflow,
  createWorkflowDraft,
  deleteWorkflow,
  duplicateWorkflow,
  getWorkflowCatalogDetail,
  listWorkflowCatalog,
  publishWorkflow,
  restoreWorkflow,
  unpublishWorkflow,
  updateWorkflowDraft,
  type WorkflowOrigin,
} from '../../utils/workflows/catalog.js'
import {
  workflowDefinitionAuthoringSchema,
  walkWorkflowNodes,
  type WorkflowDefinitionV3,
} from '../../utils/workflows/definition.js'
import { findWorkflowByName } from '../../utils/workflows/discovery.js'
import { prepareWorkflowDefinition } from '../../utils/workflows/runtime.js'
import { areWorkflowsEnabled } from '../../utils/workflows/enabled.js'
import {
  WORKFLOW_CREATE_TOOL_NAME,
  WORKFLOW_EDIT_TOOL_NAME,
  WORKFLOW_MANAGE_TOOL_NAME,
} from './constants.js'
import { getWorkflowAuthoringPrompt } from './prompt.js'

const scopeSchema = z.enum(['user', 'project'])
const workflowIdSchema = z.string().regex(/^wfd_[a-f0-9]{16}$/)

const createInputSchema = lazySchema(() => z.strictObject({
  definition: workflowDefinitionAuthoringSchema.describe(
    'Complete state-machine Definition v3. Creating a draft never executes it.',
  ),
  scope: scopeSchema.optional().describe('Defaults to user; project stores it in the current repository.'),
  changeSummary: z.string().max(500).optional(),
}))

const editInputSchema = lazySchema(() => z.strictObject({
  workflowId: workflowIdSchema,
  baseRevision: z.number().int().positive().describe('Revision returned by WorkflowManage get.'),
  definition: workflowDefinitionAuthoringSchema.describe('Complete replacement Definition v3.'),
  changeSummary: z.string().max(500).optional(),
}))

// Reuse shared node/source schemas as JSON Schema references instead of
// inlining them for every node variant. This is the schema sent to the model;
// the Zod schema above remains the local input parser.
const createInputJSONSchema = z.toJSONSchema(createInputSchema(), {
  reused: 'ref',
}) as ToolInputJSONSchema
const editInputJSONSchema = z.toJSONSchema(editInputSchema(), {
  reused: 'ref',
}) as ToolInputJSONSchema

const manageInputSchema = lazySchema(() => z.strictObject({
  action: z.enum(['list', 'get', 'publish', 'unpublish', 'duplicate', 'archive', 'restore', 'delete']),
  workflowId: workflowIdSchema.optional(),
  revision: z.number().int().positive().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/).optional(),
  title: z.string().min(1).max(120).optional(),
  scope: scopeSchema.optional(),
}))

const catalogOutputSchema = z.object({
  ok: z.boolean(),
  action: z.string(),
  workflow: z.unknown().optional(),
  workflows: z.array(z.unknown()).optional(),
  deleted: z.boolean().optional(),
})

type CatalogOutput = z.infer<typeof catalogOutputSchema>

export function workflowOrigin(context: ToolUseContext): WorkflowOrigin {
  let sessionId: string | undefined
  const taskScopeSessionId = getTaskScopeContext()?.sessionId
  if (typeof taskScopeSessionId === 'string' && taskScopeSessionId.trim()) {
    sessionId = taskScopeSessionId
  } else {
    try {
      sessionId = String(getSessionId())
    } catch {
      sessionId = undefined
    }
  }
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(context.toolUseId ? { toolUseId: context.toolUseId } : {}),
  }
}

function mapResult(output: CatalogOutput, toolUseID: string) {
  return {
    tool_use_id: toolUseID,
    type: 'tool_result' as const,
    content: jsonStringify(output),
  }
}

function mutationPermission(
  input: unknown,
  context: ToolUseContext | undefined,
  message: string,
) {
  if (
    context?.getAppState().toolPermissionContext?.mode === 'bypassPermissions' ||
    context?.options.isNonInteractiveSession
  ) {
    return { behavior: 'allow' as const, updatedInput: input }
  }
  return { behavior: 'ask' as const, message }
}

function validateExecutableDefinition(definition: unknown): WorkflowDefinitionV3 {
  const prepared = prepareWorkflowDefinition(definition)
  if (!prepared.ok) throw new Error(prepared.error)
  return prepared.definition
}

async function validatePublishedChildWorkflows(
  definition: WorkflowDefinitionV3,
  cwd: string,
  workflowId?: string,
): Promise<void> {
  const children: Array<{ id: string; workflowId?: string; name?: string; revision?: number }> = []
  walkWorkflowNodes(definition.graph, node => {
    if (node.type === 'workflow' && !node.disabled) children.push(node)
  })
  for (const child of children) {
    if (child.workflowId) {
      if (child.workflowId === workflowId) {
        throw new Error(`Workflow node "${child.id}" cannot invoke its own workflow`)
      }
      let detail
      try {
        detail = await getWorkflowCatalogDetail({ workflowId: child.workflowId, cwd })
      } catch {
        throw new Error(`Workflow node "${child.id}" references unknown child workflowId "${child.workflowId}"`)
      }
      if (!detail.record.publishedRevision || detail.record.status === 'archived') {
        throw new Error(`Workflow node "${child.id}" requires child workflow "${child.workflowId}" to be published first`)
      }
      if (child.revision && child.revision > detail.record.publishedRevision) {
        throw new Error(
          `Workflow node "${child.id}" references unpublished child revision ${child.revision}; latest published revision is ${detail.record.publishedRevision}`,
        )
      }
      continue
    }
    if (child.name === definition.meta.name) {
      throw new Error(`Workflow node "${child.id}" cannot invoke its own workflow`)
    }
    const saved = child.name ? await findWorkflowByName(child.name, cwd) : undefined
    if (!saved) {
      throw new Error(
        `Workflow node "${child.id}" references unknown published child name "${child.name}"; use its exact meta.name or, preferably, workflowId`,
      )
    }
  }
}

function notifyCatalogChanged(
  context: ToolUseContext,
  action: string,
  workflowId?: string,
): void {
  void context.emitAppEvent?.({
    type: 'workflow_catalog_changed',
    input: { action, ...(workflowId ? { workflowId } : {}) },
  }).catch(() => {})
}

export const WorkflowCreateTool = buildTool({
  name: WORKFLOW_CREATE_TOOL_NAME,
  deferLoading: true,
  searchHint: 'create and preview a structured workflow draft without running it',
  maxResultSizeChars: 200_000,
  userFacingName: () => 'Workflow Create',
  get inputSchema() { return createInputSchema() },
  inputJSONSchema: createInputJSONSchema,
  get outputSchema() { return catalogOutputSchema },
  isEnabled: () => areWorkflowsEnabled(),
  isConcurrencySafe: () => false,
  isReadOnly: () => false,
  isOpenWorld: () => false,
  checkPermissions(input, context) {
    return mutationPermission(input, context, 'Moss wants to create a versioned workflow draft.')
  },
  async description(input) {
    return `Create workflow draft “${input.definition.meta.title}” without running it`
  },
  async prompt() {
    return `${getWorkflowAuthoringPrompt()}\n\nWorkflowCreate saves revision 1 as a draft and returns its exact graph. It never runs agents or node code.`
  },
  renderToolUseMessage: () => null,
  mapToolResultToToolResultBlockParam: mapResult,
  async call(input, context) {
    const definition = validateExecutableDefinition(input.definition)
    const cwd = getOriginalCwd()
    await validatePublishedChildWorkflows(definition, cwd)
    const workflow = await createWorkflowDraft({
      ...input,
      definition,
      cwd,
      origin: workflowOrigin(context),
    })
    notifyCatalogChanged(context, 'create', workflow.record.id)
    return { data: { ok: true, action: 'create', workflow } }
  },
} satisfies ToolDef<ReturnType<typeof createInputSchema>, CatalogOutput>)

export const WorkflowEditTool = buildTool({
  name: WORKFLOW_EDIT_TOOL_NAME,
  deferLoading: true,
  searchHint: 'replace a workflow draft definition using optimistic revision control',
  maxResultSizeChars: 200_000,
  userFacingName: () => 'Workflow Edit',
  get inputSchema() { return editInputSchema() },
  inputJSONSchema: editInputJSONSchema,
  get outputSchema() { return catalogOutputSchema },
  isEnabled: () => areWorkflowsEnabled(),
  isConcurrencySafe: () => false,
  isReadOnly: () => false,
  isOpenWorld: () => false,
  checkPermissions(input, context) {
    return mutationPermission(input, context, 'Moss wants to create a new immutable revision of this workflow.')
  },
  async description(input) { return `Edit ${input.workflowId} from revision ${input.baseRevision}` },
  async prompt() {
    return `${getWorkflowAuthoringPrompt()}\n\nBefore WorkflowEdit, call WorkflowManage with action=get. Send the complete replacement Definition and the returned current revision as baseRevision.`
  },
  renderToolUseMessage: () => null,
  mapToolResultToToolResultBlockParam: mapResult,
  async call(input, context) {
    const definition = validateExecutableDefinition(input.definition)
    const cwd = getOriginalCwd()
    await validatePublishedChildWorkflows(definition, cwd, input.workflowId)
    const workflow = await updateWorkflowDraft({
      ...input,
      definition,
      cwd,
      origin: workflowOrigin(context),
    })
    notifyCatalogChanged(context, 'edit', workflow.record.id)
    return { data: { ok: true, action: 'edit', workflow } }
  },
} satisfies ToolDef<ReturnType<typeof editInputSchema>, CatalogOutput>)

export const WorkflowManageTool = buildTool({
  name: WORKFLOW_MANAGE_TOOL_NAME,
  deferLoading: true,
  searchHint: 'list inspect publish duplicate archive or delete workflow templates',
  maxResultSizeChars: 200_000,
  userFacingName: () => 'Workflow Manage',
  get inputSchema() { return manageInputSchema() },
  get outputSchema() { return catalogOutputSchema },
  isEnabled: () => areWorkflowsEnabled(),
  isConcurrencySafe: input => input.action === 'list' || input.action === 'get',
  isReadOnly: input => input.action === 'list' || input.action === 'get',
  isDestructive: input => input.action === 'delete',
  isOpenWorld: () => false,
  checkPermissions(input, context) {
    if (input.action === 'list' || input.action === 'get') {
      return { behavior: 'allow', updatedInput: input }
    }
    return mutationPermission(
      input,
      context,
      `Moss wants to ${input.action} workflow ${input.workflowId ?? ''}.`,
    )
  },
  async description(input) { return `${input.action} workflow${input.workflowId ? ` ${input.workflowId}` : ' catalog'}` },
  async prompt() {
    return 'Use WorkflowManage to list/get workflows and to publish, unpublish, duplicate, archive, restore, or permanently delete them. get returns the complete immutable revision. A new or edited draft belongs to its conversation and is not a reusable template. Never publish it automatically: publish only after the user explicitly confirms that the draft is ready. Publishing makes the current revision visible in Workflows and reusable as a saved workflow command.'
  },
  renderToolUseMessage: () => null,
  mapToolResultToToolResultBlockParam: mapResult,
  async call(input, context) {
    const cwd = getOriginalCwd()
    if (input.action === 'list') {
      const workflows = await listWorkflowCatalog({ cwd, status: input.status })
      return {
        data: {
          ok: true,
          action: input.action,
          workflows: workflows.map(({ graph: _graph, mermaid: _mermaid, inputSchema: _inputSchema, ...record }) => record),
        },
      }
    }
    if (!input.workflowId) throw new Error(`WorkflowManage action=${input.action} requires workflowId`)
    if (input.action === 'get') {
      const workflow = await getWorkflowCatalogDetail({ workflowId: input.workflowId, revision: input.revision, cwd })
      return { data: { ok: true, action: input.action, workflow } }
    }
    if (input.action === 'publish') {
      const workflow = await publishWorkflow({ workflowId: input.workflowId, cwd })
      notifyCatalogChanged(context, input.action, input.workflowId)
      return { data: { ok: true, action: input.action, workflow } }
    }
    if (input.action === 'unpublish') {
      const workflow = await unpublishWorkflow({ workflowId: input.workflowId, cwd })
      notifyCatalogChanged(context, input.action, input.workflowId)
      return { data: { ok: true, action: input.action, workflow } }
    }
    if (input.action === 'archive') {
      const workflow = await archiveWorkflow({ workflowId: input.workflowId, cwd })
      notifyCatalogChanged(context, input.action, input.workflowId)
      return { data: { ok: true, action: input.action, workflow } }
    }
    if (input.action === 'restore') {
      const workflow = await restoreWorkflow({ workflowId: input.workflowId, cwd })
      notifyCatalogChanged(context, input.action, input.workflowId)
      return { data: { ok: true, action: input.action, workflow } }
    }
    if (input.action === 'duplicate') {
      if (!input.name) throw new Error('WorkflowManage action=duplicate requires name')
      const workflow = await duplicateWorkflow({
        workflowId: input.workflowId,
        name: input.name,
        title: input.title,
        scope: input.scope,
        cwd,
        origin: workflowOrigin(context),
      })
      notifyCatalogChanged(context, input.action, workflow.record.id)
      return { data: { ok: true, action: input.action, workflow } }
    }
    await deleteWorkflow({ workflowId: input.workflowId, cwd })
    notifyCatalogChanged(context, input.action, input.workflowId)
    return { data: { ok: true, action: input.action, deleted: true } }
  },
} satisfies ToolDef<ReturnType<typeof manageInputSchema>, CatalogOutput>)

export const WorkflowCatalogTools = [
  WorkflowCreateTool,
  WorkflowEditTool,
  WorkflowManageTool,
]
