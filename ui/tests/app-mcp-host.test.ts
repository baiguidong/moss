import { appServiceKey } from '../../packages/app-sdk/src/tool-services.mjs'
import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { AsyncLocalStorage } from 'node:async_hooks'
import { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, validateMcpHostInput } from '../src/apps/app-mcp-host.mjs'
import { AppCredentialAdapter } from '../src/apps/app-runtime.mjs'
import { AppHostCapabilityRegistry } from '../../packages/app-runtime/src/capabilities/index.mjs'
import { APP_ERROR_CODES, AppServiceError } from '../../packages/app-sdk/src/protocol/index.mjs'
import { buildMcpToolName } from '../../src/services/mcp/mcpStringUtils.js'

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
    getActivePackage: async () => ({ manifest: { host: { protocols: [MCP_PROTOCOL] },
backend: { }, permissions: ['mcp:manage', 'mcp:connect'] } }),
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

test('configuration updates preserve directory settings, disabled tools, secrets, enablement and identity', async () => {
  const f = await fixture(), getPackage = f.runtime.getActivePackage
  const roots = { directories: [], includeWorkspace: true, delivery: 'arguments' }
  const initial = { type: 'stdio', command: 'npx', args: ['v1'], roots, env: { TOKEN: 'default', NEW: 'old' } }
  const definition = (value: any) => fs.writeFile(path.join(f.root, 'mcp.json'), JSON.stringify({ mcpServers: { files: value } }))
  f.runtime.getActivePackage = async () => ({ root: f.root, manifest: { ...(await getPackage()).manifest, hostApi: '^3.10.0', mcpApp: { config: 'mcp.json' } } })
  await definition(initial); await f.host.refresh()
  await f.host.handle('servers.save', { name: 'files', previousName: 'files', enabled: false, config: { ...initial, roots: { ...roots, directories: [f.root] }, disabledTools: ['write_file'], env: { TOKEN: 'user-secret', NEW: 'old' } } }, f.context)
  const identity = f.host.toolCatalog('moss.mcp')[0].serviceId
  await definition({ ...initial, args: ['v2'], env: { TOKEN: 'revised-default', NEW: 'new' } }); await f.host.refresh()
  const saved = (await f.host.handle('servers.list', {}, f.context)).servers[0]
  expect(saved.enabled).toBe(false)
  expect(saved.config.args).toEqual(['v2'])
  expect(saved.config.roots.directories).toEqual([f.root])
  expect(saved.config.disabledTools).toEqual(['write_file'])
  expect(f.host.toolCatalog('moss.mcp')[0].serviceId).toBe(identity)
  await f.host.handle('servers.set-enabled', { name: 'files', enabled: true }, f.context)
  expect(f.host.enabledServers().files.env).toMatchObject({ TOKEN: 'user-secret', NEW: 'new', MOSS_SESSION_WORKSPACE: '' })
  await expect(f.host.handle('servers.save', { name: 'files', previousName: 'files', enabled: true, config: { ...initial, roots: { ...roots, directories: [path.join(f.root, 'missing')] } } }, f.context)).rejects.toThrow('目录不存在')
  expect(f.host.enabledServers().files.roots.directories).toEqual([f.root])
})

test('legacy directory Backend conversion replaces obsolete executable paths and preserves public roots and exclusions', async () => {
  const f = await fixture(), getPackage = f.runtime.getActivePackage
  await f.host.handle('servers.save', { name: 'files', enabled: false, config: { type: 'stdio', command: '/old/node', args: ['/old/package/cli.mjs', JSON.stringify({ directories: [f.root], disabledTools: ['write_file'] })], disabledTools: ['write_file'] } }, f.context)
  const identity = f.host.toolCatalog('moss.mcp')[0].serviceId
  await fs.writeFile(path.join(f.root, 'mcp.json'), JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['pinned-upstream'], roots: { directories: [], includeWorkspace: true, delivery: 'arguments' } } } }))
  f.runtime.getActivePackage = async () => ({ root: f.root, manifest: { ...(await getPackage()).manifest, hostApi: '^3.10.0', mcpApp: { config: 'mcp.json' } } })
  await f.host.refresh()
  const saved = (await f.host.handle('servers.list', {}, f.context)).servers[0]
  expect(saved).toMatchObject({ enabled: false, config: { command: 'npx', args: ['pinned-upstream'], roots: { directories: [f.root] }, disabledTools: ['write_file'] } })
  expect(f.host.toolCatalog('moss.mcp')[0].serviceId).toBe(identity)
})

test('an upstream transport switch keeps customized directory connections valid', async () => {
  const f = await fixture(), getPackage = f.runtime.getActivePackage
  const initial = { type: 'stdio', command: 'npx', args: ['files'], roots: { directories: [], includeWorkspace: true, delivery: 'arguments' } }
  const definition = (value: any) => fs.writeFile(path.join(f.root, 'mcp.json'), JSON.stringify({ mcpServers: { files: value } }))
  f.runtime.getActivePackage = async () => ({ root: f.root, manifest: { ...(await getPackage()).manifest, hostApi: '^3.10.0', mcpApp: { config: 'mcp.json' } } })
  await definition(initial); await f.host.refresh()
  const customized = { ...initial, roots: { ...initial.roots, directories: [f.root] } }
  await f.host.handle('servers.save', { name: 'files', previousName: 'files', enabled: true, config: customized }, f.context)
  await definition({ type: 'http', url: 'https://example.com/files' }); await f.host.refresh()
  expect((await f.host.handle('servers.list', {}, f.context)).servers[0].config).toEqual(customized)
})

