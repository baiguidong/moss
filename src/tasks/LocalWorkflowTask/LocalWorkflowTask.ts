import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import {
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TASK_TYPE_TAG,
  TOOL_USE_ID_TAG,
  WORKFLOW_RUN_ID_TAG,
} from '../../constants/xml.js'
import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { createTaskStateBase } from '../../Task.js'
import { createAbortController } from '../../utils/abortController.js'
import { logForDebugging } from '../../utils/debug.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { emitTaskTerminatedSdk } from '../../utils/sdkEventQueue.js'
import {
  evictTaskOutput,
  getTaskOutputPath,
  writeTaskOutput,
} from '../../utils/task/diskOutput.js'
import { updateTaskState } from '../../utils/task/framework.js'
import { WORKFLOW_MAX_PROGRESS_ROWS } from '../../utils/workflows/constants.js'
import {
  getWorkflowRunPath,
  getWorkflowTranscriptDir,
} from '../../utils/workflows/paths.js'
import { asAgentId } from '../../types/ids.js'
import type { WorkflowGraph } from '../../utils/workflows/graph.js'
import type { WorkflowDefinitionV3 } from '../../utils/workflows/definition.js'
import {
  isDurableWorkflowEvent,
  type WorkflowNodeEvent,
  type WorkflowProgressEvent,
} from '../../utils/workflows/types.js'

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  /** Validated definition used by both the executor and the visual graph. */
  definition: WorkflowDefinitionV3
  definitionPath?: string
  /** Kept under `prompt` too so generic task consumers can show something. */
  prompt: string
  args?: unknown
  summary?: string
  workflowName?: string
  workflowId?: string
  workflowRevision?: number
  runMode?: 'test' | 'run'
  title?: string
  workflowRunId: string
  graph?: WorkflowGraph
  mermaid?: string
  graphError?: string
  workflowNodeEvents: WorkflowNodeEvent[]
  ownerAgentId?: string
  workflowProgress: WorkflowProgressEvent[]
  /** Bumped on every applied batch so views can diff cheaply. */
  progressVersion: number
  agentCount: number
  totalTokens: number
  totalToolCalls: number
  logs: string[]
  result?: unknown
  error?: string
  abortController?: AbortController
  /** Per-agent controllers, so a single agent can be skipped or restarted. */
  agentControllers?: Map<string, AbortController>
  evictAfter?: number
  /** Keep completed workflows available as session history in desktop UI. */
  retain: boolean
}

const WORKFLOW_MAX_NODE_EVENTS = 5_000

export function isLocalWorkflowTask(
  task: unknown,
): task is LocalWorkflowTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'local_workflow'
  )
}

export function registerWorkflowTask(params: {
  taskId: string
  definition: WorkflowDefinitionV3
  definitionPath?: string
  args?: unknown
  summary?: string
  workflowName?: string
  workflowId?: string
  workflowRevision?: number
  runMode?: 'test' | 'run'
  title?: string
  workflowRunId: string
  graph?: WorkflowGraph
  mermaid?: string
  graphError?: string
  ownerAgentId?: string
  toolUseId?: string
  startTime?: number
}): LocalWorkflowTaskState {
  const base = createTaskStateBase(
    params.taskId,
    'local_workflow',
    params.summary ?? 'Dynamic workflow',
    params.toolUseId,
  )
  return {
    ...base,
    ...(params.startTime !== undefined ? { startTime: params.startTime } : {}),
    type: 'local_workflow',
    status: 'running',
    definition: params.definition,
    definitionPath: params.definitionPath,
    args: params.args,
    prompt: params.definition.meta.description,
    summary: params.summary,
    workflowName: params.workflowName,
    workflowId: params.workflowId,
    workflowRevision: params.workflowRevision,
    runMode: params.runMode,
    title: params.title,
    workflowRunId: params.workflowRunId,
    graph: params.graph,
    mermaid: params.mermaid,
    graphError: params.graphError,
    workflowNodeEvents: [],
    ownerAgentId: params.ownerAgentId,
    workflowProgress: [],
    progressVersion: 0,
    agentCount: 0,
    totalTokens: 0,
    totalToolCalls: 0,
    logs: [],
    abortController: createAbortController(),
    agentControllers: new Map(),
    retain: true,
  }
}

