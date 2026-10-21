import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createEnvelope } from '../src/protocol/index.mjs'

const nodeExecutable = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
const sdkUrl = new URL('../src/client/index.mjs', import.meta.url).href

function launchBackend(entry, marker) {
  const child = spawn(nodeExecutable, [entry], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      MOSS_APP_ID: 'fixture.sdk-shutdown',
      MOSS_APP_VERSION: '1.0.0',
      MOSS_APP_INSTANCE_ID: 'default',
      MOSS_APP_GENERATION: '1',
      MOSS_APP_LAUNCH_TOKEN: 'launch-1',
      MOSS_TEST_SHUTDOWN_MARKER: marker,
    },
  })
  const messages = []
  let stderr = ''
  child.on('message', message => messages.push(message))
  child.stderr.on('data', chunk => { stderr += chunk })
  const exited = new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
    child.once('error', reject)
  })
  const waitForExit = (timeoutMs = 3_000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Backend did not exit; stderr: ${stderr}`)), timeoutMs)
    exited.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
  const waitFor = async predicate => {
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline) {
      const found = messages.find(predicate)
      if (found) return found
      if (child.exitCode !== null || child.signalCode !== null) break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error(`Backend did not send expected message. Received: ${JSON.stringify(messages)}; stderr: ${stderr}`)
  }
  return { child, exited, waitFor, waitForExit, stderr: () => stderr }
}

test('shutdown aborts active Actions and rejects Actions received while stopping', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-sdk-shutdown-'))
  const entry = path.join(root, 'backend.mjs')
  const marker = path.join(root, 'shutdown.json')
  await fs.writeFile(entry, `
import { writeFileSync } from 'node:fs'
import { AppBackendClient } from ${JSON.stringify(sdkUrl)}

let activeSignal = null
let lateCalls = 0
const backend = new AppBackendClient({
  async onShutdown() {
    await new Promise(resolve => setTimeout(resolve, 200))
    writeFileSync(process.env.MOSS_TEST_SHUTDOWN_MARKER, JSON.stringify({
      aborted: activeSignal?.aborted,
      reason: activeSignal?.reason?.code,
      lateCalls,
    }))
  },
})
backend.registerAction('wait', (_input, { signal }) => {
  activeSignal = signal
  backend.status('action-started')
  return new Promise(() => {})
})
backend.registerAction('late', () => {
  lateCalls++
  return { accepted: true }
})
backend.start()
`)
  const { child, exited, waitFor, waitForExit, stderr } = launchBackend(entry, marker)

  try {
    await waitFor(message => message.type === 'service.hello')
    child.send(createEnvelope('service.init', { generation: 1, launchToken: 'launch-1', protocols: [], permissions: [], grants: [] }))
    await waitFor(message => message.type === 'service.ready')
    child.send(createEnvelope('action.invoke', { name: 'wait', input: {} }, { id: 'active' }))
    await waitFor(message => message.type === 'service.status' && message.payload.state === 'action-started')
    child.send(createEnvelope('service.shutdown', {}, { id: 'stop' }))
    await waitFor(message => message.type === 'service.status' && message.payload.state === 'stopping')
    child.send(createEnvelope('action.invoke', { name: 'late', input: {} }, { id: 'late' }))
    assert.equal((await waitFor(message => message.id === 'late' && message.type === 'action.error')).payload.error.code, 'APP_ACTION_CANCELED')
    assert.deepEqual(await waitForExit(), { code: 0, signal: null }, stderr())
    assert.deepEqual(JSON.parse(await fs.readFile(marker, 'utf8')), {
      aborted: true,
      reason: 'APP_ACTION_CANCELED',
      lateCalls: 0,
    })
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited.catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Host disconnect aborts active Actions before the Backend exits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-sdk-disconnect-'))
  const entry = path.join(root, 'backend.mjs')
  const marker = path.join(root, 'aborted.txt')
  await fs.writeFile(entry, `
import { writeFileSync } from 'node:fs'
import { AppBackendClient } from ${JSON.stringify(sdkUrl)}

const backend = new AppBackendClient()
backend.registerAction('wait', (_input, { signal }) => {
  signal.addEventListener('abort', () => {
    writeFileSync(process.env.MOSS_TEST_SHUTDOWN_MARKER, signal.reason?.code || 'missing-reason')
  }, { once: true })
  backend.status('action-started')
  return new Promise(() => {})
})
backend.start()
`)
  const { child, exited, waitFor, waitForExit, stderr } = launchBackend(entry, marker)
  try {
    await waitFor(message => message.type === 'service.hello')
    child.send(createEnvelope('service.init', { generation: 1, launchToken: 'launch-1', protocols: [], permissions: [], grants: [] }))
    await waitFor(message => message.type === 'service.ready')
    child.send(createEnvelope('action.invoke', { name: 'wait', input: {} }, { id: 'active' }))
    await waitFor(message => message.type === 'service.status' && message.payload.state === 'action-started')
    child.disconnect()
    assert.deepEqual(await waitForExit(), { code: 0, signal: null }, stderr())
    assert.equal(await fs.readFile(marker, 'utf8'), 'APP_ACTION_CANCELED')
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited.catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})
