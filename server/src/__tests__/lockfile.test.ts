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

const originalMossServerHome = process.env.MOSS_SERVER_HOME
let tempRoot: string | undefined

afterEach(async () => {
  restoreEnv('MOSS_SERVER_HOME', originalMossServerHome)
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  }
})

describe('Direct Connect server lock', () => {
  test('stores the lock in MOSS_SERVER_HOME', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-lock-'))
    const serverHome = join(tempRoot, 'server-home')
    process.env.MOSS_SERVER_HOME = serverHome
    const lock: ServerLock = {
      pid: process.pid,
      port: 4242,
      host: '127.0.0.1',
      httpUrl: 'http://127.0.0.1:4242',
      startedAt: Date.now(),
    }

    await writeServerLock(lock)

    const lockPath = join(serverHome, 'direct-connect-server.json')
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