/**
 * Fold a batch of progress events into the task's state.
 *
 * Agent and phase rows are keyed by `type:index` and overwritten in place, so
 * a run that emits hundreds of updates for the same twenty agents keeps twenty
 * rows. Only logs accumulate, and they are the first thing trimmed.
 */
export function updateWorkflowProgressBatch(
  taskId: string,
  events: WorkflowProgressEvent[],
  setAppState: SetAppState,
): void {
  if (events.length === 0) return
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task

    const rows = [...task.workflowProgress]
    const nodeEvents = [...task.workflowNodeEvents]
    const rowIndexByKey = new Map<string, number>()
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
      if (row.type === 'workflow_agent' || row.type === 'workflow_phase') {
        rowIndexByKey.set(`${row.type}:${row.index}`, i)
      } else if (row.type === 'workflow_edge') {
        rowIndexByKey.set(`${row.type}:${row.edgeId}`, i)
      }
    }

    let agentCount = task.agentCount
    let appendedLogs = false
    for (const event of events) {
      if (event.type === 'workflow_node') {
        nodeEvents.push(event)
        continue
      }
      if (event.type === 'workflow_log') {
        rows.push(event)
        appendedLogs = true
        continue
      }
      if (event.type === 'workflow_edge') {
        const key = `${event.type}:${event.edgeId}`
        const existing = rowIndexByKey.get(key)
        if (existing !== undefined) rows[existing] = event
        else {
          rowIndexByKey.set(key, rows.length)
          rows.push(event)
        }
        continue
      }
      const key = `${event.type}:${event.index}`
      const existing = rowIndexByKey.get(key)
      if (existing !== undefined) rows[existing] = event
      else {
        rowIndexByKey.set(key, rows.length)
        rows.push(event)
      }
      if (event.type === 'workflow_agent') {
        agentCount = Math.max(agentCount, event.index)
      }
    }

    const trimmed =
      appendedLogs && rows.length > WORKFLOW_MAX_PROGRESS_ROWS * 2
        ? dropOldestLogs(rows, rows.length - WORKFLOW_MAX_PROGRESS_ROWS)
        : rows

    let totalTokens = 0
    let totalToolCalls = 0
    for (const row of trimmed) {
      if (row.type !== 'workflow_agent') continue
      totalTokens += row.tokens ?? 0
      totalToolCalls += row.toolCalls ?? 0
    }

    return {
      ...task,
      workflowProgress: trimmed,
      workflowNodeEvents: compactWorkflowNodeEvents(nodeEvents),
      progressVersion: task.progressVersion + events.length,
      agentCount,
      totalTokens,
      totalToolCalls,
    }
  })
}

function dropOldestLogs(
  rows: WorkflowProgressEvent[],
  toDrop: number,
): WorkflowProgressEvent[] {
  let remaining = toDrop
  const kept: WorkflowProgressEvent[] = []
  for (const row of rows) {
    if (remaining > 0 && row.type === 'workflow_log') {
      remaining--
      continue
    }
    kept.push(row)
  }
  return kept
}

function settleWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
  status: 'completed' | 'failed' | 'killed' | 'paused',
  patch: Partial<LocalWorkflowTaskState>,
): LocalWorkflowTaskState | null {
  let settled: LocalWorkflowTaskState | null = null
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    task.abortController?.abort()
    const endTime = Date.now()
    const workflowNodeEvents = status === 'killed' || status === 'paused'
      ? closeOpenWorkflowNodes(
        task.workflowNodeEvents,
        status === 'killed' ? 'cancelled' : 'interrupted',
        endTime,
      )
      : task.workflowNodeEvents
    const next = {
      ...task,
      ...patch,
      status,
      endTime,
      workflowNodeEvents,
      progressVersion: task.progressVersion + (workflowNodeEvents.length - task.workflowNodeEvents.length),
      abortController: undefined,
      agentControllers: undefined,
    }
    settled = next
    return next
  })
  return settled
}

