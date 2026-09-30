import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL } from '../src/apps/app-mcp-host.mjs'
import { AppCredentialAdapter } from '../src/apps/app-runtime.mjs'
import { AppHostCapabilityRegistry } from '../../packages/app-runtime/src/capabilities/index.mjs'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))) })
async function fixture(legacy: any = { version: 1, servers: {} }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-mcp-host-')); roots.push(root)
  const installations = new Map<string, any>(), instances = new Map<string, any>()
  const runtime = {
    dataDir: path.join(root, 'apps-data'),
    credentials: new AppCredentialAdapter(root),
    installations: { get: (id: string) => installations.get(id), list: () => [...installations.values()] },
    instances: { get: (id: string) => instances.get(id), list: (appId: string) => [...instances.values()].filter(instance => instance.appId === appId) },
    appDataPath: (...parts: string[]) => path.join(...parts),
    getActivePackage: async () => ({ manifest: { backend: { protocols: [MCP_PROTOCOL] }, permissions: ['mcp:manage', 'mcp:connect'] } }),
  }
  const addApp = (appId: string) => {
    installations.set(appId, { appId, enabled: true, activeVersion: '0.1.0', grants: ['mcp:manage', 'mcp:connect', 'mcp:read', 'mcp:auth'] })
    const instanceId = `${appId}-default`; instances.set(instanceId, { id: instanceId, appId, enabled: true })
    return { appId, instanceId, version: '0.1.0', dataDir: path.join(runtime.dataDir, appId, 'instances', instanceId) }
  }
  const context = addApp('moss.mcp')
  let reloads = 0
  const calls: any[] = []
  const options = { getRuntime: () => runtime, readLegacy: () => legacy, clearLegacy: () => { legacy = { version: 1, servers: {} } }, onChanged: () => { reloads++; return { resetSessionCount: 2, skippedBusySessionCount: 1 } },
    inspect: async (name: string, config: any) => { calls.push({ name, config }); return { state: 'connected', tools: [{ name: 'search', description: 'Find things', disabled: false }], checkedAt: 10 } },
    authenticate: async (name: string) => { calls.push({ auth: name }) }, clearAuth: async (name: string) => { calls.push({ clear: name }) },
  }
  const host = new AppMcpHost(options)
  return { root, runtime, installations, instances, context, addApp, host, calls, options, legacy: () => legacy, reloads: () => reloads }
}
const config = { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer fixture-secret' }, disabledTools: ['remove'], oauth: { clientId: 'client', callbackPort: 4444 } }

test('migrates legacy services once, preserves names and tool options, and encrypts credentials', async () => {
  const f = await fixture({ version: 1, servers: { docs: { enabled: true, config, updatedAt: 1 }, local: { enabled: false, config: { command: 'node', env: { API_KEY: 'local-fixture-secret' } } } } })
  await f.host.refresh()
  expect(f.legacy().servers).toEqual({})
  expect(f.host.enabledServers()).toEqual({ docs: config })
  const list = await f.host.handle('servers.list', {}, f.context)
  expect(list.servers.map((entry: any) => entry.name)).toEqual(['docs', 'local'])
  expect(list.servers[0].config.headers.Authorization).toBe('')
  const disk = await fs.readFile(path.join(f.context.dataDir, 'mcp-servers.json'), 'utf8')
  const vault = await fs.readFile(path.join(f.root, 'credentials/app-secrets.json'), 'utf8')
  expect(disk).not.toContain('fixture-secret'); expect(vault).not.toContain('fixture-secret')
  const restarted = new AppMcpHost(f.options); await restarted.refresh()
  expect(restarted.enabledServers()).toEqual({ docs: config })
  expect(f.reloads()).toBe(1)
})

test('edits preserve masked secrets and OAuth metadata, reject collisions, and remove credentials', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  const result = await f.host.handle('servers.save', { name: 'renamed', previousName: 'docs', enabled: true, config: { ...config, headers: { Authorization: '' } } }, f.context)
  expect(result).toMatchObject({ resetSessionCount: 2, skippedBusySessionCount: 1 })
  expect(f.host.enabledServers()).toEqual({ renamed: config })
  await expect(f.host.handle('servers.save', { name: 'renamed', enabled: true, config }, f.context)).rejects.toThrow('同名')
  await f.host.handle('servers.remove', { name: 'renamed' }, f.context)
  expect(f.host.enabledServers()).toEqual({})
  const secrets = await f.runtime.credentials.get(f.context.appId, f.context.instanceId)
  expect(JSON.parse(secrets.mcpSecrets)).toEqual({})
})

