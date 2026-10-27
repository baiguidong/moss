import { describe, expect, test } from 'bun:test'
import type { TaskState } from '../../tasks/types.js'
import { createTaskStateBase } from '../../Task.js'
import {
  AgentRegistryLimitError,
  buildAgentRegistry,
  canSpawnAgent,
  getAgentRegistryPolicy,
  toAgentRegistryEntry,
} from './agentRegistry.js'
import { evictTerminalTask, registerTask } from './framework.js'

function agentTask(
  id: string,
  options: { parentId?: string; depth?: number; status?: 'pending' | 'running' | 'completed' } = {},
): TaskState {
  return {
    ...createTaskStateBase(id, 'local_agent', id),
    type: 'local_agent',
    status: options.status ?? 'running',
    agentId: id,
    prompt: id,
    agentType: 'general-purpose',
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true,
    pendingMessages: [],
    retain: false,
    diskLoaded: false,
    ...(options.parentId ? { parentId: options.parentId } : {}),
    ...(options.depth !== undefined ? { depth: options.depth } : {}),
  }
}

describe('agent registry', () => {
  test('normalizes local and teammate task metadata into one view', () => {
    const task = {
      ...agentTask('agent-1', { depth: 2, parentId: 'parent' }),
      budget: { maxTurns: 5, usedTokens: 120, usedTurns: 2 },
    }
    const entry = toAgentRegistryEntry(task)
    expect(entry).toMatchObject({
      taskId: 'agent-1',
      agentId: 'agent-1',
      parentId: 'parent',
      depth: 2,
      status: 'running',
      needsInput: false,
    })
    expect(entry?.lastHeartbeat).toBeGreaterThan(0)
    expect(entry?.budget).toEqual({ maxTurns: 5, usedTokens: 120, usedTurns: 2 })
    expect(buildAgentRegistry({ [task.id]: task })).toEqual({ 'agent-1': entry })
  })

  test('counts only active agents for concurrency limits', () => {
    const tasks = {
      a: agentTask('a'),
      b: agentTask('b', { status: 'completed' }),
    }
    expect(canSpawnAgent(tasks, {}, { maxConcurrent: 1, maxDepth: 8 })).toEqual({
      allowed: false,
      reason: 'max_concurrent',
      depth: 0,
    })
    expect(canSpawnAgent({ b: tasks.b }, {}, { maxConcurrent: 1, maxDepth: 8 })).toEqual({
      allowed: true,
      depth: 0,
    })
  })

  test('derives nested depth from task id or stable agent id', () => {
    const parent = agentTask('task-parent', { depth: 2 })
    expect(canSpawnAgent({ parent }, { parentId: 'task-parent' }, { maxConcurrent: 10, maxDepth: 2 })).toEqual({
      allowed: false,
      reason: 'max_depth',
      depth: 3,
    })
    expect(canSpawnAgent({ parent }, { parentId: 'task-parent' }, { maxConcurrent: 10, maxDepth: 3 })).toEqual({
      allowed: true,
      depth: 3,
    })
    expect(canSpawnAgent({ parent }, { parentId: 'task-parent' }, { maxConcurrent: 10, maxDepth: 1 })).toEqual({
      allowed: false,
      reason: 'max_depth',
      depth: 3,
    })
  })

  test('reads safe positive policy overrides', () => {
    expect(getAgentRegistryPolicy({ MOSS_AGENT_MAX_CONCURRENT: '3', MOSS_AGENT_MAX_DEPTH: '2' })).toEqual({
      maxConcurrent: 3,
      maxDepth: 2,
    })
    expect(getAgentRegistryPolicy({ MOSS_AGENT_MAX_CONCURRENT: '-1', MOSS_AGENT_MAX_DEPTH: 'nope' })).toEqual({
      maxConcurrent: 64,
      maxDepth: 8,
    })
  })

  test('exposes a structured limit error', () => {
    const task = agentTask('agent-1')
    const decision = canSpawnAgent({ task }, {}, { maxConcurrent: 1, maxDepth: 8 })
    expect(decision.allowed).toBe(false)
    if (decision.allowed) throw new Error('expected a denied spawn')
    const error = new AgentRegistryLimitError(decision)
    expect(error.name).toBe('AgentRegistryLimitError')
    expect(error.decision.reason).toBe('max_concurrent')
    expect(error.message).toContain('并发 agent')
  })

  test('registerTask keeps task and registry metadata in sync', () => {
    let state = { tasks: {}, agentRegistry: {} } as any
    const setAppState = (update: (previous: any) => any) => {
      state = update(state)
    }
    const parent = agentTask('parent-task')
    registerTask(parent, setAppState)
    const child = agentTask('child-task', { parentId: 'parent-task' })
    registerTask(child, setAppState)

    expect(state.tasks['child-task'].depth).toBe(1)
    expect(state.agentRegistry['child-task']).toMatchObject({
      taskId: 'child-task',
      parentId: 'parent-task',
      depth: 1,
      status: 'running',
    })
  })

  test('evicting a terminal task removes its registry entry', () => {
    let state = { tasks: {}, agentRegistry: {} } as any
    const setAppState = (update: (previous: any) => any) => {
      state = update(state)
    }
    const task = {
      ...agentTask('terminal'),
      status: 'completed',
      notified: true,
      evictAfter: 0,
    }
    registerTask(task, setAppState)
    expect(state.agentRegistry.terminal).toBeDefined()
    evictTerminalTask('terminal', setAppState)
    expect(state.tasks.terminal).toBeUndefined()
    expect(state.agentRegistry.terminal).toBeUndefined()
  })
})