test('user App scope changes every MCP service without changing saved configurations', async () => {
  const f = await fixture()
  let selectedScope = 'session'
  f.runtime.getToolScope = () => selectedScope
  await f.host.handle('servers.save', { name: 'knowledge', enabled: true, config }, f.context)
  expect(f.host.enabledServers([])).toEqual({})
  selectedScope = 'global'
  expect(f.host.enabledServers([]).knowledge).toEqual(config)
  const snapshot = f.host.serverOwners()
  expect(snapshot.knowledge.toolScope).toBe('global')
  selectedScope = 'session'
  expect(f.host.enabledServers([])).toEqual({})
  expect(f.host.serverOwners().knowledge.toolScope).toBe('session')
  expect(snapshot.knowledge.toolScope).toBe('global')
  expect(f.host.enabledServers(['moss.mcp']).knowledge).toEqual(config)
})

test('Core propagates only explicitly stateless idle policy and identifies the changed App', async () => {
  const f = await fixture(), changed: string[] = []
  f.host.onChanged = (appId: string) => { changed.push(appId) }
  await f.host.handle('servers.save', { name: 'one', enabled: true, config }, f.context)
  expect(f.host.serverOwners().one.mcpIdleTimeoutMs).toBeUndefined()
  const getPackage = f.runtime.getActivePackage
  let policy: any = { state: 'stateless' }
  await fs.writeFile(path.join(f.root, 'mcp.json'), JSON.stringify({ mcpServers: { one: config } }))
  f.runtime.getActivePackage = async () => ({ root: f.root, manifest: { ...(await getPackage()).manifest, mcpApp: { config: 'mcp.json', runtime: policy } } })
  await f.host.refresh()
  expect(f.host.serverOwners().one.mcpIdleTimeoutMs).toBe(3_600_000)
  policy = { state: 'stateless', idleTimeoutMs: 10_000 }; await f.host.refresh()
  expect(f.host.serverOwners().one.mcpIdleTimeoutMs).toBe(10_000)
  f.host.getIdleTimeoutMs = () => 7_200_000
  expect(f.host.serverOwners().one.mcpIdleTimeoutMs).toBe(7_200_000)
  policy = { state: 'session' }; await f.host.refresh()
  expect(f.host.serverOwners().one.mcpIdleTimeoutMs).toBeUndefined()
  expect(changed).toEqual(['moss.mcp', 'moss.mcp'])
})

test('all MCP services inherit App scope, including saves, refreshes and unselected sessions', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'one', enabled: true, config }, f.context)
  await f.host.handle('servers.save', { name: 'two', enabled: true, config }, f.context)
  expect(Object.keys(f.host.enabledServers([]))).toEqual([])
  expect(Object.keys(f.host.enabledServers(['moss.mcp'])).sort()).toEqual(['one', 'two'])
  expect(f.host.serverOwners().one).toMatchObject({ appId: 'moss.mcp', toolScope: 'session' })
  const getPackage = f.runtime.getActivePackage
  f.runtime.getActivePackage = async () => {
    const pkg = await getPackage()
    return { manifest: { ...pkg.manifest, toolScope: 'global' } }
  }
  await f.host.refresh()
  expect(Object.keys(f.host.enabledServers([])).sort()).toEqual(['one', 'two'])
  await f.host.handle('servers.save', { name: 'three', enabled: true, config }, f.context)
  expect(f.host.serverOwners().three.toolScope).toBe('global')
  expect(Object.keys(f.host.enabledServers([]))).toHaveLength(3)
})

test('portable stdio paths stay on disk and resolve identically for sessions and checks after restart', async () => {
  const f = await fixture()
  const portable = { type: 'stdio', command: '~/bin/mcp', args: ['--output-dir', '~/.moss/artifacts/playwright'] }
  const resolved = { ...portable, env: { MOSS_SESSION_WORKSPACE: '' }, command: path.join(os.homedir(), 'bin/mcp'), args: ['--output-dir', path.join(os.homedir(), '.moss/artifacts/playwright')] }
  await f.host.handle('servers.save', { name: 'browser', enabled: true, config: portable }, f.context)
  expect(f.host.enabledServers().browser).toEqual(resolved)
  expect(f.host.findServer('browser')?.config).toEqual(resolved)
  const checked = await f.host.handle('servers.inspect', { name: 'browser' }, f.context)
  expect(f.calls[0].config).toEqual(resolved)
  expect(checked.servers[0].config).toEqual(portable)
  const stored = JSON.parse(await fs.readFile(path.join(f.context.dataDir, 'mcp-servers.json'), 'utf8'))
  expect(stored.servers.browser.config).toEqual(portable)
  const restarted = new AppMcpHost(f.options); await restarted.refresh()
  expect(restarted.enabledServers().browser).toEqual(resolved)
})

test('session MCP launches bind their own workspace without changing shared settings or service checks', async () => {
  const f = await fixture()
  for (const appId of ['moss.git', 'moss.filesystem']) {
    const context = f.addApp(appId)
    const config = { type: 'stdio', command: 'node', args: ['server.mjs', '{"directories":["/shared"]}'], env: { TOKEN: 'fixture', MOSS_SESSION_WORKSPACE: '/stale' } }
    await f.host.handle('servers.save', { name: 'local', enabled: true, config }, context)
    const name = `${appId.replaceAll('.', '_')}__local`
    const first = path.join(f.root, 'First workspace'), second = path.join(f.root, '第二个工作目录')
    const a = f.host.enabledServers([appId], first)[name]
    const b = f.host.enabledServers([appId], second)[name]
    expect(a.env).toEqual({ TOKEN: 'fixture', MOSS_SESSION_WORKSPACE: first })
    expect(b.env.MOSS_SESSION_WORKSPACE).toBe(second)
    expect(a.env.MOSS_SESSION_WORKSPACE).toBe(first)
    expect(a.args).toEqual(config.args)
    await f.host.handle('servers.inspect', { name: 'local' }, context)
    expect(f.calls.at(-1).config.env.MOSS_SESSION_WORKSPACE).toBe('')
    expect(f.host.findServer(name)?.config.env.MOSS_SESSION_WORKSPACE).toBe('')
    const disk = await fs.readFile(path.join(context.dataDir, 'mcp-servers.json'), 'utf8')
    expect(disk).not.toContain(first)
    expect(disk).not.toContain(second)
    expect(f.host.enabledServers([], first)[name]).toBeUndefined()
  }
})

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

