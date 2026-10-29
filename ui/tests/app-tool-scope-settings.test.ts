import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AppRuntimeHost } from '../../packages/app-runtime/src/host/index.mjs'
import { AppToolScopeStore } from '../../packages/app-runtime/src/tool-scope/index.mjs'
import { contracts } from '../../packages/host-contracts/src/index.mjs'

test('bundled assistants and control Apps are globally discoverable on demand without changing signed manifests or user choices', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-builtin-scope-'))
  const runtime = new AppRuntimeHost({ rootDir: root })
  await runtime.state.initialize()
  try {
    for (const id of ['moss.buddy', 'moss.browser-use', 'moss.computer-use']) {
      const manifest = { id, version: '1.0.0', toolScope: 'session', toolLoading: 'always', contributes: { tools: [{ id: 'read' }] } }
      runtime.getActivePackage = async () => ({ manifest, root: '/missing' })
      await runtime.installations.upsert(id, { enabled: true, activeVersion: '1.0.0', grants: [] })
      const context = { appId: id, assertCurrent() {} }
      expect(await runtime.toolScopeSettings(context)).toEqual({ scope: 'global', defaultScope: 'global', overridden: false })
      expect(runtime.getToolLoading(id, 'always')).toBe('on-demand')
      const tool = (await runtime.listContributions({ kinds: ['tools'], selectedAppIds: [] })).tools.find(tool => tool.appId === id)
      expect(tool?.toolScope).toBe('global')
      expect(tool?.toolLoading).toBe('on-demand')
      await runtime.toolScopeSettings(context, 'session', 'always')
      const restart = new AppRuntimeHost({ rootDir: root })
      expect(restart.getToolScope(id, 'global')).toBe('session')
      expect(restart.getToolLoading(id, 'on-demand')).toBe('always')
      expect(runtime.withOwner({ scope: 'user', orgId: 'org', userId: 'other' }, () => runtime.getToolScope(id, 'session'))).toBe('global')
      expect(manifest.toolScope).toBe('session')
      expect(manifest.toolLoading).toBe('always')
      await runtime.installations.remove(id)
    }
    expect(runtime.getToolScope('external.app', 'session')).toBe('session')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('user scope is durable, App/owner isolated, and filters native tools before schema loading', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-tool-scope-'))
  const manifest = { id: 'scope.app', version: '1.0.0', toolScope: 'session', contributes: { tools: [{ id: 'find', inputSchema: 'not-loaded.json' }] } }
  const runtime = new AppRuntimeHost({ rootDir: root })
  await runtime.state.initialize()
  runtime.getActivePackage = async () => ({ manifest, root: '/missing' })
  await runtime.installations.upsert(manifest.id, { enabled: true, activeVersion: '1.0.0', grants: [] })
  const context = { appId: manifest.id, assertCurrent() {} }
  try {
    expect((await runtime.listContributions({ kinds: ['tools'], selectedAppIds: [], loadSchemas: true })).tools).toEqual([])
    expect(await runtime.toolScopeSettings(context, 'global')).toEqual({ scope: 'global', defaultScope: 'session', overridden: true })
    expect((await runtime.listContributions({ kinds: ['tools'], selectedAppIds: [] })).tools[0].toolScope).toBe('global')
    expect(manifest.toolScope).toBe('session')
    expect(runtime.getToolScope('other.app', 'session')).toBe('session')
    expect(runtime.withOwner({ scope: 'user', orgId: 'org', userId: 'other' }, () => runtime.getToolScope(manifest.id, 'session'))).toBe('session')
    const restart = new AppRuntimeHost({ rootDir: root })
    expect(restart.getToolScope(manifest.id, 'session')).toBe('global')
    await runtime.toolScopeSettings(context, 'session')
    expect((await runtime.listContributions({ kinds: ['tools'], selectedAppIds: [], loadSchemas: true })).tools).toEqual([])
    expect((await runtime.listContributions({ kinds: ['tools'], selectedAppIds: [manifest.id] })).tools).toHaveLength(1)
    expect(await runtime.toolScopeSettings(context, null)).toEqual({ scope: 'session', defaultScope: 'session', overridden: false })
    await expect(runtime.toolScopeSettings({ appId: manifest.id, assertCurrent() { throw new Error('stale') } }, 'global')).rejects.toThrow('stale')
    expect(runtime.getToolScope(manifest.id, 'session')).toBe('session')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('scope mutation is UI-only and cannot name another App; invalid storage does not widen scope', async () => {
  const contract = contracts['moss.host/v1'].methods['tools.scope.set']
  expect(contract.surfaces).toEqual(['ui'])
  expect(contract.input.additionalProperties).toBe(false)
  expect(Object.keys(contract.input.properties)).toEqual(['scope'])
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-scope-store-'))
  try {
    const file = path.join(root, 'scope.json'), store = new AppToolScopeStore(file)
    store.set('app', 'session')
    expect(() => store.set('app', 'invalid')).toThrow()
    expect(new AppToolScopeStore(file).get('app')).toBe('session')
    await fs.writeFile(file, '{broken')
    expect(() => new AppToolScopeStore(file)).toThrow()
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('global on-demand and resident choices persist separately from signed manifest and obey availability', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-resident-'))
  const runtime = new AppRuntimeHost({ rootDir: root })
  const manifest = { id: 'resident.app', version: '1.0.0', toolScope: 'global', toolLoading: 'always', contributes: { tools: [{ id: 'find' }, { id: 'export', permission: 'export' }] } }
  await runtime.state.initialize()
  runtime.getActivePackage = async () => ({ manifest, root: '/missing' })
  await runtime.installations.upsert(manifest.id, { enabled: true, activeVersion: '1.0.0', grants: [] })
  const context = { appId: manifest.id, assertCurrent() {} }
  try {
    const list = async () => (await runtime.listContributions({ kinds: ['tools'], selectedAppIds: [] })).tools
    expect((await list()).map(tool => tool.toolLoading)).toEqual(['always'])
    await runtime.toolScopeSettings(context, 'global', 'on-demand')
    expect((await list()).map(tool => tool.toolLoading)).toEqual(['on-demand'])
    expect(new AppRuntimeHost({ rootDir: root }).getToolLoading(manifest.id, 'always')).toBe('on-demand')
    expect(runtime.withOwner({ scope: 'user', orgId: 'org', userId: 'other' }, () => runtime.getToolLoading(manifest.id, 'always'))).toBe('always')
    await expect(runtime.toolScopeSettings(context, 'global', 'invalid')).rejects.toThrow()
    await runtime.toolScopeSettings(context, 'global', 'always')
    expect((await list()).map(tool => tool.toolLoading)).toEqual(['always'])
    await runtime.installations.upsert(manifest.id, { enabled: false })
    expect(await list()).toEqual([])
    expect(manifest.toolLoading).toBe('always')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