test('scopes services to each App and immediately gates injection by enabled state and grants', async () => {
  const f = await fixture(), other = f.addApp('example.mcp')
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config: { type: 'stdio', command: 'node' } }, other)
  expect(Object.keys(f.host.enabledServers())).toEqual(['docs', 'example_mcp__docs'])
  await f.host.handle('servers.remove', { name: 'docs' }, other)
  expect(f.host.enabledServers().docs).toEqual(config)
  f.installations.get('moss.mcp').enabled = false
  expect(f.host.enabledServers()).toEqual({})
  await expect(f.host.handle('servers.list', {}, f.context)).rejects.toThrow('启用')
  f.installations.get('moss.mcp').enabled = true
  f.installations.get('moss.mcp').grants = ['mcp:read']
  expect(f.host.enabledServers()).toEqual({})
  f.installations.delete('moss.mcp')
  expect(f.host.enabledServers()).toEqual({})
})

test('credential clearing disables injection and concurrent saves do not lose services', async () => {
  const f = await fixture()
  await Promise.all(['alpha', 'beta'].map(name => f.host.handle('servers.save', { name, enabled: true, config }, f.context)))
  expect(Object.keys(f.host.enabledServers())).toHaveLength(2)
  await f.runtime.credentials.remove(f.context.appId, f.context.instanceId)
  await f.host.refresh()
  expect(f.host.enabledServers()).toEqual({})
  const result = await f.host.handle('servers.list', {}, f.context)
  expect(result.servers.every((entry: any) => entry.credentialsMissing)).toBe(true)
})

test('checks real unmasked configuration, caches only current results, and redacts connection errors', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  const checked = await f.host.handle('servers.inspect', { name: 'docs' }, f.context)
  expect(f.calls[0]).toEqual({ name: 'docs', config })
  expect(checked.servers[0].check.tools[0].name).toBe('search')
  await f.host.handle('auth.start', { name: 'docs' }, f.context)
  await f.host.handle('auth.clear', { name: 'docs' }, f.context)
  f.host.inspect = async () => { throw new Error('remote rejected Bearer fixture-secret') }
  const failed = await f.host.handle('servers.inspect', { name: 'docs' }, f.context)
  expect(failed.servers[0].check).toMatchObject({ state: 'failed', error: 'remote rejected [已隐藏]' })
  expect(f.calls).toContainEqual({ auth: 'docs' }); expect(f.calls).toContainEqual({ clear: 'docs' })
})

test('failed migration leaves legacy data intact and rejects cross-App identifiers and missing grants', async () => {
  const f = await fixture({ version: 1, servers: { docs: { enabled: true, config } } })
  f.runtime.credentials.set = async () => { throw new Error('disk full') }
  await expect(f.host.refresh()).rejects.toThrow('disk full')
  expect(f.legacy().servers.docs.config).toEqual(config)
  const definition = createMcpProtocolDefinition()
  expect(() => definition.methods['servers.list'].validateInput({ appId: 'another.app' })).toThrow()
  expect(() => definition.methods['servers.remove'].validateInput({ name: '__proto__' })).toThrow()
  const registry = new AppHostCapabilityRegistry({ protocols: [definition] })
  registry.registerHandler(MCP_PROTOCOL, 'servers.list', () => ({ servers: [] }))
  await expect(registry.dispatch({ ...f.context, protocol: MCP_PROTOCOL, method: 'servers.list', input: {}, protocols: [MCP_PROTOCOL], permissions: ['mcp:read'], grants: [] })).rejects.toThrow()
})

test('bounds large tool catalogs without losing service metadata or the requested service tools', async () => {
  const f = await fixture()
  for (const name of ['one', 'two']) await f.host.handle('servers.save', { name, enabled: true, config }, f.context)
  f.host.inspect = async () => ({ state: 'connected', tools: Array.from({ length: 200 }, (_, i) => ({ name: `tool_${i}`, description: '详情'.repeat(700), disabled: false })), checkedAt: 1 })
  await f.host.handle('servers.inspect', { name: 'one' }, f.context)
  const result = await f.host.handle('servers.inspect', { name: 'two' }, f.context)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(512 * 1024)
  expect(result.servers).toHaveLength(2)
  expect(result.servers[1].check.tools.length).toBeGreaterThan(0)
  expect(result.servers[1].check.truncated).toBe(true)
})
