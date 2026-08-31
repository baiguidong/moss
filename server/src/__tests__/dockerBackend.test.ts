import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import type { BackendSpawnOptions } from '../backendTypes.js'
import { buildSessionEnv } from '../backends/backendUtils.js'
import { buildDockerMounts, formatMount } from '../backends/dockerBackend.js'

describe('docker backend mounts', () => {
  test('mounts only the current session root for session profile mode', () => {
    const root = '/tmp/moss-server'
    const sessionRoot = join(root, 'var', 'lib', 'sessions', 'session-1')
    const options = makeOptions({
      cwd: join(sessionRoot, 'workspace'),
      backendManifestPath: join(
        sessionRoot,
        'attempts',
        'attempt-1',
        'docker-backend.json',
      ),
      mountDirs: [sessionRoot],
      runtime: {
        backend: 'docker',
        profileMode: 'session',
        dockerImage: 'moss-runtime:0.1.8',
        profileDir: join(sessionRoot, 'profile'),
        transcriptDir: join(sessionRoot, 'transcripts'),
        workspaceDir: join(sessionRoot, 'workspace'),
      },
    })

    expect(
      buildDockerMounts(options, join(root, 'bin', 'moss-session-runner.mjs'))
        .map(formatMount),
    ).toEqual([
      `${sessionRoot}:${sessionRoot}`,
      `${join(root, 'bin')}:${join(root, 'bin')}:ro`,
    ])
  })

  test('mounts only the current workspace plus shared profile in user mode', () => {
    const root = '/tmp/moss-server'
    const currentSessionRoot = join(root, 'var', 'lib', 'sessions', 'session-2')
    const userProfileDir = join(root, 'var', 'lib', 'profiles', 'users', 'user-1')
    const sessionWorkspaceDir = join(currentSessionRoot, 'workspace')
    const options = makeOptions({
      cwd: sessionWorkspaceDir,
      backendManifestPath: join(
        currentSessionRoot,
        'attempts',
        'attempt-1',
        'docker-backend.json',
      ),
      mountDirs: [currentSessionRoot],
      runtime: {
        backend: 'docker',
        profileMode: 'user',
        dockerImage: 'moss-runtime:0.1.8',
        profileDir: userProfileDir,
        transcriptDir: join(currentSessionRoot, 'transcripts'),
        workspaceDir: sessionWorkspaceDir,
      },
    })

    expect(
      buildDockerMounts(options, join(root, 'bin', 'moss-session-runner.mjs'))
        .map(formatMount),
    ).toEqual([
      `${currentSessionRoot}:${currentSessionRoot}`,
      `${userProfileDir}:${userProfileDir}`,
      `${join(root, 'bin')}:${join(root, 'bin')}:ro`,
    ])
  })
})

describe('session runtime settings environment', () => {
  test('inherits the global value unless the session provides an override', () => {
    const prior = process.env.MOSS_AUTO_MEMORY_SETTINGS
    process.env.MOSS_AUTO_MEMORY_SETTINGS = JSON.stringify({ dreamEnabled: true })

    try {
      expect(buildSessionEnv(makeOptions({})).MOSS_AUTO_MEMORY_SETTINGS).toBe(
        JSON.stringify({ dreamEnabled: true }),
      )

      const autoMemory = {
        enabled: true,
        extractionEnabled: true,
        extractionIntervalTurns: 2,
        pastContextSearchEnabled: true,
        dreamEnabled: true,
        dreamMinHours: 12,
        dreamMinSessions: 3,
      }
      expect(
        buildSessionEnv(makeOptions({ autoMemory }))
          .MOSS_RUNTIME_AUTO_MEMORY_SETTINGS,
      ).toBe(JSON.stringify(autoMemory))
      expect(
        buildSessionEnv(makeOptions({ autoMemory })).MOSS_AUTO_MEMORY_SETTINGS,
      ).toBe(JSON.stringify({ dreamEnabled: true }))
    } finally {
      if (prior === undefined) delete process.env.MOSS_AUTO_MEMORY_SETTINGS
      else process.env.MOSS_AUTO_MEMORY_SETTINGS = prior
    }
  })

  test('does not inherit another session runtime snapshot', () => {
    const priorAdvanced = process.env.MOSS_RUNTIME_ADVANCED_SETTINGS
    const priorAuto = process.env.MOSS_RUNTIME_AUTO_MEMORY_SETTINGS
    const priorSession = process.env.MOSS_RUNTIME_SESSION_MEMORY_SETTINGS
    process.env.MOSS_RUNTIME_ADVANCED_SETTINGS = '{"moss_scratchpad":true}'
    process.env.MOSS_RUNTIME_AUTO_MEMORY_SETTINGS = '{"enabled":false}'
    process.env.MOSS_RUNTIME_SESSION_MEMORY_SETTINGS = '{"enabled":false}'
    try {
      const env = buildSessionEnv(makeOptions({}))
      expect(env.MOSS_RUNTIME_ADVANCED_SETTINGS).toBeUndefined()
      expect(env.MOSS_RUNTIME_AUTO_MEMORY_SETTINGS).toBeUndefined()
      expect(env.MOSS_RUNTIME_SESSION_MEMORY_SETTINGS).toBeUndefined()
    } finally {
      if (priorAdvanced === undefined) delete process.env.MOSS_RUNTIME_ADVANCED_SETTINGS
      else process.env.MOSS_RUNTIME_ADVANCED_SETTINGS = priorAdvanced
      if (priorAuto === undefined) delete process.env.MOSS_RUNTIME_AUTO_MEMORY_SETTINGS
      else process.env.MOSS_RUNTIME_AUTO_MEMORY_SETTINGS = priorAuto
      if (priorSession === undefined) delete process.env.MOSS_RUNTIME_SESSION_MEMORY_SETTINGS
      else process.env.MOSS_RUNTIME_SESSION_MEMORY_SETTINGS = priorSession
    }
  })
})

function makeOptions(
  overrides: Partial<BackendSpawnOptions>,
): BackendSpawnOptions {
  return {
    sessionId: 'session-1',
    cwd: '/tmp/moss-server/var/lib/sessions/session-1/workspace',
    backendManifestPath:
      '/tmp/moss-server/var/lib/sessions/session-1/attempts/attempt-1/docker-backend.json',
    runtime: {
      backend: 'docker',
      profileMode: 'session',
      dockerImage: 'moss-runtime:0.1.8',
      profileDir: '/tmp/moss-server/var/lib/sessions/session-1/profile',
      transcriptDir: '/tmp/moss-server/var/lib/sessions/session-1/transcripts',
      workspaceDir: '/tmp/moss-server/var/lib/sessions/session-1/workspace',
    },
    ...overrides,
  }
}
