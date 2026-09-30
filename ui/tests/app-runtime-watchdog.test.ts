import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AppProcessSupervisor } from '../../packages/app-runtime/src/process/index.mjs'
import { createAppWatchdog } from '../../packages/app-runtime/src/process/watchdog.mjs'

const nodeExecutable = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
const resources: Array<{ root: string; supervisor: AppProcessSupervisor }> = []
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const blockHost = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

afterEach(async () => {
  for (const { root, supervisor } of resources.splice(0)) {
    await supervisor.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function backend(initialize: string, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-watchdog-'))
  const supervisor = new AppProcessSupervisor({
    nodeExecutable, handshakeTimeoutMs: 300, healthCheckIntervalMs: 20,
    healthCheckTimeoutMs: 80, shutdownTimeoutMs: 50, killTimeoutMs: 30, ...options,
  })
  resources.push({ root, supervisor })
  await fs.writeFile(path.join(root, 'backend.mjs'), `
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const send = (type, payload = {}, id = crypto.randomUUID()) => process.send({ version: 1, type, id, timestamp: Date.now(), payload: { ...payload, ...identity } })
process.on('SIGTERM', () => {})
process.on('message', message => {
  if (message.type === 'service.init') { ${initialize} }
  if (message.type === 'service.ping') send('service.pong', {}, message.id)
  if (message.type === 'service.shutdown') process.exit(0)
})
send('service.hello', { appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION, apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID })
`)
  supervisor.register({
    key: 'test', appId: 'fixture.watchdog', instanceId: 'default', version: '1.0.0', generation: 1,
    packageRoot: root, entry: 'backend.mjs', dataDir: path.join(root, 'data'),
    runtimeDir: path.join(root, 'runtime'), lifecycle: 'on-demand',
  })
  return supervisor
}

describe('App watchdog response windows', () => {
  test('requires real responses to keep a continuously observed Backend alive', () => {
    let clock = 1_000_000
    const watchdog = createAppWatchdog({ timeoutMs: 65_000, intervalMs: 30_000, now: () => clock })
    clock += 30_000
    expect(watchdog.expired()).toBe(false)
    watchdog.refresh()
    clock += 30_000
    expect(watchdog.expired()).toBe(false)
    clock += 30_000
    expect(watchdog.expired()).toBe(false)
    clock += 30_000
    expect(watchdog.expired()).toBe(true)
  })

  test.each([300_000, -300_000])('allows a fresh response window after a clock gap of %s ms, then still expires', jump => {
    let clock = 1_000_000
    const watchdog = createAppWatchdog({ timeoutMs: 65_000, intervalMs: 30_000, now: () => clock })
    clock += jump
    expect(watchdog.expired()).toBe(false)
    clock += 30_000
    expect(watchdog.expired()).toBe(false)
    clock += 30_000
    expect(watchdog.expired()).toBe(false)
    clock += 30_000
    expect(watchdog.expired()).toBe(true)
  })
})

describe('App watchdog integration', () => {
  test('does not restart a locally responsive Backend reporting an unavailable remote server', async () => {
    const supervisor = await backend(`
      send('service.ready', {}, message.id)
      send('service.status', { state: 'degraded', details: { connected: false, error: 'ECONNREFUSED' } })
    `)
    const before = await supervisor.start('test')
    await delay(250)
    expect(supervisor.status('test')).toMatchObject({ state: 'running', pid: before.pid, recentCrashCount: 0, lastError: null })
    expect(supervisor.status('test').lastHeartbeatAt).toBeGreaterThan(before.lastHeartbeatAt)
  })

  test('keeps the same healthy process after Host polling is suspended', async () => {
    const supervisor = await backend("send('service.ready', {}, message.id)")
    const before = await supervisor.start('test')
    blockHost(250)
    await delay(120)
    const after = supervisor.status('test')
    expect(after).toMatchObject({ state: 'running', pid: before.pid, recentCrashCount: 0, lastError: null })
    expect(after.lastHeartbeatAt).toBeGreaterThan(before.lastHeartbeatAt)
  })

  test('accepts a handshake queued while the Host was suspended', async () => {
    let suspended = false
    const supervisor = await backend(`
      send('service.status', { state: 'initializing' })
      setTimeout(() => send('service.ready', {}, message.id), 20)
    `, {
      onStatus: (status: any) => {
        if (status.backendStatus !== 'initializing') return
        suspended = true
        blockHost(750)
      },
    })
    expect(await supervisor.start('test')).toMatchObject({ state: 'running', recentCrashCount: 0 })
    expect(suspended).toBe(true)
  })

  test('retains the handshake timeout cause after escalation to SIGKILL', async () => {
    const logs: any[] = []
    const supervisor = await backend("send('service.status', { state: 'initializing' })", {
      onLog: (entry: any) => logs.push(entry),
    })
    await expect(supervisor.start('test')).rejects.toThrow('handshake timed out')
    const status = supervisor.status('test')
    expect(status).toMatchObject({ state: 'error', pid: null, recentCrashCount: 1 })
    expect(status.lastError).toContain('handshake timed out after 300ms')
    expect(status.lastError).toContain('(SIGKILL)')
    expect(logs).toContainEqual(expect.objectContaining({ level: 'error', message: status.lastError }))
  })
})
