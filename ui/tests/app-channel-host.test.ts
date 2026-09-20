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
  AppChannelHost,
  AppProcessSupervisor,
  AppRuntimeHost,
  defaultInstanceId,
  writePackageChecksums,
} from '../../packages/app-runtime/src/index.mjs'

const roots: string[] = []
const nodeExecutable = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()

afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function createChannelRuntime(options: { requestOnInitialize?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-channel-host-'))
  roots.push(root)
  const source = path.join(root, 'source')
  await fs.mkdir(path.join(source, 'dist', 'backend'), { recursive: true })
  await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify({
    schemaVersion: 2,
    id: 'fixture.channel-host',
    version: '1.0.0',
    displayName: 'Channel Host Fixture',
    hostApi: '^1.1.0',
    backend: {
      entry: 'dist/backend/main.mjs',
      runtime: 'node',
      apiVersion: 1,
      lifecycle: 'persistent',
      instanceMode: 'single',
      targets: ['desktop'],
      protocols: ['moss.channel/v1'],
      actions: [{ name: 'host.request' }],
    },
    permissions: ['channel:connection', 'channel:sessions:read', 'channel:notifications'],
  }, null, 2))
  await fs.writeFile(path.join(source, 'dist', 'backend', 'main.mjs'), `
import { randomUUID } from 'node:crypto'
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const pending = new Map()
const send = (type, payload = {}, id = randomUUID()) => process.send?.({ version: 1, id, type, timestamp: Date.now(), payload: { ...payload, ...identity } })
process.on('message', (message) => {
  if (message.type === 'service.init') {
    if (!message.payload.protocols?.includes('moss.channel/v1') || !message.payload.permissions?.includes('channel:sessions:read')) {
      process.exit(20)
    }
    if (message.payload.config.requestOnInitialize) {
      pending.set('initialize-request', { kind: 'initialize', requestId: message.id })
      send('channel.request', {
        protocol: 'moss.channel/v1',
        method: 'connection.update',
        input: { connected: true },
      }, 'initialize-request')
    } else send('service.ready', {}, message.id)
  }
  if (message.type === 'service.ping') send('service.pong', {}, message.id)
  if (message.type === 'service.shutdown') process.exit(0)
  if (message.type === 'action.invoke' && message.payload.name === 'host.request') {
    const requestId = message.payload.input.requestId || randomUUID()
    pending.set(requestId, { kind: 'action', requestId: message.id })
    send('channel.request', {
      protocol: 'moss.channel/v1',
      method: message.payload.input.method,
      input: message.payload.input.data || {},
    }, requestId)
  }
  if (message.type === 'channel.response') {
    const waiting = pending.get(message.payload.requestId)
    if (!waiting) return
    pending.delete(message.payload.requestId)
    if (waiting.kind === 'initialize') {
      if (message.payload.ok) send('service.ready', {}, waiting.requestId)
      else process.exit(21)
    } else if (message.payload.ok) send('action.result', { requestId: waiting.requestId, result: message.payload.result }, waiting.requestId)
    else send('action.error', { requestId: waiting.requestId, error: message.payload.error }, waiting.requestId)
  }
  if (message.type === 'channel.event') {
    send('channel.event.response', {
      protocol: 'moss.channel/v1',
      eventId: message.payload.eventId,
      ok: true,
      result: { received: message.payload.name, data: message.payload.data },
    }, message.id)
  }
})
send('service.hello', { appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION, apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID }, 'hello')
`)
  await writePackageChecksums(source)
  const requests: any[] = []
  const runtime = await new AppRuntimeHost({
    rootDir: root,
    nodeExecutable,
    target: 'desktop',
    hostId: 'desktop-test',
    channelOptions: {
      handlers: {
        'connection.update': async (input: any, context: any) => {
          requests.push({ input, context })
          return { connected: input.connected }
        },
        'conversation.list': async (input: any, context: any) => {
          requests.push({ input, context })
          return { sessions: [{ id: 'session-1', title: 'One' }] }
        },
      },
    },
    processOptions: { handshakeTimeoutMs: 1000, shutdownTimeoutMs: 200 },
  }).initialize()
  await runtime.installFromDirectory(source)
  const appId = 'fixture.channel-host'
  const instanceId = defaultInstanceId(appId)
  if (options.requestOnInitialize) {
    await runtime.updateInstance(appId, instanceId, { config: { requestOnInitialize: true } })
  }
  await runtime.setInstanceEnabled(appId, instanceId, true)
  await runtime.setAppEnabled(appId, true)
  return { runtime, appId, instanceId, requests }
}

