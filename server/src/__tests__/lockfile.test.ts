import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  probeRunningServer,
  removeServerLock,
  type ServerLock,
  writeServerLock,
} from '../lockfile.js'

const originalMossConfigDir = process.env.MOSS_CONFIG_DIR
let tempRoot: string | undefined

afterEach(async () => {
  restoreEnv('MOSS_CONFIG_DIR', originalMossConfigDir)
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  }
})

describe('Direct Connect server lock', () => {
  test('stores the lock in MOSS_CONFIG_DIR', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-lock-'))
    const configDir = join(tempRoot, 'config')
    process.env.MOSS_CONFIG_DIR = configDir
    const lock: ServerLock = {
      pid: process.pid,
      port: 4242,
      host: '127.0.0.1',
      httpUrl: 'http://127.0.0.1:4242',
      startedAt: Date.now(),
    }

    await writeServerLock(lock)

    const lockPath = join(configDir, 'direct-connect-server.json')
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toEqual(lock)
    expect(await probeRunningServer()).toEqual(lock)

    await removeServerLock()
    expect(await probeRunningServer()).toBeNull()
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
