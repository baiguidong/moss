import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppExecutionHost } from '../src/apps/app-execution-host.mjs'
const T = 'moss.tasks/v1', E = 'moss.agent-execution/v1'
const context = { appId: 'example.app', instanceId: 'default', owner: { userId: 'one' }, invocation: { sessionId: 'session' } }
const waitFor = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)) } throw new Error('Timed out') }
function setup(execute = async () => ({ value: { answer: 42 }, tokens: 3, toolCalls: 1 })) {
  const directory = mkdtempSync(path.join(tmpdir(), 'app-execution-'))
  const options = { directory, createSource: async () => ({ sessionId: 'session' }), execute }
  const host = new AppExecutionHost(options)
  return { host, options, call: (p, m, i = {}, c = context) => host.handle(p, m, i, c), close: () => { host.close(); rmSync(directory, { recursive: true, force: true }) } }
}
const request = task => ({ scopeRef: task.scopeRef, idempotencyKey: 'node-1', contextKey: 'node', prompt: 'Return answer', outputSchema: { type: 'object', required: ['answer'] } })
test('task and execution idempotency, owner isolation and chunked structured results', async () => {
  const f = setup()
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'task' })
    expect((await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'task' })).id).toBe(task.id)
    await expect(f.call(T, 'task.create', { idempotencyKey: 'run', title: 'changed' })).rejects.toThrow('idempotency')
    await expect(f.call(T, 'task.get', { taskId: task.id }, { ...context, instanceId: 'other' })).rejects.toThrow('scope')
    await expect(f.call(T, 'task.create', { idempotencyKey: 'evil', title: 'task', sessionId: 'forged' })).rejects.toThrow('Unknown field')
    const [one, two] = await Promise.all([f.call(E, 'execution.start', request(task)), f.call(E, 'execution.start', request(task))])
    expect(one.id).toBe(two.id)
    await waitFor(() => f.host.tasks[task.id].executions[one.id].status === 'completed')
    expect(JSON.parse((await f.call(E, 'execution.result.read', { resultRef: one.id })).text)).toEqual({ answer: 42 })
    await expect(f.call(E, 'execution.result.read', { resultRef: one.id }, { ...context, owner: { userId: 'two' } })).rejects.toThrow('scope')
  } finally { f.close() }
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
  } finally { f.close() }
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
  } finally { f.close() }
})
test('restart interrupts outstanding work; resume requires current revision and rotates scope', async () => {
  const f = setup()
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'task' }); f.host.close()
    const restarted = new AppExecutionHost(f.options)
    try {
      const current = await restarted.handle(T, 'task.get', { taskId: task.id }, context); expect(current.status).toBe('interrupted')
      await expect(restarted.handle(T, 'task.resume', { taskId: task.id, revision: 100 }, context)).rejects.toThrow('revision')
      const resumed = await restarted.handle(T, 'task.resume', { taskId: task.id, revision: current.revision }, context)
      expect(resumed.scopeRef).not.toBe(task.scopeRef); expect(resumed.attempt).toBe(2)
    } finally { restarted.close() }
  } finally { f.close() }
})
test('invalid structured output fails and task completion notification is delivered once', async () => {
  const f = setup(async () => ({ value: {}, tokens: 0, toolCalls: 0 })); let deliveries = 0
  f.host.notify = async () => { deliveries++ }
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'task' })
    const execution = await f.call(E, 'execution.start', request(task)); await waitFor(() => f.host.tasks[task.id].executions[execution.id].status === 'failed')
    await f.call(T, 'task.finish', { taskId: task.id, revision: task.revision, status: 'failed', summary: 'schema failure' }); await waitFor(() => deliveries === 1)
    f.host.expire(); expect(deliveries).toBe(1)
  } finally { f.close() }
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
  } finally { f.close() }
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
  } finally { host.close(); rmSync(directory,{recursive:true,force:true}) }
})
