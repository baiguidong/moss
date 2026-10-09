import { test, expect } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AppRuntimeHost, defaultInstanceId, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'
import { createExecutionProtocolDefinitions } from '../../packages/app-sdk/src/execution/index.mjs'
import { AppExecutionHost } from '../src/apps/app-execution-host.mjs'
import { EventEmitter } from 'node:events'
import { registerAppUiRequests } from '../src/apps/app-ui-requests.mjs'
import { createAppClient } from '../../packages/app-sdk/src/ui/index.mjs'

const appId = 'fixture.execution'
const instanceId = defaultInstanceId(appId)
const T = 'moss.tasks/v1', E = 'moss.agent-execution/v1'
const nodeExecutable = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

for (const reason of ['revoke', 'abort', 'timeout', 'window']) test(`UI Host ${reason} while package loading never dispatches the handler`, async () => {
  const f = await setup()
  const entered = deferred(), release = deferred()
  const original = f.runtime.getActivePackage.bind(f.runtime)
  let pause = true, calls = 0
  const handlers = new Map(), sender = Object.assign(new EventEmitter(), { id: 1 })
  const ui = registerAppUiRequests({ ipc: { handle: (name, handler) => handlers.set(name, handler) }, getState: () => ({ id: appId, runtime: f.runtime }) })
  const request = (method, payload) => handlers.get(`app-ui:host:${method}`)({ sender }, payload)
  const client = createAppClient({ host: {
    request: (protocol, method, input, options) => request('request', { protocol, method, input, ...options }),
    cancel: requestId => Promise.resolve(request('cancel', { requestId })),
  } })
  let pending
  try {
    const handle = f.host.handle.bind(f.host)
    f.host.handle = (...args) => { calls++; return handle(...args) }
    f.runtime.getActivePackage = async (...args) => {
      if (pause) { pause = false; entered.resolve(); await release.promise }
      return original(...args)
    }
    const controller = new AbortController()
    pending = client.host.request(T, 'task.list', {}, { signal: controller.signal, timeoutMs: reason === 'timeout' ? 100 : 2000 }).catch(error => error)
    await entered.promise
    if (reason === 'revoke') await f.runtime.setAppGrants(appId, [])
    if (reason === 'abort') controller.abort()
    if (reason === 'window') sender.emit('destroyed')
    const error = await pending
    expect(error.code).toBe(reason === 'timeout' ? 'APP_HOST_TIMEOUT' : 'APP_ACTION_CANCELED')
    release.resolve()
    await waitFor(() => f.runtime.hostRequests.pending.size === 0)
    expect(calls).toBe(0)
  } finally { release.resolve(); await pending; ui.dispose(1); await f.close() }
})

