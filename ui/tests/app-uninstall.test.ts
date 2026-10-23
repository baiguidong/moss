import { describe, expect, test } from 'bun:test'
import { createAppUninstallHandler } from '../src/apps/app-uninstall.mjs'

function fixture(apps: Array<{ id: string; name?: string }> = []) {
  const calls: Array<[string, ...unknown[]]> = []
  const options = {
    listApps: () => apps,
    closeViews: (id: string) => { calls.push(['close', id]) },
    appWindows: new Map(),
    getRuntime: () => ({ uninstall: async (...args: unknown[]) => { calls.push(['uninstall', ...args]); return false } }),
    getConnectorHost: () => ({ remove: async (...args: unknown[]) => { calls.push(['connector', ...args]) } }),
    clearConnectorAuth: async (id: string) => { calls.push(['credentials', id]) },
    removePackage: async (id: string) => { calls.push(['package', id]) },
    emitChanged: async (event: unknown) => { calls.push(['changed', event]) },
  }
  return { calls, options }
}

describe('App uninstall', () => {
  test('a stale list entry can be removed repeatedly without a registry or Runtime installation', async () => {
    const { calls, options } = fixture()
    const uninstall = createAppUninstallHandler(options)
    expect(await uninstall(null, { name: 'example.removed' })).toEqual({ ok: true })
    expect(await uninstall(null, { name: 'example.removed' })).toEqual({ ok: true })
    expect(calls.filter(([kind]) => kind === 'package')).toEqual([['package', 'example.removed'], ['package', 'example.removed']])
    expect(calls.filter(([kind]) => kind === 'changed')).toHaveLength(2)
    expect(calls.filter(([kind]) => kind === 'credentials')).toHaveLength(0)
  })

  test('resolves a registered name and preserves explicit cleanup choices', async () => {
    const { calls, options } = fixture([{ id: 'example.app', name: 'Old app name' }])
    const uninstall = createAppUninstallHandler(options)
    expect(await uninstall(null, { name: 'Old app name', deleteData: true, deleteCredentials: true })).toEqual({ ok: true })
    expect(calls).toContainEqual(['uninstall', 'example.app', { deleteData: true, deleteCredentials: true }])
    expect(calls).toContainEqual(['connector', 'example.app', { deleteData: true, deleteCredentials: true }])
    expect(calls).toContainEqual(['credentials', 'example.app'])
  })

  test.each(['../outside', 'example/app', '', '   ', null, undefined])('rejects invalid target %s without cleanup side effects', async name => {
    const { calls, options } = fixture([{ id: 'example.keep' }])
    const result = await createAppUninstallHandler(options)(null, { name })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid App id')
    expect(calls).toEqual([])
  })

  test('keeps real uninstall failures visible and does not remove the package afterward', async () => {
    const { calls, options } = fixture()
    options.getRuntime = () => ({ uninstall: async () => { throw new Error('Runtime cleanup failed') } })
    const result = await createAppUninstallHandler(options)(null, { name: 'example.app' })
    expect(result).toEqual({ ok: false, error: 'Error: Runtime cleanup failed' })
    expect(calls).toEqual([['close', 'example.app']])
  })

  test('closes only live windows belonging to the target App', async () => {
    const { calls, options } = fixture()
    options.appWindows.set('example.app:settings', { isDestroyed: () => false, close: () => calls.push(['window', 'target']) })
    options.appWindows.set('example.app:closed', { isDestroyed: () => true, close: () => calls.push(['window', 'destroyed']) })
    options.appWindows.set('example.application:settings', { isDestroyed: () => false, close: () => calls.push(['window', 'other']) })
    expect(await createAppUninstallHandler(options)(null, { name: 'example.app' })).toEqual({ ok: true })
    expect(calls.filter(([kind]) => kind === 'window')).toEqual([['window', 'target']])
  })

  test('removes a stale package and refreshes the list when Runtime is not initialized', async () => {
    const { calls, options } = fixture()
    expect(await createAppUninstallHandler({ ...options, getRuntime: () => null })(null, { name: 'example.app' })).toEqual({ ok: true })
    expect(calls).toEqual([['close', 'example.app'], ['package', 'example.app'], ['changed', { action: 'deleted', name: 'example.app' }]])
  })
})