test('omits repeated App service names while keeping manager names and other services distinct', async () => {
  const f = await fixture(), standalone = f.addApp('moss.sequential-thinking'), other = f.addApp('example.sequential-thinking')
  await f.host.handle('servers.save', { name: 'sequential-thinking', enabled: true, config }, f.context)
  await f.host.handle('servers.save', { name: 'sequential-thinking', enabled: true, config }, standalone)
  await f.host.handle('servers.save', { name: 'sequential-thinking', enabled: true, config }, other)
  await f.host.handle('servers.save', { name: 'secondary', enabled: true, config }, standalone)
  expect(Object.keys(f.host.enabledServers())).toEqual([
    'sequential-thinking', 'moss_sequential_thinking', 'moss_sequential_thinking__secondary', 'example_sequential_thinking',
  ])
  expect(f.host.serverOwners().moss_sequential_thinking.appId).toBe(standalone.appId)
  expect(f.host.toolCatalog(standalone.appId)[0].runtimeName).toBe('moss_sequential_thinking')
  expect(f.host.findServer('moss_sequential_thinking')?.localName).toBe('sequential-thinking')
  await f.host.handle('servers.inspect', { name: 'sequential-thinking' }, standalone)
  expect(f.calls.at(-1).name).toBe('moss_sequential_thinking')
  await expect(f.host.handle('servers.save', { name: 'moss_sequential_thinking', enabled: true, config }, f.context)).rejects.toThrow('冲突')
  await expect(f.host.handle('servers.save', { name: 'sequential_thinking', enabled: true, config }, standalone)).rejects.toThrow('冲突')
  const restarted = new AppMcpHost(f.options); await restarted.refresh()
  expect(restarted.enabledServers()).toEqual(f.host.enabledServers())
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

test('inspection projects extended upstream server metadata into the App protocol', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'excel', enabled: true, config }, f.context)
  f.host.inspect = async () => ({ state: 'connected', tools: [], checkedAt: 10,
    serverInfo: { name: 'excel-mcp-server', version: '2.0.0', title: 'Excel MCP Server',
      description: 'Workbooks', websiteUrl: 'https://example.com', icons: [{ src: 'https://example.com/icon.png' }] } })
  const expected = { name: 'excel-mcp-server', version: '2.0.0' }
  const inspected = await f.host.handle('servers.inspect', { name: 'excel' }, f.context)
  expect(inspected.servers[0].check.state).toBe('connected')
  expect(inspected.servers[0].check.serverInfo).toEqual(expected)
  expect((await f.host.handle('servers.list', {}, f.context)).servers[0].check.serverInfo).toEqual(expected)
  expect(f.host.toolCatalog('moss.mcp')[0].status).toBe('connected')
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

test('desktop MCP catalog discovers real tools without static contributions or exposing launch secrets', async () => {
  const f = await fixture()
  let notifications = 0
  f.host.onCatalogChanged = () => { notifications++ }
  f.host.inspect = async (name: string, resolved: any) => {
    f.calls.push({ name, config: resolved })
    return { state: 'connected', tools: [{ name: 'search', description: 'Find things', disabled: false }, { name: 'remove', description: 'Remove things', disabled: true }], checkedAt: 10 }
  }
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  const initial = f.host.toolCatalog('moss.mcp')[0]
  expect(initial).toMatchObject({ name: 'docs', status: 'unchecked', tools: [] })
  const reloads = f.reloads()
  const result = await f.host.inspectTools({ appId: initial.appId, instanceId: initial.instanceId, name: initial.name, revision: initial.revision })
  expect(result).toMatchObject({ status: 'connected', tools: [{ name: 'search', disabled: false }, { name: 'remove', disabled: true }] })
  expect(f.calls[0].config.headers.Authorization).toBe(config.headers.Authorization)
  expect(JSON.stringify(result)).not.toContain('fixture-secret')
  expect(result).not.toHaveProperty('config')
  expect(f.reloads()).toBe(reloads)
  expect(notifications).toBe(2)
  const restarted = new AppMcpHost(f.options); await restarted.refresh()
  expect(restarted.toolCatalog('moss.mcp')[0]).toMatchObject({ status: 'unchecked', catalogSource: 'cache', checkedAt: 10, tools: result.tools })
  expect(f.calls).toHaveLength(1)
  expect((await restarted.handle('servers.list', {}, f.context)).servers[0].check).toBeNull()
  const persisted = await fs.readFile(path.join(f.context.dataDir, 'mcp-tool-catalog.json'), 'utf8')
  expect(persisted).not.toContain('fixture-secret')
  expect(persisted).not.toContain('headers')
  expect(persisted).not.toContain('connected')
})

test('failed refresh retains the last successful catalog, while a successful empty result replaces it', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  await f.host.handle('servers.inspect', { name: 'docs' }, f.context)
  f.host.inspect = async () => { throw new Error('offline') }
  await f.host.handle('servers.inspect', { name: 'docs' }, f.context)
  expect(f.host.toolCatalog('moss.mcp')[0]).toMatchObject({ status: 'failed', catalogSource: 'cache', checkedAt: 10, tools: [{ name: 'search' }], error: 'offline' })
  f.host.inspect = async () => ({ state: 'connected', tools: [], checkedAt: 20 })
  await f.host.handle('servers.inspect', { name: 'docs' }, f.context)
  const restarted = new AppMcpHost(f.options); await restarted.refresh()
  expect(restarted.toolCatalog('moss.mcp')[0]).toMatchObject({ status: 'unchecked', catalogSource: 'cache', checkedAt: 20, tools: [] })
})

