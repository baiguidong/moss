import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  APP_ERROR_CODES,
  AppBackendClient,
  createEnvelope,
} from '../../packages/app-sdk/src/index.mjs'
import {
  AppHostCapabilityRegistry,
  AppRuntimeHost,
  appToolName,
  defaultInstanceId,
  writePackageChecksums,
} from '../../packages/app-runtime/src/index.mjs'

const roots: string[] = []
const nodeExecutable = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()

afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('App Host Capability API', () => {
  it('generates stable, bounded, collision-resistant Agent tool names', () => {
    expect(appToolName('example-a', 'search')).not.toBe(appToolName('example.a', 'search'))
    expect(appToolName('a'.repeat(80), 'b'.repeat(64))).toHaveLength(64)
    expect(appToolName('example.app', 'search')).toMatch(/^[a-zA-Z0-9_]{1,64}$/)
  })

  it('requires both Manifest declarations and installation grants before dispatch', async () => {
    const registry = new AppHostCapabilityRegistry()
    registry.registerProtocol({
      protocol: 'moss.test/v1',
      methods: {
        echo: {
          permission: 'test:echo',
          validateInput: (input: any) => {
            if (typeof input?.text !== 'string') throw new TypeError('text is required')
            return { text: input.text.trim() }
          },
        },
      },
    })
    const contexts: any[] = []
    registry.registerHandler('moss.test/v1', 'echo', async (input, context) => {
      contexts.push(context)
      return input
    })
    const request = {
      appId: 'fixture.host',
      instanceId: 'fixture.host--default',
      requestId: 'request-1',
      protocol: 'moss.test/v1',
      method: 'echo',
      input: { text: ' hello ' },
      protocols: ['moss.test/v1'],
      permissions: ['test:echo'],
      grants: ['test:echo'],
      owner: { scope: 'org', orgId: 'org-1', userId: null, key: 'org:org-1' },
      principal: { scope: 'user', orgId: 'org-1', userId: 'user-1' },
    }
    await expect(registry.dispatch(request)).resolves.toEqual({ text: 'hello' })
    expect(contexts[0]).toMatchObject({
      protocol: 'moss.test/v1',
      method: 'echo',
      permission: 'test:echo',
      owner: { scope: 'org', orgId: 'org-1', userId: null, key: 'org:org-1' },
      principal: { scope: 'user', orgId: 'org-1', userId: 'user-1' },
    })
    await expect(registry.dispatch({ ...request, protocols: [] })).rejects.toMatchObject({
      code: APP_ERROR_CODES.hostUnavailable,
    })
    await expect(registry.dispatch({ ...request, grants: [] })).rejects.toMatchObject({
      code: APP_ERROR_CODES.permissionDenied,
    })
    await expect(registry.dispatch({ ...request, grants: undefined })).rejects.toMatchObject({
      code: APP_ERROR_CODES.permissionDenied,
    })
    expect(contexts).toHaveLength(1)
  })

  it('waits for asynchronous authorization before dispatching requests or events', async () => {
    let handlerCalls = 0
    const registry = new AppHostCapabilityRegistry({
      authorize: async () => {
        await tick()
        throw new Error('denied asynchronously')
      },
      protocols: [{
        protocol: 'moss.test/v1',
        methods: { echo: {} },
        events: { notice: {} },
      }],
    })
    registry.registerHandler('moss.test/v1', 'echo', () => {
      handlerCalls += 1
      return { ok: true }
    })
    const request = {
      appId: 'fixture.host',
      instanceId: 'fixture.host--default',
      protocol: 'moss.test/v1',
      protocols: ['moss.test/v1'],
      permissions: [],
      grants: [],
    }
    await expect(registry.dispatch({ ...request, method: 'echo', input: {} }))
      .rejects.toThrow('denied asynchronously')
    await expect(registry.prepareEvent({ ...request, name: 'notice', data: {} }))
      .rejects.toThrow('denied asynchronously')
    expect(handlerCalls).toBe(0)
  })

  it('provides generic Backend request and acknowledged event transport', async () => {
    const sent: any[] = []
    let receive: ((message: any) => void) | null = null
    const client = new AppBackendClient({
      send: (message: any) => sent.push(message),
      onMessage: (handler: (message: any) => void) => { receive = handler },
    })
    client.onHostEvent('moss.test/v1', 'notice', async (data) => ({ seen: data.value }))
    client.start()
    receive?.(createEnvelope('service.init', {
      generation: 1,
      launchToken: 'launch-1',
      protocols: ['moss.test/v1'],
      permissions: ['test:echo'],
      grants: ['test:echo'],
    }, { id: 'init' }))
    await tick()

    const pending = client.requestHost('moss.test/v1', 'echo', { text: 'hello' }, {
      requestId: 'host-1',
      timeoutMs: 120_000,
    })
    expect(sent.at(-1)).toMatchObject({
      type: 'host.request',
      payload: { protocol: 'moss.test/v1', method: 'echo', input: { text: 'hello' }, timeoutMs: 120_000 },
    })
    receive?.(createEnvelope('host.response', {
      protocol: 'moss.test/v1', requestId: 'host-1', ok: true, result: { text: 'hello' },
      generation: 1, launchToken: 'launch-1',
    }, { id: 'host-1' }))
    await expect(pending).resolves.toEqual({ text: 'hello' })

    receive?.(createEnvelope('host.event', {
      protocol: 'moss.test/v1', eventId: 'event-1', name: 'notice', data: { value: 7 },
      generation: 1, launchToken: 'launch-1',
    }, { id: 'event-1' }))
    await tick()
    expect(sent.at(-1)).toMatchObject({
      type: 'host.event.response',
      payload: { protocol: 'moss.test/v1', eventId: 'event-1', ok: true, result: { seen: 7 } },
    })
  })

  it('routes a custom protocol through AppRuntimeHost without domain imports', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-host-capability-'))
    roots.push(root)
    const source = path.join(root, 'source')
    await fs.mkdir(path.join(source, 'dist', 'backend'), { recursive: true })
    await fs.mkdir(path.join(source, 'schemas'), { recursive: true })
    await fs.writeFile(path.join(source, 'schemas', 'echo.json'), JSON.stringify({
      type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false,
    }))
    await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify({
      schemaVersion: 2,
      id: 'fixture.host-capability',
      version: '1.0.0',
      displayName: 'Host Capability Fixture',
      hostApi: '^2.0.0',
      backend: {
        entry: 'dist/backend/main.mjs',
        runtime: 'node',
        apiVersion: 1,
        lifecycle: 'persistent',
        instanceMode: 'single',
        targets: ['desktop'],
        protocols: { desktop: ['moss.test/v1'] },
        actions: [{ name: 'host.request', inputSchema: 'schemas/echo.json' }],
      },
      permissions: ['test:echo', 'test:notice'],
      contributes: {
        tools: [{
          id: 'echo', title: 'Echo', description: 'Echo through the test Host protocol',
          action: 'host.request', inputSchema: 'schemas/echo.json', effect: 'read', permission: 'test:echo',
        }],
      },
    }, null, 2))
    await fs.writeFile(path.join(source, 'dist', 'backend', 'main.mjs'), `
import { randomUUID } from 'node:crypto'
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const pending = new Map()
const send = (type, payload = {}, id = randomUUID()) => process.send?.({ version: 1, id, type, timestamp: Date.now(), payload: { ...payload, ...identity } })
process.on('message', (message) => {
  if (message.type === 'service.init') send('service.ready', {}, message.id)
  if (message.type === 'service.ping') send('service.pong', {}, message.id)
  if (message.type === 'service.shutdown') process.exit(0)
  if (message.type === 'action.invoke') {
    const hostRequestId = 'host-' + message.id
    pending.set(hostRequestId, message.id)
    send('host.request', { protocol: 'moss.test/v1', method: 'echo', input: message.payload.input, actionRequestId: message.id }, hostRequestId)
  }
  if (message.type === 'host.response') {
    const actionId = pending.get(message.payload.requestId)
    if (actionId && message.payload.ok) send('action.result', { requestId: actionId, result: message.payload.result }, actionId)
    else if (actionId) send('action.error', { requestId: actionId, error: message.payload.error }, actionId)
  }
  if (message.type === 'host.event') {
    send('host.event.response', {
      protocol: message.payload.protocol,
      eventId: message.payload.eventId,
      ok: true,
      result: { received: message.payload.name, data: message.payload.data },
    }, message.id)
  }
})
send('service.hello', { appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION, apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID }, 'hello')
`)
    await writePackageChecksums(source)

    const contexts: any[] = []
    const runtime = await new AppRuntimeHost({
      rootDir: root,
      nodeExecutable,
      target: 'desktop',
      hostId: 'desktop-test',
      processOptions: { handshakeTimeoutMs: 1000, shutdownTimeoutMs: 200 },
    }).initialize()
    runtime.registerHostProtocol({
      protocol: 'moss.test/v1',
      methods: { echo: { permission: 'test:echo' } },
      events: { notice: { permission: 'test:notice' } },
    })
    runtime.registerHostHandler('moss.test/v1', 'echo', async (input, context) => {
      contexts.push(context)
      return { echoed: input.text }
    })
    await runtime.installFromDirectory(source)
    const appId = 'fixture.host-capability'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)

    const tools = (await runtime.listContributions({ kinds: ['tools'], loadSchemas: true })).tools
    expect(tools[0]).toMatchObject({
      id: `${appId}/echo`,
      effect: 'read',
      inputSchemaDocument: { type: 'object' },
    })
    expect(tools[0].name).toMatch(/^app__fixture_host_capability__echo__[0-9a-f]{12}$/)
    expect(tools[0].name.length).toBeLessThanOrEqual(64)
    await expect(runtime.invokeToolContribution(`${appId}/echo`, { text: 'tool' }))
      .resolves.toEqual({ echoed: 'tool' })
    const principal = { scope: 'user', orgId: 'org-1', userId: 'user-1', key: 'user:org-1:user-1' }
    await expect(runtime.invoke(appId, instanceId, 'host.request', { text: 'hello' }, { principal }))
      .resolves.toEqual({ echoed: 'hello' })
    await expect(runtime.requestHostCapability(
      appId,
      instanceId,
      'moss.test/v1',
      'echo',
      { text: 'from-ui' },
    )).resolves.toEqual({ echoed: 'from-ui' })
    expect(contexts[1]).toMatchObject({
      appId,
      instanceId,
      protocol: 'moss.test/v1',
      method: 'echo',
      principal,
    })
    await expect(runtime.publishHostEvent(appId, instanceId, 'moss.test/v1', 'notice', { value: 9 }))
      .resolves.toEqual({ received: 'notice', data: { value: 9 } })
    await runtime.setAppGrants(appId, ['test:notice'])
    expect((await runtime.getApp(appId)).installation.grants).toEqual(['test:notice'])
    expect((await runtime.listContributions({ kinds: ['tools'] })).tools).toEqual([])
    await expect(runtime.invokeToolContribution(`${appId}/echo`, { text: 'denied' }))
      .rejects.toMatchObject({ code: APP_ERROR_CODES.actionNotFound })
    await expect(runtime.invoke(appId, instanceId, 'host.request', { text: 'denied' }))
      .rejects.toMatchObject({ code: APP_ERROR_CODES.permissionDenied })
    await expect(runtime.requestHostCapability(
      appId,
      instanceId,
      'moss.test/v1',
      'echo',
      { text: 'denied' },
    )).rejects.toMatchObject({ code: APP_ERROR_CODES.permissionDenied })
    await expect(runtime.setAppGrants(appId, ['not:requested']))
      .rejects.toMatchObject({ code: APP_ERROR_CODES.permissionDenied })
    await runtime.setAppGrants(appId, ['test:echo', 'test:notice'])
    await runtime.setInstanceEnabled(appId, instanceId, false)
    await expect(runtime.requestHostCapability(
      appId,
      instanceId,
      'moss.test/v1',
      'echo',
      { text: 'disabled-instance' },
    )).rejects.toMatchObject({ code: APP_ERROR_CODES.instanceDisabled })
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, false)
    await expect(runtime.requestHostCapability(
      appId,
      instanceId,
      'moss.test/v1',
      'echo',
      { text: 'disabled-app' },
    )).rejects.toMatchObject({ code: APP_ERROR_CODES.disabled })
    await runtime.shutdown()
  })
})
