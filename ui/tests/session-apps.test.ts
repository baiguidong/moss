import { expect, test } from 'bun:test'
import { canInvokeSessionAppTool, createSessionApps } from '../src/apps/session-apps.mjs'

test('native tools retain active scope until reload and explicit session removal still revokes access', () => {
  const tool = { id: 'native/find', appId: 'native', toolScope: 'session' }
  const record = { appIds: [] as string[], runtimeAppToolIds: new Set([tool.id]), runtimeAppToolScopes: { [tool.id]: 'global' } }
  expect(canInvokeSessionAppTool(record, tool)).toBe(true)
  record.runtimeAppToolScopes[tool.id] = 'session'
  expect(canInvokeSessionAppTool(record, tool)).toBe(false)
  record.appIds = ['native']
  expect(canInvokeSessionAppTool(record, tool)).toBe(true)
  record.appIds = []
  expect(canInvokeSessionAppTool(record, tool)).toBe(false)
  expect(canInvokeSessionAppTool(record, { ...tool, toolScope: 'global' })).toBe(false)
})

function fixture() {
  const persisted: unknown[] = [], disposed: unknown[] = []
  const installations = new Map(['native', 'mcp', 'target', 'disabled'].map(appId => [appId, { enabled: appId !== 'disabled' }]))
  const service = createSessionApps({
    getRuntime: () => ({ installations,
      listContributions: async ({ appId }: any) => ({ tools: appId === 'native' ? [{}] : [] }),
      requireContribution: async (_: string, id: string) => { if (id !== 'native/create') throw new Error('Unknown resource'); return { appId: 'native' } },
    }),
    getMcpHost: () => ({ toolCatalog: (appId: string) => appId === 'mcp' ? [{ status: 'unchecked' }] : [] }),
    isBusy: (record: any) => record.busy || record.preparingPrompt,
    disposeRuntime: (record: any) => { disposed.push(record); record.runtime = null },
    persist: (record: any) => persisted.push([...record.appIds]), emit: () => {},
  })
  return { service, persisted, disposed }
}
test('validates native and undiscovered MCP apps, while rejecting disabled and tool-less apps', async () => {
  const { service } = fixture()
  expect(await service.validateIds(['native', 'mcp', 'native'])).toEqual(['native', 'mcp'])
  await expect(service.validateIds(['disabled'])).rejects.toThrow('启用')
  await expect(service.validateIds(['target'])).rejects.toThrow('工具')
  expect(await service.validateIds(['disabled'], ['disabled'])).toEqual(['disabled'])
})
test('updates selection durably, defers busy runtime changes, and leaves its active snapshot intact', async () => {
  const { service, persisted, disposed } = fixture()
  const record = { agentMode: 'local', appIds: ['native'], runtimeAppIds: ['native'], runtime: {}, busy: true, pendingMcpRuntimeReload: false }
  expect(await service.update(record, ['mcp'])).toBe(true)
  expect(record.appIds).toEqual(['mcp'])
  expect(record.runtimeAppIds).toEqual(['native'])
  expect(record.pendingMcpRuntimeReload).toBe(true)
  expect(disposed).toHaveLength(0)
  record.busy = false
  await service.update(record, [])
  expect(disposed).toHaveLength(1)
  expect(persisted).toEqual([['mcp'], []])
})
test('resource selection uses the attested provider, not its target App', async () => {
  const { service } = fixture()
  expect(await service.resourceAppId('native/create')).toBe('native')
  await expect(service.resourceAppId('target/spoof')).rejects.toThrow('Unknown')
  await expect(service.update({ agentMode: 'remote-direct' }, ['native'])).rejects.toThrow('本地')
})

test('concurrent resource additions and toggles use the latest persisted selection', async () => {
  const { service, persisted } = fixture()
  const record = { agentMode: 'local', appIds: [] as string[] }
  await Promise.all([
    service.update(record, ids => [...ids, 'native']),
    service.toggle(record, 'mcp'),
    service.toggle(record, 'native'),
  ])
  expect(persisted).toEqual([['native'], ['native', 'mcp'], ['mcp']])
  expect(record.appIds).toEqual(['mcp'])

  const results = await Promise.allSettled([
    service.toggle(record, 'disabled'),
    service.update(record, ids => [...ids, 'native']),
  ])
  expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled'])
  expect(record.appIds).toEqual(['mcp', 'native'])
  await expect(service.toggle(record, '')).rejects.toThrow('无效')
})

test('legacy selections stay unchanged and explicitly selected connector Apps retain remote compatibility', async () => {
  const appId = 'example.team-tools'
  const installations = new Map([[appId, { enabled: true, grants: ['connector:use'] }]])
  let connected = true
  const service = createSessionApps({
    getRuntime: () => ({ installations, getInstallation: id => installations.get(id), getActivePackage: async () => ({ manifest: { id: appId, connectorApp: { id: 'fixture' } } }) }),
    getMcpHost: () => null, connectorAvailable: async () => connected,
    isBusy: () => false, disposeRuntime: () => {}, persist: () => {}, emit: () => {},
  })
  const record = { agentMode: 'remote-direct', connectorIds: ['fixture'], appIds: [] as string[] }
  await service.migrateRecord(record)
  expect(record.appIds).toEqual([])
  expect(record.connectorIds).toEqual(['fixture'])
  await service.toggle(record, appId)
  await service.migrateRecord(record)
  expect(record.appIds).toEqual([appId])
  connected = false
  await service.toggle(record, appId)
  await expect(service.toggle(record, appId)).rejects.toThrow('连接')
})

test('remote App selection uses metadata rather than the App name', async () => {
  const installations = new Map([
    ['moss.feishu', { enabled: true, grants: [] as string[] }],
    ['moss.feishu-cli', { enabled: true, grants: ['connector:use'] }],
  ])
  const service = createSessionApps({
    getRuntime: () => ({
      installations,
      getActivePackage: async id => ({ manifest: id === 'moss.feishu-cli' ? { connectorApp: { id: 'feishu' } } : {} }),
      listContributions: async () => ({ tools: [{ id: 'moss.feishu/send' }] }),
    }),
    getMcpHost: () => null, connectorAvailable: async () => true,
    isBusy: () => false, disposeRuntime: () => {}, persist: () => {}, emit: () => {},
  })
  expect(await service.isConnectorApp('moss.feishu')).toBe(false)
  expect(await service.isConnectorApp('moss.feishu-cli')).toBe(true)
  const record = { agentMode: 'remote-direct', appIds: [] as string[] }
  await expect(service.toggle(record, 'moss.feishu')).rejects.toThrow('本地会话')
  await service.toggle(record, 'moss.feishu-cli')
  expect(record.appIds).toEqual(['moss.feishu-cli'])
})
