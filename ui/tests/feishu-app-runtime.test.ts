import { describe, expect, it } from 'bun:test'
import {
  FEISHU_APP_ID,
  FEISHU_APP_INSTANCE_ID,
  configureFeishuAppFromLegacy,
  createFeishuChannelHandlers,
  hasFeishuAppMigrationMarker,
  isFeishuLegacyFallbackEnabled,
  mapChannelRequestToLegacy,
  mapLegacyFeishuEventToChannel,
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
})
