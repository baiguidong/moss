import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { fork, spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { AppRuntimeHost, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'
import { readProcessInfo } from '../../packages/app-runtime/src/process/process-info.mjs'
import { AppProcessLeases } from '../../packages/app-runtime/src/process/lease.mjs'

const nodeExecutable = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
const appId = 'fixture.persistent-single'
const runtimeModule = new URL('../../packages/app-runtime/src/index.mjs', import.meta.url).href
const fixtureRoot = fileURLToPath(new URL('./fixtures/apps/persistent-single', import.meta.url))
let root: string
let source: string
let worker: string
const children: ChildProcess[] = []
const backendPids: number[] = []
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function gone(pid: number, timeout = 3_000) {
  const deadline = Date.now() + timeout
  do {
    if (!await readProcessInfo(pid)) return true
    await delay(15)
  } while (Date.now() < deadline)
  return false
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss app recovery-'))
  source = path.join(root, 'source')
  await fs.cp(fixtureRoot, source, { recursive: true })
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'app.moss.json'), 'utf8'))
  manifest.backend.actions.push({ name: 'block' })
  await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify(manifest))
  const entry = path.join(source, 'dist/backend/main.mjs')
  await fs.writeFile(entry, `
import fs from 'node:fs'
import path from 'node:path'
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const send = (type, payload = {}, id = crypto.randomUUID(), callback) => process.send({ version: 1, type, id, timestamp: Date.now(), payload: { ...payload, ...identity } }, callback)
let dataDir
process.on('SIGTERM', () => {})
process.once('disconnect', () => setTimeout(() => {
  if (dataDir) fs.writeFileSync(path.join(dataDir, 'disconnect-cleanup.txt'), 'cleanup complete')
  process.exit(0)
}, 30))
process.on('message', message => {
  if (message.type === 'service.init') {
    dataDir = message.payload.dataDir
    const file = path.join(message.payload.dataDir, 'preserved.txt')
    if (!fs.existsSync(file)) fs.writeFileSync(file, 'saved data')
    send('service.ready', {}, message.id)
  }
  if (message.type === 'service.ping') send('service.pong', {}, message.id)
  if (message.type === 'service.shutdown') process.exit(0)
  if (message.type === 'action.invoke') {
    const block = message.payload.name === 'block'
    send('action.result', { requestId: message.id, result: { input: message.payload.input, instanceId: process.env.MOSS_APP_INSTANCE_ID } }, message.id,
      block ? () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0) : undefined)
  }
})
send('service.hello', { appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION, apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID })
`)
  await writePackageChecksums(source)
  worker = path.join(root, 'host.mjs')
  await fs.writeFile(worker, `
import { AppRuntimeHost } from ${JSON.stringify(runtimeModule)}
const runtime = new AppRuntimeHost({ rootDir: process.argv[2], nodeExecutable: process.execPath,
  processOptions: { shutdownTimeoutMs: 100, killTimeoutMs: 100, handshakeTimeoutMs: 2000 } })
const errors = []
runtime.events.on('event', event => { if (event.type === 'restore-error') errors.push(event.error) })
try {
  await runtime.initialize()
  if (!runtime.getInstallation('${appId}')) await runtime.installFromDirectory(process.argv[3])
  const [status] = runtime.supervisor.listStatuses()
  process.send({ type: 'ready', status, errors })
  process.on('message', async message => {
    if (message === 'stop') { await runtime.shutdown(); process.exit(0) }
    if (message === 'block') {
      await runtime.invoke('${appId}', status.instanceId, 'block', {})
      process.send({ type: 'blocked' })
    }
  })
} catch (error) { console.error(error); await runtime.shutdown(); process.exit(1) }
`)
})

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  const pids = backendPids.splice(0)
  for (const pid of pids) {
    try { process.kill(pid, 'SIGKILL') } catch (error: any) { if (error.code !== 'ESRCH') throw error }
  }
  await Promise.all(pids.map(pid => gone(pid)))
  await fs.rm(root, { recursive: true, force: true })
})

