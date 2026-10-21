import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { AppRuntimeHost, defaultInstanceId, writePackageChecksums } from '../src/index.mjs'

const nodeExecutable = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
const sdkUrl = new URL('../../app-sdk/src/client/index.mjs', import.meta.url).href

async function waitForFile(file) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try { await fs.access(file); return }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Backend did not start Action: ${file}`)
}

test('a canceled Action holds the queue until it replies or its Backend is stopped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-action-cancel-order-'))
  const source = path.join(root, 'source')
  const appId = 'fixture.cancel-order'
  const instanceId = defaultInstanceId(appId)
  let runtime
  try {
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify({
      schemaVersion: 2, id: appId, displayName: 'Cancel order', version: '1.0.0', hostApi: '^3.0.0',
      backend: { entry: 'main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand',
        actions: [{ name: 'hold' }, { name: 'hang' }, { name: 'check' }] },
      permissions: [],
    }))
    await fs.writeFile(path.join(source, 'main.mjs'), `
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { AppBackendClient } from ${JSON.stringify(sdkUrl)}

const launchId = randomUUID()
let active = false
const backend = new AppBackendClient()
backend.registerAction('hold', async (_input, context) => {
  active = true
  writeFileSync(path.join(context.dataDir, 'hold.started'), '1')
  await new Promise(resolve => setTimeout(resolve, 200))
  active = false
  return { done: true }
})
backend.registerAction('hang', (_input, context) => {
  active = true
  writeFileSync(path.join(context.dataDir, 'hang.started'), '1')
  return new Promise(() => {})
})
backend.registerAction('check', () => ({ active, launchId }))
backend.start()
`)
    await writePackageChecksums(source)
    runtime = await new AppRuntimeHost({
      rootDir: path.join(root, 'host'), nodeExecutable,
      processOptions: { actionCancelGraceMs: 120, idleTimeoutMs: 1_000, handshakeTimeoutMs: 2_000, shutdownTimeoutMs: 300 },
    }).initialize()
    await runtime.installFromDirectory(source)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)

    const dataDir = runtime.appDataPath(runtime.dataDir, appId, 'instances', instanceId)
    const hold = runtime.invoke(appId, instanceId, 'hold', {}, { requestId: 'hold', timeoutMs: 2_000 }).catch(error => error)
    await waitForFile(path.join(dataDir, 'hold.started'))
    assert.equal(runtime.cancel(appId, instanceId, 'hold'), true)
    assert.equal((await hold).code, 'APP_ACTION_CANCELED')
    const afterHold = await runtime.invoke(appId, instanceId, 'check', {}, { timeoutMs: 2_000 })
    assert.equal(afterHold.active, false, 'the next Action must wait for the canceled handler to finish')

    const hang = runtime.invoke(appId, instanceId, 'hang', {}, { requestId: 'hang', timeoutMs: 2_000 }).catch(error => error)
    await waitForFile(path.join(dataDir, 'hang.started'))
    assert.equal(runtime.cancel(appId, instanceId, 'hang'), true)
    assert.equal((await hang).code, 'APP_ACTION_CANCELED')
    const afterHang = await runtime.invoke(appId, instanceId, 'check', {}, { timeoutMs: 2_000 })
    assert.equal(afterHang.active, false)
    assert.notEqual(afterHang.launchId, afterHold.launchId, 'an unresponsive Backend must be restarted')
  } finally {
    await runtime?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('canceling an Action stops its Host requests while allowing cleanup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-action-host-cancel-'))
  const source = path.join(root, 'source')
  const appId = 'fixture.host-cancel'
  const instanceId = defaultInstanceId(appId)
  const protocol = 'moss.fixture-cancel/v1'
  let runtime
  let touches = 0
  let hostStarted = false
  let releaseHost
  const hostGate = new Promise(resolve => { releaseHost = resolve })
  try {
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify({
      schemaVersion: 2, id: appId, displayName: 'Host cancellation', version: '1.0.0', hostApi: '^3.17.0',
      backend: { entry: 'main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand',
        actions: [{ name: 'late' }, { name: 'inflight' }, { name: 'background' },
          { name: 'detached' }, { name: 'canceledDetached' }] },
      host: { protocols: [protocol, 'moss.runtime/v1'] }, permissions: [],
    }))
    await fs.writeFile(path.join(source, 'main.mjs'), `
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { AppBackendClient } from ${JSON.stringify(sdkUrl)}

