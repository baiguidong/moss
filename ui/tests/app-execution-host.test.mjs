import { test, expect, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppExecutionHost } from '../src/apps/app-execution-host.mjs'
import { AppHostCapabilityRegistry } from '../../packages/app-runtime/src/capabilities/index.mjs'
import { APP_ERROR_CODES } from '../../packages/app-sdk/src/protocol/index.mjs'
import { createExecutionProtocolDefinitions, createExecutionClient, createTasksClient, validateExecutionHostOutput, validateExecutionHostEvent, validateExecutionHostInput } from '../../packages/app-sdk/src/execution/index.mjs'
const T = 'moss.tasks/v1', E = 'moss.agent-execution/v1'
const context = { appId: 'example.app', instanceId: 'default', owner: { userId: 'one' }, invocation: { sessionId: 'session' } }
const waitFor = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)) } throw new Error('Timed out') }
function setup(execute = async () => ({ value: { answer: 42 }, tokens: 3, toolCalls: 1 })) {
  const directory = mkdtempSync(path.join(tmpdir(), 'app-execution-'))
  const options = { directory, createSource: async () => ({ sessionId: 'session' }), execute }
  const host = new AppExecutionHost(options)
  const definitions = createExecutionProtocolDefinitions()
  const registry = new AppHostCapabilityRegistry({ protocols: definitions })
  const permissions = [...new Set(definitions.flatMap(d => Object.values(d.methods).map(m => m.permission)))]
  for (const definition of definitions) for (const method of Object.keys(definition.methods)) {
    registry.registerHandler(definition.protocol, method, (input, ctx) => host.handle(definition.protocol, method, input, ctx))
  }
  return { host, options, call: (protocol, method, input = {}, c = context) => registry.dispatch({
    ...c, protocol, method, input, protocols: [T, E], permissions, grants: permissions,
  }), close: async () => { await host.close(); rmSync(directory, { recursive: true, force: true }) } }
}
const request = task => ({ scopeRef: task.scopeRef, idempotencyKey: 'node-1', contextKey: 'node', prompt: 'Return answer', outputSchema: { type: 'object', required: ['answer'] } })
test('task and execution idempotency, owner isolation and chunked structured results', async () => {
  const f = setup()
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'task' })
    expect((await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'task' })).id).toBe(task.id)
    await expect(f.call(T, 'task.create', { idempotencyKey: 'run', title: 'changed' })).rejects.toThrow('idempotency')
    await expect(f.call(T, 'task.get', { taskId: task.id }, { ...context, instanceId: 'other' })).rejects.toThrow('scope')
    await expect(f.call(T, 'task.create', { idempotencyKey: 'evil', title: 'task', sessionId: 'forged' })).rejects.toMatchObject({ code: APP_ERROR_CODES.invalidInput })
    const [one, two] = await Promise.all([f.call(E, 'execution.start', request(task)), f.call(E, 'execution.start', request(task))])
    expect(one.id).toBe(two.id)
    await waitFor(() => f.host.tasks[task.id].executions[one.id].status === 'completed')
    expect(JSON.parse((await f.call(E, 'execution.result.read', { resultRef: one.id })).text)).toEqual({ answer: 42 })
    await expect(f.call(E, 'execution.result.read', { resultRef: one.id }, { ...context, owner: { userId: 'two' } })).rejects.toThrow('scope')
  } finally { await f.close() }
})

