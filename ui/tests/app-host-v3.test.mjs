import { AppBackendClient, createEnvelope } from '../../packages/app-sdk/src/index.mjs'
import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { AppRuntimeHost, defaultInstanceId, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'
import { HostRequests } from '../../packages/app-runtime/src/host/requests.mjs'
import { AppActionBroker } from '../../packages/app-runtime/src/actions/index.mjs'
import { createAppClient } from '../../packages/app-sdk/src/ui/index.mjs'
import { registerAppUiRequests } from '../src/apps/app-ui-requests.mjs'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
test('Host rejects invalid deadlines, preserves timeout reasons and accounts for handlers until they stop', async () => {
  const requests = new HostRequests({ maxPending: 1 })
  const base = { protocol: 'moss.test/v1', method: 'wait', input: {}, key: 'one' }
  for (const timeoutMs of [Infinity, NaN, '100', 99, 300001]) await expect(requests.run({ ...base, timeoutMs }, () => {})).rejects.toMatchObject({ code: 'APP_INVALID_ACTION_INPUT' })
  const aborted = new AbortController()
  aborted.abort(Object.assign(new Error('deadline'), { code: 'APP_HOST_TIMEOUT' }))
  await expect(requests.run({ ...base, signal: aborted.signal }, () => {})).rejects.toMatchObject({ code: 'APP_HOST_TIMEOUT' })
  let release, signal
  const pending = requests.run({ ...base, timeoutMs: 100 }, context => { signal = context.signal; return new Promise(resolve => { release = resolve }) })
  await expect(pending).rejects.toMatchObject({ code: 'APP_HOST_TIMEOUT' })
  expect(signal.reason.code).toBe('APP_HOST_TIMEOUT')
  await expect(requests.run(base, () => {})).rejects.toMatchObject({ code: 'APP_RESOURCE_EXHAUSTED' })
  release({})
  await delay(0)
  expect(requests.pending.size).toBe(0)
})

test('Action deadline includes package loading even without a caller request id', async () => {
  let release, invoked = 0
  const broker = new AppActionBroker({
    supervisor: { maxActionTimeoutMs: 150, invoke: () => { invoked++ } },
    packageResolver: () => new Promise(resolve => { release = resolve }),
  })
  await expect(broker.invoke({ appId: 'test', key: 'one' }, 'wait', {}, { timeoutMs: 100 })).rejects.toMatchObject({ code: 'APP_ACTION_TIMEOUT' })
  release({ manifest: { backend: { actions: [{ name: 'wait' }] } } })
  await delay(0)
  expect(invoked).toBe(0)
  expect(broker.pendingTotal).toBe(0)
})

async function pureUi(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-ui-v3-'))
  const source = path.join(root, 'source')
  await mkdir(source)
  await writeFile(path.join(source, 'index.html'), '<!doctype html><title>UI</title>')
  await writeFile(path.join(source, 'app.moss.json'), JSON.stringify({ schemaVersion: 2, id: 'test.ui', displayName: 'UI', version: '1.0.0', hostApi: '^3.0.0', ui: { entry: 'index.html' }, host: { protocols: ['moss.test/v1'] }, permissions: ['test:read'] }))
  await writePackageChecksums(source)
  const runtime = await new AppRuntimeHost({ rootDir: path.join(root, 'host'), ...options }).initialize()
  runtime.registerHostProtocol({ protocol: 'moss.test/v1', methods: { get: { permission: 'test:read', limits: { items: 10 } }, unsupported: {}, backend: { surfaces: ['backend'] } }, events: { changed: { permission: 'test:read' } } })
  runtime.registerHostHandler('moss.test/v1', 'get', (_input, context) => ({ appId: context.appId, surface: context.surface }))
  runtime.registerHostHandler('moss.test/v1', 'backend', () => ({}))
  await runtime.installFromDirectory(source)
  const instanceId = defaultInstanceId('test.ui')
  return { runtime, instanceId, call: (protocol, method, input = {}) => runtime.requestHostCapability('test.ui', instanceId, protocol, method, input), close: async () => { await runtime.shutdown(); await rm(root, { recursive: true, force: true }) } }
}

test('pure UI Host requests and subscriptions use App identity, surfaces, grants and sender lifetime', async () => {
  const f = await pureUi()
  try {
    expect(await f.call('moss.test/v1', 'get')).toEqual({ appId: 'test.ui', surface: 'ui' })
    expect(f.runtime.supervisor.listStatuses()).toEqual([])
    const discovery = await f.call('moss.host/v1', 'capabilities.get')
    expect(discovery.capabilities.find(x => x.method === 'get')).toMatchObject({ supported: true, allowed: true, available: true, limits: { items: 10 } })
    expect(discovery.capabilities.find(x => x.method === 'unsupported')).toMatchObject({ supported: false, available: false })
    expect(discovery.capabilities.find(x => x.method === 'backend')).toMatchObject({ allowed: false })
    await expect(f.call('moss.host/v1', 'capabilities.get', { protocols: ['moss.other/v1'] })).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    const handlers = new Map(), sender = Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => false })
    sender.send = (_name, value) => sender.emit('hostEvent', value)
    registerAppUiRequests({ ipc: { handle: (name, handler) => handlers.set(name, handler) }, getState: () => ({ id: 'test.ui', runtime: f.runtime }) })
    const call = (name, data) => handlers.get('app-ui:host:' + name)({ sender }, data)
    const client = createAppClient({ host: {
      subscribe: (protocol, name, subscriptionId) => call('subscribe', { protocol, name, subscriptionId }),
      unsubscribe: subscriptionId => Promise.resolve(call('unsubscribe', { subscriptionId })),
      onEvent: listener => { sender.on('hostEvent', listener); return () => sender.off('hostEvent', listener) },
    } })
    const events = [], errors = []
    await client.host.subscribe('moss.test/v1', 'changed', data => events.push(data), { onError: error => errors.push(error.code) })
    await f.runtime.publishHostEvent('test.ui', f.instanceId, 'moss.test/v1', 'changed', { value: 1 })
    await delay(0)
    expect(events).toEqual([{ value: 1 }])
    await f.runtime.setAppGrants('test.ui', [])
    await delay(0)
    expect(f.runtime.uiHostSubscriptions.size).toBe(0)
    expect(errors).toHaveLength(1)
    await expect(f.call('moss.test/v1', 'get')).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await f.runtime.setAppGrants('test.ui', ['test:read'])
    await client.host.subscribe('moss.test/v1', 'changed', () => {})
    sender.emit('did-start-navigation', {}, 'app://next', false, true)
    expect(f.runtime.uiHostSubscriptions.size).toBe(0)
    await client.host.subscribe('moss.test/v1', 'changed', () => {})
    client.dispose()
    expect(f.runtime.uiHostSubscriptions.size).toBe(0)
    expect(sender.listenerCount('hostEvent')).toBe(0)
  } finally { await f.close() }
})

