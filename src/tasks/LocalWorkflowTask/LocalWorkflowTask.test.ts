import { describe, expect, test } from 'bun:test'
import { readFile, rm } from 'fs/promises'
import type { AppState } from '../../state/AppState.js'
import type { SetAppState } from '../../Task.js'
import { cleanupTaskOutput } from '../../utils/task/diskOutput.js'
import { WORKFLOW_MAX_PROGRESS_ROWS } from '../../utils/workflows/constants.js'
import { getWorkflowRunPath } from '../../utils/workflows/paths.js'
import type { WorkflowProgressEvent } from '../../utils/workflows/types.js'
import {
  buildResumePrompt,
  buildWorkflowNotification,
  completeWorkflowTask,
  pauseWorkflowTask,
  registerWorkflowTask,
  updateWorkflowProgressBatch,
  type LocalWorkflowTaskState,
} from './LocalWorkflowTask.js'

/** A minimal AppState stand-in: these helpers only read and write `tasks`. */
function makeStore(task: LocalWorkflowTaskState): {
  setAppState: SetAppState
  get: () => LocalWorkflowTaskState
} {
  let state = { tasks: { [task.id]: task } } as unknown as AppState
  return {
    setAppState: updater => {
      state = updater(state)
    },
    get: () => state.tasks[task.id] as LocalWorkflowTaskState,
  }
}

function makeTask(taskId = 'w0000001'): LocalWorkflowTaskState {
  return registerWorkflowTask({
    taskId,
    definition: {
      version: 3,
      kind: 'state-machine',
      meta: { name: 'demo', title: 'Demo', description: 'Demo' },
      graph: {
        entry: 'input',
        nodes: [
          { id: 'input', type: 'start', title: '输入', outputSchema: {} },
          { id: 'output', type: 'end', title: '输出', inputSchema: {}, input: [{ target: [], source: { kind: 'workflow-input' } }] },
        ],
        edges: [{ source: 'input', target: 'output' }],
      },
    },
    definitionPath: '/tmp/demo.wf_abc12345-def.workflow.json',
    summary: 'Demo',
    workflowName: 'demo',
    workflowRunId: 'wf_abc12345-def',
  })
}

function agent(
  index: number,
  state: 'start' | 'progress' | 'done' | 'error',
  extra: Partial<Extract<WorkflowProgressEvent, { type: 'workflow_agent' }>> = {},
): WorkflowProgressEvent {
  return {
    type: 'workflow_agent',
    index,
    nodeId: `agent-${index}`,
    instanceId: `agent-${index}`,
    label: `a${index}`,
    state,
    ...extra,
  }
}