describe('App Channel Host API', () => {
  it('cancels Host handlers cooperatively without retaining concurrency slots', async () => {
    let startedResolve: (() => void) | null = null
    const started = new Promise<void>((resolve) => { startedResolve = resolve })
    const host = new AppChannelHost({
      handlers: {
        'conversation.list': async (_input: any, context: any) => new Promise((_resolve, reject) => {
          startedResolve?.()
          context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })
        }),
      },
    })
    const controller = new AbortController()
    const pending = host.dispatch({
      appId: 'fixture.channel-host',
      instanceId: 'fixture.channel-host--default',
      target: { type: 'desktop', id: 'desktop-test' },
      requestId: 'request-cancel',
      protocol: 'moss.channel/v1',
      method: 'conversation.list',
      input: { externalUserId: 'user-1' },
      protocols: ['moss.channel/v1'],
      permissions: ['channel:sessions:read'],
      signal: controller.signal,
    })
    await started
    controller.abort(new Error('stop'))
    await expect(pending).rejects.toThrow('stop')
    expect(host.activeTotal).toBe(0)
    expect(host.activeByInstance.size).toBe(0)
  })

  it('does not invoke a Channel Host handler for an already-canceled request', async () => {
    let calls = 0
    const host = new AppChannelHost({
      handlers: {
        'conversation.list': async () => {
          calls += 1
          return { sessions: [] }
        },
      },
    })
    const controller = new AbortController()
    controller.abort(new Error('already stopped'))
    await expect(host.dispatch({
      appId: 'fixture.channel-host',
      instanceId: 'fixture.channel-host--default',
      requestId: 'request-canceled-before-dispatch',
      protocol: 'moss.channel/v1',
      method: 'conversation.list',
      input: { externalUserId: 'user-1' },
      protocols: ['moss.channel/v1'],
      permissions: ['channel:sessions:read'],
      signal: controller.signal,
    })).rejects.toThrow('already stopped')
    expect(calls).toBe(0)
    expect(host.activeTotal).toBe(0)
  })

  it('removes the Channel Host cancellation listener after completion', async () => {
    let listener: (() => void) | null = null
    let removed = 0
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: (_name: string, handler: () => void) => { listener = handler },
      removeEventListener: (_name: string, handler: () => void) => {
        if (listener === handler) {
          listener = null
          removed += 1
        }
      },
    }
    const host = new AppChannelHost({
      handlers: { 'conversation.list': async () => ({ sessions: [] }) },
    })
    await expect(host.dispatch({
      appId: 'fixture.channel-host',
      instanceId: 'fixture.channel-host--default',
      requestId: 'request-complete',
      protocol: 'moss.channel/v1',
      method: 'conversation.list',
      input: { externalUserId: 'user-1' },
      protocols: ['moss.channel/v1'],
      permissions: ['channel:sessions:read'],
      signal,
    })).resolves.toEqual({ sessions: [] })
    expect(listener).toBeNull()
    expect(removed).toBe(1)
  })

  it('rejects an invalid injected Channel Host at construction time', () => {
    expect(() => new AppRuntimeHost({
      rootDir: path.join(os.tmpdir(), 'moss-invalid-channel-host'),
      channelHost: {},
    } as any)).toThrow(/dispatch/)
  })

  it('supports Backend-to-Host requests and acknowledged Host-to-Backend events', async () => {
    const { runtime, appId, instanceId, requests } = await createChannelRuntime()
    const result = await runtime.invoke(appId, instanceId, 'host.request', {
      method: 'conversation.list',
      data: { externalUserId: 'user-1' },
    })
    expect(result).toEqual({ sessions: [{ id: 'session-1', title: 'One' }] })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      input: { externalUserId: 'user-1' },
      context: {
        appId,
        instanceId,
        target: { type: 'desktop', id: 'desktop-test' },
        protocol: 'moss.channel/v1',
        method: 'conversation.list',
        permission: 'channel:sessions:read',
      },
    })

    await expect(runtime.publishChannelEvent(
      appId,
      instanceId,
      'notification.deliver',
      { deliveryId: 'delivery-1', externalConversationId: 'chat-1' },
      { eventId: 'delivery-1' },
    )).resolves.toEqual({
      received: 'notification.deliver',
      data: { deliveryId: 'delivery-1', externalConversationId: 'chat-1' },
    })
    await expect(runtime.publishChannelEvent(
      appId,
      instanceId,
      'notification.deliver',
      { deliveryId: 'delivery-1', externalConversationId: 'chat-1' },
      { eventId: 'delivery-1' },
    )).resolves.toMatchObject({ received: 'notification.deliver' })
    await runtime.shutdown()
  })

  it('allows a Channel Backend to call the Host while it is initializing', async () => {
    const { runtime, appId, instanceId, requests } = await createChannelRuntime({ requestOnInitialize: true })
    expect((await runtime.getInstanceStatus(appId, instanceId))[0].runtime.state).toBe('running')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      input: { connected: true },
      context: { method: 'connection.update', permission: 'channel:connection' },
    })
    await runtime.shutdown()
  })

  it('rejects reuse of a Backend request id with a different payload', async () => {
    const { runtime, appId, instanceId, requests } = await createChannelRuntime()
    await expect(runtime.invoke(appId, instanceId, 'host.request', {
      requestId: 'stable-request-id',
      method: 'conversation.list',
      data: { externalUserId: 'user-1' },
    })).resolves.toMatchObject({ sessions: [{ id: 'session-1' }] })
    await expect(runtime.invoke(appId, instanceId, 'host.request', {
      requestId: 'stable-request-id',
      method: 'connection.update',
      data: { connected: true },
    })).rejects.toMatchObject({ code: APP_ERROR_CODES.channelProtocol })
    expect(requests).toHaveLength(1)
    await runtime.shutdown()
  })

  it('enforces declared permissions in both directions', async () => {
    const { runtime, appId, instanceId } = await createChannelRuntime()
    await expect(runtime.invoke(appId, instanceId, 'host.request', {
      method: 'pairing.attempt',
      data: {
        externalUserId: 'user-1',
        externalConversationId: 'chat-1',
        externalEventId: 'pairing-1',
        code: 'ABC123',
      },
    })).rejects.toMatchObject({ code: APP_ERROR_CODES.permissionDenied })
    await expect(runtime.publishChannelEvent(
      appId,
      instanceId,
      'decision.resolved',
      { decisionId: 'decision-1' },
    )).rejects.toMatchObject({ code: APP_ERROR_CODES.permissionDenied })
    await expect(runtime.invoke(appId, instanceId, 'host.request', {
      method: 'conversation.current',
      data: { externalUserId: 'user-1' },
    })).rejects.toMatchObject({ code: APP_ERROR_CODES.channelUnavailable })
    await runtime.shutdown()
  })

  it('exposes request correlation and acknowledged events through AppBackendClient', async () => {
    const sent: any[] = []
    let receive: ((message: any) => void) | null = null
    let eventCalls = 0
    const client = new AppBackendClient({
      send: (message: any) => sent.push(message),
      onMessage: (handler: (message: any) => void) => { receive = handler },
    })
    client.onChannelEvent('turn.completed', async (data) => {
      eventCalls += 1
      return { delivered: data.turnId }
    })
    client.start()
    receive?.(createEnvelope('service.init', {
      generation: 1,
      launchToken: 'launch-1',
      protocols: ['moss.channel/v1'],
      permissions: ['channel:messages', 'channel:sessions:read'],
    }, { id: 'init' }))
    await tick()

    const pending = client.requestChannelHost('message.receive', {
      externalUserId: 'user-1',
      externalConversationId: 'chat-1',
      externalEventId: 'message-1',
      text: 'hello',
    }, { requestId: 'request-1' })
    expect(sent.at(-1)).toMatchObject({
      id: 'request-1',
      type: 'channel.request',
      payload: {
        protocol: 'moss.channel/v1',
        method: 'message.receive',
        input: {
          externalUserId: 'user-1',
          externalConversationId: 'chat-1',
          externalEventId: 'message-1',
          text: 'hello',
        },
      },
    })
    receive?.(createEnvelope('channel.response', {
      protocol: 'moss.channel/v1', requestId: 'request-1', ok: true, result: { stale: true },
      generation: 0, launchToken: 'old-launch',
    }, { id: 'request-1' }))
    await tick()
    expect((client as any).channelRequests.has('request-1')).toBe(true)
    receive?.(createEnvelope('channel.response', {
      protocol: 'moss.channel/v1', requestId: 'request-1', ok: true, result: { accepted: true },
      generation: 1, launchToken: 'launch-1',
    }, { id: 'request-1' }))
    await expect(pending).resolves.toEqual({ accepted: true })

    receive?.(createEnvelope('channel.event', {
      protocol: 'moss.channel/v1', eventId: 'event-1', name: 'turn.completed',
      data: { turnId: 'turn-1', externalConversationId: 'chat-1' },
      generation: 1, launchToken: 'launch-1',
    }, { id: 'event-1' }))
    await tick()
    expect(sent.at(-1)).toMatchObject({
      type: 'channel.event.response',
      payload: { eventId: 'event-1', ok: true, result: { delivered: 'turn-1' } },
    })

    receive?.(createEnvelope('channel.event', {
      protocol: 'moss.channel/v1', eventId: 'event-1', name: 'turn.completed',
      data: { turnId: 'turn-1', externalConversationId: 'chat-1' },
      generation: 1, launchToken: 'launch-1',
    }, { id: 'event-1' }))
    await tick()
    expect(sent.filter((message) => message.type === 'channel.event.response')).toHaveLength(2)
    expect(eventCalls).toBe(1)
    await expect(client.requestChannelHost('message.receive', { text: 'missing identity' } as any))
      .rejects.toMatchObject({ code: APP_ERROR_CODES.invalidInput })

    const timedOut = client.requestChannelHost('conversation.current', {
      externalUserId: 'user-1',
    }, { requestId: 'request-timeout', timeoutMs: 100 })
    await expect(timedOut).rejects.toMatchObject({ code: APP_ERROR_CODES.channelTimeout })
    expect(sent.some((message) => message.type === 'channel.cancel'
      && message.payload.requestId === 'request-timeout')).toBe(true)
  })

  it('deduplicates in-flight events and rejects event id payload collisions', async () => {
    const sent: any[] = []
    let receive: ((message: any) => void) | null = null
    let eventCalls = 0
    let resolveEvent: ((value: unknown) => void) | null = null
    const client = new AppBackendClient({
      send: (message: any) => sent.push(message),
      onMessage: (handler: (message: any) => void) => { receive = handler },
    })
    client.onChannelEvent('turn.completed', async () => {
      eventCalls += 1
      return new Promise((resolve) => { resolveEvent = resolve })
    })
    client.start()
    receive?.(createEnvelope('service.init', {
      generation: 1,
      launchToken: 'launch-1',
      protocols: ['moss.channel/v1'],
      permissions: ['channel:messages'],
    }, { id: 'init' }))
    await tick()

    const event = createEnvelope('channel.event', {
      protocol: 'moss.channel/v1', eventId: 'event-deduplicated', name: 'turn.completed',
      data: { turnId: 'turn-1', externalConversationId: 'chat-1' },
      generation: 1, launchToken: 'launch-1',
    }, { id: 'event-deduplicated' })
    receive?.(event)
    receive?.(structuredClone(event))
    await tick()
    expect(eventCalls).toBe(1)
    resolveEvent?.({ delivered: true })
    await tick()
    expect(sent.filter((message) => message.type === 'channel.event.response')).toHaveLength(1)

    receive?.(createEnvelope('channel.event', {
      ...event.payload,
      data: { externalConversationId: 'chat-1', turnId: 'turn-1' },
    }, { id: 'event-deduplicated' }))
    await tick()
    expect(eventCalls).toBe(1)
    expect(sent.at(-1)).toMatchObject({
      type: 'channel.event.response',
      payload: { ok: true, result: { delivered: true } },
    })

    receive?.(createEnvelope('channel.event', {
      ...event.payload,
      data: { turnId: 'turn-2', externalConversationId: 'chat-1' },
    }, { id: 'event-deduplicated' }))
    await tick()
    expect(eventCalls).toBe(1)
    expect(sent.at(-1)).toMatchObject({
      type: 'channel.event.response',
      payload: { ok: false, error: { code: APP_ERROR_CODES.channelProtocol } },
    })
  })

  it('reprocesses an immediate retry after a canceled event handler stops', async () => {
    const sent: any[] = []
    let receive: ((message: any) => void) | null = null
    let eventCalls = 0
    const client = new AppBackendClient({
      send: (message: any) => sent.push(message),
      onMessage: (handler: (message: any) => void) => { receive = handler },
    })
    client.onChannelEvent('turn.completed', async (_data, context) => {
      eventCalls += 1
      if (eventCalls > 1) return { attempt: eventCalls }
      return new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })
      })
    })
    client.start()
    receive?.(createEnvelope('service.init', {
      generation: 1,
      launchToken: 'launch-1',
      protocols: ['moss.channel/v1'],
      permissions: ['channel:messages'],
    }, { id: 'init' }))
    await tick()
    const event = createEnvelope('channel.event', {
      protocol: 'moss.channel/v1', eventId: 'event-retry', name: 'turn.completed',
      data: { turnId: 'turn-1', externalConversationId: 'chat-1' },
      generation: 1, launchToken: 'launch-1',
    }, { id: 'event-retry' })
    receive?.(event)
    await tick()
    receive?.(createEnvelope('channel.event.cancel', {
      protocol: 'moss.channel/v1', eventId: 'event-retry',
      generation: 1, launchToken: 'launch-1',
    }))
    receive?.(structuredClone(event))
    await tick()
    await tick()
    expect(eventCalls).toBe(2)
    expect(sent.filter((message) => message.type === 'channel.event.response')).toHaveLength(1)
    expect(sent.at(-1)).toMatchObject({
      type: 'channel.event.response',
      payload: { eventId: 'event-retry', ok: true, result: { attempt: 2 } },
    })
  })

  it('settles Channel work when a Backend exits during shutdown', () => {
    const supervisor = new AppProcessSupervisor()
    let actionError: any = null
    let eventError: any = null
    const requestController = new AbortController()
    const actionTimer = setTimeout(() => {}, 60_000)
    const requestTimer = setTimeout(() => {}, 60_000)
    actionTimer.unref?.()
    requestTimer.unref?.()
    const hosted: any = {
      definition: { appId: 'fixture.channel-host', instanceId: 'instance-1', lifecycle: 'persistent' },
      state: 'running',
      stopping: false,
      child: null,
      pending: new Map([['action-1', {
        timeout: actionTimer,
        reject: (error: unknown) => { actionError = error },
      }]]),
      pendingChannelEvents: new Map([['event-1', {
        finish: (error: unknown) => { eventError = error },
      }]]),
      channelRequests: new Map([['request-1', {
        timer: requestTimer,
        controller: requestController,
      }]]),
      pingTimer: null,
      idleTimer: null,
    }
    ;(supervisor as any).processes.set('deployment-1', hosted)
    ;(supervisor as any).shuttingDown = true
    supervisor.handleExit('deployment-1', hosted, 0, null)
    expect(actionError).toMatchObject({ code: APP_ERROR_CODES.backendUnavailable })
    expect(eventError).toMatchObject({ code: APP_ERROR_CODES.channelUnavailable })
    expect(requestController.signal.aborted).toBe(true)
    expect(hosted.pending.size).toBe(0)
    expect(hosted.pendingChannelEvents.size).toBe(0)
    expect(hosted.channelRequests.size).toBe(0)
  })
})
