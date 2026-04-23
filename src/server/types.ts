import type { ChildProcess } from 'child_process'
import { z } from 'zod/v4'
import { lazySchema } from '../utils/lazySchema.js'
import type { SessionRuntimeInfo, SessionRuntimeType } from './sessionManager.js'

export const connectResponseSchema = lazySchema(() =>
  z.object({
    session_id: z.string(),
    ws_url: z.string(),
    work_dir: z.string().optional(),
    runtime: z
      .object({
        type: z.enum(['host', 'docker']),
        dockerImage: z.string().optional(),
        dockerMode: z.enum(['session', 'user']).optional(),
        containerName: z.string().optional(),
        configDir: z.string().optional(),
      })
      .optional(),
  }),
)

export type ServerConfig = {
  port: number
  host: string
  authMode: 'auth-center'
  authCenterUrl?: string
  unix?: string
  /** Idle timeout for detached sessions (ms). 0 = never expire. */
  idleTimeoutMs?: number
  /** Maximum number of concurrent sessions. */
  maxSessions?: number
  /** Default workspace directory for sessions that don't specify cwd. */
  workspace?: string
  defaultRuntime?: SessionRuntimeType
  dockerImage?: string
  dockerMode?: 'session' | 'user'
}

export type SessionState =
  | 'starting'
  | 'running'
  | 'detached'
  | 'stopping'
  | 'stopped'

export type SessionInfo = {
  id: string
  status: SessionState
  createdAt: number
  workDir: string
  process: ChildProcess | null
  sessionKey?: string
}

/**
 * Stable session key → session metadata. Persisted to ~/.claude/server-sessions.json
 * so sessions can be resumed across server restarts.
 */
export type SessionIndexEntry = {
  /** Server-assigned session ID (matches the subprocess's claude session). */
  sessionId: string
  /** The claude transcript session ID for --resume. Same as sessionId for direct sessions. */
  transcriptSessionId: string
  cwd: string
  permissionMode?: string
  createdAt: number
  lastActiveAt: number
  userId: string
  orgId: string
  role: string
  scopes: string[]
  runtime: SessionRuntimeInfo
}

export type SessionIndex = Record<string, SessionIndexEntry>
