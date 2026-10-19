import { expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createAppRuntime } from '../src/apps/app-runtime.mjs'
import { AppMcpHost, createMcpProtocolDefinition, MCP_METHODS, MCP_PROTOCOL } from '../src/apps/app-mcp-host.mjs'
import { AppRuntimeHost, defaultInstanceId, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'

test('desktop restoration runs independent Apps with a bounded worker pool', async () => {
  const ids = Array.from({ length: 9 }, (_, index) => `app-${index}`)
  let active = 0, maximum = 0
  const completed: string[] = []
  const errors: string[] = []
  const host = {
    installations: { list: () => ids.map(appId => ({ appId })) },
    reconcileApp: async (appId: string) => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 10))
      active -= 1
      if (appId === 'app-4') throw new Error('damaged package')
      completed.push(appId)
    },
    publishRuntimeEvent: (event: { appId: string }) => { errors.push(event.appId) },
  } as unknown as AppRuntimeHost
  await AppRuntimeHost.prototype.restore.call(host, { concurrency: 3 })
  expect(maximum).toBe(3)
  expect(completed).toHaveLength(8)
  expect(errors).toEqual(['app-4'])
})

test('desktop restoration stops scheduling new Apps after cancellation', async () => {
  const controller = new AbortController()
  const started: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const host = {
    installations: { list: () => Array.from({ length: 8 }, (_, index) => ({ appId: `app-${index}` })) },
    reconcileApp: async (appId: string) => { started.push(appId); await gate },
    publishRuntimeEvent: () => {},
  } as unknown as AppRuntimeHost
  const restoring = AppRuntimeHost.prototype.restore.call(host, { signal: controller.signal, concurrency: 3 })
  expect(started).toHaveLength(3)
  controller.abort()
  release()
  await restoring
  expect(started).toHaveLength(3)
})

test('restored Backends can register and inspect MCP before desktop initialization finishes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-startup-'))
  const appId = 'fixture.startup-memory'
  const nodeExecutable = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
  let runtime: Awaited<ReturnType<typeof createAppRuntime>> | null = null
  let initializing = false
  const requests: { method: string; initializing: boolean }[] = []
  const host = new AppMcpHost({
    getRuntime: () => runtime,
    inspect: async () => ({ state: 'connected', tools: [], checkedAt: Date.now() }),
  })
  const start = async (deferRestore = false) => {
    initializing = true
    try {
      runtime = await createAppRuntime({
        mossHome: root, appsDir: path.join(root, 'apps'), nodeExecutable, deferRestore,
        onCreated: (created: NonNullable<typeof runtime>) => { runtime = created },
        hostProtocols: [createMcpProtocolDefinition()],
        hostHandlers: { [MCP_PROTOCOL]: Object.fromEntries(MCP_METHODS.map(method => [method, (input: unknown, context: unknown) => {
          requests.push({ method, initializing })
          return host.handle(method, input, context)
        }])) },
      })
      return runtime
    } finally { initializing = false }
  }
  try {
    const source = path.join(root, 'source')
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify({
      schemaVersion: 2, id: appId, version: '1.0.0', displayName: 'Startup Memory', hostApi: '^3.0.0',
      backend: { entry: 'main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'persistent', actions: [{ name: 'status' }] },
      host: { protocols: [MCP_PROTOCOL] }, permissions: ['mcp:read', 'mcp:manage', 'mcp:connect'],
    }))
    const sdk = new URL('../../packages/app-sdk/src/index.mjs', import.meta.url).href
    await fs.writeFile(path.join(source, 'main.mjs'), `
import { AppBackendClient } from ${JSON.stringify(sdk)}
let result
const backend = new AppBackendClient({ onInitialize: async () => {
  try {
    const request = (method, input = {}) => backend.host.request('moss.mcp/v1', method, input)
    const catalog = await request('servers.list')
    if (!catalog.servers.length) await request('servers.save', { name: 'memory', enabled: true, config: { type: 'stdio', command: process.execPath, args: [] } })
    result = { ok: true, catalog: await request('servers.inspect', { name: 'memory' }) }
  } catch (error) { result = { ok: false, error: error.message } }
} })
backend.registerAction('status', () => result)
backend.start()
`)
    await writePackageChecksums(source)
    const first = await start()
    await first.installFromDirectory(source)
    await first.shutdown()
    runtime = null
    requests.length = 0

    const restored = await start()
    expect(restored.installations.get(appId)?.enabled).toBe(true)
    expect(requests).toEqual([
      { method: 'servers.list', initializing: true },
      { method: 'servers.inspect', initializing: true },
    ])
    expect(await restored.invoke(appId, defaultInstanceId(appId), 'status', {})).toMatchObject({
      ok: true, catalog: { servers: [{ enabled: true, check: { state: 'connected' } }] },
    })
    expect(host.enabledServers()).toHaveProperty('fixture_startup_memory__memory')

    await restored.shutdown()
    runtime = null
    requests.length = 0
    const deferred = await start(true)
    expect(deferred.installations.get(appId)?.enabled).toBe(true)
    expect(requests).toEqual([])
    const cancelled = new AbortController()
    cancelled.abort()
    await deferred.restoreAllOwners({ signal: cancelled.signal })
    expect(requests).toEqual([])
    await deferred.restoreAllOwners()
    expect(requests.map(request => request.method)).toEqual(['servers.list', 'servers.inspect'])
  } finally {
    await runtime?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
}, 15_000)
