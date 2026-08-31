import { join } from 'path'
import type { SessionProfileMode } from '../../packages/direct-connect-protocol/src/index.js'
import type { ServerConfig } from './types.js'

export function getSessionDir(config: ServerConfig, sessionId: string): string {
  return join(config.dataDir, 'sessions', sessionId)
}

export function getSessionTranscriptDir(
  config: ServerConfig,
  sessionId: string,
): string {
  return join(getSessionDir(config, sessionId), 'transcripts')
}

export function getTranscriptPath(
  config: ServerConfig,
  sessionId: string,
  transcriptSessionId: string,
): string {
  return join(getSessionTranscriptDir(config, sessionId), `${transcriptSessionId}.jsonl`)
}

export function getSessionWorkspaceDir(
  config: ServerConfig,
  sessionId: string,
): string {
  return join(getSessionDir(config, sessionId), 'workspace')
}

export function getSessionRuntimeMountDirs(
  config: ServerConfig,
  sessionId: string,
): string[] {
  return [getSessionDir(config, sessionId)]
}

export function resolveSessionWorkspaceDir(
  config: ServerConfig,
  sessionId: string,
  requestedCwd?: string,
): string {
  return (
    requestedCwd?.trim() ||
    config.workspace ||
    getSessionWorkspaceDir(config, sessionId)
  )
}

export function getSessionProfileDir(
  config: ServerConfig,
  sessionId: string,
): string {
  return join(getSessionDir(config, sessionId), 'profile')
}

export function getUserProfileDir(config: ServerConfig, userId: string): string {
  return join(config.dataDir, 'profiles', 'users', userId)
}

export function getProfileDir(
  config: ServerConfig,
  sessionId: string,
  userId: string,
  profileMode: SessionProfileMode,
): string {
  return profileMode === 'user'
    ? getUserProfileDir(config, userId)
    : getSessionProfileDir(config, sessionId)
}

export function getAttemptDir(
  config: ServerConfig,
  sessionId: string,
  attemptId: string,
): string {
  return join(getSessionDir(config, sessionId), 'attempts', attemptId)
}

export function getAttachPath(config: ServerConfig, attemptId: string): string {
  return join(config.runDir, 'sockets', `${attemptId}.sock`)
}

export function getRuntimeStatusPath(attemptDir: string): string {
  return join(attemptDir, 'status.json')
}

export function getRuntimeStdoutLogPath(attemptDir: string): string {
  return join(attemptDir, 'stdout.log')
}

export function getRuntimeStderrLogPath(attemptDir: string): string {
  return join(attemptDir, 'stderr.log')
}

export function getAttemptManifestPath(attemptDir: string): string {
  return join(attemptDir, 'manifest.json')
}

export function getDockerBackendManifestPath(attemptDir: string): string {
  return join(attemptDir, 'docker-backend.json')
}
