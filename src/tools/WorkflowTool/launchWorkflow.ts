import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import {
  getCurrentTurnTokenBudget,
  getTurnOutputTokens,
} from '../../bootstrap/state.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { SetAppState } from '../../Task.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  completeWorkflowTask,
  enqueueWorkflowNotification,
  failWorkflowTask,
  killWorkflowTask,
  registerWorkflowTask,
  updateWorkflowProgressBatch,
  type LocalWorkflowTaskState,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { logForDebugging } from '../../utils/debug.js'
import { TOOL_EXECUTION_COMPLETED } from '../../utils/abortController.js'
import { registerTask, updateTaskState } from '../../utils/task/framework.js'
import { emitTaskProgress } from '../../utils/task/sdkProgress.js'
import {
  WORKFLOW_PANEL_EMIT_INTERVAL_MS,
  WORKFLOW_PROGRESS_BATCH_MS,
} from '../../utils/workflows/constants.js'
import { createWorkflowSharedCounters } from '../../utils/workflows/harness.js'
import { createRunJournal } from '../../utils/workflows/journal.js'
import { buildWorkflowGraph } from '../../utils/workflows/graph.js'
import {
  getWorkflowDefinitionPath,
  getWorkflowTranscriptDir,
} from '../../utils/workflows/paths.js'
import {
  executeWorkflowDefinition,
  type PreparedWorkflowDefinition,
} from '../../utils/workflows/runtime.js'
import {
  stringifyWorkflowDefinition,
  type WorkflowDefinitionV3,
} from '../../utils/workflows/definition.js'
import { createNestedWorkflowRunner } from './runNestedWorkflow.js'
import {
  isDurableWorkflowEvent,
  type WorkflowProgressEvent,
} from '../../utils/workflows/types.js'

export type LaunchWorkflowParams = {
  taskId: string
  workflowRunId: string
  definition: WorkflowDefinitionV3
  definitionPath?: string
  args?: unknown
  prepared: PreparedWorkflowDefinition
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  toolUseId?: string
  isResume: boolean
  workflowId?: string
  workflowRevision?: number
  runMode?: 'test' | 'run'
  runNestedWorkflow?: (
    reference: { workflowId?: string; name?: string; revision?: number },
    args: unknown,
    parentInstanceId: string,
  ) => Promise<unknown>
}

export type LaunchedWorkflow = {
  task: LocalWorkflowTaskState
  transcriptDir: string
  definitionPath: string
}

/**
 * Register the background task for a run and start executing its definition.
 *
 * Returns as soon as the task and its durable definition copy exist so the tool can
 * hand the model a usable run id/path; execution happens on the detached
 * promise below.
 */
