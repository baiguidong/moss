import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { AppRuntimeHost, defaultInstanceId, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'

const roots: string[] = []
const nodeExecutable = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
const fixtureRoot = [path.resolve('ui/tests/fixtures/apps'), path.resolve('tests/fixtures/apps')]
  .find((candidate) => fsSync.existsSync(candidate))!

async function createRuntime(fixture: string, processOptions = {}, mutate?: (source: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-host-'))
  roots.push(root)
  const source = path.join(root, 'source')
  await fs.cp(path.join(fixtureRoot, fixture), source, { recursive: true })
  await mutate?.(source)
  await writePackageChecksums(source)
  const runtime = await new AppRuntimeHost({
    rootDir: root,
    nodeExecutable,
    target: 'desktop',
    hostId: 'desktop-test',
    processOptions: { handshakeTimeoutMs: 2000, shutdownTimeoutMs: 200, killTimeoutMs: 100, ...processOptions },
  }).initialize()
  await runtime.installFromDirectory(source)
  return runtime
}

async function installVersion(runtime: AppRuntimeHost, version: string, mutate: (manifest: any, source: string) => Promise<void> | void) {
  const source = path.join(runtime.rootDir, `source-${version}`)
  await fs.cp(path.join(runtime.rootDir, 'source'), source, { recursive: true })
  const manifestPath = path.join(source, 'app.moss.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  manifest.version = version
  await mutate(manifest, source)
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await writePackageChecksums(source)
  await runtime.installFromDirectory(source)
  return source
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('App Runtime lifecycle', () => {
  it('does not create a process or Backend instance for UI-only Apps', async () => {
    const runtime = await createRuntime('ui-only')
    const app = await runtime.getApp('fixture.ui-only')
    expect(app?.instances).toHaveLength(0)
    expect(runtime.supervisor.listStatuses()).toHaveLength(0)
    await runtime.shutdown()
  })

  it('shares one on-demand process and stops it after the idle timeout', async () => {
    const runtime = await createRuntime('on-demand-single', { idleTimeoutMs: 80 })
    const appId = 'fixture.on-demand-single'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)
    const [first, second] = await Promise.all([
      runtime.invoke(appId, instanceId, 'echo', { value: 1 }),
      runtime.invoke(appId, instanceId, 'echo', { value: 2 }),
    ])
    expect(first.instanceId).toBe(instanceId)
    expect(second.instanceId).toBe(instanceId)
    expect(runtime.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(runtime.supervisor.status(runtime.deployments.list(appId)[0].key).state).toBe('stopped')
    await runtime.shutdown()
  })

  it('runs exactly one persistent process per enabled multi-instance', async () => {
    const runtime = await createRuntime('persistent-multiple')
    const appId = 'fixture.persistent-multiple'
    await runtime.setAppEnabled(appId, true)
    await expect(runtime.createInstance(appId, { id: '../../escape', displayName: 'Unsafe' })).rejects.toMatchObject({ code: 'APP_INVALID_ACTION_INPUT' })
    await expect(runtime.createInstance(appId, { id: 'other.app--instance', displayName: 'Wrong scope' })).rejects.toMatchObject({ code: 'APP_INVALID_ACTION_INPUT' })
    const first = await runtime.createInstance(appId, { displayName: 'One', config: { label: 'one' }, secrets: { token: 'first-secret' }, enabled: true })
    const second = await runtime.createInstance(appId, { displayName: 'Two', config: { label: 'two' }, secrets: { token: 'second-secret' }, enabled: true })
    expect(runtime.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(2)
    await runtime.setInstanceEnabled(appId, first.id, false)
    expect(runtime.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(1)
    expect(() => runtime.requireInstance('another.app', second.id)).toThrow(/outside the caller scope/)
    expect((await runtime.invoke(appId, second.id, 'echo', 'ok')).input).toBe('ok')
    await runtime.shutdown()
    expect(runtime.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(0)
  })

  it('removes instance state and runtime directories when creation cannot start the Backend', async () => {
    const runtime = await createRuntime('persistent-multiple', { handshakeTimeoutMs: 200 }, async (source) => {
      await fs.writeFile(path.join(source, 'dist/backend/main.mjs'), 'process.exit(21)\n')
    })
    const appId = 'fixture.persistent-multiple'
    const instanceId = `${appId}--failed`
    await runtime.setAppEnabled(appId, true)
    await expect(runtime.createInstance(appId, { id: instanceId, displayName: 'Failed', enabled: true })).rejects.toMatchObject({ code: 'APP_HANDSHAKE_FAILED' })
    expect(runtime.instances.get(instanceId)).toBeNull()
    expect(runtime.deployments.list(appId)).toEqual([])
    expect(runtime.supervisor.listStatuses()).toEqual([])
    await expect(fs.stat(path.join(runtime.dataDir, appId, 'instances', instanceId))).rejects.toMatchObject({ code: 'ENOENT' })
    await runtime.shutdown()
  })

  it('activates a newly registered version instead of leaving the old process alive', async () => {
    const runtime = await createRuntime('persistent-single')
    const appId = 'fixture.persistent-single'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)
    const key = runtime.deployments.list(appId)[0].key
    const previousPid = runtime.supervisor.status(key).pid

    await installVersion(runtime, '2.0.0', () => {})
    expect(runtime.installations.get(appId)?.activeVersion).toBe('1.0.0')
    await runtime.registerInstalled(appId, '2.0.0')

    expect(runtime.installations.get(appId)?.activeVersion).toBe('2.0.0')
    expect(runtime.supervisor.status(key).state).toBe('running')
    expect(runtime.supervisor.status(key).pid).not.toBe(previousPid)
    await runtime.shutdown()
  })

  it('does not let manual restart bypass App and instance enable switches', async () => {
    const runtime = await createRuntime('persistent-single')
    const appId = 'fixture.persistent-single'
    const instanceId = defaultInstanceId(appId)
    await expect(runtime.restartInstance(appId, instanceId)).rejects.toMatchObject({ code: 'APP_DISABLED' })
    await runtime.setAppEnabled(appId, true)
    await expect(runtime.restartInstance(appId, instanceId)).rejects.toMatchObject({ code: 'APP_INSTANCE_DISABLED' })
    await runtime.setInstanceEnabled(appId, instanceId, true)
    const key = runtime.deployments.list(appId)[0].key
    const previousPid = runtime.supervisor.status(key).pid
    await runtime.restartInstance(appId, instanceId)
    expect(runtime.supervisor.status(key).pid).not.toBe(previousPid)
    await runtime.shutdown()
  })

  it('reconciles deployments and visible instances when a version changes runtime shape', async () => {
    const runtime = await createRuntime('persistent-multiple')
    const appId = 'fixture.persistent-multiple'
    await runtime.setAppEnabled(appId, true)
    const first = await runtime.createInstance(appId, { displayName: 'One', enabled: true })
    const second = await runtime.createInstance(appId, { displayName: 'Two', enabled: true })
    expect(runtime.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(2)

    await installVersion(runtime, '2.0.0', (manifest) => {
      manifest.backend.instanceMode = 'single'
    })
    await runtime.activateVersion(appId, '2.0.0')
    const singleApp = await runtime.getApp(appId)
    expect(singleApp?.instances.map((instance: any) => instance.id)).toEqual([defaultInstanceId(appId)])
    expect(runtime.deployments.list(appId).map((deployment) => deployment.instanceId)).toEqual([defaultInstanceId(appId)])
    expect(runtime.instances.get(first.id)).not.toBeNull()
    expect(runtime.instances.get(second.id)).not.toBeNull()
    expect(runtime.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(0)

    await installVersion(runtime, '3.0.0', async (manifest, source) => {
      delete manifest.backend
      manifest.ui = { entry: 'dist/ui/index.html' }
      await fs.mkdir(path.join(source, 'dist/ui'), { recursive: true })
      await fs.writeFile(path.join(source, 'dist/ui/index.html'), '<!doctype html><title>UI only</title>')
    })
    await runtime.activateVersion(appId, '3.0.0')
    expect((await runtime.getApp(appId))?.instances).toEqual([])
    expect(runtime.deployments.list(appId)).toEqual([])
    expect(runtime.supervisor.listStatuses()).toEqual([])
    await runtime.shutdown()
  })

  it('removes a local deployment when the new version no longer targets this Host', async () => {
    const runtime = await createRuntime('persistent-single')
    const appId = 'fixture.persistent-single'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)
    await installVersion(runtime, '2.0.0', (manifest) => {
      manifest.backend.targets = ['server']
    })
    await runtime.activateVersion(appId, '2.0.0')
    expect(runtime.deployments.list(appId)).toEqual([])
    expect(runtime.supervisor.listStatuses()).toEqual([])
    await runtime.shutdown()
  })

  it('serializes concurrent version activations per App', async () => {
    const runtime = await createRuntime('persistent-single')
    const appId = 'fixture.persistent-single'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)
    await installVersion(runtime, '2.0.0', () => {})
    await installVersion(runtime, '3.0.0', () => {})
    await Promise.all([runtime.activateVersion(appId, '2.0.0'), runtime.activateVersion(appId, '3.0.0')])
    expect(runtime.installations.get(appId)?.activeVersion).toBe('3.0.0')
    expect(runtime.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(1)
    await runtime.shutdown()
  })

  it('stops a local process before moving and requires confirmation for a remote source', async () => {
    const runtime = await createRuntime('persistent-multiple')
    const appId = 'fixture.persistent-multiple'
    await runtime.setAppEnabled(appId, true)
    const instance = await runtime.createInstance(appId, { displayName: 'Movable', enabled: true })
    const local = runtime.deployments.list(appId)[0]
    expect(runtime.supervisor.status(local.key).state).toBe('running')

    const remote = await runtime.moveDeployment(appId, instance.id, 'server', 'server-default')
    expect(remote.targetType).toBe('server')
    expect(runtime.supervisor.status(local.key).state).toBe('stopped')
    await expect(runtime.moveDeployment(appId, instance.id, 'desktop', 'desktop-test')).rejects.toThrow(/confirm it has stopped/)

    const movedBack = await runtime.moveDeployment(appId, instance.id, 'desktop', 'desktop-test', { sourceStopped: true })
    expect(runtime.supervisor.status(movedBack.key).state).toBe('running')
    await runtime.shutdown()
  })

  it('validates action input and output and supports explicit cancellation', async () => {
    const runtime = await createRuntime('on-demand-single', {}, async (source) => {
      await fs.mkdir(path.join(source, 'schemas'), { recursive: true })
      await fs.writeFile(path.join(source, 'schemas/input.json'), JSON.stringify({
        type: 'object', required: ['value'], properties: { value: { type: 'number' } }, additionalProperties: false,
      }))
      await fs.writeFile(path.join(source, 'schemas/output.json'), JSON.stringify({
        type: 'object', required: ['instanceId'], properties: { instanceId: { type: 'integer' } },
      }))
      const manifestPath = path.join(source, 'app.moss.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      manifest.backend.actions[0] = { name: 'echo', inputSchema: 'schemas/input.json', outputSchema: 'schemas/output.json' }
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    })
    const appId = 'fixture.on-demand-single'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)
    await expect(runtime.invoke(appId, instanceId, 'echo', { value: 'invalid' })).rejects.toMatchObject({ code: 'APP_INVALID_ACTION_INPUT' })
    await expect(runtime.invoke(appId, instanceId, 'echo', { value: 1 })).rejects.toMatchObject({ code: 'APP_INVALID_ACTION_OUTPUT' })
    await runtime.shutdown()

    const slow = await createRuntime('slow-backend')
    const slowAppId = 'fixture.slow-backend'
    const slowInstanceId = defaultInstanceId(slowAppId)
    await slow.setInstanceEnabled(slowAppId, slowInstanceId, true)
    await slow.setAppEnabled(slowAppId, true)
    const pending = slow.invoke(slowAppId, slowInstanceId, 'wait', {}, { requestId: 'cancel-me', timeoutMs: 2000 })
    const deadline = Date.now() + 1000
    while (!slow.supervisor.listStatuses().some((item) => item.pendingActions === 1) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const queued = slow.invoke(slowAppId, slowInstanceId, 'wait', {}, { requestId: 'queued-cancel', timeoutMs: 2000 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(slow.cancel(slowAppId, slowInstanceId, 'queued-cancel')).toBe(true)
    await expect(queued).rejects.toMatchObject({ code: 'APP_ACTION_CANCELED' })
    expect(slow.cancel(slowAppId, slowInstanceId, 'cancel-me')).toBe(true)
    await expect(pending).rejects.toMatchObject({ code: 'APP_ACTION_CANCELED' })
    await slow.shutdown()
  })

  it('does not restart a disabled instance to execute an already queued action', async () => {
    const runtime = await createRuntime('slow-backend')
    const appId = 'fixture.slow-backend'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)
    const running = runtime.invoke(appId, instanceId, 'wait', {}, { requestId: 'disable-running', timeoutMs: 2000 }).catch(error => error)
    const queued = runtime.invoke(appId, instanceId, 'wait', {}, { requestId: 'disable-queued', timeoutMs: 2000 }).catch(error => error)
    const deadline = Date.now() + 1000
    while (!runtime.supervisor.listStatuses().some((item) => item.pendingActions === 1) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await runtime.setInstanceEnabled(appId, instanceId, false)
    const codes = [(await running).code, (await queued).code].sort()
    expect(codes).toEqual(['APP_BACKEND_UNAVAILABLE', 'APP_INSTANCE_DISABLED'])
    expect(runtime.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(0)
    await runtime.shutdown()
  })

  it('preserves data, credentials, and instance configuration unless deletion is requested', async () => {
    const runtime = await createRuntime('persistent-multiple', {}, async (source) => {
      const secretsPath = path.join(source, 'schemas/secrets.schema.json')
      const schema = JSON.parse(await fs.readFile(secretsPath, 'utf8'))
      schema.required = ['token']
      await fs.writeFile(secretsPath, `${JSON.stringify(schema, null, 2)}\n`)
    })
    const appId = 'fixture.persistent-multiple'
    const instance = await runtime.createInstance(appId, {
      displayName: 'Durable', config: { label: 'kept' }, secrets: { token: 'kept-secret' }, enabled: false,
    })
    const dataFile = path.join(runtime.dataDir, appId, 'instances', instance.id, 'value.txt')
    await fs.mkdir(path.dirname(dataFile), { recursive: true })
    await fs.writeFile(dataFile, 'kept')
    const source = path.join(runtime.rootDir, 'source')

    await runtime.uninstall(appId)
    expect(runtime.instances.get(instance.id)?.config).toEqual({ label: 'kept' })
    expect(await runtime.credentials.get(appId, instance.id)).toEqual({ token: 'kept-secret' })
    expect(await fs.readFile(dataFile, 'utf8')).toBe('kept')

    await runtime.installFromDirectory(source)
    expect((await runtime.getApp(appId))?.instances[0]?.displayName).toBe('Durable')
    await runtime.clearInstanceCredentials(appId, instance.id)
    expect(await runtime.credentials.get(appId, instance.id)).toEqual({})
    await runtime.setAppEnabled(appId, true)
    await expect(runtime.setInstanceEnabled(appId, instance.id, true)).rejects.toMatchObject({ code: 'APP_INVALID_ACTION_INPUT' })
    await runtime.uninstall(appId, { deleteData: true, deleteCredentials: true })
    expect(runtime.instances.get(instance.id)).toBeNull()
    expect(await runtime.credentials.get(appId, instance.id)).toEqual({})
    await expect(fs.stat(dataFile)).rejects.toMatchObject({ code: 'ENOENT' })
    await runtime.shutdown()
  })

  it('clears preserved secret markers when credentials are deleted without deleting data', async () => {
    const runtime = await createRuntime('persistent-multiple')
    const appId = 'fixture.persistent-multiple'
    const instance = await runtime.createInstance(appId, {
      displayName: 'Credentials', secrets: { token: 'remove-me' }, enabled: false,
    })
    await runtime.uninstall(appId, { deleteCredentials: true })
    expect(await runtime.credentials.get(appId, instance.id)).toEqual({})
    expect(runtime.instances.get(instance.id)?.secretRefs).toEqual({})
    await runtime.shutdown()
  })

  it('rejects a Backend that sends ready before hello and init', async () => {
    const runtime = await createRuntime('persistent-single', { handshakeTimeoutMs: 300 }, async (source) => {
      await fs.writeFile(path.join(source, 'dist/backend/main.mjs'), `
const payload = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
process.send?.({ version: 1, id: 'early', type: 'service.ready', timestamp: Date.now(), payload })
setInterval(() => {}, 1000)
`)
    })
    const appId = 'fixture.persistent-single'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await expect(runtime.setAppEnabled(appId, true)).rejects.toMatchObject({ code: 'APP_HANDSHAKE_FAILED' })
    expect(runtime.installations.get(appId)?.enabled).toBe(false)
    expect(runtime.instances.get(instanceId)?.enabled).toBe(true)
    expect(runtime.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(0)
    await runtime.shutdown()
  })

  it('does not mark a Backend running when it exits immediately after ready', async () => {
    const runtime = await createRuntime('persistent-single', { handshakeTimeoutMs: 300 }, async (source) => {
      await fs.writeFile(path.join(source, 'dist/backend/main.mjs'), `
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const send = (type, payload, id = crypto.randomUUID()) => process.send?.({ version: 1, id, type, timestamp: Date.now(), payload: { ...payload, ...identity } })
process.on('message', (message) => {
  if (message.type === 'service.init') { send('service.ready', {}, message.id); process.exit(24) }
})
send('service.hello', { appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION, apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID })
`)
    })
    const appId = 'fixture.persistent-single'
    const instanceId = defaultInstanceId(appId)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(runtime.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(0)
    await runtime.shutdown()
  })

  it('restores Desktop desired state independently of App windows', async () => {
    const first = await createRuntime('persistent-single')
    const appId = 'fixture.persistent-single'
    const instanceId = defaultInstanceId(appId)
    await first.setInstanceEnabled(appId, instanceId, true)
    await first.setAppEnabled(appId, true)
    expect(first.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(1)
    const root = first.rootDir
    await first.shutdown()

    const restored = await new AppRuntimeHost({
      rootDir: root,
      nodeExecutable,
      target: 'desktop',
      hostId: 'desktop-restored',
      processOptions: { handshakeTimeoutMs: 2000, shutdownTimeoutMs: 200, killTimeoutMs: 100 },
    }).initialize()
    expect(restored.installations.get(appId)?.enabled).toBe(true)
    expect(restored.instances.get(instanceId)?.enabled).toBe(true)
    expect(restored.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(1)
    await restored.shutdown()
  })

  it('keeps Preview state and processes isolated from the published runtime', async () => {
    const published = await createRuntime('on-demand-single')
    const preview = await createRuntime('on-demand-single', { idleTimeoutMs: 500 })
    const appId = 'fixture.on-demand-single'
    const instanceId = defaultInstanceId(appId)
    await preview.setInstanceEnabled(appId, instanceId, true)
    await preview.setAppEnabled(appId, true)
    await preview.invoke(appId, instanceId, 'echo', { preview: true })
    expect(preview.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(1)
    expect(published.installations.get(appId)?.enabled).toBe(false)
    expect(published.instances.get(instanceId)?.enabled).toBe(false)
    expect(published.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(0)
    await preview.shutdown()
    expect(preview.supervisor.listStatuses().filter((item) => item.state === 'running')).toHaveLength(0)
    await published.shutdown()
  })
})
