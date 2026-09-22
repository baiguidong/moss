import { describe, expect, it } from 'bun:test'
import { requireEnabledAppForLaunch } from '../src/apps/app-launch-policy.mjs'

function runtimeWith(enabled?: boolean) {
  return {
    installations: {
      get: (appId: string) => appId === 'moss.openim' && enabled !== undefined
        ? { appId, enabled }
        : null,
    },
  }
}

describe('App launch policy', () => {
  it('allows an enabled App to open', () => {
    expect(requireEnabledAppForLaunch({
      runtime: runtimeWith(true),
      appId: 'moss.openim',
      displayName: '即时消息',
    })).toMatchObject({ enabled: true })
  })

  it('rejects disabled and unregistered Apps with an actionable message', () => {
    for (const enabled of [false, undefined]) {
      expect(() => requireEnabledAppForLaunch({
        runtime: runtimeWith(enabled),
        appId: 'moss.openim',
        displayName: '即时消息',
      })).toThrow('“即时消息”未启用，请先启用后再打开。')
    }
  })
})
