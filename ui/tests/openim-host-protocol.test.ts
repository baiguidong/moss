import { describe, expect, it } from 'bun:test'
import {
  MOSS_OPENIM_PROTOCOL,
  validateOpenIMHostInput,
  validateOpenIMHostOutput,
} from '../../packages/app-sdk/src/index.mjs'
import {
  AppHostCapabilityRegistry,
  createOpenIMProtocolDefinition,
} from '../../packages/app-runtime/src/index.mjs'

describe('OpenIM management Host protocol', () => {
  it('accepts only the bounded management operations needed by the Desktop App', () => {
    expect(validateOpenIMHostInput('session.issue', { platformId: 4 })).toEqual({ platformId: 4 })
    expect(validateOpenIMHostInput('conversation.direct.prepare', { userId: 'user-2' }))
      .toEqual({ userId: 'user-2' })
    expect(() => validateOpenIMHostInput('session.issue', { platformId: 9 })).toThrow(/platformId/)
    expect(() => validateOpenIMHostInput('directory.list', { orgId: 'other-org' })).toThrow(/override Runtime identity|unknown field/)
  })

  it('validates server responses before returning them to the App', async () => {
    const registry = new AppHostCapabilityRegistry({
      protocols: [createOpenIMProtocolDefinition()],
    })
    registry.registerHandler(MOSS_OPENIM_PROTOCOL, 'session.issue', () => ({
      available: true,
      userID: 'moss-user-1',
      imToken: 'short-lived-user-token',
      expiresIn: 3600,
      apiAddr: 'https://im.example.test',
      wsAddr: 'wss://im.example.test/msg_gateway',
      rtcEnabled: false,
      capabilities: { createGroup: true },
      user: { id: 'user-1', name: 'Alice', email: null, orgId: 'org-1' },
    }))
    const request = {
      appId: 'moss.openim',
      instanceId: 'moss.openim--default',
      protocol: MOSS_OPENIM_PROTOCOL,
      method: 'session.issue',
      input: { platformId: 4 },
      protocols: [MOSS_OPENIM_PROTOCOL],
      permissions: ['openim:client'],
      grants: ['openim:client'],
    }
    await expect(registry.dispatch(request)).resolves.toMatchObject({
      userID: 'moss-user-1',
      imToken: 'short-lived-user-token',
    })
    expect(() => validateOpenIMHostOutput('session.issue', {
      available: true,
      userID: 'moss-user-1',
      imToken: 'token',
      expiresIn: 3600,
      apiAddr: 'https://im.example.test',
      wsAddr: 'wss://im.example.test',
      rtcEnabled: false,
      capabilities: { createGroup: true },
      user: { id: 'user-1', name: 'Alice', email: null, orgId: 'org-1' },
      adminSecret: 'must-not-leak',
    })).toThrow(/unknown field: adminSecret/)
  })
})
