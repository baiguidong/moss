import { test, expect, afterAll } from 'bun:test'
import { mkdtemp, rm, readFile, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { asSessionId } from '../../types/ids'
import { runWithSessionIdContext } from '../../utils/sessionIdContext'
import { runWithCwdOverride } from '../../utils/cwd'
import { connectToServer, clearServerCache, releaseMcpLifetime, releaseMcpServers, getMcpRuntimeStats, prefetchAllMcpResources, ensureConnectedClient, fetchToolsForClient, refreshMcpToolCatalog, getMcpToolCatalogState } from './client'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ConnectedMCPServer, ScopedMcpServerConfig } from './types'
import { onMcpToolCatalog } from './catalogUpdates'

const previousMacro = (globalThis as any).MACRO
;(globalThis as any).MACRO = { VERSION: '0.0.0-test', BUILD_TIME: '', FEEDBACK_CHANNEL: '', ISSUES_EXPLAINER: '', VERSION_CHANGELOG: '' }
afterAll(() => { if (previousMacro) (globalThis as any).MACRO = previousMacro; else delete (globalThis as any).MACRO })

const fixture = path.join(import.meta.dir, 'fixtures/stateful-server.mjs')
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const waitFor = async (fn: () => boolean | Promise<boolean>) => { for (let i = 0; i < 100; i++) { if (await fn()) return; await Bun.sleep(20) } throw new Error('Timed out') }
const session = (cwd: string, idle = 0) => {
  const controller = new AbortController(), id = crypto.randomUUID(), revokedServers = new Set<string>()
  return { id, controller, revokedServers, run: <T>(fn: () => T) => runWithCwdOverride(cwd, () => runWithSessionIdContext(asSessionId(id), null, fn, undefined, undefined,
    { executionEnvironment: 'desktop', mcpLifetime: { id, signal: controller.signal, revokedServers }, appToolPolicy: { appIds: [], mcpServers: { fixture: { appId: 'test.app', toolScope: 'global', mcpIdleTimeoutMs: idle } } } })),
    dispose: async () => { controller.abort(); await releaseMcpLifetime(id) } }
}
async function call(client: ConnectedMCPServer, name: string, args: Record<string, unknown> = {}) {
  const connected = await ensureConnectedClient(client)
  const result = await connected.client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema)
  return JSON.parse((result.content[0] as { text: string }).text)
}

test('cached startup defers MCP launch, and first actual use refreshes the catalog once per connection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-mcp-live-catalog-'))
  const catalog = path.join(root, 'tools.json'), log = path.join(root, 'lists')
  const config: ScopedMcpServerConfig = { type: 'stdio', command: 'node', args: [fixture], env: { MCP_TEST_CATALOG_FILE: catalog, MCP_TEST_LIST_LOG: log }, scope: 'dynamic' }
  const a = session(root), b = session(root), c = session(root)
  const updates: any[] = []
  const unsubscribe = onMcpToolCatalog(update => { if ('env' in update.config && update.config.env?.MCP_TEST_CATALOG_FILE === catalog) updates.push(update) })
  const count = async () => (await readFile(log, 'utf8')).trim().split('\n').length
  try {
    await writeFile(catalog, '[]')
    await a.run(() => prefetchAllMcpResources({ fixture: config }))
    expect(await count()).toBe(1); expect(updates).toHaveLength(1)
    await writeFile(catalog, JSON.stringify([{ name: 'new_tool', description: 'New live capability', inputSchema: { type: 'object', properties: {} } }]))
    const cached = await b.run(() => prefetchAllMcpResources({ fixture: config }))
    expect(cached.tools).toHaveLength(2); expect(await count()).toBe(1)
    const descriptor = cached.clients[0] as ConnectedMCPServer
    const values = await b.run(() => Promise.all([call(descriptor, 'get_value'), call(descriptor, 'get_value')]))
    expect(values[0].pid).toBe(values[1].pid)
    expect(await count()).toBe(2); expect(updates).toHaveLength(2)
    expect(updates[1].check.tools.map((tool: any) => tool.name)).toContain('new_tool')
    expect(updates[1].check.tools[2]).not.toHaveProperty('inputSchema')
    const latest = await c.run(() => prefetchAllMcpResources({ fixture: config }))
    expect(latest.tools).toHaveLength(3); expect(await count()).toBe(2)
    await b.run(() => clearServerCache('fixture', config))
    await writeFile(catalog, '[]')
    await b.run(() => call(descriptor, 'get_value'))
    expect(await count()).toBe(3); expect(updates[2].check.tools).toHaveLength(2)
  } finally { unsubscribe(); await Promise.all([a.dispose(), b.dispose(), c.dispose()]); await rm(root, { recursive: true, force: true }) }
}, 20_000)

