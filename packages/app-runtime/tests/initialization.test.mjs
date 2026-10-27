import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { AppRuntimeHost } from '../src/index.mjs'

test('failed startup recovery is retryable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-runtime-init-'))
  const runtime = new AppRuntimeHost({ rootDir: root })
  let attempts = 0
  const original = runtime.supervisor.recoverOrphans.bind(runtime.supervisor)
  runtime.supervisor.recoverOrphans = async () => {
    attempts += 1
    if (attempts === 1) throw new Error('temporary recovery failure')
    return original()
  }
  try {
    await assert.rejects(runtime.initialize(), /temporary recovery failure/)
    assert.equal(runtime.initialized, false)
    await runtime.initialize()
    assert.equal(runtime.initialized, true)
    assert.equal(attempts, 2)
  } finally {
    await runtime.shutdown().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('concurrent initialization shares one startup operation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-runtime-init-concurrent-'))
  const runtime = new AppRuntimeHost({ rootDir: root })
  let attempts = 0
  const original = runtime.supervisor.recoverOrphans.bind(runtime.supervisor)
  runtime.supervisor.recoverOrphans = async () => { attempts += 1; await new Promise(resolve => setTimeout(resolve, 20)); return original() }
  try {
    const [first, second] = await Promise.all([runtime.initialize(), runtime.initialize()])
    assert.equal(first, runtime)
    assert.equal(second, runtime)
    assert.equal(attempts, 1)
  } finally {
    await runtime.shutdown().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})
