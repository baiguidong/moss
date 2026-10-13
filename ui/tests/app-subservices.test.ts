import { expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { validateAppManifest } from '../../packages/app-sdk/src/index.mjs'
import { appServiceKey, getAppToolServices } from '../../packages/app-sdk/src/tool-services.mjs'
import { AppRuntimeHost } from '../../packages/app-runtime/src/host/index.mjs'
import { applyAppToolPolicy } from '../../src/utils/appToolPolicy'
import { canInvokeSessionAppTool, createSessionApps } from '../src/apps/session-apps.mjs'
import { getToolPickerItems } from '../src/renderer-react/lib/app-tool-selection'
import type { StoredApp } from '../src/renderer-react/types'

const key = (id: string) => appServiceKey('customer.app', id)
const app = {
  id: 'customer.app', name: 'customer.app', displayName: '客户服务', enabled: true, toolSelection: 'services',
  contributes: { services: [{ id: 'sales', title: '销售数据' }, { id: 'support', title: '客户支持' }] },
  agentTools: [{ id: 'read-sales', serviceId: 'sales' }, { id: 'read-support', serviceId: 'support' }],
  mcpServices: [{ serviceId: 'mcp/default/one', name: '知识库', status: 'unchecked', tools: [] }],
} as unknown as StoredApp

test('legacy selection waits for persisted MCP catalog restoration instead of snapshotting an empty startup catalog', async () => {
  let ready = false
  const service = createSessionApps({
    getRuntime: () => ({ installations: new Map([['customer.app', { enabled: true }]]),
      getActivePackage: async () => ({ manifest: { toolSelection: 'services', host: { protocols: ['moss.mcp/v1'] } } }),
      listContributions: async () => ({ tools: [] }) }),
    getMcpHost: () => ({ hasApp: () => ready, toolCatalog: () => ready ? app.mcpServices : [] }),
    isBusy: () => false, disposeRuntime() {}, persist() {}, emit() {},
  })
  const record = { appIds: ['customer.app'], appServiceIds: [] }
  await service.migrateRecord(record)
  expect(record.appIds).toEqual(['customer.app'])
  ready = true
  await service.migrateRecord(record)
  expect(record.appIds).toEqual([])
  expect(record.appServiceIds).toEqual([key('mcp/default/one')])
})

test('manifest declares generic native subservices, validates references and requires a compatible Host', async () => {
  const text = await fs.readFile(new URL('../docs/app-authoring.md', import.meta.url), 'utf8')
  const raw = JSON.parse(text.match(/```json\n([\s\S]*?)\n```/)![1]!)
  raw.hostApi = '^3.8.0'; raw.toolSelection = 'services'
  raw.contributes.services = [{ id: 'sales', title: '销售数据' }]
  for (const tool of raw.contributes.tools) tool.serviceId = 'sales'
  const normalized = validateAppManifest(raw)
  expect(normalized.toolSelection).toBe('services')
  expect(normalized.contributes.services[0].title).toBe('销售数据')
  expect(normalized.contributes.tools[0].serviceId).toBe('sales')
  expect(() => validateAppManifest({ ...raw, hostApi: '^3.4.0' })).toThrow('3.8.0')
  raw.contributes.tools[0].serviceId = 'missing'
  expect(() => validateAppManifest(raw)).toThrow('serviceId')
  delete raw.contributes.tools[0].serviceId
  expect(() => validateAppManifest(raw)).toThrow('serviceId')
})

test('both native and dynamic services are children of any declaring App, with cross-level search', () => {
  expect(getAppToolServices(app).map(service => service.title)).toEqual(['销售数据', '客户支持', '知识库'])
  const root = getToolPickerItems([app], '', [], [key('sales')])
  expect(root).toHaveLength(1)
  expect(root[0].expandable).toBe(true)
  expect(root[0].description).toContain('已选 1 / 3')
  expect(getToolPickerItems([app], '', [], [key('sales')], app.id).map(item => item.selected)).toEqual([true, false, false])
  expect(getToolPickerItems([app], '知识库')[0].id).toBe(key('mcp/default/one'))
  expect(getToolPickerItems([{ ...app, toolSelection: 'app' }], '').map(item => item.expandable)).toEqual([false])
  const unavailable = { ...app, enabled: false }
  expect(getToolPickerItems([unavailable], '')).toEqual([])
  expect(getToolPickerItems([unavailable], '', [], [key('sales')], app.id)[0]).toMatchObject({ selected: true, available: false })
})

test('native schemas and tool policies isolate sibling services and retain global discovery semantics', async () => {
  const tools = ['sales', 'support'].map(serviceId => ({ id: serviceId, appId: app.id!, serviceId, toolSelection: 'services' as const, toolScope: 'session' as const, inputSchema: 'missing.json' }))
  const host = Object.create(AppRuntimeHost.prototype)
  host.installations = { list: () => [{ appId: app.id, enabled: true, grants: [] }] }
  host.getActivePackage = async () => ({ manifest: { id: app.id, version: '1.0.0', toolSelection: 'services', contributes: { tools } }, root: '/missing-services-fixture' })
  expect((await host.listContributions({ kinds: ['tools'], selectedAppIds: [], selectedAppServiceIds: [], loadSchemas: true })).tools).toEqual([])
  expect((await host.listContributions({ kinds: ['tools'], selectedAppIds: [], selectedAppServiceIds: [key('sales')] })).tools.map((tool: any) => tool.serviceId)).toEqual(['sales'])
  const pool = tools.map(appInfo => ({ appInfo }))
  const policy = { appIds: [], appServiceIds: [key('sales')], mcpServers: {} }
  expect(applyAppToolPolicy(pool, policy).map(tool => tool.appInfo.serviceId)).toEqual(['sales'])
  expect(applyAppToolPolicy(pool, { ...policy, appServiceIds: [] })).toEqual([])
  expect(applyAppToolPolicy(pool, { ...policy, appIds: [app.id!], appServiceIds: [] })).toEqual([])
  const global = pool.map(tool => ({ appInfo: { ...tool.appInfo, toolScope: 'global' as const } }))
  expect(applyAppToolPolicy(global, policy).map(tool => tool.alwaysLoad)).toEqual([true, false])
  const record = { appIds: [], appServiceIds: [key('sales')], runtimeAppToolIds: new Set(['sales', 'support']) }
  expect(canInvokeSessionAppTool(record, tools[0])).toBe(true)
  expect(canInvokeSessionAppTool(record, tools[1])).toBe(false)
  record.appServiceIds = []
  expect(canInvokeSessionAppTool(record, tools[0])).toBe(false)
})

test('selection is serialized, persists service keys, defers busy runtimes and snapshots legacy whole-App selection once', async () => {
  const definition = structuredClone(app)
  const persisted: any[] = []
  const runtime = {
    installations: new Map([[app.id, { enabled: true }]]),
    getActivePackage: async () => ({ manifest: definition }),
    listContributions: async () => ({ tools: definition.agentTools }),
  }
  const service = createSessionApps({ getRuntime: () => runtime, getMcpHost: () => ({ toolCatalog: () => definition.mcpServices }),
    isBusy: (record: any) => record.busy, disposeRuntime: () => { throw new Error('busy runtime must remain intact') },
    persist: (record: any) => persisted.push(structuredClone(record.appServiceIds)), emit: () => {} })
  const record = { agentMode: 'local', appIds: [], appServiceIds: [], runtime: {}, busy: true, runtimeAppServiceIds: [] } as any
  await Promise.all([service.toggleService(record, key('sales')), service.toggleService(record, key('support'))])
  expect(record.appServiceIds).toEqual([key('sales'), key('support')])
  expect(record.appIds).toEqual([])
  expect(record.runtimeAppServiceIds).toEqual([])
  expect(record.pendingMcpRuntimeReload).toBe(true)
  await expect(service.toggleService(record, appServiceKey('other', 'sales'))).rejects.toThrow('不可用')
  await expect(service.setServices(record, app.id, [appServiceKey('other', 'sales')])).rejects.toThrow('无效')
  expect(record.appServiceIds).toEqual([key('sales'), key('support')])
  await service.setServices(record, app.id, [])
  expect(record.appServiceIds).toEqual([])
  const legacy = { appIds: [app.id], appServiceIds: [] }
  await service.migrateRecord(legacy)
  expect(legacy.appIds).toEqual([])
  expect(legacy.appServiceIds).toHaveLength(3)
  const firstEdit = { agentMode: 'local', appIds: [app.id], appServiceIds: [] }
  await service.toggleService(firstEdit, key('sales'))
  expect(firstEdit.appIds).toEqual([])
  expect(firstEdit.appServiceIds).toEqual([key('support'), key('mcp/default/one')])
  definition.mcpServices!.push({ serviceId: 'mcp/default/two', name: 'new', status: 'unchecked', tools: [] } as any)
  await service.migrateRecord(legacy)
  expect(legacy.appServiceIds).toHaveLength(3)
  expect(persisted.at(-1)).toHaveLength(2)
})