async function startHost() {
  const child = fork(worker, [root, source], { execPath: nodeExecutable, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  children.push(child)
  let output = ''
  child.stderr!.on('data', data => { output += data })
  const exited = once(child, 'exit')
  const timer = setTimeout(() => child.kill('SIGKILL'), 6_000)
  try {
    const [message] = await Promise.race([
      once(child, 'message'),
      exited.then(() => { throw new Error(`Host failed to start: ${output}`) }),
    ])
    expect(message.type).toBe('ready')
    if (message.status?.pid) backendPids.push(message.status.pid)
    return { child, exited, status: message.status, errors: message.errors }
  } finally { clearTimeout(timer) }
}

async function killHostWithBlockedBackend() {
  const host = await startHost()
  expect(host.status.state).toBe('running')
  const blocked = once(host.child, 'message')
  host.child.send('block')
  expect((await blocked)[0].type).toBe('blocked')
  host.child.kill('SIGKILL')
  await host.exited
  expect(await readProcessInfo(host.status.pid)).not.toBeNull()
  return host.status.pid as number
}

async function leaseFiles() {
  const directory = path.join(root, 'apps-runtime', 'processes', createHash('sha256').update(appId).digest('hex'))
  const entries = await fs.readdir(directory)
  return { directory, owner: entries.find(name => /^[a-f0-9-]{36}\.json$/.test(name))!, child: entries.find(name => name.endsWith('.child.json'))! }
}

describe('App Backend ownership across Host restarts', () => {
  it('preserves CommonJS main entry behavior and App child process startup', async () => {
    const manifestPath = path.join(source, 'app.moss.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.backend.entry = 'dist/backend/main.cjs'
    await fs.writeFile(manifestPath, JSON.stringify(manifest))
    await fs.writeFile(path.join(source, manifest.backend.entry), `
if (require.main !== module) throw new Error('Backend must be the main module')
const probe = require('node:child_process').fork(require('node:path').join(__dirname, 'probe.cjs'), [], {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
})
probe.once('message', () => import('./main.mjs'))
`)
    await fs.writeFile(path.join(source, 'dist/backend/probe.cjs'), "process.send('ready', () => process.exit(0))")
    await writePackageChecksums(source)
    const host = await startHost()
    expect(host.status.state).toBe('running')
  })

  it('allows App disconnect cleanup to finish when the Host is killed', async () => {
    const host = await startHost()
    host.child.kill('SIGKILL')
    await host.exited
    expect(await gone(host.status.pid)).toBe(true)
    expect(await fs.readFile(path.join(root, 'apps-data', appId, 'instances', `${appId}--default`, 'disconnect-cleanup.txt'), 'utf8')).toBe('cleanup complete')
  })

  it('reaps an unresponsive orphan before restoring the same App and its data', async () => {
    const oldPid = await killHostWithBlockedBackend()
    const next = await startHost()
    expect(next.status.state).toBe('running')
    expect(next.status.pid).not.toBe(oldPid)
    expect(await readProcessInfo(oldPid)).toBeNull()
    expect(await fs.readFile(path.join(root, 'apps-data', appId, 'instances', `${appId}--default`, 'preserved.txt'), 'utf8')).toBe('saved data')
  })

  it('allows only one replacement when multiple Hosts recover the same orphan', async () => {
    const oldPid = await killHostWithBlockedBackend()
    const contenders = await Promise.all([startHost(), startHost(), startHost()])
    expect(contenders.filter(host => host.status?.state === 'running')).toHaveLength(1)
    expect(contenders.filter(host => host.errors.some((error: string) => error.includes('already running')))).toHaveLength(2)
    expect(await readProcessInfo(oldPid)).toBeNull()
  })

  it('cleans up a disabled App orphan without starting the App again', async () => {
    const oldPid = await killHostWithBlockedBackend()
    const statePath = path.join(root, 'app-runtime-state.json')
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
    for (const installation of Object.values(state.installations) as any[]) installation.enabled = false
    await fs.writeFile(statePath, JSON.stringify(state))
    const next = await startHost()
    expect(next.status?.state).not.toBe('running')
    expect(await readProcessInfo(oldPid)).toBeNull()
  })

  it('does not take over an App owned by a live Host', async () => {
    const first = await startHost()
    const second = await startHost()
    expect(first.status.state).toBe('running')
    expect(second.status?.state).not.toBe('running')
    expect(second.errors.join(' ')).toContain('already running in another Host')
    expect(await readProcessInfo(first.status.pid)).not.toBeNull()
  })

  it('finds the orphan by its launch marker when the child PID record is missing', async () => {
    const oldPid = await killHostWithBlockedBackend()
    const lease = await leaseFiles()
    await fs.unlink(path.join(lease.directory, lease.child))
    const next = await startHost()
    expect(next.status.state).toBe('running')
    expect(await readProcessInfo(oldPid)).toBeNull()
  })

  it('does not kill an unrelated process when a saved PID has been reused', async () => {
    const first = await startHost()
    first.child.kill('SIGKILL')
    await first.exited
    expect(await gone(first.status.pid)).toBe(true)
    const unrelated = spawn(nodeExecutable, ['-e', "console.log('ready');setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] })
    children.push(unrelated)
    await once(unrelated.stdout!, 'data')
    const lease = await leaseFiles()
    await fs.writeFile(path.join(lease.directory, lease.child), JSON.stringify({ pid: unrelated.pid, started: 'previous-process-start-time' }))
    const next = await startHost()
    expect(next.status.state).toBe('running')
    expect(await readProcessInfo(unrelated.pid!)).not.toBeNull()
  })

  it('refuses a duplicate if the previous process identity cannot be verified', async () => {
    const oldPid = await killHostWithBlockedBackend()
    const lease = await leaseFiles()
    const unrelated = await readProcessInfo(process.pid)
    await fs.writeFile(path.join(lease.directory, lease.child), JSON.stringify({ pid: process.pid, started: unrelated!.started }))
    const next = await startHost()
    expect(next.status?.state).not.toBe('running')
    expect(next.errors.join(' ')).toContain('Cannot verify the previous App Backend identity')
    expect(await readProcessInfo(oldPid)).not.toBeNull()
  })

  it('refuses to start when ownership metadata is corrupt', async () => {
    const oldPid = await killHostWithBlockedBackend()
    const lease = await leaseFiles()
    await fs.writeFile(path.join(lease.directory, lease.owner), '{broken')
    const next = await startHost()
    expect(next.status?.state).not.toBe('running')
    expect(next.errors.join(' ')).toContain('Cannot read App Backend ownership record')
    expect(await readProcessInfo(oldPid)).not.toBeNull()
  })

  it('releases ownership after a spawn error so the same Host can retry', async () => {
    const runtime = await new AppRuntimeHost({ rootDir: root, nodeExecutable }).initialize()
    try {
      await runtime.installFromDirectory(source, { enabled: false })
      runtime.supervisor.nodeExecutable = path.join(root, 'missing-node')
      await expect(runtime.setAppEnabled(appId, true)).rejects.toThrow()
      runtime.supervisor.nodeExecutable = nodeExecutable
      await runtime.setAppEnabled(appId, true)
      expect(runtime.supervisor.listStatuses()[0].state).toBe('running')
    } finally { await runtime.shutdown() }
  })

  it('waits for old ownership cleanup when the same Host immediately retries after a crash', async () => {
    const runtime = await new AppRuntimeHost({ rootDir: root, nodeExecutable,
      processOptions: { restartBaseDelayMs: 10_000 } }).initialize()
    let allowCleanup = () => {}
    try {
      await runtime.installFromDirectory(source)
      const [status] = runtime.supervisor.listStatuses()
      const hosted = (runtime.supervisor as any).processes.get(status.key)
      const release = hosted.lease.release
      const cleanupGate = new Promise<void>(resolve => { allowCleanup = resolve })
      hosted.lease.release = async () => { await cleanupGate; await release() }
      const exited = once(hosted.child, 'exit')
      hosted.child.kill('SIGKILL')
      await exited
      const retried = runtime.supervisor.start(status.key)
      let settled = false
      void retried.then(() => { settled = true }, () => { settled = true })
      await delay(80)
      expect(settled).toBe(false)
      allowCleanup()
      const next = await retried
      expect(next.state).toBe('running')
      expect(next.pid).not.toBe(status.pid)
    } finally { allowCleanup(); await runtime.shutdown() }
  })

  // Windows SIGTERM forcibly exits the target instead of invoking its handler.
  it.skipIf(process.platform === 'win32')('refuses to release ownership if a live orphan loses its marker during termination', async () => {
    const marker = `--moss-app-process=${randomUUID()}`
    const child = spawn(nodeExecutable, ['-e', `
      process.on('SIGTERM', () => { process.title = 'moss recovery identity changed' })
      setInterval(() => {}, 1000)
      console.log('ready')
    `, '--', marker], { stdio: ['ignore', 'pipe', 'ignore'] })
    children.push(child)
    await once(child.stdout!, 'data')
    const info = await readProcessInfo(child.pid!)
    const leases = new AppProcessLeases({ directory: root, killTimeoutMs: 100 })
    await expect(leases.terminateOrphan(info, marker, appId)).rejects.toThrow('Cannot verify the previous App Backend identity')
    expect(await readProcessInfo(child.pid!)).not.toBeNull()
  })
})