test('real global-scope services isolate state, defer cached startup, and release child processes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-mcp-lifecycle-')), log = path.join(root, 'pids')
  const config: ScopedMcpServerConfig = { type: 'stdio', command: 'node', args: [fixture], env: { MCP_TEST_PID_LOG: log }, scope: 'dynamic' }
  const a = session(root), b = session(root)
  try {
    const first = await a.run(() => prefetchAllMcpResources({ fixture: config }))
    if (!first.tools.length) throw new Error(JSON.stringify(first.clients))
    expect(first.tools.length).toBe(2)
    expect(getMcpRuntimeStats().connections).toBe(0)
    const discoveryPids = (await readFile(log, 'utf8')).trim().split('\n').map(Number)
    await waitFor(() => discoveryPids.every(pid => !alive(pid)))
    const second = await b.run(() => prefetchAllMcpResources({ fixture: config }))
    expect(second.tools.length).toBe(2)
    expect((await readFile(log, 'utf8')).trim().split('\n').length).toBe(discoveryPids.length)
    const descriptorA = first.clients[0] as ConnectedMCPServer, descriptorB = second.clients[0] as ConnectedMCPServer
    const valueA = await a.run(() => call(descriptorA, 'set_value', { value: 'diagram A' }))
    const valueB = await b.run(() => call(descriptorB, 'get_value'))
    expect(valueA.value).toBe('diagram A'); expect(valueB.value).toBe(''); expect(valueA.pid).not.toBe(valueB.pid)
    expect(valueA.cwd).toBe(await realpath(root)); expect(valueB.cwd).toBe(await realpath(root))
    await a.dispose(); await waitFor(() => !alive(valueA.pid))
    expect((await b.run(() => call(descriptorB, 'get_value'))).pid).toBe(valueB.pid)
    await b.dispose(); await waitFor(() => !alive(valueB.pid))
    expect(getMcpRuntimeStats().entries).toBe(0); expect(getMcpRuntimeStats().lifetimes).toBe(0)
  } finally { await Promise.all([a.dispose(), b.dispose()]); await rm(root, { recursive: true, force: true }) }
}, 20_000)

test('cancel during real MCP handshake closes the process and never reconnects during cleanup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-mcp-start-cancel-')), log = path.join(root, 'pids'), a = session(root)
  const config: ScopedMcpServerConfig = { type: 'stdio', command: 'node', args: [fixture], env: { MCP_TEST_PID_LOG: log, MCP_TEST_HANDSHAKE_DELAY: '1000' }, scope: 'dynamic' }
  try {
    const pending = a.run(() => connectToServer('fixture', config)); void pending.catch(() => {})
    await waitFor(async () => { try { return Boolean(await readFile(log, 'utf8')) } catch { return false } })
    const pid = Number((await readFile(log, 'utf8')).trim())
    await a.dispose(); await expect(pending).rejects.toThrow()
    await waitFor(() => !alive(pid))
    await a.run(() => clearServerCache('fixture', config))
    expect((await readFile(log, 'utf8')).trim().split('\n').length).toBe(1)
    expect(getMcpRuntimeStats().entries).toBe(0)
  } finally { await a.dispose(); await rm(root, { recursive: true, force: true }) }
}, 10_000)

