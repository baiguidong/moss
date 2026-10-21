import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { AppRuntimeHost, defaultInstanceId, normalizeAppOwner, writePackageChecksums } from '../src/index.mjs'

const appId = 'fixture.on-demand-single'
const instanceId = defaultInstanceId(appId)
const fixture = fileURLToPath(new URL('../../../ui/tests/fixtures/apps/on-demand-single/', import.meta.url))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor(check, description, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = check()
    if (value) return value
    await delay(20)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

function createHost(root, processOptions = {}) {
  return new AppRuntimeHost({
    rootDir: root,
    nodeExecutable: process.execPath,
    processOptions: { handshakeTimeoutMs: 5_000, shutdownTimeoutMs: 300, killTimeoutMs: 150,
      idleTimeoutMs: 5_000, restartBaseDelayMs: 40, maxRestartDelayMs: 100, ...processOptions },
  })
}

async function installFixture({ activity = true, processOptions = {}, owner } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-on-demand-recovery-'))
  const source = path.join(root, 'source')
  let host
  try {
    await fs.cp(fixture, source, { recursive: true })
    if (activity) {
      const manifestPath = path.join(source, 'app.moss.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      manifest.hostApi = '^3.17.0'
      manifest.host = { protocols: ['moss.runtime/v1'] }
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    }
    await writePackageChecksums(source)
    host = await createHost(root, processOptions).initialize()
    await (owner ? host.withOwner(owner, () => host.installFromDirectory(source)) : host.installFromDirectory(source))
    const dataDir = owner
      ? host.withOwner(owner, () => host.appDataPath(host.dataDir, appId, 'instances', instanceId))
      : host.appDataPath(host.dataDir, appId, 'instances', instanceId)
    await host.shutdown()
    return { root, pendingDir: path.join(dataDir, 'jobs', '.pending') }
  } catch (error) {
    await host?.shutdown().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
    throw error
  }
}

async function marker(pendingDir, name = randomUUID()) {
  await fs.mkdir(pendingDir, { recursive: true })
  const file = path.join(pendingDir, name)
  await fs.writeFile(file, '')
  return file
}

function status(host, owner) {
  const runtimeRecord = owner
    ? host.withOwner(owner, () => host.runtimeForInstance(appId, instanceId))
    : host.runtimeForInstance(appId, instanceId)
  assert.ok(runtimeRecord)
  return host.supervisor.status(runtimeRecord.key)
}

test('restore wakes an on-demand Backend only for a valid pending task marker', async () => {
  const { root, pendingDir } = await installFixture()
  let host
  try {
    await marker(pendingDir, 'not-a-task')
    host = await createHost(root).initialize()
    assert.equal(status(host).pid, null)
    await host.shutdown()

    await marker(pendingDir)
    host = await createHost(root).initialize()
    assert.equal(status(host).state, 'running')
    assert.ok(status(host).pid)
  } finally {
    await host?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a Backend without the activity protocol remains on-demand with the same marker', async () => {
  const { root, pendingDir } = await installFixture({ activity: false })
  let host
  try {
    await marker(pendingDir)
    host = await createHost(root).initialize()
    assert.equal(status(host).pid, null)
  } finally {
    await host?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('pending work restores in the correct owner data directory after Host restart', async () => {
  const owner = normalizeAppOwner({ scope: 'user', orgId: 'sample-org', userId: 'sample-user' })
  const { root, pendingDir } = await installFixture({ owner })
  await marker(pendingDir)
  let host
  try {
    host = await createHost(root).initialize()
    assert.equal(status(host, owner).state, 'running')
    const firstPid = status(host, owner).pid
    process.kill(firstPid, 'SIGKILL')
    await waitFor(() => {
      const next = status(host, owner).pid
      return next && next !== firstPid
    }, 'owner-scoped Backend recovery')
  } finally {
    await host?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('normal idle shutdown does not restart a Backend even if a marker remains', async () => {
  const { root, pendingDir } = await installFixture()
  await marker(pendingDir)
  let host
  try {
    host = await createHost(root, { idleTimeoutMs: 80 }).initialize()
    assert.ok(status(host).pid)
    await waitFor(() => status(host).state === 'stopped', 'idle Backend shutdown')
    await delay(180)
    assert.equal(status(host).pid, null)
  } finally {
    await host?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('unexpected exit restarts while work is pending, then stops restarting after the marker is removed', async () => {
  const { root, pendingDir } = await installFixture()
  const pending = await marker(pendingDir)
  let host
  try {
    host = await createHost(root).initialize()
    const firstPid = status(host).pid
    assert.ok(firstPid)
    process.kill(firstPid, 'SIGKILL')
    const secondPid = await waitFor(() => {
      const next = status(host).pid
      return next && next !== firstPid ? next : null
    }, 'pending Backend restart')

    await fs.rm(pending)
    process.kill(secondPid, 'SIGKILL')
    await waitFor(() => status(host).state === 'error' && status(host).pid === null, 'Backend exit')
    await delay(250)
    assert.equal(status(host).pid, null)
  } finally {
    await host?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('explicit stop and disable do not revive a pending on-demand Backend', async () => {
  const { root, pendingDir } = await installFixture()
  await marker(pendingDir)
  let host
  try {
    host = await createHost(root, { restartBaseDelayMs: 200, maxRestartDelayMs: 200 }).initialize()
    const runtimeRecord = host.runtimeForInstance(appId, instanceId)
    await host.supervisor.stop(runtimeRecord.key)
    await delay(260)
    assert.equal(status(host).pid, null)

    await host.invoke(appId, instanceId, 'echo', 'wake for disable test')
    const runningPid = status(host).pid
    assert.ok(runningPid)
    process.kill(runningPid, 'SIGKILL')
    await waitFor(() => status(host).state === 'error', 'Backend crash')
    const staleDefinition = host.supervisor.definitions.get(runtimeRecord.key)
    await host.setAppEnabled(appId, false)
    assert.equal(await host.canRecoverPendingRuntime(staleDefinition), false)
    await delay(260)
    assert.equal(status(host).pid, null)
  } finally {
    await host?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a stale generation or version cannot restart from an old crash timer', async () => {
  const { root, pendingDir } = await installFixture()
  await marker(pendingDir)
  let host
  try {
    host = await createHost(root, { restartBaseDelayMs: 350, maxRestartDelayMs: 350 }).initialize()
    const key = host.runtimeForInstance(appId, instanceId).key
    const oldDefinition = host.supervisor.definitions.get(key)
    process.kill(status(host).pid, 'SIGKILL')
    await waitFor(() => status(host).state === 'error', 'first Backend crash')
    await host.runtimes.bumpGeneration(key)
    assert.equal(await host.canRecoverPendingRuntime(oldDefinition), false)
    await delay(420)
    assert.equal(status(host).pid, null)

    await host.reconcileApp(appId)
    assert.ok(status(host).pid)
    const secondSource = path.join(root, 'source-v2')
    await fs.cp(path.join(root, 'source'), secondSource, { recursive: true })
    const manifestPath = path.join(secondSource, 'app.moss.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.version = '2.0.0'
    manifest.host = { protocols: [] }
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await writePackageChecksums(secondSource)
    await host.installFromDirectory(secondSource)

    const currentDefinition = host.supervisor.definitions.get(key)
    process.kill(status(host).pid, 'SIGKILL')
    await waitFor(() => status(host).state === 'error', 'second Backend crash')
    await host.activateVersion(appId, '2.0.0')
    assert.equal(await host.canRecoverPendingRuntime(currentDefinition), false)
    await delay(420)
    assert.equal(status(host).pid, null)
    assert.equal(host.installations.get(appId).activeVersion, '2.0.0')
  } finally {
    await host?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('pending recovery obeys the crash-loop limit and rejects a removed installation', async () => {
  const { root, pendingDir } = await installFixture()
  await marker(pendingDir)
  let host
  try {
    host = await createHost(root, { crashLoopThreshold: 2 }).initialize()
    const firstPid = status(host).pid
    process.kill(firstPid, 'SIGKILL')
    const secondPid = await waitFor(() => {
      const next = status(host).pid
      return next && next !== firstPid ? next : null
    }, 'first crash recovery')
    process.kill(secondPid, 'SIGKILL')
    await waitFor(() => status(host).state === 'crash-loop', 'crash-loop limit')
    await delay(250)
    assert.equal(status(host).pid, null)

    const oldDefinition = host.supervisor.definitions.get(host.runtimeForInstance(appId, instanceId).key)
    await host.uninstall(appId)
    assert.equal(await host.canRecoverPendingRuntime(oldDefinition), false)
  } finally {
    await host?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})
