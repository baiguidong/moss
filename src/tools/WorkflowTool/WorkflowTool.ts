import { readFile } from 'fs/promises'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { generateTaskId } from '../../Task.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getRuleByContentsForToolName } from '../../utils/permissions/permissions.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  findWorkflowByName,
  loadWorkflows,
} from '../../utils/workflows/discovery.js'
import { getWorkflowCatalogDetail } from '../../utils/workflows/catalog.js'
import {
  parseWorkflowDefinitionJson,
  type WorkflowDefinitionV3,
} from '../../utils/workflows/definition.js'
import {
  areWorkflowsEnabled,
  describeWorkflowsDisabled,
  getWorkflowsDisabledReason,
} from '../../utils/workflows/enabled.js'
import { WORKFLOW_RUN_ID_PATTERN } from '../../utils/workflows/constants.js'
import { createWorkflowRunId } from '../../utils/workflows/paths.js'
import { prepareWorkflowDefinition } from '../../utils/workflows/runtime.js'
import { launchWorkflow } from './launchWorkflow.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import { getWorkflowRunPrompt } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    definitionPath: z
      .string()
      .optional()
      .describe(
        'Path to an exported .workflow.json definition. Use exactly one of definitionPath, name, or workflowId.',
      ),
    name: z
      .string()
      .optional()
      .describe('Name of a saved structured workflow.'),
    workflowId: z
      .string()
      .regex(/^wfd_[a-f0-9]{16}$/)
      .optional()
      .describe('Stable id of a workflow draft or template in the catalog.'),
    revision: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Immutable catalog revision to run. Defaults to the current revision.'),
    mode: z
      .enum(['test', 'run'])
      .optional()
      .describe('Test and run execute the same frozen revision; the mode is retained for history and UI.'),
    args: z
      .unknown()
      .optional()
      .describe('Optional JSON input exposed through workflow-input bindings and as `args` inside code-node JavaScript.'),
    resumeFromRunId: z
      .string()
      .regex(WORKFLOW_RUN_ID_PATTERN)
      .optional()
      .describe(
        'Run ID to resume. Unchanged Agent nodes with the same stable instance ID, configuration, and resolved input reuse their saved results.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.literal('async_launched'),
    taskId: z.string(),
    taskType: z.literal('local_workflow'),
    workflowName: z.string().optional(),
    workflowId: z.string().optional(),
    revision: z.number().int().positive().optional(),
    mode: z.enum(['test', 'run']).optional(),
    runId: z.string().optional(),
    summary: z.string().optional(),
    transcriptDir: z.string().optional(),
    definitionPath: z.string().optional(),
    sessionUrl: z.string().optional(),
    warning: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const WorkflowRunTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  supportedEnvironments: ['desktop'],
  deferLoading: true,
  searchHint: 'orchestrate subagents with a structured visual workflow',
  maxResultSizeChars: 100_000,
  userFacingName: () => 'Workflow Run',
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return areWorkflowsEnabled()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  isOpenWorld() {
    return true
  },
  async checkPermissions(input, context) {
    const appState = context?.getAppState()
    const permissionContext = appState?.toolPermissionContext
    if (
      permissionContext?.mode === 'bypassPermissions' ||
      context?.options.isNonInteractiveSession
    ) {
      return { behavior: 'allow', updatedInput: input }
    }
    const ruleContent = typeof input.workflowId === 'string'
      ? input.workflowId
      : typeof input.name === 'string'
        ? input.name
        : undefined
    if (ruleContent && permissionContext) {
      const denied = getRuleByContentsForToolName(
        permissionContext,
        WORKFLOW_TOOL_NAME,
        'deny',
      ).get(ruleContent)
      if (denied) {
        return {
          behavior: 'deny',
          message: `${WORKFLOW_TOOL_NAME} denied for workflow "${ruleContent}".`,
          decisionReason: { type: 'rule', rule: denied },
        }
      }
      const allowed = getRuleByContentsForToolName(
        permissionContext,
        WORKFLOW_TOOL_NAME,
        'allow',
      ).get(ruleContent)
      if (allowed) {
        return {
          behavior: 'allow',
          updatedInput: input,
          decisionReason: { type: 'rule', rule: allowed },
        }
      }
    }
    return {
      behavior: 'ask',
      message:
        'Moss wants to run a structured workflow, which can spawn many subagents and use a large number of tokens.',
      ...(ruleContent
        ? {
            suggestions: [
              {
                type: 'addRules' as const,
                rules: [{ toolName: WORKFLOW_TOOL_NAME, ruleContent }],
                behavior: 'allow' as const,
                destination: 'localSettings' as const,
              },
            ],
          }
        : {}),
    }
  },
  async description(input) {
    if (input.workflowId) return `${input.mode === 'test' ? 'Test' : 'Run'} workflow ${input.workflowId}${input.revision ? `@${input.revision}` : ''}`
    if (input.name) return `Run the ${input.name} workflow`
    return 'Run a structured workflow'
  },
  async prompt() {
    return getWorkflowRunPrompt()
  },
  renderToolUseMessage() {
    return null
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(output),
    }
  },
  async call(input, toolUseContext, canUseTool) {
    const disabled = getWorkflowsDisabledReason()
    if (disabled) throw new Error(describeWorkflowsDisabled(disabled))

    const resolved = await resolveDefinition(input)
    if ('error' in resolved) throw new Error(resolved.error)
    const prepared = prepareWorkflowDefinition(resolved.definition)
    if (!prepared.ok) throw new Error(prepared.error)

    const runningTasks = Object.values(toolUseContext.getAppState().tasks) as Array<{
      id: string
      type: string
      status: string
      workflowId?: string
      workflowRevision?: number
      workflowName?: string
      args?: unknown
    }>
    const duplicate = runningTasks.find(task => {
      if (task.type !== 'local_workflow' || task.status !== 'running') return false
      const sameWorkflow = resolved.workflowId
        ? task.workflowId === resolved.workflowId && task.workflowRevision === resolved.revision
        : task.workflowName === prepared.definition.meta.name
      return sameWorkflow && stableInput(task.args) === stableInput(input.args ?? {})
    })
    if (duplicate) {
      throw new Error(`Workflow is already running as task ${duplicate.id}; wait for it or stop it before launching again.`)
    }

    const workflowRunId = input.resumeFromRunId ?? createWorkflowRunId()
    const taskId = generateTaskId('local_workflow')
    const launched = await launchWorkflow({
      taskId,
      workflowRunId,
      definition: prepared.definition,
      definitionPath: resolved.definitionPath,
      args: input.args,
      prepared,
      toolUseContext,
      canUseTool,
      toolUseId: toolUseContext.toolUseId,
      isResume: input.resumeFromRunId !== undefined,
      workflowId: resolved.workflowId,
      workflowRevision: resolved.revision,
      runMode: input.mode ?? 'run',
    })

    return {
      data: {
        status: 'async_launched' as const,
        taskId,
        taskType: 'local_workflow' as const,
        workflowName: prepared.definition.meta.name,
        workflowId: resolved.workflowId,
        revision: resolved.revision,
        mode: input.mode ?? 'run',
        runId: workflowRunId,
        summary: prepared.definition.meta.description,
        transcriptDir: launched.transcriptDir,
        definitionPath: launched.definitionPath,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)

/** Internal compatibility export; the public tool name is WorkflowRun. */
export const WorkflowTool = WorkflowRunTool

type DefinitionInput = {
  definitionPath?: string
  name?: string
  workflowId?: string
  revision?: number
  cwd?: string
}

function stableInput(value: unknown): string {
  if (value === undefined) return '{}'
  try {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stableInput).join(',')}]`
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableInput((value as Record<string, unknown>)[key])}`).join(',')}}`
  } catch {
    return String(value)
  }
}

export async function resolveDefinitionForTesting(
  input: DefinitionInput,
): Promise<
  | { definition: WorkflowDefinitionV3; definitionPath?: string; workflowId?: string; revision?: number }
  | { error: string }
> {
  return resolveDefinition(input)
}

async function resolveDefinition(
  input: DefinitionInput,
): Promise<
  | { definition: WorkflowDefinitionV3; definitionPath?: string; workflowId?: string; revision?: number }
  | { error: string }
> {
  if (input.revision !== undefined && !input.workflowId) {
    return { error: '`revision` requires `workflowId`.' }
  }
  const sources = [input.definitionPath, input.name, input.workflowId].filter(
    value => value !== undefined,
  )
  if (sources.length !== 1) {
    return {
      error: 'WorkflowRun requires exactly one of `workflowId`, `definitionPath`, or `name`.',
    }
  }

  if (input.workflowId) {
    try {
      const detail = await getWorkflowCatalogDetail({
        workflowId: input.workflowId,
        revision: input.revision,
        cwd: input.cwd,
      })
      if (detail.record.status === 'archived') {
        return { error: `Workflow ${input.workflowId} is archived.` }
      }
      return {
        definition: detail.revision.definition,
        workflowId: detail.record.id,
        revision: detail.revision.revision,
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
  if (input.definitionPath) {
    try {
      const source = await readFile(input.definitionPath, 'utf8')
      const parsed = parseWorkflowDefinitionJson(source)
      return parsed.ok
        ? { definition: parsed.definition, definitionPath: input.definitionPath }
        : { error: parsed.error }
    } catch (error) {
      return {
        error: `Failed to read workflow definition ${input.definitionPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
  }

  if (input.name) {
    const workflow = await findWorkflowByName(input.name)
    if (!workflow) {
      const available = (await loadWorkflows()).map(entry => entry.name).join(', ')
      return {
        error: `Unknown workflow '${input.name}'.${available ? ` Available: ${available}` : ''}`,
      }
    }
    return { definition: workflow.definition }
  }

  return {
    error: 'WorkflowRun requires exactly one of `workflowId`, `definitionPath`, or `name`.',
  }
}
