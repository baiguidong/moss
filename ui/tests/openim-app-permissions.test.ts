import { describe, expect, it } from 'bun:test'
import {
  isAllowedOpenIMMediaPermission,
  isAuthorizedOpenIMAppState,
} from '../src/openim/openim-app-permissions.mjs'

function fixture(overrides: Record<string, unknown> = {}) {
  const runtime = {}
  return {
    runtime,
    state: {
      id: 'moss.openim',
      runtime,
      source: { mode: 'published' },
    },
    installation: {
      enabled: true,
      grants: ['openim:client', 'openim:media'],
    },
    ...overrides,
  }
}

describe('OpenIM App permissions', () => {
  it('authorizes only a published, enabled moss.openim installation with the requested grant', () => {
    const allowed = fixture()
    expect(isAuthorizedOpenIMAppState(allowed)).toBe(true)
    expect(isAuthorizedOpenIMAppState(fixture({
      state: { ...allowed.state, source: { mode: 'preview' } },
    }))).toBe(false)
    expect(isAuthorizedOpenIMAppState(fixture({
      state: { ...allowed.state, id: 'example.other' },
    }))).toBe(false)
    expect(isAuthorizedOpenIMAppState(fixture({
      installation: { ...allowed.installation, enabled: false },
    }))).toBe(false)
    expect(isAuthorizedOpenIMAppState(fixture({
      installation: { ...allowed.installation, grants: ['openim:client'] },
      permission: 'openim:media',
    }))).toBe(false)
  })

  it('allows only audio and video media requests from the authorized OpenIM App', () => {
    const allowed = fixture({ permission: 'media' })
    expect(isAllowedOpenIMMediaPermission({ ...allowed, mediaTypes: ['audio'] })).toBe(true)
    expect(isAllowedOpenIMMediaPermission({ ...allowed, mediaTypes: ['video'] })).toBe(true)
    expect(isAllowedOpenIMMediaPermission({ ...allowed, mediaTypes: ['audio', 'video'] })).toBe(true)
    expect(isAllowedOpenIMMediaPermission({ ...allowed, permission: 'geolocation' })).toBe(false)
    expect(isAllowedOpenIMMediaPermission({ ...allowed, mediaTypes: ['display-capture'] })).toBe(false)
  })

  it('rejects media for previews, other Apps, disabled installations, and revoked grants', () => {
    const allowed = fixture({ permission: 'media', mediaTypes: ['audio', 'video'] })
    expect(isAllowedOpenIMMediaPermission({
      ...allowed,
      state: { ...allowed.state, source: { mode: 'preview' } },
    })).toBe(false)
    expect(isAllowedOpenIMMediaPermission({
      ...allowed,
      state: { ...allowed.state, id: 'example.other' },
    })).toBe(false)
    expect(isAllowedOpenIMMediaPermission({
      ...allowed,
      installation: { ...allowed.installation, enabled: false },
    })).toBe(false)
    expect(isAllowedOpenIMMediaPermission({
      ...allowed,
      installation: { ...allowed.installation, grants: ['openim:client'] },
    })).toBe(false)
  })
})