test('changed configuration, auth reset and recreated services cannot reuse old catalogs', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  await f.host.handle('servers.inspect', { name: 'docs' }, f.context)
  await f.host.handle('servers.save', { name: 'docs', previousName: 'docs', enabled: true, config: { ...config, url: 'https://new.example.com/mcp' } }, f.context)
  expect(f.host.toolCatalog('moss.mcp')[0]).toMatchObject({ catalogSource: 'unknown', tools: [] })
  await f.host.handle('servers.inspect', { name: 'docs' }, f.context)
  let release!: (value: any) => void, started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  f.host.inspect = () => { started(); return new Promise(resolve => { release = resolve }) }
  const pending = f.host.handle('servers.inspect', { name: 'docs' }, f.context)
  await ready
  await f.host.handle('auth.clear', { name: 'docs' }, f.context)
  release({ state: 'connected', tools: [{ name: 'stale' }], checkedAt: 30 })
  await expect(pending).rejects.toThrow('配置已变化')
  const restarted = new AppMcpHost(f.options); await restarted.refresh()
  expect(restarted.toolCatalog('moss.mcp')[0]).toMatchObject({ catalogSource: 'unknown', tools: [] })
  await restarted.recordRuntimeCatalog('docs', { ...config, url: 'https://new.example.com/mcp', scope: 'dynamic' }, { state: 'connected', checkedAt: Date.now(), tools: [{ name: 'late-auth-session' }] }, 1)
  expect(restarted.toolCatalog('moss.mcp')[0].catalogSource).toBe('unknown')
  await restarted.handle('servers.inspect', { name: 'docs' }, f.context)
  await restarted.handle('servers.remove', { name: 'docs' }, f.context)
  await restarted.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  expect(restarted.toolCatalog('moss.mcp')[0]).toMatchObject({ catalogSource: 'unknown', tools: [] })
})

test('concurrent desktop discovery shares one transport inspection', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  let release!: (value: any) => void, started!: () => void, calls = 0
  const ready = new Promise<void>(resolve => { started = resolve })
  f.host.inspect = () => { calls++; started(); return new Promise(resolve => { release = resolve }) }
  const { appId, instanceId, name, revision } = f.host.toolCatalog('moss.mcp')[0]
  const first = f.host.inspectTools({ appId, instanceId, name, revision })
  const second = f.host.inspectTools({ appId, instanceId, name, revision })
  await ready
  release({ state: 'connected', tools: [{ name: 'search', description: '', disabled: false }], checkedAt: 10 })
  const results = await Promise.all([first, second])
  expect(calls).toBe(1); expect(results[0]).toEqual(results[1])
})

test('live Agent discovery updates display metadata only for the current launch configuration', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  const check = { state: 'connected', tools: [{ name: 'live', description: `Uses ${config.headers.Authorization}`, inputSchema: { secret: true } }], checkedAt: 20 }
  await f.host.recordRuntimeCatalog('docs', { ...config, scope: 'dynamic', url: 'https://old.example.com/mcp' }, check)
  expect(f.host.toolCatalog('moss.mcp')[0].catalogSource).toBe('unknown')
  await f.host.recordRuntimeCatalog('docs', { ...config, scope: 'dynamic' }, check)
  expect(f.calls).toHaveLength(0)
  expect(f.host.toolCatalog('moss.mcp')[0]).toMatchObject({ status: 'connected', catalogSource: 'live', tools: [{ name: 'live', description: 'Uses [已隐藏]' }] })
  const persisted = await fs.readFile(path.join(f.context.dataDir, 'mcp-tool-catalog.json'), 'utf8')
  expect(persisted).not.toContain('fixture-secret'); expect(persisted).not.toContain('inputSchema')
  let release!: () => void
  const blocker = f.host.serial(() => new Promise<void>(resolve => { release = resolve }))
  await Promise.resolve()
  const changed = f.host.handle('servers.save', { name: 'docs', previousName: 'docs', enabled: true, config: { ...config, url: 'https://changed.example.com/mcp' } }, f.context)
  const stale = f.host.recordRuntimeCatalog('docs', { ...config, scope: 'dynamic' }, check)
  release(); await blocker; await changed; await stale
  expect(f.host.toolCatalog('moss.mcp')[0]).toMatchObject({ catalogSource: 'unknown', tools: [] })
})

test('corrupt display caches are ignored without blocking App startup', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  for (const content of ['{broken', JSON.stringify({ version: 2, services: {} }), 'x'.repeat(513 * 1024)]) {
    await fs.writeFile(path.join(f.context.dataDir, 'mcp-tool-catalog.json'), content)
    const restarted = new AppMcpHost(f.options); await restarted.refresh()
    expect(restarted.toolCatalog('moss.mcp')[0]).toMatchObject({ status: 'unchecked', catalogSource: 'unknown', tools: [] })
  }
  expect(f.calls).toHaveLength(0)
})

test('desktop catalog preserves disabled services and prevents probing without grants, credentials, or enabled instances', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  const request = () => {
    const { appId, instanceId, name, revision } = f.host.toolCatalog('moss.mcp')[0]
    return { appId, instanceId, name, revision }
  }
  const installation = f.installations.get('moss.mcp'), instance = f.instances.get(f.context.instanceId)
  installation.enabled = false
  expect(f.host.toolCatalog('moss.mcp')[0].status).toBe('app-disabled')
  await expect(f.host.inspectTools(request())).rejects.toThrow('停用')
  installation.enabled = true; instance.enabled = false
  expect(f.host.toolCatalog('moss.mcp')[0].status).toBe('instance-disabled')
  await expect(f.host.inspectTools(request())).rejects.toThrow('停用')
  instance.enabled = true; installation.grants = ['mcp:read']
  expect(f.host.toolCatalog('moss.mcp')[0].status).toBe('unauthorized')
  await expect(f.host.inspectTools(request())).rejects.toThrow('未授权')
  installation.grants = ['mcp:manage', 'mcp:connect']
  await f.runtime.credentials.remove(f.context.appId, f.context.instanceId); await f.host.refresh()
  expect(f.host.toolCatalog('moss.mcp')[0].status).toBe('credentials-missing')
  await expect(f.host.inspectTools(request())).rejects.toThrow('凭据')
  await f.host.handle('servers.set-enabled', { name: 'docs', enabled: false }, f.context)
  expect(f.host.toolCatalog('moss.mcp')[0].status).toBe('disabled')
  await expect(f.host.inspectTools(request())).rejects.toThrow('停用')
  expect(f.calls).toHaveLength(0)
})

