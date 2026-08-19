import { z } from 'zod/v4'

export type SessionRuntimeType = 'host' | 'docker'

export type SessionRuntimeOptions = {
  type?: SessionRuntimeType
  dockerImage?: string
  dockerMode?: 'session' | 'user'
  configDir?: string
  containerName?: string
}

export type SessionRuntimeInfo = {
  type: SessionRuntimeType
  dockerImage?: string
  dockerMode?: 'session' | 'user'
  containerName?: string
  configDir?: string
}

function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= factory())
}

export const runtimeInfoSchema = lazySchema(() =>
  z.object({
    type: z.enum(['host', 'docker']),
    dockerImage: z.string().optional(),
    dockerMode: z.enum(['session', 'user']).optional(),
    containerName: z.string().optional(),
    configDir: z.string().optional(),
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