test('UI cancellation is scoped to its sender and structured Host errors survive the bridge', async () => {
  const handlers = new Map(), controllers = []
  const ipc = { handle: (name, handler) => handlers.set(name, handler) }
  const runtime = { requestHostCapability: (_app, _instance, _protocol, _method, _input, options) => new Promise((resolve, reject) => {
    controllers.push(options.signal)
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
  }) }
  registerAppUiRequests({ ipc, getState: () => ({ id: appId, runtime }) })
  const one = Object.assign(new EventEmitter(), { id: 1 }), two = Object.assign(new EventEmitter(), { id: 2 })
  const payload = { requestId: 'same', protocol: T, method: 'task.list' }
  const a = handlers.get('app-ui:host:request')({ sender: one }, payload)
  const b = handlers.get('app-ui:host:request')({ sender: two }, payload)
  handlers.get('app-ui:host:cancel')({ sender: one }, { requestId: 'same' })
  expect(controllers[0].aborted).toBe(true)
  expect(controllers[1].aborted).toBe(false)
  expect(await a).toMatchObject({ ok: false, error: { code: 'APP_ACTION_CANCELED' } })
  two.emit('destroyed')
  await b
})
async function waitFor(predicate) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for IPC event')
}

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-ipc-'))
  const source = path.join(root, 'source')
  await fs.mkdir(source)
  const definitions = createExecutionProtocolDefinitions()
  const permissions = [...new Set(definitions.flatMap(d => Object.values(d.methods).map(m => m.permission)))]
  await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify({
    schemaVersion: 2, id: appId, version: '1.0.0', displayName: 'Execution fixture', hostApi: '^3.0.0',
    permissions,
    host: { protocols: [T, E] },
backend: { entry: 'main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand',
       actions: [{ name: 'request' }] },
  }))
  const sdkUrl = new URL('../../packages/app-sdk/src/index.mjs', import.meta.url).href
  await fs.writeFile(path.join(source, 'main.mjs'), `
import { AppBackendClient, createTasksClient, createExecutionClient } from ${JSON.stringify(sdkUrl)}
const backend = new AppBackendClient()
const tasks = createTasksClient(backend.host), execution = createExecutionClient(backend.host)
tasks.on('task.changed', data => { backend.emit('received.task', data) })
execution.on('execution.changed', data => { backend.emit('received.execution', data) })
backend.start({ request: ({ protocol, method, input }) =>
  (protocol === 'moss.tasks/v1' ? tasks : execution).request(method, input) })
`)
  await writePackageChecksums(source)
  const runtime = await new AppRuntimeHost({ rootDir: root, nodeExecutable,
    processOptions: { handshakeTimeoutMs: 2000, shutdownTimeoutMs: 200, idleTimeoutMs: 60_000 },
  }).initialize()
  const received = [], deliveries = []
  runtime.events.on('event', event => { if (event.type === 'backend-event') received.push(event) })
  const host = new AppExecutionHost({ directory: path.join(root, 'tasks'),
    createSource: async () => ({ sessionId: 'source-session' }),
    execute: async ({ onProgress }) => {
      onProgress({ tokens: 2, toolCalls: 1, lastToolName: 'Read' })
      return { value: { answer: '🌱' }, tokens: 3, toolCalls: 1 }
    },
    publishEvent: (target, protocol, name, data, options) => {
      const delivery = runtime.withOwner(target.owner, () => runtime.publishHostEvent(target.appId, target.instanceId, protocol, name, data, options))
      deliveries.push(delivery.catch(error => error))
      return delivery
    },
  })
  for (const definition of definitions) {
    runtime.registerHostProtocol(definition)
    for (const method of Object.keys(definition.methods)) runtime.registerHostHandler(definition.protocol, method,
      (input, context) => host.handle(definition.protocol, method, input, context))
  }
  try { await runtime.installFromDirectory(source) }
  catch (error) { await host.close(); await runtime.shutdown(); await fs.rm(root, { recursive: true, force: true }); throw error }
  return { runtime, host, received, deliveries,
    call: (protocol, method, input = {}) => runtime.invoke(appId, instanceId, 'request', { protocol, method, input }),
    close: async () => { await host.close(); await Promise.all(deliveries); await runtime.shutdown(); await fs.rm(root, { recursive: true, force: true }) },
  }
}