test('real idle recycling reconnects stateless services while preserving stateful sessions, and revocation blocks stale tools', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-mcp-idle-')), a = session(root, 100), b = session(root)
  const config: ScopedMcpServerConfig = { command: 'node', args: [fixture], env: { MCP_TEST_TOOL_DELAY: '250' }, scope: 'dynamic' }
  try {
    const ca = await a.run(() => connectToServer('fixture', config)) as ConnectedMCPServer
    const cb = await b.run(() => connectToServer('fixture', config)) as ConnectedMCPServer
    const va = await a.run(() => call(ca, 'set_value', { value: 'restart safe fixture' }))
    const vb = await b.run(() => call(cb, 'set_value', { value: 'keep diagram' }))
    await waitFor(() => !alive(va.pid))
    const next = await a.run(() => call(ca, 'get_value'))
    expect(next.pid).not.toBe(va.pid)
    expect(next.value).toBe('')
    expect(await b.run(() => call(cb, 'get_value'))).toMatchObject({ value: 'keep diagram', pid: vb.pid })
    b.revokedServers.add('fixture'); await releaseMcpServers(b.id, ['fixture'])
    await waitFor(() => !alive(vb.pid))
    await expect(b.run(() => call(cb, 'get_value'))).rejects.toThrow('撤销')
  } finally { await Promise.all([a.dispose(), b.dispose()]); await rm(root, { recursive: true, force: true }) }
  expect(getMcpRuntimeStats().entries).toBe(0)
}, 10_000)

test('real paginated catalogs refresh on the same transport, retain failures, and reject stale tool adapters', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-mcp-pagination-')), a = session(root)
  const catalog = path.join(root, 'tools.json'), failPage = path.join(root, 'fail-page')
  const config: ScopedMcpServerConfig = { type: 'stdio', command: 'node', args: [fixture], env: {
    MCP_TEST_CATALOG_FILE: catalog, MCP_TEST_PAGINATED: 'true', MCP_TEST_FAIL_PAGE_FILE: failPage,
  }, scope: 'dynamic' }
  const custom = (type: string) => ({ name: 'custom', description: 'Custom', inputSchema: { type: 'object', properties: { value: { type } } } })
  let conn!: ConnectedMCPServer
  try {
    await writeFile(catalog, JSON.stringify([custom('string')]))
    await a.run(async () => {
      conn = await connectToServer('fixture', config) as ConnectedMCPServer
      const initial = await conn.client.request({ method: 'tools/call', params: { name: 'set_value', arguments: { value: 'keep my diagram' } } }, CallToolResultSchema)
      const original = JSON.parse((initial.content[0] as { text: string }).text)
      await writeFile(failPage, '')
      await expect(fetchToolsForClient(conn)).rejects.toThrow('second-page failure')
      await rm(failPage)
      const tools = await fetchToolsForClient(conn)
      expect(tools).toHaveLength(3)
      const old = tools.find(tool => tool.mcpInfo?.toolName === 'custom')!
      const value = await call(conn, 'get_value')
      expect(value).toMatchObject({ value: 'keep my diagram', pid: original.pid })
      const revision = getMcpToolCatalogState(conn).revision
      await writeFile(catalog, JSON.stringify([custom('number')]))
      await call(conn, 'notify_catalog')
      await waitFor(() => getMcpToolCatalogState(conn).revision !== revision)
      expect((await call(conn, 'get_value'))).toMatchObject({ value: 'keep my diagram', pid: value.pid })
      await expect(old.call({}, { abortController: new AbortController() } as any, undefined as any,
        { message: { content: [] } } as any)).rejects.toThrow('changed or was removed')
      const fresh = await fetchToolsForClient(conn)
      expect(fresh.find(tool => tool.mcpInfo?.toolName === 'custom')!.inputJSONSchema).toMatchObject({ properties: { value: { type: 'number' } } })
      await writeFile(failPage, '')
      const complete = getMcpToolCatalogState(conn).revision
      await expect(refreshMcpToolCatalog(conn)).rejects.toThrow('second-page failure')
      expect(getMcpToolCatalogState(conn)).toMatchObject({ revision: complete, stale: true })
      expect(await fetchToolsForClient(conn)).toHaveLength(3)
      await rm(failPage)
      await refreshMcpToolCatalog(conn)
      expect(getMcpToolCatalogState(conn).stale).toBe(false)
      expect((await call(conn, 'get_value')).pid).toBe(value.pid)
    })
    await a.dispose()
    await expect(refreshMcpToolCatalog(conn)).rejects.toThrow()
    expect(getMcpRuntimeStats().entries).toBe(0)
  } finally { await a.dispose(); await rm(root, { recursive: true, force: true }) }
}, 20_000)
