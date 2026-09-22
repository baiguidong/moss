import { describe, expect, it } from 'bun:test'
import {
  APP_ERROR_CODES,
  MOSS_ACCOUNT_PROTOCOL,
  MOSS_AGENT_PROTOCOL,
  MOSS_DESKTOP_PROTOCOL,
  MOSS_REMOTE_PROTOCOL,
  validateAccountBackendEventData,
  validateAccountHostInput,
  validateAgentHostInput,
  validateDesktopHostInput,
  validateRemoteHostInput,
} from '../../packages/app-sdk/src/index.mjs'
import {
  AppHostCapabilityRegistry,
  createAccountProtocolDefinition,
  createAgentProtocolDefinition,
  createDesktopProtocolDefinition,
  createRemoteProtocolDefinition,
} from '../../packages/app-runtime/src/index.mjs'

function request(protocol: string, method: string, input: Record<string, unknown>, permission: string) {
  return {
    appId: 'fixture.channel',
    instanceId: 'fixture.channel--default',
    requestId: `${protocol}:${method}`,
    protocol,
    method,
    input,
    protocols: [protocol],
    permissions: [permission],
    grants: [permission],
  }
}

describe('Account and Agent Host protocols', () => {
  it('validates bounded Account directory requests', () => {
    expect(validateAccountHostInput('directory.search', { query: ' Alice ', limit: 20 }))
      .toEqual({ query: ' Alice ', limit: 20 })
    expect(() => validateAccountHostInput('directory.search', { query: '' }))
      .toThrow(/requires a query/)
    expect(() => validateAccountHostInput('directory.list', { limit: 201 }))
      .toThrow(/between 1 and 200/)
    expect(() => validateAccountHostInput('directory.list', { orgId: 'other-org' }))
      .toThrow(/cannot override Runtime identity/)
  })

  it('validates directory user lifecycle events', () => {
    expect(validateAccountBackendEventData('directory.user-changed', {
      user: { id: 'user-1', name: 'User', status: 'disabled' },
    })).toEqual({ user: { id: 'user-1', name: 'User', status: 'disabled' } })
    expect(() => validateAccountBackendEventData('directory.user-changed', {
      user: { id: 'user-1', status: 'unknown' },
    })).toThrow(/user status/)
  })

  it('rejects unsafe Agent permission modes and malformed binding policies', () => {
    expect(() => validateAgentHostInput('binding.update', {
      externalConversationId: 'chat-1',
      patch: { permissionMode: 'bypassPermissions' },
    })).toThrow(/permissionMode/)
    expect(() => validateAgentHostInput('binding.update', {
      externalConversationId: 'chat-1',
      patch: { resources: { tools: ['Read'], credentials: ['secret'] } },
    })).toThrow(/unknown field/)
    expect(validateAgentHostInput('binding.update', {
      externalConversationId: 'chat-1',
      defaultConversationId: 'account-1/*',
      patch: { inheritDefault: false, resources: { tools: ['Read'] } },
    })).toMatchObject({
      defaultConversationId: 'account-1/*',
      patch: { inheritDefault: false, resources: { tools: ['Read'] } },
    })
    expect(validateAgentHostInput('binding.reset', {
      externalConversationId: 'chat-1', expectedRevision: 2,
    })).toMatchObject({ externalConversationId: 'chat-1', expectedRevision: 2 })
    expect(validateAgentHostInput('turn.delivery.ack', {
      turnId: 'turn-1', externalConversationId: 'chat-1', ok: false, error: 'offline',
    })).toMatchObject({ turnId: 'turn-1', ok: false })
    expect(validateAgentHostInput('context.observe', {
      externalUserId: 'user-1', externalConversationId: 'chat-1',
      externalEventId: 'outgoing-1', text: 'manual reply',
    })).toMatchObject({ externalEventId: 'outgoing-1', text: 'manual reply' })
    expect(validateAgentHostInput('turn.start', {
      externalUserId: 'user-1',
      externalConversationId: 'chat-1',
      externalEventId: 'event-1',
      defaultConversationId: 'account-1/*',
      text: 'hello',
      source: 'human',
    })).toMatchObject({ defaultConversationId: 'account-1/*', text: 'hello' })
    expect(validateAgentHostInput('turn.list', {
      statuses: ['awaiting_review'], limit: 20,
    })).toMatchObject({ statuses: ['awaiting_review'], limit: 20 })
    expect(() => validateAgentHostInput('turn.list', { statuses: ['unknown'] }))
      .toThrow(/invalid status/)
    expect(() => validateAgentHostInput('binding.get', {
      appId: 'another.app', externalConversationId: 'chat-1',
    })).toThrow(/cannot override Runtime identity/)
  })

  it('bounds external message data and rejects fields outside the protocol contract', () => {
    const identity = {
      externalUserId: 'user-1',
      externalConversationId: 'chat-1',
      externalEventId: 'event-1',
    }
    expect(validateAgentHostInput('turn.start', {
      ...identity,
      text: 'hello',
      attachments: [{ type: 'file', name: 'note.txt', mimeType: 'text/plain' }],
    })).toMatchObject({ text: 'hello' })
    expect(() => validateAgentHostInput('turn.start', {
      ...identity,
      text: 'hello',
      externalMemberId: 'another-user',
    })).toThrow(/unknown field: externalMemberId/)
    expect(() => validateAgentHostInput('turn.start', {
      ...identity,
      text: 'x'.repeat(100_001),
    })).toThrow(/text is invalid/)
    expect(() => validateAgentHostInput('turn.start', {
      ...identity,
      attachments: Array.from({ length: 33 }, () => ({ type: 'file' })),
    })).toThrow(/at most 32/)
    expect(() => validateAgentHostInput('turn.start', {
      ...identity,
      attachments: [{ type: 'file', secret: 'value' }],
    })).toThrow(/unknown field: secret/)
    expect(() => validateAccountHostInput('identity.current', { debug: true }))
      .toThrow(/unknown field: debug/)
  })

  it('uses manifest permission and installation grant checks for both protocols', async () => {
    const registry = new AppHostCapabilityRegistry()
    registry.registerProtocol(createAccountProtocolDefinition())
    registry.registerProtocol(createAgentProtocolDefinition())
    registry.registerHandler(MOSS_ACCOUNT_PROTOCOL, 'identity.current', () => ({ source: 'local' }))
    registry.registerHandler(MOSS_AGENT_PROTOCOL, 'catalog.list', () => ({ agents: [] }))

    await expect(registry.dispatch(request(
      MOSS_ACCOUNT_PROTOCOL,
      'identity.current',
      {},
      'account:identity:read',
    ))).resolves.toEqual({ source: 'local' })
    await expect(registry.dispatch(request(
      MOSS_AGENT_PROTOCOL,
      'catalog.list',
      {},
      'agent:catalog:read',
    ))).resolves.toEqual({ agents: [] })

    await expect(registry.dispatch({
      ...request(MOSS_AGENT_PROTOCOL, 'catalog.list', {}, 'agent:catalog:read'),
      grants: [],
    })).rejects.toMatchObject({ code: APP_ERROR_CODES.permissionDenied })
  })

  it('validates and permission-gates Desktop and same-App remote protocols', async () => {
    expect(validateDesktopHostInput('file.pick', { kind: 'image', multiple: true }))
      .toEqual({ kind: 'image', multiple: true })
    expect(() => validateDesktopHostInput('shell.open-external', { url: 'file:///tmp/secret' }))
      .toThrow(/HTTP or HTTPS/)
    expect(validateRemoteHostInput('action.invoke', {
      action: 'directory.list', input: {}, timeoutMs: 30_000, ownerScope: 'org',
    })).toEqual({ action: 'directory.list', input: {}, timeoutMs: 30_000, ownerScope: 'org' })
    expect(() => validateRemoteHostInput('action.invoke', { action: 'directory.list', ownerScope: 'host' }))
      .toThrow(/ownerScope/)
    expect(() => validateRemoteHostInput('action.invoke', { action: '../other-app' }))
      .toThrow(/invalid action/)

    const registry = new AppHostCapabilityRegistry()
    registry.registerProtocol(createDesktopProtocolDefinition())
    registry.registerProtocol(createRemoteProtocolDefinition())
    registry.registerHandler(MOSS_DESKTOP_PROTOCOL, 'file.pick', () => ({ files: [] }))
    registry.registerHandler(MOSS_REMOTE_PROTOCOL, 'action.invoke', input => ({ action: input.action }))
    await expect(registry.dispatch(request(
      MOSS_DESKTOP_PROTOCOL,
      'file.pick',
      { kind: 'file' },
      'desktop:files',
    ))).resolves.toEqual({ files: [] })
    await expect(registry.dispatch(request(
      MOSS_REMOTE_PROTOCOL,
      'action.invoke',
      { action: 'directory.list' },
      'remote:actions',
    ))).resolves.toEqual({ action: 'directory.list' })
    await expect(registry.dispatch({
      ...request(MOSS_REMOTE_PROTOCOL, 'action.invoke', { action: 'directory.list' }, 'remote:actions'),
      grants: [],
    })).rejects.toMatchObject({ code: APP_ERROR_CODES.permissionDenied })
  })
})
