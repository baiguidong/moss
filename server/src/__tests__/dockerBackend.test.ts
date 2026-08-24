import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import type { BackendSpawnOptions } from '../backendTypes.js'
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

  test('mounts all user session roots plus shared user dirs for user profile mode', () => {
    const root = '/tmp/moss-server'
    const currentSessionRoot = join(root, 'var', 'lib', 'sessions', 'session-2')
    const previousSessionRoot = join(root, 'var', 'lib', 'sessions', 'session-1')
    const userProfileDir = join(root, 'var', 'lib', 'profiles', 'users', 'user-1')
    const userWorkspaceDir = join(root, 'var', 'lib', 'workspaces', 'users', 'user-1')
    const options = makeOptions({
      cwd: userWorkspaceDir,
      backendManifestPath: join(
        currentSessionRoot,
        'attempts',
        'attempt-1',
        'docker-backend.json',
      ),
      mountDirs: [currentSessionRoot, previousSessionRoot],
      runtime: {
        backend: 'docker',
        profileMode: 'user',
        dockerImage: 'moss-runtime:0.1.8',
        profileDir: userProfileDir,
        transcriptDir: join(currentSessionRoot, 'transcripts'),
        workspaceDir: userWorkspaceDir,
      },
    })

    expect(
      buildDockerMounts(options, join(root, 'bin', 'moss-session-runner.mjs'))
        .map(formatMount),
    ).toEqual([
      `${currentSessionRoot}:${currentSessionRoot}`,
      `${previousSessionRoot}:${previousSessionRoot}`,
      `${userWorkspaceDir}:${userWorkspaceDir}`,
      `${userProfileDir}:${userProfileDir}`,
      `${join(root, 'bin')}:${join(root, 'bin')}:ro`,
    ])
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
