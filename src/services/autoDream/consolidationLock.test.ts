import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  listSessionsTouchedSince,
  readLastConsolidatedAt,
  recordMemorySessionActivity,
  releaseConsolidationLock,
  rollbackConsolidationLock,
  tryAcquireConsolidationLock,
} from './consolidationLock.js'

const originalConfigDir = process.env.MOSS_CONFIG_DIR
let tempRoot: string | undefined

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.MOSS_CONFIG_DIR
  else process.env.MOSS_CONFIG_DIR = originalConfigDir
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  }
})

describe('auto-dream session activity', () => {
  test('counts shared profile activity without cross-mounting transcripts', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-dream-activity-'))
    process.env.MOSS_CONFIG_DIR = tempRoot

    await recordMemorySessionActivity('phone-session-1')
    await recordMemorySessionActivity('../invalid-session')

    const sessions = await listSessionsTouchedSince(0)
    expect(sessions).toContain('phone-session-1')
    expect(sessions).not.toContain('../invalid-session')
  })

  test('allows only one active consolidation and restores checkpoints on failure', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-dream-lock-'))
    process.env.MOSS_CONFIG_DIR = tempRoot

    const contenders = await Promise.all([
      tryAcquireConsolidationLock(0),
      tryAcquireConsolidationLock(0),
    ])
    const acquired = contenders.filter(lock => lock !== null)
    expect(acquired).toHaveLength(1)
    expect(await readLastConsolidatedAt()).toBeGreaterThan(0)

    await rollbackConsolidationLock(acquired[0]!)
    expect(await readLastConsolidatedAt()).toBe(0)

    const completed = await tryAcquireConsolidationLock(0)
    expect(completed).not.toBeNull()
    await releaseConsolidationLock(completed!)
    const checkpoint = await readLastConsolidatedAt()
    expect(checkpoint).toBeGreaterThan(0)

    expect(await tryAcquireConsolidationLock(0)).toBeNull()
    const next = await tryAcquireConsolidationLock(checkpoint)
    expect(next).not.toBeNull()
    await rollbackConsolidationLock(next!)
  })
})
