import { describe, expect, it } from 'bun:test'
import { requireEnabledAppForLaunch, requireVerifiedAppForLaunch } from '../src/apps/app-launch-policy.mjs'

function runtimeWith(enabled?: boolean) {
  return {
    installations: {
      get: (appId: string) => appId === 'example.app' && enabled !== undefined
        ? { appId, enabled }
        : null,
    },
  }
}

describe('App launch policy', () => {
  it('allows an enabled App to open', () => {
    expect(requireEnabledAppForLaunch({
      runtime: runtimeWith(true),
      appId: 'example.app',
      displayName: '示例 App',
    })).toMatchObject({ enabled: true })
  })

  it('rejects disabled and unregistered Apps with an actionable message', () => {
    for (const enabled of [false, undefined]) {
      expect(() => requireEnabledAppForLaunch({
        runtime: runtimeWith(enabled),
        appId: 'example.app',
        displayName: '示例 App',
      })).toThrow('“示例 App”未启用，请先启用后再打开。')
    }
  })

  it('validates the active package before opening a cached App entry', async () => {
    const runtime = {
      ...runtimeWith(true),
      getActivePackage: async () => { throw new Error('Checksum mismatch') },
    }
    await expect(requireVerifiedAppForLaunch({ runtime, appId: 'example.app' })).rejects.toThrow('Checksum mismatch')
  })
})