const backend = new AppBackendClient()
const invokeHost = async (kind, context) => {
  writeFileSync(path.join(context.dataDir, kind + '.started'), '1')
  if (kind === 'late') await new Promise(resolve => setTimeout(resolve, 25))
  try { await backend.host.request(${JSON.stringify(protocol)}, 'touch', { kind }) }
  catch (error) { writeFileSync(path.join(context.dataDir, kind + '.done'), error.code || error.message) }
  if (kind === 'late') {
    try { await backend.host.request('moss.runtime/v1', 'activity.begin', { id: 'late-new' }) }
    catch (error) { writeFileSync(path.join(context.dataDir, 'begin.done'), error.code || error.message) }
    const ended = await backend.host.request('moss.runtime/v1', 'activity.end', { id: 'late-cleanup' })
    writeFileSync(path.join(context.dataDir, 'cleanup.done'), String(ended.active))
  }
  return { done: true }
}
backend.registerAction('late', (_input, context) => invokeHost('late', context))
backend.registerAction('inflight', (_input, context) => invokeHost('inflight', context))
backend.registerAction('detached', (_input, context) => {
  setTimeout(async () => {
    try {
      const result = await backend.host.request(${JSON.stringify(protocol)}, 'touch', { kind: 'detached' })
      writeFileSync(path.join(context.dataDir, 'detached.done'), String(result.touched))
    } catch (error) { writeFileSync(path.join(context.dataDir, 'detached.done'), error.code || error.message) }
  }, 25)
  return { accepted: true }
})
backend.registerAction('canceledDetached', async (_input, context) => {
  writeFileSync(path.join(context.dataDir, 'canceled-detached.started'), '1')
  await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true }))
  setTimeout(async () => {
    try {
      await backend.host.request(${JSON.stringify(protocol)}, 'touch', { kind: 'canceledDetached' })
      writeFileSync(path.join(context.dataDir, 'canceled-detached.done'), 'true')
    } catch (error) { writeFileSync(path.join(context.dataDir, 'canceled-detached.done'), error.code || error.message) }
  }, 25)
  return { accepted: true }
})
backend.registerAction('background', async (_input, context) => {
  await backend.host.request('moss.runtime/v1', 'activity.begin', { id: 'background-task' })
  setTimeout(async () => {
    try {
      const renewed = await backend.host.request('moss.runtime/v1', 'activity.renew', { id: 'background-task' })
      writeFileSync(path.join(context.dataDir, 'background.renew'), String(renewed.active))
    } catch (error) { writeFileSync(path.join(context.dataDir, 'background.renew'), error.code || error.message) }
    await backend.host.request('moss.runtime/v1', 'activity.end', { id: 'background-task' })
  }, 25)
  return { accepted: true }
})
backend.start()
`)
    await writePackageChecksums(source)
    runtime = await new AppRuntimeHost({ rootDir: path.join(root, 'host'), nodeExecutable,
      processOptions: { actionCancelGraceMs: 500, idleTimeoutMs: 1_000, handshakeTimeoutMs: 2_000, shutdownTimeoutMs: 300 },
    }).initialize()
    runtime.registerHostProtocol({ protocol, methods: { touch: { surfaces: ['backend'] } } })
    runtime.registerHostHandler(protocol, 'touch', async (input, context) => {
      if (input.kind === 'inflight') { hostStarted = true; await hostGate }
      context.assertCurrent()
      touches++
      return { touched: true }
    })
    await runtime.installFromDirectory(source)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    await runtime.setAppEnabled(appId, true)
    const dataDir = runtime.appDataPath(runtime.dataDir, appId, 'instances', instanceId)

    const late = runtime.invoke(appId, instanceId, 'late', {}, { requestId: 'late', timeoutMs: 2_000 }).catch(error => error)
    await waitForFile(path.join(dataDir, 'late.started'))
    assert.equal(runtime.cancel(appId, instanceId, 'late'), true)
    assert.equal((await late).code, 'APP_ACTION_CANCELED')
    await waitForFile(path.join(dataDir, 'late.done'))
    await waitForFile(path.join(dataDir, 'begin.done'))
    await waitForFile(path.join(dataDir, 'cleanup.done'))
    assert.equal(await fs.readFile(path.join(dataDir, 'late.done'), 'utf8'), 'APP_ACTION_CANCELED')
    assert.equal(await fs.readFile(path.join(dataDir, 'begin.done'), 'utf8'), 'APP_ACTION_CANCELED')
    assert.equal(await fs.readFile(path.join(dataDir, 'cleanup.done'), 'utf8'), 'false')
    assert.equal(touches, 0)

    assert.deepEqual(await runtime.invoke(appId, instanceId, 'background', {}, { timeoutMs: 2_000 }), { accepted: true })
    await waitForFile(path.join(dataDir, 'background.renew'))
    assert.equal(await fs.readFile(path.join(dataDir, 'background.renew'), 'utf8'), 'true')

    assert.deepEqual(await runtime.invoke(appId, instanceId, 'detached', {}, { timeoutMs: 2_000 }), { accepted: true })
    await waitForFile(path.join(dataDir, 'detached.done'))
    assert.equal(await fs.readFile(path.join(dataDir, 'detached.done'), 'utf8'), 'true')
    assert.equal(touches, 1, 'a normally completed Action may start detached Host work')

    const canceledDetached = runtime.invoke(appId, instanceId, 'canceledDetached', {}, {
      requestId: 'canceledDetached', timeoutMs: 2_000,
    }).catch(error => error)
    await waitForFile(path.join(dataDir, 'canceled-detached.started'))
    assert.equal(runtime.cancel(appId, instanceId, 'canceledDetached'), true)
    assert.equal((await canceledDetached).code, 'APP_ACTION_CANCELED')
    await waitForFile(path.join(dataDir, 'canceled-detached.done'))
    assert.equal(await fs.readFile(path.join(dataDir, 'canceled-detached.done'), 'utf8'), 'APP_ACTION_CANCELED')
    assert.equal(touches, 1)

    const inflight = runtime.invoke(appId, instanceId, 'inflight', {}, { requestId: 'inflight', timeoutMs: 2_000 }).catch(error => error)
    for (let i = 0; i < 200 && !hostStarted; i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(hostStarted, true, 'the Host request should start before cancellation')
    assert.equal(runtime.cancel(appId, instanceId, 'inflight'), true)
    assert.equal((await inflight).code, 'APP_ACTION_CANCELED')
    releaseHost()
    await waitForFile(path.join(dataDir, 'inflight.done'))
    assert.equal(await fs.readFile(path.join(dataDir, 'inflight.done'), 'utf8'), 'APP_ACTION_CANCELED')
    assert.equal(touches, 1)
  } finally {
    releaseHost()
    await runtime?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})