test('typed helpers validate real Host summaries, preserve structured results and use stable errors', async () => {
  const f = setup()
  const host = { request: f.call, on: () => () => {} }
  const tasks = createTasksClient(host), executions = createExecutionClient(host)
  try {
    expect(await executions.request('capabilities')).toMatchObject({ events: false })
    const task = await tasks.request('task.create', { idempotencyKey: 'contract', title: 'contract', limits: { maxCalls: 1 } })
    expect(task).not.toHaveProperty('owner')
    expect(task).not.toHaveProperty('source')
    await expect(tasks.request('task.get', { taskId: 'missing' })).rejects.toMatchObject({ code: APP_ERROR_CODES.notFound })
    await expect(tasks.request('task.update', { taskId: task.id, revision: 99 })).rejects.toMatchObject({ code: APP_ERROR_CODES.conflict, details: { currentRevision: 1 } })
    await expect(tasks.request('task.update', { taskId: task.id })).rejects.toMatchObject({ code: APP_ERROR_CODES.invalidInput })
    const execution = await executions.request('execution.start', request(task))
    await waitFor(() => f.host.tasks[task.id].executions[execution.id].status === 'completed')
    await expect(executions.request('execution.start', { ...request(task), idempotencyKey: 'over-limit' })).rejects.toMatchObject({ code: APP_ERROR_CODES.resourceExhausted })
    expect((await executions.request('execution.list', { taskId: task.id })).executions).toHaveLength(1)
    const events = (await executions.request('execution.events', { executionId: execution.id })).events
    expect(events.at(-1).type).toBe('completed')
    expect((await tasks.request('task.list', {})).tasks).toHaveLength(1)
    const result = { nested: [{ answer: 42, emoji: '🌱' }], empty: null }
    const finished = await tasks.request('task.finish', { taskId: task.id, revision: task.revision, status: 'completed', result })
    expect(finished.result).toEqual(result)
    for (const invalid of [{ ...finished, owner: context.owner }, { ...finished, status: 'unknown' }, { ...finished, revision: '1' }]) {
      expect(() => validateExecutionHostOutput(T, 'task.get', invalid)).toThrow(expect.objectContaining({ code: APP_ERROR_CODES.hostProtocol }))
    }
    expect(() => validateExecutionHostEvent(E, 'execution.changed', { taskId: task.id, execution, event: { ...events[0], sequence: -1 } })).toThrow()
    expect(() => validateExecutionHostOutput(T, 'toString', {})).toThrow()
    const broken = createTasksClient({ ...host, request: async () => ({ id: 'incomplete' }) })
    await expect(broken.request('task.get', { taskId: task.id })).rejects.toMatchObject({ code: APP_ERROR_CODES.hostProtocol })
  } finally { await f.close() }
})
test('same context serializes; different contexts respect task concurrency', async () => {
  let active = 0, peak = 0
  const releases = []
  const f = setup(async () => { active++; peak = Math.max(active, peak); await new Promise(r => releases.push(r)); active--; return { value: { answer: 1 }, tokens: 0, toolCalls: 0 } })
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'task', limits: { maxConcurrency: 2 } })
    for (const [key, ctx] of [['a', 'same'], ['b', 'same'], ['c', 'other']]) await f.call(E, 'execution.start', { ...request(task), idempotencyKey: key, contextKey: ctx })
    await waitFor(() => releases.length === 2); expect(peak).toBe(2)
    releases.shift()(); await waitFor(() => releases.length === 2)
    while (releases.length) releases.shift()()
    await waitFor(() => active === 0)
  } finally { await f.close() }
})
test('explicit session stop cascades into detached Agent executions', async () => {
  let aborted = false
  const f = setup(({ controller }) => new Promise((_, reject) => controller.signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')) })))
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'task' })
    const execution = await f.call(E, 'execution.start', request(task)); await waitFor(() => f.host.tasks[task.id].executions[execution.id].status === 'running')
    f.host.cancelSession('session'); await waitFor(() => aborted)
    expect((await f.call(T, 'task.get', { taskId: task.id })).status).toBe('cancelled')
    await expect(f.call(E, 'execution.start', { ...request(task), idempotencyKey: 'new' })).rejects.toThrow('accepting')
  } finally { await f.close() }
})
test('restart interrupts outstanding work; resume requires current revision and rotates scope', async () => {
  const f = setup()
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'task' }); await f.host.close()
    const restarted = new AppExecutionHost(f.options)
    try {
      const current = await restarted.handle(T, 'task.get', { taskId: task.id }, context); expect(current.status).toBe('interrupted')
      await expect(restarted.handle(T, 'task.resume', { taskId: task.id, revision: 100 }, context)).rejects.toThrow('revision')
      const resumed = await restarted.handle(T, 'task.resume', { taskId: task.id, revision: current.revision }, context)
      expect(resumed.scopeRef).not.toBe(task.scopeRef); expect(resumed.attempt).toBe(2)
    } finally { await restarted.close() }
  } finally { await f.close() }
})
test('invalid structured output fails and task completion notification is delivered once', async () => {
  const f = setup(async () => ({ value: {}, tokens: 0, toolCalls: 0 })); let deliveries = 0
  f.host.notify = async () => { deliveries++ }
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'task' })
    const execution = await f.call(E, 'execution.start', request(task)); await waitFor(() => f.host.tasks[task.id].executions[execution.id].status === 'failed')
    await f.call(T, 'task.finish', { taskId: task.id, revision: task.revision, status: 'failed', summary: 'schema failure' }); await waitFor(() => deliveries === 1)
    f.host.expire(); expect(deliveries).toBe(1)
  } finally { await f.close() }
})
test('resume reuses completed execution receipts even when App journal was lost', async () => {
  let calls = 0
  const f = setup(async () => { calls++; return { value: { answer: 42 }, tokens: 1, toolCalls: 0 } })
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'receipt test' })
    const execution = await f.call(E, 'execution.start', { ...request(task), contextKey: '__proto__' })
    await waitFor(() => f.host.tasks[task.id].executions[execution.id].status === 'completed')
    f.host.deactivate(context.appId)
    const current = await f.call(T, 'task.get', { taskId: task.id })
    const resumed = await f.call(T, 'task.resume', { taskId: task.id, revision: current.revision })
    const reused = await f.call(E, 'execution.start', { ...request(resumed), contextKey: '__proto__' })
    expect(reused.id).toBe(execution.id); expect(calls).toBe(1)
    await expect(f.call(E, 'execution.start', { ...request(resumed), contextKey: '__proto__', prompt: 'changed' })).rejects.toThrow('idempotency')
  } finally { await f.close() }
})