test('Task/Execution events reach a real Node Backend; queries recover after restart and grants gate events', async () => {
  const f = await setup()
  try {
    expect((await f.call(E, 'capabilities')).events).toBe(true)
    const task = await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'IPC run' })
    await expect(f.call(T, 'task.update', { taskId: task.id, revision: 99 })).rejects.toMatchObject({ code: 'APP_CONFLICT', details: { kind: 'revision', currentRevision: 1 } })
    await expect(f.call(T, 'task.get', { taskId: 'missing' })).rejects.toMatchObject({ code: 'APP_NOT_FOUND' })
    const execution = await f.call(E, 'execution.start', { scopeRef: task.scopeRef, idempotencyKey: 'node', contextKey: 'node', prompt: 'Run', outputSchema: true })
    await waitFor(() => f.received.some(e => e.name === 'received.execution' && e.data.event.type === 'completed'))
    const events = f.received.filter(e => e.name === 'received.execution')
    expect(events.map(e => e.data.event.type)).toEqual(['queued', 'running', 'progress', 'completed'])
    expect(events[2].data.event.lastToolName).toBe('Read')
    expect(events.every(e => e.data.taskId === task.id && e.data.execution.id === execution.id && e.data.event.executionId === execution.id)).toBe(true)
    expect(f.received.find(e => e.name === 'received.task').data.task.id).toBe(task.id)
    expect(f.received.every(e => e.owner.key === f.runtime.defaultOwner.key)).toBe(true)
    expect(f.received.some(e => e.data.task?.owner || e.data.execution?.input)).toBe(false)
    await Promise.all(f.deliveries)
    const record = f.runtime.runtimeForInstance(appId, instanceId)
    await f.runtime.supervisor.stop(record.key)
    await expect(f.runtime.publishHostEvent(appId, instanceId, T, 'task.changed', { task }, { onlyIfRunning: true })).rejects.toMatchObject({ code: 'APP_HOST_UNAVAILABLE' })
    expect(f.runtime.supervisor.processes.get(record.key)?.state).not.toBe('running')
    const current = await f.call(E, 'execution.get', { executionId: execution.id })
    expect(current.status).toBe('completed')
    const history = await f.call(E, 'execution.events', { executionId: execution.id, afterSequence: events[1].data.event.sequence })
    expect(history.events.map(e => e.type)).toEqual(['progress', 'completed'])
    let text = '', offset = 0
    do {
      const chunk = await f.call(E, 'execution.result.read', { resultRef: current.resultRef, offset, limit: 1 })
      text += chunk.text; offset = chunk.nextOffset
    } while (offset !== null)
    expect(JSON.parse(text)).toEqual({ answer: '🌱' })
    await f.runtime.setAppGrants(appId, ['tasks:write'])
    await expect(f.runtime.publishHostEvent(appId, instanceId, T, 'task.changed', { task }, { onlyIfRunning: true })).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await expect(f.call(T, 'task.get', { taskId: task.id })).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
  } finally { await f.close() }
})

test('revocation while a task event is being authorized prevents delivery', async () => {
  const f = await setup()
  const entered = deferred(), release = deferred()
  let delivery
  try {
    const task = await f.call(T, 'task.create', { idempotencyKey: 'run', title: 'IPC run' })
    await waitFor(() => f.received.some(e => e.name === 'received.task'))
    await Promise.all(f.deliveries)
    const before = f.received.length
    f.runtime.hostCapabilities.authorize = async (_request, authorization) => {
      if (authorization.kind === 'event') { entered.resolve(); await release.promise }
    }
    delivery = f.runtime.publishHostEvent(appId, instanceId, T, 'task.changed', { task }, { onlyIfRunning: true }).catch(error => error)
    await entered.promise
    await f.runtime.setAppGrants(appId, ['tasks:write'])
    release.resolve()
    expect(await delivery).toMatchObject({ code: 'APP_STALE_GENERATION' })
    expect(f.received).toHaveLength(before)
  } finally {
    release.resolve(); await delivery
    f.runtime.hostCapabilities.authorize = null
    await f.close()
  }
})

for (const phase of ['getActivePackage', 'prepareRuntime']) test(`Action can be cancelled while ${phase} is pending`, async () => {
  const f = await setup()
  const entered = deferred(), release = deferred()
  const original = f.runtime[phase].bind(f.runtime)
  let pending
  try {
    f.runtime[phase] = async (...args) => { entered.resolve(); await release.promise; return original(...args) }
    pending = f.runtime.invoke(appId, instanceId, 'request', { protocol: T, method: 'task.list', input: {} }, { requestId: 'cancel-before-start' }).catch(error => error)
    await entered.promise
    expect(f.runtime.cancel(appId, instanceId, 'cancel-before-start')).toBe(true)
    const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('did not cancel promptly'), 200))])
    expect(result).toMatchObject({ code: 'APP_ACTION_CANCELED' })
    release.resolve()
    await waitFor(() => f.runtime.actions.pendingTotal === 0)
    expect(f.runtime.actions.requests.size).toBe(0)
    expect(f.runtime.supervisor.processes.size).toBe(0)
  } finally {
    release.resolve(); f.runtime[phase] = original
    await pending
    await f.close()
  }
})