test('an inspection finishing after a service toggle cannot repopulate the cleared catalog', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  let release!: (value: any) => void, started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  f.host.inspect = () => { started(); return new Promise(resolve => { release = resolve }) }
  const pending = f.host.handle('servers.inspect', { name: 'docs' }, f.context)
  await ready
  const old = f.host.toolCatalog('moss.mcp')[0]
  await f.host.handle('servers.set-enabled', { name: 'docs', enabled: false }, f.context)
  release({ state: 'connected', tools: [{ name: 'old-tool' }], checkedAt: 10 })
  await expect(pending).rejects.toThrow('配置已变化')
  expect(f.host.toolCatalog('moss.mcp')[0]).toMatchObject({ status: 'disabled', tools: [] })
  await f.host.handle('servers.set-enabled', { name: 'docs', enabled: true }, f.context)
  await expect(f.host.inspectTools({ appId: old.appId, instanceId: old.instanceId, name: old.name, revision: old.revision })).rejects.toThrow('配置已变化')
})

test('a queued desktop discovery rechecks enabled state before starting the transport', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  const { appId, instanceId, name, revision } = f.host.toolCatalog('moss.mcp')[0]
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const blocker = f.host.serial(() => gate)
  const disabled = f.host.handle('servers.set-enabled', { name: 'docs', enabled: false }, f.context)
  const inspect = f.host.inspectTools({ appId, instanceId, name, revision })
  release(); await blocker; await disabled
  await expect(inspect).rejects.toThrow('启用状态已变化')
  expect(f.calls).toHaveLength(0)
})


test('generic App subservices survive rename/restart and do not include new or recreated servers', async () => {
  const f = await fixture(), context = f.addApp('customer.container')
  const getPackage = f.runtime.getActivePackage
  f.runtime.getActivePackage = async () => ({ manifest: { ...(await getPackage()).manifest, toolSelection: 'services' } })
  await f.host.handle('servers.save', { name: 'one', enabled: true, config }, context)
  await f.host.handle('servers.save', { name: 'two', enabled: true, config }, context)
  const first = f.host.toolCatalog(context.appId)[0]
  const selected = [appServiceKey(context.appId, first.serviceId)]
  expect(Object.keys(f.host.enabledServers([], undefined, selected))).toEqual(['customer_container__one'])
  expect(f.host.enabledServers([context.appId])).toEqual({})
  await f.host.handle('servers.save', { name: 'renamed', previousName: 'one', enabled: true, config }, context)
  expect(f.host.toolCatalog(context.appId).find((service: any) => service.name === 'renamed').serviceId).toBe(first.serviceId)
  const restarted = new AppMcpHost(f.options); await restarted.refresh()
  expect(Object.keys(restarted.enabledServers([], undefined, selected))).toEqual(['customer_container__renamed'])
  await restarted.handle('servers.save', { name: 'three', enabled: true, config }, context)
  expect(Object.keys(restarted.enabledServers([], undefined, selected))).toEqual(['customer_container__renamed'])
  await restarted.handle('servers.remove', { name: 'renamed' }, context)
  await restarted.handle('servers.save', { name: 'renamed', enabled: true, config }, context)
  expect(restarted.enabledServers([], undefined, selected)).toEqual({})
  f.installations.get(context.appId).enabled = false
  expect(restarted.enabledServers([], undefined, restarted.toolCatalog(context.appId).map((service: any) => appServiceKey(context.appId, service.serviceId)))).toEqual({})
})

test('legacy service identities are migrated durably before rename', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'old', enabled: true, config }, f.context)
  const file = path.join(f.context.dataDir, 'mcp-servers.json')
  const document = JSON.parse(await fs.readFile(file, 'utf8')); delete document.servers.old.id
  await fs.writeFile(file, JSON.stringify(document))
  await f.host.refresh()
  const id = f.host.toolCatalog(f.context.appId)[0].serviceId
  const restarted = new AppMcpHost(f.options); await restarted.refresh()
  expect(restarted.toolCatalog(f.context.appId)[0].serviceId).toBe(id)
  await restarted.handle('servers.save', { name: 'new', previousName: 'old', enabled: true, config }, f.context)
  expect(restarted.toolCatalog(f.context.appId)[0].serviceId).toBe(id)
})

test('a failed live refresh retains the complete display catalog and exposes a redacted stale state', async () => {
  const f = await fixture()
  await f.host.handle('servers.save', { name: 'docs', enabled: true, config }, f.context)
  const check = { state: 'connected', tools: [{ name: 'known', description: 'Known tool' }], checkedAt: 20, schemaRevision: 'a'.repeat(64) }
  await f.host.recordRuntimeCatalog('docs', { ...config, scope: 'dynamic' }, check)
  await f.host.recordRuntimeCatalog('docs', { ...config, scope: 'dynamic' }, { ...check, catalogStale: true, error: `refresh failed ${config.headers.Authorization}` })
  const stale = f.host.toolCatalog('moss.mcp')[0]
  expect(stale).toMatchObject({ catalogStale: true, schemaRevision: check.schemaRevision, tools: [{ name: 'known' }] })
  expect(stale.error).not.toContain('fixture-secret')
  const restarted = new AppMcpHost(f.options); await restarted.refresh()
  expect(restarted.toolCatalog('moss.mcp')[0]).toMatchObject({ catalogStale: true, tools: [{ name: 'known' }] })
  await f.host.recordRuntimeCatalog('docs', { ...config, scope: 'dynamic' }, { ...check, checkedAt: 21 })
  expect(f.host.toolCatalog('moss.mcp')[0].catalogStale).not.toBe(true)
  expect(f.calls).toHaveLength(0)
})

