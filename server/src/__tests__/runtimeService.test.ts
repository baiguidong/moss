import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { resolveSessionWorkspaceDir } from '../runtimePaths.js'
import type { ServerConfig } from '../types.js'

describe('runtime service workspace layout', () => {
  test('uses per-session server workspace when client does not request cwd', () => {
    const config = makeConfig('/tmp/moss-server')

    expect(resolveSessionWorkspaceDir(config, 'session-1')).toBe(
      join('/tmp/moss-server', 'var', 'lib', 'sessions', 'session-1', 'workspace'),
    )
  })

  test('respects an explicit requested cwd', () => {
    const config = makeConfig('/tmp/moss-server')

    expect(resolveSessionWorkspaceDir(config, 'session-1', '/work/project')).toBe(
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