test('Host mandatory policy rejects creation and interrupts existing tasks after revocation', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'app-policy-'))
  let denied = true, sources = 0
  const host = new AppExecutionHost({ directory, authorize: async () => { if (denied) throw new Error('managed policy') }, createSource: async () => { sources++; return { sessionId: 'policy-session' } }, execute: async () => ({value:42}) })
  const context = {appId:'moss.workflow',instanceId:'default',owner:null}
  try {
    await expect(host.handle('moss.tasks/v1','task.create',{idempotencyKey:'policy',title:'policy'},context)).rejects.toThrow('managed policy')
    expect(sources).toBe(0)
    denied=false
    const task=await host.handle('moss.tasks/v1','task.create',{idempotencyKey:'policy',title:'policy'},context)
    denied=true;host.expire()
    await new Promise(resolve=>setTimeout(resolve,10))
    expect(host.tasks[task.id].status).toBe('cancelled')
  } finally { await host.close(); rmSync(directory,{recursive:true,force:true}) }
})

test('SQLite transaction failure rolls back task and event changes together', async () => {
  const f = setup()
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'transaction', title: 'original' })
    const execution = await f.call(E, 'execution.start', { ...request(task), prompt: '\nReturn answer' })
    await waitFor(() => f.host.tasks[task.id].executions[execution.id].status === 'completed')
    await f.host.flush()
    const before = (await f.host.store.request('load'))[task.id]
    const { executions, ...state } = before
    const { events, ...record } = executions[execution.id]
    await expect(f.host.store.request('save', [{ task: { ...state, title: 'must roll back' }, execution: record, event: events[0] }])).rejects.toThrow()
    const after = (await f.host.store.request('load'))[task.id]
    expect(after.title).toBe('original')
    expect(after.executions[execution.id].events).toEqual(events)
    await f.host.updateSource(task.id, { runtimeSessionId: 'runtime-1' })
    expect((await f.host.store.request('load'))[task.id].source.runtimeSessionId).toBe('runtime-1')
  } finally { await f.close() }
})

test('a failed observer does not suppress persisted state events', async () => {
  const f = setup()
  const warning = spyOn(console, 'warn').mockImplementation(() => {})
  const published = []
  f.host.onChanged = async () => { throw new Error('observer unavailable') }
  f.host.publishEvent = async (_target, protocol, name, data) => {
    const stored = await f.host.store.request('load')
    published.push({ protocol, name, data, stored })
  }
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'observer', title: 'observer' })
    const execution = await f.call(E, 'execution.start', request(task))
    await waitFor(() => published.some(item => item.name === 'execution.changed' && item.data.event.type === 'completed'))
    const completion = published.find(item => item.name === 'execution.changed' && item.data.event.type === 'completed')
    expect(completion.stored[task.id].executions[execution.id].status).toBe('completed')
    expect(warning).toHaveBeenCalled()
    expect((await f.call(E, 'execution.get', { executionId: execution.id })).status).toBe('completed')
  } finally { await f.close(); warning.mockRestore() }
})