export async function launchWorkflow(
  params: LaunchWorkflowParams,
): Promise<LaunchedWorkflow> {
  const {
    taskId,
    workflowRunId,
    definition,
    args,
    prepared,
    toolUseContext,
    canUseTool,
    toolUseId,
    isResume,
    workflowId,
    workflowRevision,
    runMode,
  } = params

  const setAppState: SetAppState =
    toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState
  const transcriptDir = getWorkflowTranscriptDir(workflowRunId)
  // A caller-supplied path is read-only: it is the user's file, and a resume
  // is supposed to pick up their edits, not overwrite them.
  const callerSuppliedPath = params.definitionPath !== undefined
  const definitionPath =
    params.definitionPath ?? getWorkflowDefinitionPath(workflowRunId, definition.meta.name)
  const graphResult = buildWorkflowGraph(definition)

  // A resumed run replaces the settled task for the same run id, so the
  // progress view shows one entry instead of a stack of dead ones.
  if (isResume) {
    const tasks = toolUseContext.getAppState().tasks as Record<
      string,
      { type?: string; workflowRunId?: string; status?: string }
    >
    for (const [id, task] of Object.entries(tasks)) {
      if (
        task.type === 'local_workflow' &&
        task.workflowRunId === workflowRunId &&
        task.status !== 'running'
      ) {
        setAppState(prev => {
          const { [id]: _removed, ...rest } = prev.tasks
          return { ...prev, tasks: rest }
        })
      }
    }
  }

  const task = registerWorkflowTask({
    taskId,
    definition,
    definitionPath,
    args,
    summary: definition.meta.description,
    workflowName: definition.meta.name,
    title: definition.meta.title,
    workflowRunId,
    ...('error' in graphResult
      ? { graphError: graphResult.error }
      : { graph: graphResult.graph, mermaid: graphResult.mermaid }),
    ownerAgentId: toolUseContext.agentId,
    toolUseId,
    workflowId,
    workflowRevision,
    runMode,
  })
  registerTask(task, setAppState)

  // A background Workflow owns its controller. Explicit cancellation of the
  // launch propagates, but normal cleanup of the completed WorkflowRun tool
  // must not terminate the detached run it just created.
  const parentSignal = toolUseContext.abortController?.signal
  const unlinkParentAbort = linkWorkflowAbort(parentSignal, task.abortController)

  if (!callerSuppliedPath) await persistDefinition(definitionPath, definition)

  const budgetTotal = getCurrentTurnTokenBudget()
  const spentBeforeRun = getTurnOutputTokens()
  const tokenBudget = {
    total: budgetTotal,
    getTurnSpent: () => getTurnOutputTokens() - spentBeforeRun,
  }

  const batcher = createProgressBatcher({
    taskId,
    toolUseId,
    setAppState,
    getTask: () =>
      toolUseContext.getAppState().tasks[taskId] as
        | LocalWorkflowTaskState
        | undefined,
    fallbackDescription: task.description,
    startTime: task.startTime,
    summary: definition.meta.description,
  })

  void (async () => {
    const journal = createRunJournal(workflowRunId)
    const journalSnapshot = isResume ? await journal.load() : undefined
    const shared = createWorkflowSharedCounters(Math.min(
      definition.defaults?.concurrency ?? Number.POSITIVE_INFINITY,
      definition.limits?.maxConcurrency ?? Number.POSITIVE_INFINITY,
    ), definition.limits?.maxAgentCalls)
    const nestedContext = {
      ...toolUseContext,
      abortController: task.abortController ?? toolUseContext.abortController,
    }
    const onAgentController = (
      agentKey: string,
      controller: AbortController | undefined,
    ) => {
      updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, current => {
        if (!current.agentControllers) return current
        if (controller) current.agentControllers.set(agentKey, controller)
        else current.agentControllers.delete(agentKey)
        return current
      })
    }

    const outcome = await executeWorkflowDefinition({
      prepared,
      toolUseContext: nestedContext,
      canUseTool,
      runId: workflowRunId,
      args,
      tokenBudget,
      journal,
      journalSnapshot,
      shared,
      onProgress: event => batcher.push(event),
      onAgentController,
      runNestedWorkflow:
        params.runNestedWorkflow ??
        createNestedWorkflowRunner({
          toolUseContext: nestedContext,
          canUseTool,
          runId: workflowRunId,
          tokenBudget,
          journal,
          journalSnapshot,
          shared,
          onProgress: event => batcher.push(event),
          onAgentController,
        }),
    })

    batcher.flush()
    unlinkParentAbort()

    const settled = toolUseContext.getAppState().tasks[taskId] as
      | LocalWorkflowTaskState
      | undefined
    // A run the user stopped is already terminal; do not overwrite that.
    if (settled && settled.status !== 'running') return

    const totalTokens = settled?.totalTokens ?? 0
    const totalToolCalls = settled?.totalToolCalls ?? 0
    if (outcome.status === 'cancelled') {
      killWorkflowTask(taskId, setAppState)
      return
    }
    const status = outcome.status === 'completed' ? 'completed' : 'failed'

    // Settling the task is synchronous; persistence is not. Queue the
    // completion notification immediately after settlement so a desktop
    // foreground loop cannot observe "no running workflow" and exit during
    // the short run-file write window before the result notification exists.
    const persistence = outcome.status !== 'completed'
      ? failWorkflowTask(
        taskId,
        outcome.status === 'blocked'
          ? `Blocked: ${outcome.error ?? 'Workflow prerequisites are missing.'}`
          : outcome.error ?? 'Workflow failed.',
        outcome.agentCount,
        outcome.logs,
        setAppState,
      )
      : completeWorkflowTask(
        taskId,
        outcome.result,
        outcome.agentCount,
        outcome.logs,
        setAppState,
      )

    enqueueWorkflowNotification({
      taskId,
      summary: definition.meta.description,
      status,
      result: outcome.status === 'completed' ? outcome.result : undefined,
      error: outcome.error,
      failures: outcome.failures,
      agentCount: outcome.agentCount,
      totalTokens,
      totalToolCalls,
      durationMs: outcome.durationMs,
      toolUseId,
      transcriptDir,
      definitionPath,
      workflowId,
      workflowRevision,
      workflowRunId,
      args,
      setAppState,
    })
    await persistence
  })().catch(async error => {
    unlinkParentAbort()
    batcher.cancel()
    const message = error instanceof Error ? error.message : String(error)
    logForDebugging(`Workflow ${workflowRunId} crashed: ${message}`)
    const persistence = failWorkflowTask(taskId, message, 0, [], setAppState)
    enqueueWorkflowNotification({
      taskId,
      summary: definition.meta.description,
      status: 'failed',
      error: message,
      agentCount: 0,
      totalTokens: 0,
      totalToolCalls: 0,
      durationMs: Date.now() - task.startTime,
      toolUseId,
      transcriptDir,
      definitionPath,
      workflowId,
      workflowRevision,
      workflowRunId,
      args,
      setAppState,
    })
    await persistence
  })

  return { task, transcriptDir, definitionPath }
}

