import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../Tool.js'
import { findWorkflowByName } from '../../utils/workflows/discovery.js'
import { getWorkflowCatalogDetail } from '../../utils/workflows/catalog.js'
import type { WorkflowSharedCounters } from '../../utils/workflows/harness.js'
import type {
  WorkflowJournal,
  WorkflowJournalSnapshot,
} from '../../utils/workflows/journal.js'
import {
  executeWorkflowDefinition,
  prepareWorkflowDefinition,
} from '../../utils/workflows/runtime.js'
import type {
  WorkflowProgressEvent,
  WorkflowTokenBudget,
} from '../../utils/workflows/types.js'

export type NestedWorkflowDeps = {
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  runId: string
  tokenBudget?: WorkflowTokenBudget
  journal?: WorkflowJournal
  journalSnapshot?: WorkflowJournalSnapshot
  shared: WorkflowSharedCounters
  onProgress: (event: WorkflowProgressEvent) => void
  onAgentController: (
    agentKey: string,
    controller: AbortController | undefined,
  ) => void
}

/** Execute one saved child definition inside the parent's limits and journal. */
export function createNestedWorkflowRunner(
  deps: NestedWorkflowDeps,
): (
  reference: { workflowId?: string; name?: string; revision?: number },
  args: unknown,
  parentInstanceId: string,
) => Promise<unknown> {
  return async (reference, args, parentInstanceId) => {
    let detail: Awaited<ReturnType<typeof getWorkflowCatalogDetail>> | undefined
    if (reference.workflowId) {
      const current = await getWorkflowCatalogDetail({ workflowId: reference.workflowId })
      const publishedRevision = current.record.publishedRevision
      if (!publishedRevision || current.record.status === 'archived') {
        throw new Error(`workflow(${reference.workflowId}): child workflow is not published`)
      }
      if (reference.revision && reference.revision > publishedRevision) {
        throw new Error(
          `workflow(${reference.workflowId}): revision ${reference.revision} is not published; latest published revision is ${publishedRevision}`,
        )
      }
      const revision = reference.revision ?? publishedRevision
      detail = current.revision.revision === revision
        ? current
        : await getWorkflowCatalogDetail({ workflowId: reference.workflowId, revision })
    }
    const workflow = detail
      ? { definition: detail.revision.definition }
      : reference.name
        ? await findWorkflowByName(reference.name)
        : undefined
    const displayName = reference.name ?? reference.workflowId ?? 'unknown'
    if (!workflow) throw new Error(`workflow: unknown workflow '${displayName}'`)
    const prepared = prepareWorkflowDefinition(workflow.definition)
    if (!prepared.ok) throw new Error(`workflow(${displayName}): ${prepared.error}`)

    deps.onProgress({
      type: 'workflow_log',
      message: `workflow(${prepared.definition.meta.name}) started`,
      instanceId: parentInstanceId,
    })

    const outcome = await executeWorkflowDefinition({
      prepared,
      toolUseContext: deps.toolUseContext,
      canUseTool: deps.canUseTool,
      runId: deps.runId,
      args,
      tokenBudget: deps.tokenBudget,
      journal: deps.journal,
      journalSnapshot: deps.journalSnapshot,
      shared: deps.shared,
      instancePrefix: `${parentInstanceId}/workflow:${displayName}`,
      // The parent graph represents the child as one node. Forward its agents,
      // phases and logs, but keep the child's node graph scoped to its own run.
      onProgress: event => {
        if (event.type !== 'workflow_node' && event.type !== 'workflow_edge') deps.onProgress(event)
      },
      onAgentController: deps.onAgentController,
      // One nesting level only.
      runNestedWorkflow: undefined,
    })
    if (outcome.error) throw new Error(`workflow(${displayName}): ${outcome.error}`)
    return outcome.result
  }
}