test('cross-App bridge discovers live tools and checks exact service, schema, grants and enabled state', async () => {
  const f = await fixture(), target = f.addApp('moss.database')
  const tool = { name: 'execute_sql', description: 'Execute SQL', inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'], additionalProperties: false } }
  const disabled = { name: 'drop_all', description: 'Disabled tool', inputSchema: { type: 'object', properties: {} } }
  const unrelated = { name: 'unrelated', inputSchema: { type: 'object', description: 'x'.repeat(70 * 1024) } }
  const databaseConfig = { type: 'stdio', command: 'node', args: ['dbhub.mjs'], env: { DB_PASSWORD: 'private-value' }, disabledTools: ['drop_all'] }
  await f.host.handle('servers.save', { name: 'database', enabled: true, config: databaseConfig }, target)
  f.host.discoverTool = async (name: string, config: any) => {
    expect(name).toBe('moss_database')
    expect(config.env.DB_PASSWORD).toBe('private-value')
    return [tool, disabled, unrelated]
  }
  const listed = await f.host.discoverBridgeTools({ targetAppId: target.appId, toolNames: ['execute_sql'] })
  expect(listed).toHaveLength(1)
  await expect(f.host.discoverBridgeTools({ targetAppId: target.appId })).rejects.toMatchObject({ code: 'APP_RESOURCE_EXHAUSTED' })
  expect(listed[0]).toMatchObject({ appId: target.appId, instanceId: target.instanceId, serviceName: 'database', name: 'execute_sql', inputSchema: tool.inputSchema })
  expect(JSON.stringify(listed)).not.toContain('private-value')
  let authorized = 0, called = 0
  f.host.invokeTool = async (_name: string, _config: any, _toolName: string, _args: any, options: any) => {
    await options.beforeCall(tool); called++
    return { content: [{ type: 'text', text: 'rows' }] }
  }
  const invoke = (changes: any = {}) => f.host.invokeBridgeTool({ targetAppId: target.appId, targetInstanceId: target.instanceId,
    serviceId: listed[0].serviceId, revision: listed[0].revision, toolName: tool.name, arguments: { sql: 'SELECT 1' },
    authorizeDispatch: () => { authorized++ }, ...changes })
  expect(await invoke()).toEqual({ content: [{ type: 'text', text: 'rows' }] })
  expect([authorized, called]).toEqual([1, 1])
  await expect(invoke({ arguments: { sql: 123 } })).rejects.toMatchObject({ code: 'APP_INVALID_ACTION_INPUT' })
  await expect(invoke({ targetAppId: 'other.app' })).rejects.toMatchObject({ code: 'APP_NOT_FOUND' })
  await expect(invoke({ toolName: 'drop_all' })).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
  expect([authorized, called]).toEqual([1, 1])
  f.host.invokeTool = async (_name: string, _config: any, _toolName: string, _args: any, options: any) => {
    await options.beforeCall({ ...tool, inputSchema: { ...tool.inputSchema, properties: { sql: { type: 'number' } } } })
  }
  await expect(invoke()).rejects.toMatchObject({ code: 'APP_CONFLICT' })
  await f.host.handle('servers.set-enabled', { name: 'database', enabled: false }, target)
  await expect(invoke()).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
})

test('cross-App MCP call rechecks target authorization immediately before the real tool call', async () => {
  const f = await fixture(), target = f.addApp('moss.database')
  const tool = { name: 'search_objects', inputSchema: { type: 'object', properties: {} } }
  await f.host.handle('servers.save', { name: 'database', enabled: true, config: { command: 'node' } }, target)
  f.host.discoverTool = async () => [tool]
  const [listed] = await f.host.discoverBridgeTools({ targetAppId: target.appId })
  let sent = false, authorize = 0
  f.host.invokeTool = async (_name: string, _config: any, _toolName: string, _args: any, options: any) => {
    f.installations.get(target.appId).grants = ['mcp:manage']
    await options.beforeCall(tool)
    sent = true
  }
  await expect(f.host.invokeBridgeTool({ targetAppId: target.appId, targetInstanceId: target.instanceId,
    serviceId: listed.serviceId, revision: listed.revision, toolName: tool.name, arguments: {},
    authorizeDispatch: () => { authorize++ } })).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
  expect(authorize).toBe(1)
  expect(sent).toBe(false)
})

test('MCP tools work after service re-enablement and Host restart without provider tool contributions', async () => {
  const f = await fixture(), target = f.addApp('moss.database')
  expect((await f.runtime.getActivePackage(target.appId)).manifest.contributes?.tools).toBeUndefined()
  await f.host.handle('servers.save', { name: 'database', enabled: true, config: { command: 'node' } }, target)
  const tool = { name: 'execute_sql', inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } }
  const discoverTool = async () => [tool]
  const invokeTool = async (_name: string, _config: any, _toolName: string, args: any, options: any) => {
    await options.beforeCall(tool)
    return { content: [{ type: 'text', text: args.sql }] }
  }
  f.host.discoverTool = discoverTool
  f.host.invokeTool = invokeTool
  const [before] = await f.host.discoverBridgeTools({ targetAppId: target.appId, toolNames: [tool.name] })
  const invoke = (host: AppMcpHost, descriptor: any) => host.invokeBridgeTool({ targetAppId: target.appId,
    targetInstanceId: target.instanceId, serviceId: descriptor.serviceId, revision: descriptor.revision,
    toolName: tool.name, arguments: { sql: 'SELECT 1' }, authorizeDispatch: () => {} })
  expect(await invoke(f.host, before)).toMatchObject({ content: [{ text: 'SELECT 1' }] })
  await f.host.handle('servers.set-enabled', { name: 'database', enabled: false }, target)
  await expect(invoke(f.host, before)).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
  await f.host.handle('servers.set-enabled', { name: 'database', enabled: true }, target)
  const restarted = new AppMcpHost({ ...f.options, discoverTool, invokeTool })
  const [after] = await restarted.discoverBridgeTools({ targetAppId: target.appId, toolNames: [tool.name] })
  expect(after).toMatchObject({ serviceId: before.serviceId, serviceName: 'database', name: tool.name })
  expect(after.revision).not.toBe(before.revision)
  await expect(invoke(restarted, before)).rejects.toMatchObject({ code: 'APP_CONFLICT' })
  expect(await invoke(restarted, after)).toMatchObject({ content: [{ text: 'SELECT 1' }] })
})

