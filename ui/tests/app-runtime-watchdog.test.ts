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

async function backend(initialize: string, options = {}, onMessage = '') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-watchdog-'))
  const supervisor = new AppProcessSupervisor({
    nodeExecutable, handshakeTimeoutMs: 1500, healthCheckIntervalMs: 20,
    healthCheckTimeoutMs: 80, shutdownTimeoutMs: 50, killTimeoutMs: 30, ...options,
  })
  resources.push({ root, supervisor })
  await fs.writeFile(path.join(root, 'backend.mjs'), `
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const send = (type, payload = {}, id = crypto.randomUUID()) => process.send({ version: 1, type, id, timestamp: Date.now(), payload: { ...payload, ...identity } })
process.on('SIGTERM', () => {})
process.on('message', message => {
  if (message.type === 'service.init') { ${initialize} }
  ${onMessage}
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
  test('an on-demand Backend stays alive while work is registered and stops after release', async () => {
    const supervisor = await backend("send('service.ready', {}, message.id)", { idleTimeoutMs: 35 })
    await supervisor.start('test')
    expect(supervisor.setActivity('test', 1, 'task-1', 'begin')).toEqual({ active: true })
    await delay(90)
    expect(supervisor.status('test')).toMatchObject({ state: 'running', activeWork: 1 })
    expect(supervisor.setActivity('test', 1, 'task-1', 'end')).toEqual({ active: false })
    await delay(100)
    expect(supervisor.status('test')).toMatchObject({ state: 'stopped', activeWork: 0 })
  })

  test('an activity ended by a Host request permits idle shutdown after its response', async () => {
    let supervisor: AppProcessSupervisor
    supervisor = await backend(`
      send('service.ready', {}, message.id)
      send('host.request', { protocol: 'moss.runtime/v1', method: 'activity.begin', input: { id: 'task-1' } })
    `, { idleTimeoutMs: 35,
      onHostRequest: ({ method, input }: { method: string; input: { id: string } }) =>
        supervisor.setActivity('test', 1, input.id, method.split('.')[1]),
    }, `if (message.type === 'host.response' && message.payload?.result?.active) {
      send('host.request', { protocol: 'moss.runtime/v1', method: 'activity.end', input: { id: 'task-1' } })
    }`)
    await supervisor.start('test')
    for (let i = 0; i < 50 && supervisor.status('test').state !== 'stopped'; i++) await delay(20)
    expect(supervisor.status('test')).toMatchObject({ state: 'stopped', activeWork: 0 })
  })

  test('delayed begin and renew requests cannot revive an ended activity', async () => {
    let supervisor: AppProcessSupervisor
    let releasePending = () => {}
    const pending = new Promise<void>(resolve => { releasePending = () => resolve() })
    const responses: Array<{ method: string; active: boolean }> = []
    supervisor = await backend(`
      send('service.ready', {}, message.id)
      for (const operation of ['begin', 'renew', 'end']) {
        send('host.request', { protocol: 'moss.runtime/v1', method: 'activity.' + operation, input: { id: 'task-1' } })
      }
    `, { idleTimeoutMs: 35,
      onHostRequest: async ({ method, input }: { method: string; input: { id: string } }) => {
        if (method !== 'activity.end') await pending
        const result = supervisor.setActivity('test', 1, input.id, method.split('.')[1])
        responses.push({ method, active: result.active })
        return result
      },
    })
    try {
      await supervisor.start('test')
      for (let i = 0; i < 50 && !responses.some(response => response.method === 'activity.end'); i++) await delay(10)
      expect(responses).toContainEqual({ method: 'activity.end', active: false })
      expect(supervisor.status('test').activeWork).toBe(0)
    } finally { releasePending() }
    for (let i = 0; i < 50 && responses.length < 3; i++) await delay(10)
    expect(responses).toEqual(expect.arrayContaining([
      { method: 'activity.begin', active: false },
      { method: 'activity.renew', active: false },
    ]))
    for (let i = 0; i < 50 && supervisor.status('test').state !== 'stopped'; i++) await delay(10)
    expect(supervisor.status('test')).toMatchObject({ state: 'stopped', activeWork: 0 })
  })

  test('an on-demand Backend can register startup work before signaling ready', async () => {
    let supervisor: AppProcessSupervisor
    supervisor = await backend(`
      send('host.request', { protocol: 'moss.runtime/v1', method: 'activity.begin', input: { id: 'startup-task' } }, 'startup-activity')
    `, { idleTimeoutMs: 35,
      onHostRequest: ({ method, input }: { method: string; input: { id: string } }) =>
        supervisor.setActivity('test', 1, input.id, method.split('.')[1]),
    }, `if (message.type === 'host.response' && message.payload?.requestId === 'startup-activity') {
      if (!message.payload.ok) throw new Error(message.payload.error?.message || 'Activity registration failed')
      send('service.ready', {}, 'ready')
    }`)
    await supervisor.start('test')
    await delay(90)
    expect(supervisor.status('test')).toMatchObject({ state: 'running', activeWork: 1 })
    supervisor.setActivity('test', 1, 'startup-task', 'end')
    await delay(100)
    expect(supervisor.status('test')).toMatchObject({ state: 'stopped', activeWork: 0 })
  })

  test('a Backend being terminated rejects new Actions and activity before it exits', async () => {
    const supervisor = await backend("send('service.ready', {}, message.id)", {
      idleTimeoutMs: 1_000, killTimeoutMs: 300,
    })
    await supervisor.start('test')
    const terminating = supervisor.terminate(supervisor.processes.get('test'))
    expect(supervisor.status('test').state).toBe('running')
    await expect(supervisor.invoke('test', 'noop', {})).rejects.toMatchObject({ code: 'APP_BACKEND_UNAVAILABLE' })
    expect(() => supervisor.setActivity('test', 1, 'late-task', 'begin')).toThrow()
    await terminating
  })

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
      handshakeTimeoutMs: 300,
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
      handshakeTimeoutMs: 300,
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
