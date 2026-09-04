import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import {
  getAttemptDir,
  getDockerBackendManifestPath,
  getSessionRuntimeMountDirs,
  getUserProfileDir,
  resolveSessionWorkspaceDir,
} from '../runtimePaths.js'
import { SessionTurnLock } from '../sessionTurnLock.js'
import type { ServerConfig } from '../types.js'

describe('runtime service workspace layout', () => {
  test('uses per-session server workspace when client does not request cwd', () => {
    const config = makeConfig('/tmp/moss-server')

    expect(resolveSessionWorkspaceDir(config, 'session-1')).toBe(
      join('/tmp/moss-server', 'var', 'lib', 'sessions', 'session-1', 'workspace'),
    )
  })

  test('uses one shared memory profile for every session owned by a user', () => {
    const config = makeConfig('/tmp/moss-server')

    expect(resolveSessionWorkspaceDir(config, 'session-1')).toBe(
      join('/tmp/moss-server', 'var', 'lib', 'sessions', 'session-1', 'workspace'),
    )
    expect(getUserProfileDir(config, 'user-1')).toBe(
      join('/tmp/moss-server', 'var', 'lib', 'profiles', 'users', 'user-1'),
    )
  })

  test('respects an explicit requested cwd', () => {
    const config = makeConfig('/tmp/moss-server')

    expect(
      resolveSessionWorkspaceDir(
        config,
        'session-1',
        '/work/project',
      ),
    ).toBe(
      '/work/project',
    )
  })

  test('uses server default workspace before per-session workspace', () => {
    const config = {
      ...makeConfig('/tmp/moss-server'),
      workspace: '/work/default',
    }

    expect(resolveSessionWorkspaceDir(config, 'session-1')).toBe('/work/default')
  })

  test('keeps attempt files under the session root', () => {
    const config = makeConfig('/tmp/moss-server')
    const attemptDir = getAttemptDir(config, 'session-1', 'attempt-1')

    expect(attemptDir).toBe(
      join('/tmp/moss-server', 'var', 'lib', 'sessions', 'session-1', 'attempts', 'attempt-1'),
    )
    expect(getDockerBackendManifestPath(attemptDir)).toBe(
      join(attemptDir, 'docker-backend.json'),
    )
  })

  test('mounts only the current session root in addition to the user profile', () => {
    const config = makeConfig('/tmp/moss-server')

    expect(
      getSessionRuntimeMountDirs(config, 'session-2'),
    ).toEqual([
      join('/tmp/moss-server', 'var', 'lib', 'sessions', 'session-2'),
    ])
  })
})

describe('runtime service session turn lock', () => {
  test('serializes turns for one session without blocking another session', async () => {
    const lock = new SessionTurnLock()
    const releaseFirst = await lock.acquire('session-1')
    let secondAcquired = false
    const second = lock.acquire('session-1').then(release => {
      secondAcquired = true
      return release
    })

    const releaseOther = await lock.acquire('session-2')
    expect(secondAcquired).toBe(false)
    releaseOther()
    releaseFirst()

    const releaseSecond = await second
    expect(secondAcquired).toBe(true)
    releaseSecond()
  })
})

function makeConfig(rootDir: string): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 43127,
    authMode: 'local',
    tokenTtlSec: 3600,
    bootstrapAdmin: {
      username: 'admin',
    },
    idleTimeoutMs: 600000,
    maxSessions: 32,
    rootDir,
    dbPath: join(rootDir, 'moss-server.db'),
    dataDir: join(rootDir, 'var', 'lib'),
    runDir: join(rootDir, 'var', 'run'),
    logDir: join(rootDir, 'var', 'log'),
    dockerStopTimeoutSec: 10,
    dockerLabels: {},
    startupPolicy: 'reattach-or-resume',
    heartbeatTimeoutMs: 30000,
    reattachProbeTimeoutMs: 3000,
    resumeOnMissingRuntime: true,
    logLevel: 'info',
  }
}