test('cross-App MCP registry isolates owners that share the same App and instance IDs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-mcp-owners-')); roots.push(root)
  const hostOwner = { scope: 'host', orgId: null, userId: null, key: 'host' }
  const userOwner = { scope: 'user', orgId: 'org', userId: 'user', key: 'user:org:user' }
  const storage = new AsyncLocalStorage<any>()
  const owner = () => storage.getStore() || hostOwner
  const keyed = (id: string) => `${owner().key}/${id}`
  const installations = new Map<string, any>(), instances = new Map<string, any>(), secrets = new Map<string, any>()
  const runtime = {
    dataDir: path.join(root, 'data'),
    currentOwner: owner,
    withOwner: (value: any, operation: () => any) => storage.run(value, operation),
    installations: { get: (id: string) => installations.get(keyed(id)), list: () => [...installations.values()].filter(row => row.owner.key === owner().key) },
    instances: { get: (id: string) => instances.get(keyed(id)), list: (appId: string) => [...instances.values()].filter(row => row.owner.key === owner().key && row.appId === appId) },
    credentials: { get: async (appId: string, instanceId: string) => structuredClone(secrets.get(keyed(`${appId}/${instanceId}`)) || {}),
      set: async (appId: string, instanceId: string, value: any) => { secrets.set(keyed(`${appId}/${instanceId}`), structuredClone(value)) } },
    appDataPath: (base: string, appId: string, ...parts: string[]) => path.join(base, owner().key, appId, ...parts),
    getActivePackage: async () => ({ manifest: { host: { protocols: [MCP_PROTOCOL] }, permissions: ['mcp:manage', 'mcp:connect'] } }),
  }
  const appId = 'moss.database', instanceId = 'moss.database--default'
  const oauthConfig = { type: 'http', url: 'https://example.com/mcp', oauth: { clientId: 'same-client' } }
  const host = new AppMcpHost({ getRuntime: () => runtime,
    discoverTool: async (_name: string, config: any) => [{ name: config.env?.TOOL_NAME || 'oauth_tool', inputSchema: { type: 'object', properties: {} } }] })
  const install = async (value: any, toolName: string) => runtime.withOwner(value, async () => {
    installations.set(keyed(appId), { appId, owner: value, enabled: true, activeVersion: '0.2.2', grants: ['mcp:manage', 'mcp:connect'] })
    instances.set(keyed(instanceId), { id: instanceId, appId, owner: value, enabled: true })
    const context = { appId, instanceId, owner: value, version: '0.2.2', dataDir: runtime.appDataPath(runtime.dataDir, appId, 'instances', instanceId) }
    await host.handle('servers.save', { name: 'database', enabled: true, config: { command: 'node', env: { TOOL_NAME: toolName } } }, context)
    await host.handle('servers.save', { name: 'oauth', enabled: true, config: oauthConfig }, context)
    await host.refresh()
  })
  await install(hostOwner, 'host_query')
  await install(userOwner, 'user_query')
  const [hostTools, userTools] = await Promise.all([
    runtime.withOwner(hostOwner, () => host.discoverBridgeTools({ targetAppId: appId, toolNames: ['host_query'] })),
    runtime.withOwner(userOwner, () => host.discoverBridgeTools({ targetAppId: appId, toolNames: ['user_query'] })),
  ])
  expect(hostTools.map((tool: any) => tool.name)).toEqual(['host_query'])
  expect(userTools.map((tool: any) => tool.name)).toEqual(['user_query'])
  expect(hostTools[0].serviceId).not.toBe(userTools[0].serviceId)
  const [hostOauth, userOauth] = await Promise.all([
    runtime.withOwner(hostOwner, () => host.toolCatalog(appId).find((item: any) => item.name === 'oauth')),
    runtime.withOwner(userOwner, () => host.toolCatalog(appId).find((item: any) => item.name === 'oauth')),
  ])
  expect(hostOauth.runtimeName).toBe('moss_database__oauth')
  expect(userOauth.runtimeName).not.toBe(hostOauth.runtimeName)
  expect(userOauth.runtimeName).not.toContain(userOwner.key)
  expect(userOauth.runtimeName.startsWith('@')).toBe(true)
  // A Host-owned moss.mcp service cannot impersonate this raw OAuth key.
  expect(() => validateMcpHostInput('servers.save', { name: userOauth.runtimeName,
    enabled: true, config: oauthConfig })).toThrow()
  const dbNames = ['db_0123456789abcdef', 'db_0123456789abcdeg']
  await runtime.withOwner(userOwner, async () => {
    const context = { appId, instanceId, owner: userOwner, version: '0.2.2',
      dataDir: runtime.appDataPath(runtime.dataDir, appId, 'instances', instanceId) }
    for (const name of dbNames) await host.handle('servers.save', { name, enabled: true, config: { command: 'node' } }, context)
  })
  const dbServices = await runtime.withOwner(userOwner, () => host.toolCatalog(appId).filter((item: any) => dbNames.includes(item.name)))
  expect(dbServices.map((item: any) => item.name)).toEqual(dbNames)
  expect(new Set(dbServices.map((item: any) => item.runtimeName)).size).toBe(2)
  for (const service of dbServices) {
    expect(service.runtimeName).not.toContain(userOwner.key)
    expect(service.runtimeName.startsWith('@')).toBe(true)
    expect(buildMcpToolName(service.runtimeName, 'execute_sql', appId).length).toBeLessThanOrEqual(64)
  }
  expect(await runtime.withOwner(hostOwner, () => host.enabledServers([appId])[hostOauth.runtimeName])).toEqual(oauthConfig)
  expect(await runtime.withOwner(userOwner, () => host.enabledServers([appId])[userOauth.runtimeName])).toEqual(oauthConfig)
  expect(await runtime.withOwner(userOwner, () => host.findServer(hostOauth.runtimeName))).toBeNull()
  await expect(runtime.withOwner(userOwner, () => host.discoverBridgeTools({ targetAppId: appId, serviceId: hostTools[0].serviceId })))
    .rejects.toMatchObject({ code: 'APP_NOT_FOUND' })
  expect(await runtime.withOwner(hostOwner, () => host.discoverBridgeTools({ targetAppId: appId, toolNames: ['host_query'] }))).toEqual(hostTools)
})

