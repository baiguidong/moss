import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import {
  getAttemptDir,
  getDockerBackendManifestPath,
  getProfileDir,
  getSessionProfileDir,
  getSessionRuntimeMountDirs,
  resolveSessionWorkspaceDir,
} from '../runtimePaths.js'
import { SessionTurnLock } from '../sessionTurnLock.js'
import { validateAutoMemoryProfile } from '../memorySettings.js'
import type { ServerConfig } from '../types.js'

const originalAutoMemoryEnv = process.env.MOSS_AUTO_MEMORY_SETTINGS

afterEach(() => {
  if (originalAutoMemoryEnv === undefined) {
    delete process.env.MOSS_AUTO_MEMORY_SETTINGS
  } else {
    process.env.MOSS_AUTO_MEMORY_SETTINGS = originalAutoMemoryEnv
  }
})

describe('runtime service workspace layout', () => {
  test('uses per-session server workspace when client does not request cwd', () => {
    const config = makeConfig('/tmp/moss-server')

    expect(resolveSessionWorkspaceDir(config, 'session-1')).toBe(
      join('/tmp/moss-server', 'var', 'lib', 'sessions', 'session-1', 'workspace'),
    )
  })

  test('uses profile mode only to choose the memory profile', () => {
    const config = makeConfig('/tmp/moss-server')

    expect(resolveSessionWorkspaceDir(config, 'session-1')).toBe(
      join('/tmp/moss-server', 'var', 'lib', 'sessions', 'session-1', 'workspace'),
    )
    expect(getProfileDir(config, 'session-1', 'user-1', 'session')).toBe(
      join('/tmp/moss-server', 'var', 'lib', 'sessions', 'session-1', 'profile'),
    )
    expect(getProfileDir(config, 'session-1', 'user-1', 'user')).toBe(
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

  test('keeps session profile and attempt files under the session root', () => {
    const config = makeConfig('/tmp/moss-server')
    const attemptDir = getAttemptDir(config, 'session-1', 'attempt-1')

    expect(getSessionProfileDir(config, 'session-1')).toBe(
      join('/tmp/moss-server', 'var', 'lib', 'sessions', 'session-1', 'profile'),
    )
    expect(attemptDir).toBe(
      join('/tmp/moss-server', 'var', 'lib', 'sessions', 'session-1', 'attempts', 'attempt-1'),
    )
    expect(getDockerBackendManifestPath(attemptDir)).toBe(
      join(attemptDir, 'docker-backend.json'),
    )
  })

  test('mounts only the current session root for session profile mode', () => {
    const config = makeConfig('/tmp/moss-server')

    expect(
      getSessionRuntimeMountDirs(config, 'session-2'),
    ).toEqual([
      join('/tmp/moss-server', 'var', 'lib', 'sessions', 'session-2'),
    ])
  })

  test('does not mount other session roots for user profile mode', () => {
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

describe('runtime service memory profile validation', () => {
  test('requires a shared user profile for session-enabled Dream', () => {
    delete process.env.MOSS_AUTO_MEMORY_SETTINGS
    expect(() =>
      validateAutoMemoryProfile('session', {
        dreamEnabled: true,
      }),
    ).toThrow('Dream consolidation requires profileMode "user"')
    expect(() =>
      validateAutoMemoryProfile('user', {
        dreamEnabled: true,
      }),
    ).not.toThrow()
  })

  test('applies the global environment override before validation', () => {
    process.env.MOSS_AUTO_MEMORY_SETTINGS = JSON.stringify({ dreamEnabled: true })
    expect(() => validateAutoMemoryProfile('session', undefined)).toThrow(
      'Dream consolidation requires profileMode "user"',
    )

    process.env.MOSS_AUTO_MEMORY_SETTINGS = JSON.stringify({ dreamEnabled: false })
    expect(() =>
      validateAutoMemoryProfile('session', {
        dreamEnabled: true,
      }),
    ).not.toThrow()
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
