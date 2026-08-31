import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  AppLogStore,
  AppRuntimeHost,
  defaultInstanceId,
  writePackageChecksums,
} from '../../packages/app-runtime/src/index.mjs'

const roots: string[] = []
const nodeExecutable = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
const fixtureRoot = [path.resolve('ui/tests/fixtures/apps'), path.resolve('tests/fixtures/apps')]
  .find((candidate) => fsSync.existsSync(candidate))!
async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-hardening-'))
  roots.push(root)
  return root
}
async function packageFixture(root: string, fixture: string, folder = fixture) {
  const source = path.join(root, folder)
  await fs.cp(path.join(fixtureRoot, fixture), source, { recursive: true })
  await writePackageChecksums(source)
  return source
}
afterEach(async () => Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))))

describe('App Runtime hardening', () => {
  it('enters crash-loop after bounded persistent restart failures', async () => {
    const root = await temporaryRoot()
    const source = await packageFixture(root, 'crashing-backend')
    const runtime = await new AppRuntimeHost({
      rootDir: root, nodeExecutable, target: 'desktop', hostId: 'desktop-test',
      processOptions: { handshakeTimeoutMs: 500, restartBaseDelayMs: 10, maxRestartDelayMs: 20, crashLoopThreshold: 3 },
    }).initialize()
    await runtime.installFromDirectory(source)
    const appId = 'fixture.crashing-backend'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true).catch(() => {})
    const key = runtime.deployments.list(appId)[0].key
    const deadline = Date.now() + 1500
    while (runtime.supervisor.status(key).state !== 'crash-loop' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(runtime.supervisor.status(key).state).toBe('crash-loop')
    await runtime.shutdown()
  })

  it('times out and cancels a slow on-demand action without leaking the process', async () => {
    const root = await temporaryRoot()
    const source = await packageFixture(root, 'slow-backend')
    const runtime = await new AppRuntimeHost({
      rootDir: root, nodeExecutable, target: 'desktop', hostId: 'desktop-test',
      processOptions: { idleTimeoutMs: 40, handshakeTimeoutMs: 1000, maxActionTimeoutMs: 120 },
      actionOptions: { maxQueuedPerDeployment: 2 },
    }).initialize()
    await runtime.installFromDirectory(source)
    const appId = 'fixture.slow-backend'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)
    const first = runtime.invoke(appId, instanceId, 'wait', {}, { requestId: 'limited-1', timeoutMs: 100 }).catch(error => error)
    const second = runtime.invoke(appId, instanceId, 'wait', {}, { requestId: 'limited-2', timeoutMs: Infinity }).catch(error => error)
    const queueDeadline = Date.now() + 500
    while (runtime.actions.pendingTotal < 2 && Date.now() < queueDeadline) await new Promise(resolve => setTimeout(resolve, 5))
    await expect(runtime.invoke(appId, instanceId, 'wait', {}, { requestId: 'limited-3' })).rejects.toThrow(/queue limit/)
    expect(await first).toMatchObject({ code: 'APP_ACTION_TIMEOUT' })
    expect(await second).toMatchObject({ code: 'APP_ACTION_TIMEOUT' })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(runtime.supervisor.listStatuses().filter(item => item.state === 'running')).toHaveLength(0)
    await runtime.shutdown()
  })

  it('redacts configured secrets and credential-shaped log fields', async () => {
    const root = await temporaryRoot()
    const logs = new AppLogStore({ logsDir: root, secretProvider: async () => ['literal-secret'] })
    await logs.append({ appId: 'example.app', instanceId: 'one', level: 'error', message: 'token=abc literal-secret', details: { password: 'visible' } })
    const [entry] = await logs.list('example.app', 'one')
    expect(JSON.stringify(entry)).not.toContain('literal-secret')
    expect(JSON.stringify(entry)).not.toContain('visible')
    expect(JSON.stringify(entry)).toContain('[REDACTED]')
  })

  it('redacts instance secrets from Backend action errors', async () => {
    const root = await temporaryRoot()
    const source = await packageFixture(root, 'persistent-multiple')
    await fs.writeFile(path.join(source, 'dist/backend/main.mjs'), `
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const send = (type, payload, id = crypto.randomUUID()) => process.send?.({ version: 1, id, type, timestamp: Date.now(), payload: { ...payload, ...identity } })
let token = ''
process.on('message', (message) => {
  if (message.type === 'service.init') { token = message.payload.secrets.token; send('service.ready', {}, message.id) }
  if (message.type === 'service.ping') send('service.pong', {}, message.id)
  if (message.type === 'service.shutdown') process.exit(0)
  if (message.type === 'action.invoke') send('action.error', { requestId: message.id, error: { code: 'APP_BACKEND_UNAVAILABLE', message: \`failed with \${token}\`, details: { token } } }, message.id)
})
send('service.hello', { appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION, apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID })
`)
    await writePackageChecksums(source)
    const runtime = await new AppRuntimeHost({ rootDir: root, nodeExecutable, target: 'desktop', hostId: 'desktop-test' }).initialize()
    await runtime.installFromDirectory(source)
    const appId = 'fixture.persistent-multiple'
    await runtime.setAppEnabled(appId, true)
    const instance = await runtime.createInstance(appId, { displayName: 'Secret', secrets: { token: 'literal-secret' }, enabled: true })
    let failure: any = null
    try { await runtime.invoke(appId, instance.id, 'echo', {}) } catch (error) { failure = error }
    expect(JSON.stringify({ message: failure?.message, details: failure?.details })).not.toContain('literal-secret')
    expect(JSON.stringify({ message: failure?.message, details: failure?.details })).toContain('[REDACTED]')
    await runtime.shutdown()
  })

  it('rotates bounded logs while retaining readable history', async () => {
    const root = await temporaryRoot()
    const logs = new AppLogStore({ logsDir: root, maxFileBytes: 100, maxFiles: 2 })
    for (let index = 0; index < 6; index += 1) {
      await logs.append({ appId: 'example.app', instanceId: 'one', level: 'info', message: `record-${index}-${'x'.repeat(80)}` })
    }
    const entries = await logs.list('example.app', 'one', { limit: 20 })
    expect(entries.at(-1)?.message).toContain('record-5')
    expect(entries.length).toBeGreaterThan(1)
    expect((await fs.readdir(path.join(root, 'example.app'))).length).toBeLessThanOrEqual(3)
  })

  it('rejects oversized and circular action inputs with a stable error code', async () => {
    const root = await temporaryRoot()
    const source = await packageFixture(root, 'on-demand-single')
    const runtime = await new AppRuntimeHost({ rootDir: root, nodeExecutable, target: 'desktop', hostId: 'desktop-test' }).initialize()
    await runtime.installFromDirectory(source)
    const appId = 'fixture.on-demand-single'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)
    await expect(runtime.invoke(appId, instanceId, 'echo', { value: 'x'.repeat(1024 * 1024) })).rejects.toMatchObject({ code: 'APP_INVALID_ACTION_INPUT' })
    expect(runtime.supervisor.listStatuses().filter(item => item.state === 'running')).toHaveLength(0)
    const circular: any = {}
    circular.self = circular
    await expect(runtime.invoke(appId, instanceId, 'echo', circular)).rejects.toMatchObject({ code: 'APP_INVALID_ACTION_INPUT' })
    expect(runtime.supervisor.listStatuses().filter(item => item.state === 'running')).toHaveLength(0)
    await runtime.shutdown()
  })

  it('ignores stale and duplicate replies and serializes actions per instance', async () => {
    const root = await temporaryRoot()
    const source = await packageFixture(root, 'on-demand-single')
    await fs.writeFile(path.join(source, 'dist/backend/main.mjs'), `
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const send = (type, payload, id) => process.send?.({ version: 1, id, type, timestamp: Date.now(), payload })
let active = 0
let sequence = 0
process.on('message', (message) => {
  if (message.type === 'service.init') send('service.ready', identity, message.id)
  if (message.type === 'service.ping') send('service.pong', identity, message.id)
  if (message.type === 'service.shutdown') process.exit(0)
  if (message.type === 'action.invoke') {
    active += 1
    send('action.result', { ...identity, generation: identity.generation - 1, requestId: message.id, result: { stale: true } }, message.id)
    setTimeout(() => {
      sequence += 1
      send('action.result', { ...identity, requestId: message.id, result: { active, sequence, value: message.payload.input.value } }, message.id)
      send('action.result', { ...identity, requestId: message.id, result: { duplicate: true } }, message.id)
      active -= 1
    }, 20)
  }
})
send('service.hello', { ...identity, appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION, apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID }, 'hello')
`)
    await writePackageChecksums(source)
    const runtime = await new AppRuntimeHost({ rootDir: root, nodeExecutable, target: 'desktop', hostId: 'desktop-test' }).initialize()
    await runtime.installFromDirectory(source)
    const appId = 'fixture.on-demand-single'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)
    const results = await Promise.all([
      runtime.invoke(appId, instanceId, 'echo', { value: 1 }),
      runtime.invoke(appId, instanceId, 'echo', { value: 2 }),
    ])
    expect(results).toEqual([{ active: 1, sequence: 1, value: 1 }, { active: 1, sequence: 2, value: 2 }])
    expect(runtime.actions.queues.size).toBe(0)
    await runtime.shutdown()
  })

  it('rolls back instance configuration when the updated Backend cannot initialize', async () => {
    const root = await temporaryRoot()
    const source = await packageFixture(root, 'persistent-multiple')
    await fs.writeFile(path.join(source, 'dist/backend/main.mjs'), `
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const send = (type, payload = {}, id = crypto.randomUUID()) => process.send?.({ version: 1, id, type, timestamp: Date.now(), payload: { ...payload, ...identity } })
process.on('message', (message) => {
  if (message.type === 'service.init') {
    if (message.payload.config.label === 'bad') process.exit(22)
    else send('service.ready', {}, message.id)
  }
  if (message.type === 'service.ping') send('service.pong', {}, message.id)
  if (message.type === 'service.shutdown') process.exit(0)
  if (message.type === 'action.invoke') send('action.result', { requestId: message.id, result: true }, message.id)
})
send('service.hello', { appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION, apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID })
`)
    await writePackageChecksums(source)
    const runtime = await new AppRuntimeHost({
      rootDir: root, nodeExecutable, target: 'desktop', hostId: 'desktop-test',
      processOptions: { handshakeTimeoutMs: 300, shutdownTimeoutMs: 100 },
    }).initialize()
    await runtime.installFromDirectory(source)
    const appId = 'fixture.persistent-multiple'
    await runtime.setAppEnabled(appId, true)
    const instance = await runtime.createInstance(appId, {
      displayName: 'Healthy', config: { label: 'good' }, secrets: { token: 'kept-secret' }, enabled: true,
    })
    await expect(runtime.updateInstance(appId, instance.id, { displayName: 'Broken', config: { label: 'bad' } })).rejects.toMatchObject({ code: 'APP_HANDSHAKE_FAILED' })
    expect(runtime.instances.get(instance.id)).toMatchObject({ displayName: 'Healthy', config: { label: 'good' }, enabled: true })
    expect(await runtime.credentials.get(appId, instance.id)).toEqual({ token: 'kept-secret' })
    expect((await runtime.getInstanceStatus(appId, instance.id))[0].runtime.state).toBe('running')
    await runtime.shutdown()
  })

  it('kills an unresponsive process after health or shutdown deadlines', async () => {
    const root = await temporaryRoot()
    const source = await packageFixture(root, 'on-demand-single')
    await fs.writeFile(path.join(source, 'dist/backend/main.mjs'), `
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const send = (type, payload, id) => process.send?.({ version: 1, id, type, timestamp: Date.now(), payload: { ...payload, ...identity } })
process.on('SIGTERM', () => {})
process.on('message', (message) => {
  if (message.type === 'service.init') send('service.ready', {}, message.id)
  if (message.type === 'action.invoke') send('action.result', { requestId: message.id, result: true }, message.id)
})
send('service.hello', { appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION, apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID }, 'hello')
`)
    await writePackageChecksums(source)
    const runtime = await new AppRuntimeHost({
      rootDir: root, nodeExecutable, target: 'desktop', hostId: 'desktop-test',
      processOptions: { healthCheckIntervalMs: 20, healthCheckTimeoutMs: 50, shutdownTimeoutMs: 30, killTimeoutMs: 30 },
    }).initialize()
    await runtime.installFromDirectory(source)
    const appId = 'fixture.on-demand-single'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)
    await runtime.invoke(appId, instanceId, 'echo', {})
    const key = runtime.deployments.list(appId)[0].key
    const pid = runtime.supervisor.status(key).pid
    const deadline = Date.now() + 500
    while (runtime.supervisor.status(key).state === 'running' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(runtime.supervisor.status(key).state).toBe('error')
    await runtime.shutdown()
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it('restores the previous healthy version when activation handshake fails', async () => {
    const root = await temporaryRoot()
    const healthy = await packageFixture(root, 'persistent-single', 'healthy')
    const runtime = await new AppRuntimeHost({
      rootDir: root, nodeExecutable, target: 'desktop', hostId: 'desktop-test',
      processOptions: { handshakeTimeoutMs: 300, restartBaseDelayMs: 10, maxRestartDelayMs: 20 },
    }).initialize()
    await runtime.installFromDirectory(healthy)
    const appId = 'fixture.persistent-single'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)

    const broken = path.join(root, 'broken')
    await fs.cp(healthy, broken, { recursive: true })
    const manifestPath = path.join(broken, 'app.moss.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.version = '2.0.0'
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await fs.writeFile(path.join(broken, 'dist/backend/main.mjs'), 'process.exit(23)\n')
    await writePackageChecksums(broken)
    await runtime.installFromDirectory(broken)
    await expect(runtime.activateVersion(appId, '2.0.0')).rejects.toThrow(/rolled back/)
    expect(runtime.installations.get(appId)?.activeVersion).toBe('1.0.0')
    expect((await runtime.getInstanceStatus(appId, instanceId))[0].runtime.state).toBe('running')
    await runtime.shutdown()
  })
})