test('MCP bridge keeps working services discoverable when another connection fails', async () => {
  const f = await fixture(), target = f.addApp('moss.database')
  for (const name of ['good', 'bad']) {
    await f.host.handle('servers.save', { name, enabled: true, config: { command: 'node', args: [name] } }, target)
  }
  f.host.discoverTool = async (name: string) => {
    if (name.endsWith('__bad')) throw new Error('DBHub connection failed')
    return [{ name: 'search_objects', inputSchema: { type: 'object', properties: {} } }]
  }
  const services = f.host.toolCatalog(target.appId)
  const tools = await f.host.discoverBridgeTools({ targetAppId: target.appId, toolNames: ['search_objects'] })
  expect(tools).toMatchObject([{ serviceId: services.find((service: any) => service.name === 'good').serviceId, name: 'search_objects' }])
  await expect(f.host.discoverBridgeTools({ targetAppId: target.appId,
    serviceId: services.find((service: any) => service.name === 'bad').serviceId, toolNames: ['search_objects'] }))
    .rejects.toMatchObject({ code: 'APP_HOST_UNAVAILABLE' })
  await f.host.handle('servers.set-enabled', { name: 'good', enabled: false }, target)
  await expect(f.host.discoverBridgeTools({ targetAppId: target.appId, toolNames: ['search_objects'] }))
    .rejects.toMatchObject({ code: 'APP_HOST_UNAVAILABLE' })
})

test('cross-App MCP bridge never exposes transport, credentials, or cancellation errors', async () => {
  const f = await fixture(), target = f.addApp('moss.database')
  const tool = { name: 'execute_sql', inputSchema: { type: 'object', properties: {} } }
  const secrets = ['url-user', 'url-pass', 'query-secret', 'header-secret', 'argv-secret', 'env-secret', 'provider-secret']
  await f.host.handle('servers.save', { name: 'remote', enabled: true, config: { type: 'http',
    url: 'https://url-user:url-pass@example.test/mcp?token=query-secret',
    headers: { Authorization: 'Bearer header-secret' } } }, target)
  await f.host.handle('servers.save', { name: 'local', enabled: true, config: { command: 'node',
    args: ['--token=argv-secret'], env: { DB_PASSWORD: 'env-secret' } } }, target)
  const services = f.host.toolCatalog(target.appId)
  const failure = new AppServiceError(APP_ERROR_CODES.hostUnavailable, `provider-secret ${secrets.join(' ')}`)
  const expectSafe = async (operation: Promise<unknown>, code = APP_ERROR_CODES.hostUnavailable) => {
    let error: any
    try { await operation } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(AppServiceError)
    expect(error.code).toBe(code)
    expect(error.message).toBe(code === APP_ERROR_CODES.actionCanceled ? 'MCP 工具操作已取消。' : '目标 MCP 服务暂不可用。')
    for (const secret of secrets) expect(error.message).not.toContain(secret)
  }
  f.host.discoverTool = async (name: string) => { throw name.endsWith('__remote')
    ? failure : new Error(`provider-secret ${secrets.join(' ')}`) }
  for (const service of services) await expectSafe(f.host.discoverBridgeTools({ targetAppId: target.appId,
    serviceId: service.serviceId, toolNames: [tool.name] }))
  f.host.discoverTool = async () => [tool]
  const descriptors = await f.host.discoverBridgeTools({ targetAppId: target.appId, toolNames: [tool.name] })
  expect(descriptors.map((item: any) => item.serviceName).sort()).toEqual(['local', 'remote'])
  for (const descriptor of descriptors) {
    f.host.invokeTool = async () => descriptor.serviceName === 'remote' ? Promise.reject(failure)
      : Promise.reject(new Error(`provider-secret ${secrets.join(' ')}`))
    await expectSafe(f.host.invokeBridgeTool({ targetAppId: target.appId, targetInstanceId: target.instanceId,
      serviceId: descriptor.serviceId, revision: descriptor.revision, toolName: tool.name, arguments: {},
      authorizeDispatch: () => {} }))
  }
  f.runtime.credentials.get = async () => { throw new Error(`private path and ${secrets.join(' ')}`) }
  await expectSafe(f.host.discoverBridgeTools({ targetAppId: target.appId, toolNames: [tool.name] }))
  await expectSafe(f.host.invokeBridgeTool({ targetAppId: target.appId, targetInstanceId: target.instanceId,
    serviceId: descriptors[0].serviceId, revision: descriptors[0].revision, toolName: tool.name,
    arguments: {}, authorizeDispatch: () => {} }))
  const canceled = new AbortController()
  canceled.abort(new Error(`provider-secret ${secrets.join(' ')}`))
  await expectSafe(f.host.discoverBridgeTools({ targetAppId: target.appId, signal: canceled.signal }), APP_ERROR_CODES.actionCanceled)
  await expectSafe(f.host.invokeBridgeTool({ targetAppId: target.appId, targetInstanceId: target.instanceId,
    serviceId: descriptors[0].serviceId, revision: descriptors[0].revision, toolName: tool.name,
    arguments: {}, authorizeDispatch: () => {}, signal: canceled.signal }), APP_ERROR_CODES.actionCanceled)
})