/** Link launch cancellation without confusing normal tool cleanup for a stop. */
export function linkWorkflowAbort(
  parentSignal: AbortSignal | undefined,
  workflowController: AbortController | undefined,
): () => void {
  if (!parentSignal || !workflowController) return () => {}
  const abortFromParent = (): void => {
    if (parentSignal.reason === TOOL_EXECUTION_COMPLETED) return
    if (!workflowController.signal.aborted) {
      workflowController.abort(parentSignal.reason ?? new Error('Parent session stopped'))
    }
  }
  if (parentSignal.aborted) abortFromParent()
  else parentSignal.addEventListener('abort', abortFromParent, { once: true })
  return () => parentSignal.removeEventListener('abort', abortFromParent)
}

/**
 * Coalesce progress events before they touch AppState.
 *
 * A 40-agent run emits thousands of token-count updates; applying each one
 * would re-render the whole task list per event. Batching on a short timer
 * keeps the view live without making the UI the bottleneck.
 */
function createProgressBatcher(params: {
  taskId: string
  toolUseId?: string
  setAppState: SetAppState
  getTask: () => LocalWorkflowTaskState | undefined
  fallbackDescription: string
  startTime: number
  summary?: string
}) {
  let pending: WorkflowProgressEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastPanelEmit = 0

  const drain = (): void => {
    timer = undefined
    if (pending.length === 0) return
    const batch = pending
    pending = []
    updateWorkflowProgressBatch(params.taskId, batch, params.setAppState)
    emitPanelProgress(batch)
  }

  const emitPanelProgress = (batch: WorkflowProgressEvent[]): void => {
    const durable = batch.filter(isDurableWorkflowEvent)
    if (durable.length === 0) return
    const task = params.getTask()
    if (task?.type !== 'local_workflow' || task.status !== 'running') return

    const lastAgent = [...durable]
      .reverse()
      .find(event => event.type === 'workflow_agent')
    // Token-count churn is throttled; anything else (an agent finishing, a new
    // phase) goes out immediately so the panel is never visibly behind.
    const onlyTokenChurn = durable.every(
      event => event.type === 'workflow_agent' && event.state === 'progress',
    )
    const now = Date.now()
    if (onlyTokenChurn && now - lastPanelEmit < WORKFLOW_PANEL_EMIT_INTERVAL_MS) {
      return
    }
    lastPanelEmit = now

    emitTaskProgress({
      taskId: params.taskId,
      toolUseId: params.toolUseId,
      description:
        lastAgent?.type === 'workflow_agent'
          ? lastAgent.phaseTitle
            ? `${lastAgent.phaseTitle}: ${lastAgent.label}`
            : lastAgent.label
          : params.fallbackDescription,
      startTime: params.startTime,
      totalTokens: task.totalTokens,
      toolUses: task.totalToolCalls,
      lastToolName:
        lastAgent?.type === 'workflow_agent' ? lastAgent.label : undefined,
      summary: params.summary,
      workflowProgress: task.workflowProgress.filter(isDurableWorkflowEvent),
    })
  }

  return {
    push(event: WorkflowProgressEvent): void {
      pending.push(event)
      if (!timer) {
        timer = setTimeout(drain, WORKFLOW_PROGRESS_BATCH_MS)
        timer.unref?.()
      }
    },
    flush(): void {
      if (timer) clearTimeout(timer)
      drain()
    },
    cancel(): void {
      if (timer) clearTimeout(timer)
      timer = undefined
      pending = []
    },
  }
}

async function persistDefinition(
  path: string,
  definition: WorkflowDefinitionV3,
): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, stringifyWorkflowDefinition(definition), {
      encoding: 'utf8',
      mode: 0o600,
    })
  } catch (error) {
    logForDebugging(
      `Failed to persist workflow definition to ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