function closeOpenWorkflowNodes(
  events: WorkflowNodeEvent[],
  state: 'cancelled' | 'interrupted',
  timestamp: number,
): WorkflowNodeEvent[] {
  const latestByInstance = new Map<string, WorkflowNodeEvent>()
  let sequence = 0
  for (const event of events) {
    latestByInstance.set(event.instanceId, event)
    sequence = Math.max(sequence, event.sequence)
  }
  const terminal = new Set<WorkflowNodeEvent['state']>([
    'completed',
    'blocked',
    'failed',
    'skipped',
    'cancelled',
    'interrupted',
  ])
  const closing = [...latestByInstance.values()]
    .filter(event => !terminal.has(event.state))
    .sort((left, right) => left.sequence - right.sequence)
    .map(event => ({
      ...event,
      sequence: ++sequence,
      state,
      timestamp,
    }))
  return compactWorkflowNodeEvents([...events, ...closing])
}

/**
 * Bound high-cardinality loop/foreach history without losing the latest
 * authoritative state for any static graph node (including Start and End).
 */
function compactWorkflowNodeEvents(events: WorkflowNodeEvent[]): WorkflowNodeEvent[] {
  if (events.length <= WORKFLOW_MAX_NODE_EVENTS) return events
  const latestIndexByNode = new Map<string, number>()
  events.forEach((event, index) => latestIndexByNode.set(event.nodeId, index))
  const keep = new Set(latestIndexByNode.values())
  for (let index = events.length - 1; index >= 0 && keep.size < WORKFLOW_MAX_NODE_EVENTS; index--) {
    keep.add(index)
  }
  return [...keep]
    .sort((left, right) => left - right)
    .map(index => events[index]!)
}

export function completeWorkflowTask(
  taskId: string,
  result: unknown,
  agentCount: number,
  logs: string[],
  setAppState: SetAppState,
): Promise<void> {
  const settled = settleWorkflowTask(taskId, setAppState, 'completed', {
    result,
    agentCount,
    logs,
  })
  if (!settled) return Promise.resolve()
  return writeWorkflowOutput(settled)
}

export function failWorkflowTask(
  taskId: string,
  error: string,
  agentCount: number,
  logs: string[],
  setAppState: SetAppState,
): Promise<void> {
  const settled = settleWorkflowTask(taskId, setAppState, 'failed', {
    error,
    agentCount,
    logs,
  })
  if (!settled) return Promise.resolve()
  return evictTaskOutput(taskId).then(() => writeWorkflowOutput(settled))
}

/** Stop the run but keep it resumable: the journal on disk is still valid. */
export function pauseWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): boolean {
  const settled = settleWorkflowTask(taskId, setAppState, 'paused', {
    notified: true,
  })
  if (settled) void writeWorkflowOutput(settled)
  return settled !== null
}

export function killWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): boolean {
  const settled = settleWorkflowTask(taskId, setAppState, 'killed', {})
  if (!settled) return false
  void evictTaskOutput(taskId)
  void writeWorkflowOutput(settled)
  enqueueWorkflowNotification({
    taskId,
    summary: settled.summary ?? settled.description,
    status: 'killed',
    agentCount: settled.agentCount,
    totalTokens: settled.totalTokens,
    totalToolCalls: settled.totalToolCalls,
    durationMs: Date.now() - settled.startTime,
    toolUseId: settled.toolUseId,
    transcriptDir: getWorkflowTranscriptDir(settled.workflowRunId),
    definitionPath: settled.definitionPath,
    workflowId: settled.workflowId,
    workflowRevision: settled.workflowRevision,
    workflowRunId: settled.workflowRunId,
    args: settled.args,
    setAppState,
  })
  return true
}

function abortWorkflowAgent(
  taskId: string,
  agentKey: string,
  reason: 'user-skip' | 'user-retry',
  setAppState: SetAppState,
): boolean {
  let aborted = false
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    const controller = task.agentControllers?.get(agentKey)
    if (controller && !controller.signal.aborted) {
      controller.abort(new DOMException(reason, 'AbortError'))
      aborted = true
    }
    return task
  })
  return aborted
}

export function skipWorkflowAgent(
  taskId: string,
  agentKey: string,
  setAppState: SetAppState,
): boolean {
  return abortWorkflowAgent(taskId, agentKey, 'user-skip', setAppState)
}

