import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { AppProcessSupervisor } from '../src/process/index.mjs'
import { AppProcessLeases } from '../src/process/lease.mjs'
import { readProcessInfo } from '../src/process/process-info.mjs'

const nodeExecutable = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()

async function waitForGone(pid, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!await readProcessInfo(pid)) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return !await readProcessInfo(pid)
}

test('shutdown reaps Backend helpers after the Backend exits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-process-tree-'))
  const entry = path.join(root, 'backend.mjs')
  const helperFile = path.join(root, 'helper.pid')
  await fs.writeFile(entry, `
import fs from 'node:fs'
import { spawn } from 'node:child_process'
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const send = (type, payload = {}, id = crypto.randomUUID()) => process.send?.({ version: 1, id, type, timestamp: Date.now(), payload: { ...payload, ...identity } })
process.on('message', message => {
  if (message.type === 'service.init') {
    const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    fs.writeFileSync(${JSON.stringify(helperFile)}, String(helper.pid))
    send('service.ready', {}, message.id)
  }
  if (message.type === 'service.ping') send('service.pong', {}, message.id)
  if (message.type === 'service.shutdown') process.exit(0)
})
send('service.hello', { appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION, apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID })
`)
  const supervisor = new AppProcessSupervisor({
    nodeExecutable,
    handshakeTimeoutMs: 1_000,
    shutdownTimeoutMs: 100,
    killTimeoutMs: 100,
    processesDir: path.join(root, 'processes'),
  })
  supervisor.register({
    key: 'tree', appId: 'fixture.process-tree', instanceId: 'default', version: '1.0.0', generation: 1,
    packageRoot: root, entry: 'backend.mjs', dataDir: path.join(root, 'data'), runtimeDir: path.join(root, 'runtime'),
    lifecycle: 'persistent',
  })
  try {
    await supervisor.start('tree')
    const helperPid = Number(await fs.readFile(helperFile, 'utf8'))
    assert.ok(helperPid > 0)
    await supervisor.shutdown()
    assert.equal(await waitForGone(helperPid), true)
    assert.equal(supervisor.status('tree').state, 'stopped')
  } finally {
    await supervisor.shutdown().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('unexpected Backend exit reaps helpers before a persistent restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-process-tree-crash-'))
  const entry = path.join(root, 'backend.mjs')
  const helperFile = path.join(root, 'helper.pid')
  await fs.writeFile(entry, `
import fs from 'node:fs'
import { spawn } from 'node:child_process'
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const send = (type, payload = {}, id = crypto.randomUUID()) => process.send?.({ version: 1, id, type, timestamp: Date.now(), payload: { ...payload, ...identity } })
process.on('message', message => {
  if (message.type === 'service.init') {
    const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    fs.writeFileSync(${JSON.stringify(helperFile)}, String(helper.pid))
    send('service.ready', {}, message.id)
    setTimeout(() => process.exit(0), 50)
  }
})
send('service.hello', { appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION, apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID })
`)
  const supervisor = new AppProcessSupervisor({
    nodeExecutable,
    handshakeTimeoutMs: 1_000,
    restartBaseDelayMs: 10_000,
    maxRestartDelayMs: 10_000,
    killTimeoutMs: 100,
    processesDir: path.join(root, 'processes'),
  })
  supervisor.register({
    key: 'tree-crash', appId: 'fixture.process-tree-crash', instanceId: 'default', version: '1.0.0', generation: 1,
    packageRoot: root, entry: 'backend.mjs', dataDir: path.join(root, 'data'), runtimeDir: path.join(root, 'runtime'),
    lifecycle: 'persistent',
  })
  try {
    await supervisor.start('tree-crash')
    const helperPid = Number(await fs.readFile(helperFile, 'utf8'))
    assert.ok(helperPid > 0)
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline && supervisor.status('tree-crash').state === 'running') {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(supervisor.status('tree-crash').state, 'error')
    assert.equal(await waitForGone(helperPid), true)
  } finally {
    await supervisor.shutdown().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('startup recovery reaps helpers after the Backend leader has exited', async () => {
  if (process.platform === 'win32') return
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-process-recovery-'))
  const appId = 'fixture.process-recovery'
  const markerId = randomUUID()
  const marker = `--moss-app-process=${markerId}`
  const processesDir = path.join(root, 'processes')
  const directory = path.join(processesDir, createHash('sha256').update(appId).digest('hex'))
  const leaseId = markerId
  let leader
  try {
    const helperPath = path.join(root, 'helper.pid')
    const script = `import { spawn } from 'node:child_process'; import fs from 'node:fs'; const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); fs.writeFileSync(${JSON.stringify(helperPath)}, String(child.pid)); setTimeout(() => process.exit(0), 25)`
    leader = spawn(nodeExecutable, ['-e', script, '--', marker], { detached: true, stdio: 'ignore' })
    const childPid = await (async () => {
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline) {
        try { return Number(await fs.readFile(helperPath, 'utf8')) } catch {}
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw new Error('helper did not start')
    })()
    const leaderPid = leader.pid
    await new Promise(resolve => leader.once('exit', resolve))
    assert.equal(await readProcessInfo(leaderPid), null)
    assert.ok(await readProcessInfo(childPid))
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, `${leaseId}.json`), JSON.stringify({
      schemaVersion: 1, id: leaseId, marker, appId, instanceId: 'default', appOwner: null,
      owner: { pid: 999999, started: 'dead-host' },
    }))
    await fs.writeFile(path.join(directory, `${leaseId}.child.json`), JSON.stringify({ pid: leaderPid, started: 'leader-started' }))
    const leases = new AppProcessLeases({ directory: processesDir, killTimeoutMs: 100 })
    await leases.recover(directory, appId)
    assert.equal(await waitForGone(childPid), true)
    await assert.rejects(fs.access(directory))
  } finally {
    if (leader?.exitCode === null && leader?.signalCode === null) leader.kill('SIGKILL')
    await fs.rm(root, { recursive: true, force: true })
  }
})