test('capability discovery rechecks grants after asynchronous availability checks', async () => {
  let release, entered
  const ready = new Promise(resolve => { entered = resolve })
  const f = await pureUi({ capabilityAvailability: async (_protocol, method) => {
    if (method === 'get') { entered(); await new Promise(resolve => { release = resolve }) }
    return { available: true, reason: null }
  } })
  try {
    const pending = f.call('moss.host/v1', 'capabilities.get', { protocols: ['moss.test/v1'] })
    await ready
    await f.runtime.installations.upsert('test.ui', { grants: [] })
    release()
    const page = await pending
    expect(page.capabilities.find(item => item.method === 'get')).toMatchObject({ allowed: false, available: false, reason: 'permission_denied' })
  } finally { release?.(); await f.close() }
})

test('Backend observers share a subscription and isolate callback failures and abort cleanup', async () => {
  const sent = [], calls = [], errors = []
  const backend = new AppBackendClient({ send: message => sent.push(message) })
  await backend.handleMessage(createEnvelope('service.init', { appId: 'test.app', version: '1.0.0', instanceId: 'default', generation: 1, launchToken: 'token', protocols: ['moss.test/v1'], permissions: [], grants: [], config: {}, secrets: {} }))
  const abort = new AbortController()
  await backend.host.subscribe('moss.test/v1', 'changed', () => { calls.push('first'); throw new Error('callback') }, { signal: abort.signal, onError: error => errors.push(error.message) })
  const off = await backend.host.subscribe('moss.test/v1', 'changed', () => calls.push('second'))
  const emit = id => backend.handleMessage(createEnvelope('host.event', { protocol: 'moss.test/v1', name: 'changed', eventId: id, data: {}, generation: 1, launchToken: 'token' }, { id }))
  await emit('one')
  expect(calls).toEqual(['first', 'second'])
  expect(errors).toEqual(['callback'])
  abort.abort(); await emit('two')
  expect(calls).toEqual(['first', 'second', 'second'])
  off()
  expect(backend.hostHandlers.size).toBe(0)
  expect(backend.hostSubscribers.size).toBe(0)
  await backend.host.subscribe('moss.test/v1', 'changed', () => {})
  off()
  expect(backend.hostSubscribers.size).toBe(1)
  backend.closeHost()
  expect(backend.hostHandlers.size).toBe(0)
  expect(backend.hostSubscribers.size).toBe(0)
})

test('Host maximum caps a declared Action default without treating it as invalid caller input', async () => {
  const broker = new AppActionBroker({
    supervisor: { maxActionTimeoutMs: 120, invoke: (_key, _name, _input, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) },
    packageResolver: async () => ({ manifest: { backend: { actions: [{ name: 'wait', timeoutMs: 1000 }] } } }),
  })
  await expect(broker.invoke({ appId: 'test', key: 'one' }, 'wait', {})).rejects.toMatchObject({ code: 'APP_ACTION_TIMEOUT' })
})