test('range reads preserve UTF-16 offsets across surrogate pairs and restart', async () => {
  const f = setup(async () => ({ value: { answer: '🌱'.repeat(300) }, tokens: 1, toolCalls: 0 }))
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'ranges', title: 'ranges' })
    const execution = await f.call(E, 'execution.start', request(task))
    await waitFor(() => f.host.tasks[task.id].executions[execution.id].status === 'completed')
    let result = '', offset = 0
    for (;;) {
      const chunk = await f.call(E, 'execution.result.read', { resultRef: execution.id, offset, limit: 13 })
      result += chunk.text
      if (chunk.nextOffset === null) break
      expect(chunk.nextOffset).toBeGreaterThan(offset)
      offset = chunk.nextOffset
    }
    expect(JSON.parse(result)).toEqual({ answer: '🌱'.repeat(300) })
    await f.host.close()
    const restarted = new AppExecutionHost(f.options)
    try { expect((await restarted.handle(E, 'execution.result.read', { resultRef: execution.id }, context)).text).toBe(result) }
    finally { await restarted.close() }
  } finally { await f.close() }
})

test('task cursors survive progress updates and restarts, isolate owners and reset after retention', async () => {
  const f = setup()
  let reloaded
  try {
    const cursor = (await f.call(T, 'task.changes')).nextCursor
    const tasks = []
    for (let i = 0; i < 4; i++) tasks.push(await f.call(T, 'task.create', { idempotencyKey: 'page-' + i, title: 'Task ' + i }))
    const first = await f.call(T, 'task.list', { limit: 2 })
    expect(first.tasks.map(t => t.id)).toEqual([tasks[3].id, tasks[2].id])
    await f.call(T, 'task.update', { taskId: tasks[0].id, revision: 1, summary: 'updated' })
    const second = await f.call(T, 'task.list', { limit: 2, cursor: first.nextCursor })
    expect(second.tasks.map(t => t.id)).toEqual([tasks[1].id, tasks[0].id])
    expect(second.nextCursor).toBeNull()
    const changes = await f.call(T, 'task.changes', { afterCursor: cursor, limit: 2 })
    expect(changes.hasMore).toBe(true)
    expect(changes.changes.map(c => c.task.id)).toEqual([tasks[0].id, tasks[1].id])
    expect((await f.call(T, 'task.changes', { afterCursor: cursor }, { ...context, instanceId: 'other' })).reset).toBe(true)
    await expect(f.call(T, 'task.list', { cursor }, context)).rejects.toMatchObject({ code: APP_ERROR_CODES.invalidInput })
    await f.host.close()
    reloaded = new AppExecutionHost(f.options)
    await reloaded.ready
    const afterRestart = await reloaded.handle(T, 'task.changes', { afterCursor: changes.nextCursor }, context)
    expect(afterRestart.reset).toBe(false)
    expect(afterRestart.changes.some(c => c.task.status === 'interrupted')).toBe(true)
    await reloaded.store.request('prune', { now: Date.now() + 8 * 86400000 })
    expect((await reloaded.handle(T, 'task.changes', { afterCursor: cursor }, context)).reset).toBe(true)
    expect((await reloaded.listSessionHistory('session')).length).toBe(4)
  } finally { await reloaded?.close(); await f.close() }
})

test('settled history has bounded memory, loads on demand and has consistent expiration', async () => {
  const f = setup()
  try {
    let first
    for (let i = 0; i < 105; i++) {
      const task = await f.call(T, 'task.create', { idempotencyKey: 'history-' + i, title: 'Task' })
      first ??= task
      await f.call(T, 'task.cancel', { taskId: task.id })
    }
    expect(Object.keys(f.host.tasks).length).toBeLessThanOrEqual(100)
    expect(f.host.tasks[first.id]).toBeUndefined()
    const historic = await f.call(T, 'task.get', { taskId: first.id })
    expect(historic.status).toBe('cancelled')
    expect(historic.expiresAt).toBeGreaterThan(Date.now())
    expect((await f.call(T, 'task.create', { idempotencyKey: 'history-0', title: 'Task' })).id).toBe(first.id)
    await f.host.hydrate({ taskId: first.id })
    const expired = f.host.tasks[first.id]
    expired.updatedAt = Date.now() - 31 * 86400000
    await f.host.persist(expired)
    await expect(f.call(T, 'task.get', { taskId: first.id })).rejects.toMatchObject({ code: APP_ERROR_CODES.notFound })
    const replacement = await f.call(T, 'task.create', { idempotencyKey: 'history-0', title: 'Task' })
    expect(replacement.id).not.toBe(first.id)
    expect((await f.call(T, 'task.create', { idempotencyKey: 'history-0', title: 'Task' })).id).toBe(replacement.id)
    await f.host.store.request('prune')
    const row = await f.host.store.request('load', { taskId: first.id })
    expect(row).toEqual({})
  } finally { await f.close() }
})
