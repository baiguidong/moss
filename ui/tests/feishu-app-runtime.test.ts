import { describe, expect, it } from 'bun:test'
import {
  FEISHU_APP_ID,
  FEISHU_APP_INSTANCE_ID,
  claimFeishuPairingEvent,
  configureFeishuAppFromLegacy,
  createFeishuChannelHandlers,
  getFeishuAppProcessStatus,
  hasFeishuAppMigrationMarker,
  isFeishuAppReady,
  isFeishuLegacyFallbackEnabled,
  mapChannelRequestToLegacy,
  mapLegacyFeishuEventToChannel,
  persistFeishuAppAuthorization,
  resolveFeishuChannelIdentity,
  splitLegacyFeishuAppConfiguration,
  withFeishuAppMigrationMarker,
} from '../src/feishu-app-runtime.mjs'

describe('Feishu App runtime integration', () => {
  it('keeps migration and emergency fallback decisions explicit', () => {
    const migrated = withFeishuAppMigrationMarker({ feishu: { appId: 'cli_app' } })
    expect(hasFeishuAppMigrationMarker(migrated)).toBe(true)
    expect(isFeishuLegacyFallbackEnabled({ MOSS_FEISHU_LEGACY_ADAPTER: '1' } as any)).toBe(true)
    expect(isFeishuLegacyFallbackEnabled({} as any)).toBe(false)
  })

  it('splits public configuration from encrypted credentials', () => {
    expect(splitLegacyFeishuAppConfiguration({
      feishu: {
        appId: ' cli_app ',
        appSecret: 'secret',
        encryptKey: 'encrypt',
        verificationToken: 'verify',
        streamingCard: true,
        pairedUsers: [{ userId: 42, displayName: 'User', pairedAt: 12 }],
      },
      pairing: { code: 'ABC234', expiresAt: 20, createdAt: 10 },
    })).toEqual({
      configured: true,
      config: {
        appId: 'cli_app',
        streamingCard: true,
        allowedUsers: [],
        pairedUsers: [{ userId: '42', displayName: 'User', pairedAt: 12 }],
        pairing: { code: 'ABC234', expiresAt: 20, createdAt: 10 },
      },
      secrets: { appSecret: 'secret', encryptKey: 'encrypt', verificationToken: 'verify' },
    })
  })

  it('authorizes identities directly from App instance configuration', () => {
    expect(resolveFeishuChannelIdentity({
      appId: 'cli_app',
      allowedUsers: ['ou_allowed'],
      pairedUsers: [{ userId: 'ou_paired', displayName: 'User', pairedAt: 1 }],
    }, 'ou_paired')).toEqual({
      adapterInstanceId: 'feishu:cli_app',
      tenantKey: 'cli_app',
    })
    expect(resolveFeishuChannelIdentity({ appId: 'cli_app', allowedUsers: ['ou_allowed'] }, 'ou_allowed'))
      .toEqual({ adapterInstanceId: 'feishu:cli_app', tenantKey: 'cli_app' })
    expect(() => resolveFeishuChannelIdentity({ appId: 'cli_app' }, 'ou_other'))
      .toThrow('not paired')
  })

  it('recovers claimed pairing events while keeping terminal retries idempotent', () => {
    const events = new Map<string, any>()
    const store = {
      getEvent: (adapterInstanceId: string, eventId: string) => (
        events.get(`${adapterInstanceId}:${eventId}`) || null
      ),
      claimEvent: (input: any) => {
        const key = `${input.adapterInstanceId}:${input.eventId}`
        if (events.has(key)) return { claimed: false, event: events.get(key) }
        const event = { ...input, status: 'received' }
        events.set(key, event)
        return { claimed: true, event }
      },
    }
    const identity = { adapterInstanceId: 'feishu:cli_app', eventId: 'om_pairing' }

    expect(claimFeishuPairingEvent(store, identity)).toMatchObject({
      proceed: true,
      existingEvent: { eventType: 'pairing', status: 'received' },
    })
    // A persisted `received` row is deliberately resumable after a crash.
    expect(claimFeishuPairingEvent(store, identity)).toMatchObject({ proceed: true })

    const event = events.get('feishu:cli_app:om_pairing')
    Object.assign(event, { status: 'completed', conversationId: 'conversation-1' })
    expect(claimFeishuPairingEvent(store, { ...identity, knownUser: true })).toEqual({
      proceed: false,
      result: {
        paired: true,
        alreadyPaired: true,
        duplicate: true,
        conversationId: 'conversation-1',
      },
    })

    events.set('feishu:cli_app:om_message', {
      eventType: 'message', status: 'completed',
    })
    expect(claimFeishuPairingEvent(store, {
      adapterInstanceId: 'feishu:cli_app', eventId: 'om_message', knownUser: false,
    })).toEqual({ proceed: false, result: { paired: false, duplicate: true } })

    expect(claimFeishuPairingEvent(store, {
      adapterInstanceId: 'feishu:cli_app', eventId: 'om_known', knownUser: true,
    })).toEqual({ proceed: true, existingEvent: null })
    expect(events.has('feishu:cli_app:om_known')).toBe(false)
  })

  it('maps every Channel request to the existing Core controller contract', () => {
    expect(mapChannelRequestToLegacy('conversation.create', {
      externalUserId: 'user', externalConversationId: 'chat', externalEventId: 'event', title: 'Title',
    })).toEqual({
      type: 'conversation.new',
      payload: { openId: 'user', chatId: 'chat', eventId: 'event', title: 'Title' },
    })
    expect(mapChannelRequestToLegacy('delivery.ack', {
      deliveryId: 'turn-1', externalConversationId: 'chat', kind: 'turn', ok: true,
    })).toEqual({
      type: 'turn.delivery.ack',
      payload: { turnId: 'turn-1', chatId: 'chat', ok: true },
    })
    expect(mapChannelRequestToLegacy('decision.respond', {
      externalUserId: 'user', externalConversationId: 'chat', externalEventId: 'event',
      decisionId: 'decision', actionToken: 'token', allowed: false,
    })).toMatchObject({
      type: 'decision.respond',
      payload: { openId: 'user', chatId: 'chat', eventId: 'event', allowed: false },
    })
  })

  it('restricts the concrete handlers to the bundled Feishu App identity', async () => {
    const requests: any[] = []
    const handlers = createFeishuChannelHandlers({
      handleRequest: async (request: any, context: any) => {
        requests.push({ request, context })
        return { accepted: true }
      },
    })
    const context = { appId: FEISHU_APP_ID, instanceId: FEISHU_APP_INSTANCE_ID }
    await expect(handlers['message.receive']({
      externalUserId: 'user', externalConversationId: 'chat', externalEventId: 'event', text: 'hello',
    }, context)).resolves.toEqual({ accepted: true })
    expect(requests[0].request).toMatchObject({
      type: 'chat.message.received',
      payload: { openId: 'user', chatId: 'chat', eventId: 'event', text: 'hello' },
    })
    await expect(handlers['message.receive']({
      externalUserId: 'user', externalConversationId: 'chat', externalEventId: 'event', text: 'hello',
    }, { ...context, appId: 'other.channel' })).rejects.toThrow('reserved')
  })

  it('lets the Host disable Channel requests while another deployment owns Feishu', async () => {
    const handlers = createFeishuChannelHandlers({
      handleRequest: async () => ({ accepted: true }),
      allowRequest: () => false,
    })
    await expect(handlers['connection.update'](
      { connected: true },
      { appId: FEISHU_APP_ID, instanceId: FEISHU_APP_INSTANCE_ID },
    )).rejects.toThrow('reserved')
  })

  it('maps durable outbound events with stable ids', () => {
    expect(mapLegacyFeishuEventToChannel('turn.completed', {
      turnId: 'turn-1', chatId: 'chat-1', text: 'done',
    })).toEqual({
      name: 'turn.completed',
      eventId: 'turn.completed:turn-1',
      data: { turnId: 'turn-1', externalConversationId: 'chat-1', text: 'done' },
    })
    expect(mapLegacyFeishuEventToChannel('decision.resolved', {
      decision: { id: 'decision-1', status: 'approved' }, reason: 'responded', deliveries: [],
    })).toMatchObject({
      name: 'decision.resolved',
      eventId: 'decision:decision-1:responded',
      data: { decisionId: 'decision-1' },
    })
  })

  it('migrates legacy settings once and enables the persistent App instance', async () => {
    const installation: any = { appId: FEISHU_APP_ID, enabled: false, grants: [] }
    const instance: any = { id: FEISHU_APP_INSTANCE_ID, appId: FEISHU_APP_ID, enabled: false, config: {} }
    let secrets: any = {}
    const calls: string[] = []
    const runtime: any = {
      installations: { get: () => installation },
      instances: { get: () => instance },
      credentials: { get: async () => secrets },
      getApp: async () => ({
        installation,
        instances: [instance],
        manifest: { permissions: ['channel:messages', 'channel:connection'] },
      }),
      updateInstance: async (_appId: string, _instanceId: string, patch: any) => {
        calls.push('configure')
        instance.config = patch.config
        secrets = patch.secrets
      },
      setAppGrants: async (_appId: string, grants: string[]) => {
        calls.push('grants')
        installation.grants = grants
      },
      setInstanceEnabled: async (_appId: string, _instanceId: string, enabled: boolean) => {
        calls.push('instance')
        instance.enabled = enabled
      },
      setAppEnabled: async (_appId: string, enabled: boolean) => {
        calls.push('app')
        installation.enabled = enabled
      },
    }
    const adapters = { feishu: { appId: 'cli_app', appSecret: 'secret' } }
    await expect(configureFeishuAppFromLegacy(runtime, adapters, { enable: true }))
      .resolves.toMatchObject({ available: true, configured: true, changed: true })
    expect(calls).toEqual(['configure', 'grants', 'instance', 'app'])
    expect(instance.config.appId).toBe('cli_app')
    expect(secrets).toMatchObject({ appSecret: 'secret' })

    calls.length = 0
    await configureFeishuAppFromLegacy(runtime, adapters, { enable: true })
    expect(calls).toEqual([])
  })

  it('refreshes the deployment snapshot after persisting paired users', async () => {
    const instance: any = {
      id: FEISHU_APP_INSTANCE_ID,
      appId: FEISHU_APP_ID,
      config: { appId: 'cli_app', pairedUsers: [], pairing: {} },
    }
    const deployment = { key: 'feishu-local' }
    const prepared: any[] = []
    const events: any[] = []
    const transitions: string[] = []
    const runtime: any = {
      instances: {
        get: () => instance,
        update: async (_instanceId: string, patch: any) => {
          instance.config = patch.config
          return instance
        },
      },
      localDeployment: () => deployment,
      prepareDeployment: async (value: any) => { prepared.push({ value, config: instance.config }) },
      publishRuntimeEvent: (event: any) => { events.push(event) },
      transitionApp: async (appId: string, operation: () => Promise<unknown>) => {
        transitions.push(appId)
        return operation()
      },
    }

    await expect(persistFeishuAppAuthorization(runtime, {
      feishu: {
        appId: 'cli_app',
        pairedUsers: [{ userId: 'ou_user', displayName: 'User', pairedAt: 10 }],
      },
      pairing: { code: null, expiresAt: null, createdAt: null },
    })).resolves.toBe(true)
    expect(transitions).toEqual([FEISHU_APP_ID])
    expect(prepared).toEqual([{ value: deployment, config: instance.config }])
    expect(instance.config.pairedUsers).toEqual([
      { userId: 'ou_user', displayName: 'User', pairedAt: 10 },
    ])
    expect(events).toEqual([{
      type: 'instance-changed', appId: FEISHU_APP_ID, instanceId: FEISHU_APP_INSTANCE_ID,
    }])
  })

  it('commits migration readiness only after both Backend and transport are ready', () => {
    const installation = { appId: FEISHU_APP_ID, enabled: true }
    const instance = { id: FEISHU_APP_INSTANCE_ID, appId: FEISHU_APP_ID, enabled: true }
    let state = 'starting'
    const runtime: any = {
      installations: { get: () => installation },
      instances: { get: () => instance },
      localDeployment: () => ({ key: 'feishu-local' }),
      supervisor: { status: () => ({ state, pid: 42 }) },
    }

    expect(getFeishuAppProcessStatus(runtime)).toMatchObject({
      status: 'running', bridgeReady: false, enabled: true,
    })
    expect(isFeishuAppReady(runtime, { connected: true })).toBe(false)
    state = 'running'
    expect(isFeishuAppReady(runtime, { connected: false })).toBe(false)
    expect(isFeishuAppReady(runtime, { connected: true })).toBe(true)
  })
})