export function retryWorkflowAgent(
  taskId: string,
  agentKey: string,
  setAppState: SetAppState,
): boolean {
  return abortWorkflowAgent(taskId, agentKey, 'user-retry', setAppState)
}

/** The `WorkflowRun(...)` call that picks a stopped run back up. */
export function buildResumePrompt(task: LocalWorkflowTaskState): string {
  return `Resume the paused workflow by calling: ${buildResumeCall({
    definitionPath: task.definitionPath,
    workflowId: task.workflowId,
    revision: task.workflowRevision,
    workflowRunId: task.workflowRunId,
    args: task.args,
  })} — completed Agent nodes return cached results.`
}

export function enqueueWorkflowNotification(params: {
  taskId: string
  summary: string
  status: 'completed' | 'failed' | 'killed'
  result?: unknown
  error?: string
  failures?: string[]
  agentCount: number
  totalTokens: number
  totalToolCalls: number
  durationMs: number
  toolUseId?: string
  transcriptDir?: string
  definitionPath?: string
  workflowId?: string
  workflowRevision?: number
  workflowRunId?: string
  args?: unknown
  setAppState: SetAppState
}): void {
  let shouldEnqueue = false
  let ownerAgentId: string | undefined
  updateTaskState<LocalWorkflowTaskState>(
    params.taskId,
    params.setAppState,
    task => {
      if (task.notified) return task
      shouldEnqueue = true
      ownerAgentId = task.ownerAgentId
      return { ...task, notified: true }
    },
  )
  if (!shouldEnqueue) return

  const message = buildWorkflowNotification(params)
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification',
    agentId: ownerAgentId ? asAgentId(ownerAgentId) : undefined,
  })
  // Root notifications are converted into SDK terminal events when print.ts
  // drains the command. An agent-owned workflow notification is consumed by
  // its parent loop, so it needs an explicitly owned SDK bookend here.
  if (ownerAgentId) {
    emitTaskTerminatedSdk(
      params.taskId,
      params.status === 'killed' ? 'stopped' : params.status,
      {
        toolUseId: params.toolUseId,
        summary: params.summary,
        outputFile: getTaskOutputPath(params.taskId),
        usage: {
          total_tokens: params.totalTokens,
          tool_uses: params.totalToolCalls,
          duration_ms: params.durationMs,
        },
      },
    )
  }
}

/**
 * The `<task-notification>` the model reads when a run settles.
 *
 * The recovery and journal hints matter: without the exact `WorkflowRun({...})`
 * call and the journal path, a model looking at an empty result has no way to
 * tell "the agents returned nothing" from "post-processing dropped it".
 */
