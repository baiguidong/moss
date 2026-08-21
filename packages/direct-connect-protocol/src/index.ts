import { z } from 'zod/v4'

export type SessionRuntimeBackend = 'host' | 'docker'
export type SessionProfileMode = 'session' | 'user'

export type SessionRuntimeOptions = {
  profileMode?: SessionProfileMode
}

export type SessionRuntimeInfo = {
  backend: SessionRuntimeBackend
  profileMode: SessionProfileMode
  dockerImage?: string
  containerName?: string
  profileDir: string
  transcriptDir: string
  workspaceDir?: string
}

function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= factory())
}

export const runtimeInfoSchema = lazySchema(() =>
  z.object({
    backend: z.enum(['host', 'docker']),
    profileMode: z.enum(['session', 'user']),
    dockerImage: z.string().optional(),
    containerName: z.string().optional(),
    profileDir: z.string(),
    transcriptDir: z.string(),
    workspaceDir: z.string().optional(),
  }),
)

export const connectResponseSchema = lazySchema(() =>
  z.object({
    session_id: z.string(),
    ws_url: z.string(),
    work_dir: z.string().optional(),
    runtime: runtimeInfoSchema().optional(),
  }),
)

export const attachSessionResponseSchema = lazySchema(() =>
  z.object({
    session: z.object({
      sessionId: z.string(),
      transcriptSessionId: z.string(),
      workDir: z.string(),
      userId: z.string(),
      orgId: z.string(),
      role: z.string(),
      scopes: z.array(z.string()),
      runtime: runtimeInfoSchema(),
      status: z.string(),
      desiredState: z.string(),
      createdAt: z.number(),
      lastActiveAt: z.number(),
      endedAt: z.number().nullable().optional(),
    }),
    ws_url: z.string(),
  }),
)

export { buildConnectUrl, parseConnectUrl } from './connectUrl.js'