describe('updateWorkflowProgressBatch', () => {
  test('replaces an agent row in place and recomputes the totals', () => {
    const store = makeStore(makeTask())
    updateWorkflowProgressBatch(
      'w0000001',
      [agent(1, 'progress', { tokens: 10, toolCalls: 1 })],
      store.setAppState,
    )
    updateWorkflowProgressBatch(
      'w0000001',
      [
        agent(1, 'done', { tokens: 40, toolCalls: 3 }),
        agent(2, 'progress', { tokens: 5, toolCalls: 0 }),
      ],
      store.setAppState,
    )

    const task = store.get()
    expect(task.workflowProgress.filter(r => r.type === 'workflow_agent')).toHaveLength(2)
    expect(task.agentCount).toBe(2)
    expect(task.totalTokens).toBe(45)
    expect(task.totalToolCalls).toBe(3)
    expect(task.progressVersion).toBe(3)
  })

  test('phase rows are keyed separately from agent rows with the same index', () => {
    const store = makeStore(makeTask())
    updateWorkflowProgressBatch(
      'w0000001',
      [
        { type: 'workflow_phase', index: 1, title: 'Scan', kind: 'definition' },
        agent(1, 'done'),
      ],
      store.setAppState,
    )
    const rows = store.get().workflowProgress
    expect(rows).toHaveLength(2)
    expect(rows[0]?.type).toBe('workflow_phase')
    expect(rows[1]?.type).toBe('workflow_agent')
  })

  test('logs are trimmed before agent rows when the buffer overflows', () => {
    const store = makeStore(makeTask())
    const logs: WorkflowProgressEvent[] = Array.from(
      { length: WORKFLOW_MAX_PROGRESS_ROWS * 2 + 10 },
      (_unused, i) => ({ type: 'workflow_log', message: `line ${i}` }),
    )
    updateWorkflowProgressBatch(
      'w0000001',
      [agent(1, 'done', { tokens: 7 }), ...logs],
      store.setAppState,
    )

    const rows = store.get().workflowProgress
    expect(rows.length).toBeLessThanOrEqual(WORKFLOW_MAX_PROGRESS_ROWS + 1)
    expect(rows.some(r => r.type === 'workflow_agent')).toBe(true)
    // Oldest logs go first, so the newest line must survive.
    const kept = rows.filter(r => r.type === 'workflow_log')
    expect(kept.at(-1)).toEqual({
      type: 'workflow_log',
      message: `line ${logs.length - 1}`,
    })
    expect(store.get().totalTokens).toBe(7)
  })

  test('a settled task ignores late progress', () => {
    const task = makeTask()
    const store = makeStore({ ...task, status: 'completed' })
    updateWorkflowProgressBatch('w0000001', [agent(1, 'done')], store.setAppState)
    expect(store.get().workflowProgress).toHaveLength(0)
  })

  test('an empty batch does not bump the version', () => {
    const store = makeStore(makeTask())
    updateWorkflowProgressBatch('w0000001', [], store.setAppState)
    expect(store.get().progressVersion).toBe(0)
  })

  test('stores authoritative node events separately from phase and agent rows', () => {
    const store = makeStore(makeTask())
    updateWorkflowProgressBatch(
      'w0000001',
      [
        {
          type: 'workflow_node',
          sequence: 1,
          nodeId: 'check',
          instanceId: 'check',
          state: 'completed',
          branch: 'then',
          timestamp: 1,
        },
      ],
      store.setAppState,
    )
    expect(store.get().workflowProgress).toHaveLength(0)
    expect(store.get().workflowNodeEvents).toEqual([
      expect.objectContaining({ branch: 'then' }),
    ])
  })

  test('keeps the latest authoritative state for each graph edge', () => {
    const store = makeStore(makeTask())
    updateWorkflowProgressBatch('w0000001', [
      { type: 'workflow_edge', sequence: 1, edgeId: 'a:default->b', source: 'a', target: 'b', instanceId: 'a', state: 'selected', timestamp: 1 },
      { type: 'workflow_edge', sequence: 2, edgeId: 'a:default->b', source: 'a', target: 'b', instanceId: 'b', state: 'traversed', timestamp: 2 },
    ], store.setAppState)
    expect(store.get().workflowProgress).toEqual([
      expect.objectContaining({ type: 'workflow_edge', edgeId: 'a:default->b', state: 'traversed' }),
    ])
  })

  test('keeps the latest state for early graph nodes when loop events are compacted', () => {
    const store = makeStore(makeTask())
    const events: WorkflowProgressEvent[] = [{
      type: 'workflow_node',
      sequence: 1,
      nodeId: '$start',
      instanceId: '$start',
      state: 'completed',
      timestamp: 1,
    }]
    for (let index = 2; index <= 5_100; index++) {
      events.push({
        type: 'workflow_node',
        sequence: index,
        nodeId: 'loop-body',
        instanceId: `loop[${index}]/loop-body`,
        state: 'completed',
        timestamp: index,
      })
    }
    updateWorkflowProgressBatch('w0000001', events, store.setAppState)

    expect(store.get().workflowNodeEvents).toHaveLength(5_000)
    expect(store.get().workflowNodeEvents).toContainEqual(
      expect.objectContaining({ nodeId: '$start', state: 'completed' }),
    )
    expect(store.get().workflowNodeEvents.at(-1)).toMatchObject({
      nodeId: 'loop-body',
      sequence: 5_100,
    })
  })
})

describe('completeWorkflowTask', () => {
  test('resolves only after the durable progress snapshot is readable', async () => {
    const task = makeTask('wdurable1')
    try {
      const store = makeStore(task)
      updateWorkflowProgressBatch(
        task.id,
        [agent(1, 'done', { cached: true, agentId: 'agent-a' })],
        store.setAppState,
      )

      await completeWorkflowTask(task.id, 'done', 1, [], store.setAppState)

      const output = JSON.parse(await readFile(task.outputFile, 'utf8')) as {
        workflowProgress: WorkflowProgressEvent[]
      }
      expect(output.workflowProgress).toContainEqual(
        expect.objectContaining({
          type: 'workflow_agent',
          index: 1,
          cached: true,
        }),
      )
    } finally {
      await cleanupTaskOutput(task.id)
      await rm(getWorkflowRunPath(task.workflowRunId, task.workflowName ?? 'workflow'), {
        force: true,
      })
    }
  })
})

