import { describe, expect, it } from 'bun:test'
import {
  APP_ERROR_CODES,
  MOSS_ACCOUNT_PROTOCOL,
  MOSS_AGENT_PROTOCOL,
  validateAccountHostInput,
  validateAgentHostInput,
} from '../../packages/app-sdk/src/index.mjs'
import {
  AppHostCapabilityRegistry,
  createAccountProtocolDefinition,
  createAgentProtocolDefinition,
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

  it('rejects unsafe Channel permission modes and malformed binding policies', () => {
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
      patch: { resources: { tools: ['Read'] } },
    })).toMatchObject({ patch: { resources: { tools: ['Read'] } } })
    expect(validateAgentHostInput('turn.start', {
      externalUserId: 'user-1',
      externalConversationId: 'chat-1',
      externalEventId: 'event-1',
      text: 'hello',
      source: 'human',
    })).toMatchObject({ text: 'hello' })
    expect(validateAgentHostInput('turn.list', {
      statuses: ['awaiting_review'], limit: 20,
    })).toMatchObject({ statuses: ['awaiting_review'], limit: 20 })
    expect(() => validateAgentHostInput('turn.list', { statuses: ['unknown'] }))
      .toThrow(/invalid status/)
    expect(() => validateAgentHostInput('binding.get', {
      appId: 'another.app', externalConversationId: 'chat-1',
    })).toThrow(/cannot override Runtime identity/)
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
})