export function buildWorkflowNotification(params: {
  taskId: string
  summary: string
  status: 'completed' | 'failed' | 'killed'
  result?: unknown
  error?: string
  failures?: string[]
  agentCount: number
  totalTokens: number
  totalToolCalls: number
  durationMs: number
  toolUseId?: string
  transcriptDir?: string
  definitionPath?: string
  workflowId?: string
  workflowRevision?: number
  workflowRunId?: string
  args?: unknown
}): string {
  const {
    taskId,
    summary,
    status,
    result,
    error,
    failures,
    agentCount,
    totalTokens,
    totalToolCalls,
    durationMs,
    toolUseId,
    transcriptDir,
    definitionPath,
    workflowId,
    workflowRevision,
    workflowRunId,
    args,
  } = params

  const headline =
    status === 'completed'
      ? `Dynamic workflow "${summary}" completed`
      : status === 'failed'
        ? `Dynamic workflow "${summary}" failed: ${error || 'Unknown error'}`
        : `Dynamic workflow "${summary}" was stopped`

  const resumeCall =
    (workflowId || definitionPath) && workflowRunId
      ? buildResumeCall({
        definitionPath,
        workflowId,
        workflowRunId,
        args,
        // A catalog failure is commonly followed by WorkflowEdit. Resolve its
        // latest draft instead of replaying the frozen run copy. File-backed
        // runs still resume from their caller-owned path.
        revision: workflowId ? undefined : workflowRevision,
      })
      : undefined

  const sections: string[] = []
  if (status !== 'completed') {
    const recovery: string[] = []
    if (resumeCall) {
      recovery.push(`To resume after editing the definition, call: ${resumeCall}`)
    }
    if (transcriptDir) recovery.push(`Workflow journal: ${transcriptDir}/journal.jsonl`)
    if (recovery.length > 0) {
      sections.push(`\n<recovery>\n${recovery.join('\n')}\n</recovery>`)
    }
  } else if (transcriptDir) {
    const notes = [
      `Per-agent results: ${transcriptDir}/journal.jsonl — one {"type":"result",...} line per completed agent with its full return value.`,
      'If the result above is empty or unexpected, Read this file BEFORE diagnosing — do not assume agents returned non-empty results.',
    ]
    if (resumeCall) {
      notes.push(
        `To re-run with edited post-processing: ${resumeCall} — agents whose (prompt, opts) are unchanged replay from cache.`,
      )
    }
    sections.push(`\n<transcripts>\n${notes.join('\n')}\n</transcripts>`)
  }
  if (failures && failures.length > 0) {
    sections.push(`\n<failures>\n${failures.join('\n')}\n</failures>`)
  }

  const resultSection =
    result === undefined
      ? ''
      : `\n<result>${safeJson(result)}</result>`
  const toolUseIdLine = toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>`
    : ''

  return `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${TASK_TYPE_TAG}>local_workflow</${TASK_TYPE_TAG}>
<${WORKFLOW_RUN_ID_TAG}>${workflowRunId ?? ''}</${WORKFLOW_RUN_ID_TAG}>
<${OUTPUT_FILE_TAG}>${getTaskOutputPath(taskId)}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${headline}</${SUMMARY_TAG}>${resultSection}${sections.join('')}
<usage><agent_count>${agentCount}</agent_count><subagent_tokens>${totalTokens}</subagent_tokens><tool_uses>${totalToolCalls}</tool_uses><duration_ms>${durationMs}</duration_ms></usage>
</${TASK_NOTIFICATION_TAG}>`
}

async function writeWorkflowOutput(task: LocalWorkflowTaskState): Promise<void> {
  const snapshot = JSON.stringify(
    {
      version: 3,
      taskId: task.id,
      description: task.description,
      status: task.status,
      startTime: task.startTime,
      endTime: task.endTime,
      definitionPath: task.definitionPath,
      args: task.args,
      summary: task.summary,
      workflowName: task.workflowName,
      workflowId: task.workflowId,
      workflowRevision: task.workflowRevision,
      runMode: task.runMode,
      workflowRunId: task.workflowRunId,
      agentCount: task.agentCount,
      logs: task.logs,
      result: task.result,
      error: task.error,
      workflowProgress: task.workflowProgress.filter(isDurableWorkflowEvent),
      workflowNodeEvents: task.workflowNodeEvents,
      totalTokens: task.totalTokens,
      totalToolCalls: task.totalToolCalls,
      definition: task.definition,
      graph: task.graph,
      mermaid: task.mermaid,
      graphError: task.graphError,
    },
    null,
    2,
  )
  try {
    await writeTaskOutput(task.id, snapshot)
    const runPath = getWorkflowRunPath(
      task.workflowRunId,
      task.workflowName ?? 'workflow',
    )
    await mkdir(dirname(runPath), { recursive: true })
    await writeFile(runPath, snapshot, { encoding: 'utf8', mode: 0o600 })
  } catch (error) {
    logForDebugging(
      `Failed to write workflow output for ${task.id}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function buildResumeCall(input: {
  definitionPath?: string
  workflowId?: string
  revision?: number
  workflowRunId: string
  args: unknown
}): string {
  const source = input.workflowId
    ? {
      workflowId: input.workflowId,
      ...(input.revision !== undefined ? { revision: input.revision } : {}),
    }
    : { definitionPath: input.definitionPath }
  return `WorkflowRun(${JSON.stringify({
    ...source,
    resumeFromRunId: input.workflowRunId,
    ...(input.args !== undefined ? { args: input.args } : {}),
  })})`
}

function safeJson(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? 'null'
  } catch {
    return '[unserializable result]'
  }
}

export const LocalWorkflowTask: Task = {
  name: 'LocalWorkflowTask',
  type: 'local_workflow',
  async kill(taskId, setAppState) {
    killWorkflowTask(taskId, setAppState)
  },
}