describe('pauseWorkflowTask', () => {
  test('marks every open graph node as interrupted', async () => {
    const task = makeTask('wpaused1')
    try {
      const store = makeStore(task)
      updateWorkflowProgressBatch(task.id, [
        {
          type: 'workflow_node',
          sequence: 1,
          nodeId: 'first',
          instanceId: 'first',
          state: 'completed',
          timestamp: 1,
        },
        {
          type: 'workflow_node',
          sequence: 2,
          nodeId: 'second',
          instanceId: 'second',
          state: 'running',
          timestamp: 2,
        },
      ], store.setAppState)

      expect(pauseWorkflowTask(task.id, store.setAppState)).toBe(true)
      expect(store.get().workflowNodeEvents).toEqual([
        expect.objectContaining({ nodeId: 'first', state: 'completed' }),
        expect.objectContaining({ nodeId: 'second', state: 'running' }),
        expect.objectContaining({ nodeId: 'second', state: 'interrupted' }),
      ])
    } finally {
      await cleanupTaskOutput(task.id)
      await rm(getWorkflowRunPath(task.workflowRunId, task.workflowName ?? 'workflow'), {
        force: true,
      })
    }
  })
})

describe('buildWorkflowNotification', () => {
  const base = {
    taskId: 'w0000001',
    summary: 'Demo',
    agentCount: 3,
    totalTokens: 1200,
    totalToolCalls: 9,
    durationMs: 4500,
    transcriptDir: '/tmp/run',
    definitionPath: '/tmp/demo.wf_abc12345-def.workflow.json',
    workflowRunId: 'wf_abc12345-def',
  }

  test('a completed run points at the journal and the replay call', () => {
    const message = buildWorkflowNotification({
      ...base,
      status: 'completed',
      result: ['ALPHA'],
    })
    expect(message).toContain('<status>completed</status>')
    expect(message).toContain('<workflow-run-id>wf_abc12345-def</workflow-run-id>')
    expect(message).toContain('/tmp/run/journal.jsonl')
    expect(message).toContain(
      'WorkflowRun({"definitionPath":"/tmp/demo.wf_abc12345-def.workflow.json","resumeFromRunId":"wf_abc12345-def"})',
    )
    expect(message).toContain('<result>["ALPHA"]</result>')
    expect(message).toContain(
      '<usage><agent_count>3</agent_count><subagent_tokens>1200</subagent_tokens><tool_uses>9</tool_uses><duration_ms>4500</duration_ms></usage>',
    )
  })

  test('a failed run offers recovery instead of the journal note', () => {
    const message = buildWorkflowNotification({
      ...base,
      status: 'failed',
      error: 'agent exploded',
      failures: ['parallel[1] failed: boom'],
    })
    expect(message).toContain('<recovery>')
    expect(message).toContain('Workflow journal: /tmp/run/journal.jsonl')
    expect(message).not.toContain('Per-agent results:')
    expect(message).toContain('<failures>\nparallel[1] failed: boom\n</failures>')
    expect(message).toContain('failed: agent exploded')
  })

  test('args are threaded into the resume call so a replay reruns the same input', () => {
    const message = buildWorkflowNotification({
      ...base,
      status: 'failed',
      error: 'nope',
      args: ['a.ts', 'b.ts'],
    })
    expect(message).toContain('"args":["a.ts","b.ts"]')
  })

  test('a catalog run resumes the latest draft instead of its frozen run copy', () => {
    const message = buildWorkflowNotification({
      ...base,
      status: 'failed',
      error: 'invalid output',
      workflowId: 'wfd_0123456789abcdef',
      workflowRevision: 2,
    })
    expect(message).toContain(
      'WorkflowRun({"workflowId":"wfd_0123456789abcdef","resumeFromRunId":"wf_abc12345-def"})',
    )
    expect(message).not.toContain('"definitionPath"')
    expect(message).not.toContain('"revision":2')
  })
})

describe('buildResumePrompt', () => {
  test('names the definition path and run id', () => {
    const prompt = buildResumePrompt({
      ...makeTask(),
      args: { q: 1 },
    })
    expect(prompt).toContain('"definitionPath":"/tmp/demo.wf_abc12345-def.workflow.json"')
    expect(prompt).toContain('"resumeFromRunId":"wf_abc12345-def"')
    expect(prompt).toContain('"args":{"q":1}')
  })

  test('quotes unusual definition paths as valid JSON', () => {
    const prompt = buildResumePrompt({
      ...makeTask(),
      definitionPath: "/tmp/it's-a-workflow.workflow.json",
    })
    expect(prompt).toContain('"definitionPath":"/tmp/it\'s-a-workflow.workflow.json"')
  })

  test('resumes a paused catalog workflow at the revision that was paused', () => {
    const prompt = buildResumePrompt({
      ...makeTask(),
      workflowId: 'wfd_0123456789abcdef',
      workflowRevision: 4,
    })
    expect(prompt).toContain(
      '"workflowId":"wfd_0123456789abcdef","revision":4,"resumeFromRunId":"wf_abc12345-def"',
    )
    expect(prompt).not.toContain('"definitionPath"')
  })
})
