import { z } from 'zod/v4'
import type {
  AdvancedSettings,
  AutoMemorySettings,
  SessionMemorySettings,
  SessionRuntimeOptions,
  SessionRuntimeInfo,
} from '../../packages/direct-connect-protocol/src/index.js'

function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= factory())
}

export const serverFileConfigSchema = lazySchema(() =>
  z.object({
    server: z.object({
      host: z.string().default('0.0.0.0'),
      port: z.number().int().min(0).default(43127),
      advertisedHost: z.string().min(1).optional(),
      publicUrl: z.string().url().optional(),
    }).default({
      host: '0.0.0.0',
      port: 43127,
    }),
    auth: z.object({
      mode: z.enum(['local', 'auth-center']).default('local'),
      tokenTtlSec: z.number().int().min(60).default(60 * 60),
      authCenterUrl: z.string().min(1).optional(),
    }).default({
      mode: 'local',
      tokenTtlSec: 60 * 60,
    }),
    bootstrapAdmin: z.object({
      username: z.string().min(1).default('admin'),
      password: z.string().min(1).optional(),
      email: z.string().min(1).optional(),
    }).default({
      username: 'admin',
    }),
    storage: z.object({
      rootDir: z.string().min(1).optional(),
      dbPath: z.string().min(1).optional(),
      dataDir: z.string().min(1).optional(),
      runDir: z.string().min(1).optional(),
      logDir: z.string().min(1).optional(),
    }).default({}),
    runtimeDefaults: z.object({
      workspace: z.string().optional(),
      idleTimeoutMs: z.number().int().min(0).default(10 * 60 * 1000),
      maxSessions: z.number().int().min(0).default(32),
    }).default({
      idleTimeoutMs: 10 * 60 * 1000,
      maxSessions: 32,
    }),
    docker: z.object({
      network: z.string().optional(),
      stopTimeoutSec: z.number().int().min(1).default(10),
      labels: z.record(z.string(), z.string()).default({}),
    }).default({
      stopTimeoutSec: 10,
      labels: {},
    }),
    recovery: z.object({
      startupPolicy: z.enum(['reattach-or-resume']).default('reattach-or-resume'),
      heartbeatTimeoutMs: z.number().int().min(1).default(30_000),
      reattachProbeTimeoutMs: z.number().int().min(1).default(3_000),
      resumeOnMissingRuntime: z.boolean().default(true),
    }).default({
      startupPolicy: 'reattach-or-resume',
      heartbeatTimeoutMs: 30_000,
      reattachProbeTimeoutMs: 3_000,
      resumeOnMissingRuntime: true,
    }),
    logging: z.object({
      level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
      auditFile: z.string().optional(),
    }).default({
      level: 'info',
    }),
    apps: z.object({
      sourceDir: z.string().min(1).optional(),
    }).default({}),
    ragflow: z.object({
      enabled: z.boolean().default(false),
      instanceId: z.string().min(1).default('default'),
      baseUrl: z.string().min(1).optional(),
      adminUrl: z.string().min(1).optional(),
      adminEmail: z.string().min(1).default('admin@ragflow.io'),
      adminPassword: z.string().min(1).optional(),
      gatewayToken: z.string().min(32).optional(),
      userDomain: z.string().min(3).default('ragflow.com'),
      passwordLength: z.number().int().min(6).max(64).default(6),
      requestTimeoutMs: z.number().int().min(1_000).default(15_000),
    }).default({
      enabled: false,
      instanceId: 'default',
      adminEmail: 'admin@ragflow.io',
      userDomain: 'ragflow.com',
      passwordLength: 6,
      requestTimeoutMs: 15_000,
    }),
    openim: z.object({
      enabled: z.boolean().default(false),
      instanceId: z.string().min(1).default('default'),
      apiUrl: z.string().min(1).optional(),
      wsUrl: z.string().min(1).optional(),
      chatUrl: z.string().min(1).optional(),
      adminUserId: z.string().min(1).default('imAdmin'),
      secret: z.string().min(1).optional(),
      webhookSecret: z.string().min(16).optional(),
      requestTimeoutMs: z.number().int().min(1_000).default(15_000),
    }).default({
      enabled: false,
      instanceId: 'default',
      adminUserId: 'imAdmin',
      requestTimeoutMs: 15_000,
    }),
  }),
)

export type ServerFileConfig = z.infer<ReturnType<typeof serverFileConfigSchema>>

export type ServerConfig = {
  host: string
  port: number
  advertisedHost?: string
  publicUrl?: string
  authMode: 'local'
  tokenTtlSec: number
  bootstrapAdmin: {
    username: string
    password?: string
    email?: string
  }
  workspace?: string
  idleTimeoutMs: number
  maxSessions: number
  rootDir: string
  dbPath: string
  dataDir: string
  runDir: string
  logDir: string
  dockerNetwork?: string
  dockerStopTimeoutSec: number
  dockerLabels: Record<string, string>
  startupPolicy: 'reattach-or-resume'
  heartbeatTimeoutMs: number
  reattachProbeTimeoutMs: number
  resumeOnMissingRuntime: boolean
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  auditFile?: string
  appSourceDir?: string
  ragflow: {
    enabled: boolean
    instanceId: string
    baseUrl?: string
    adminUrl?: string
    adminEmail: string
    adminPassword?: string
    gatewayToken?: string
    userDomain?: string
    passwordLength?: number
    requestTimeoutMs: number
  }
  openim?: {
    enabled: boolean
    instanceId: string
    apiUrl?: string
    wsUrl?: string
    chatUrl?: string
    adminUserId: string
    secret?: string
    webhookSecret?: string
    requestTimeoutMs: number
  }
}

export type SessionStatus =
  | 'creating'
  | 'active'
  | 'detached'
  | 'ended'
  | 'terminated'
  | 'failed'
  | 'lost'

export type DesiredSessionState = 'active' | 'ended' | 'terminated'

export type AttemptRuntimeState =
  | 'starting'
  | 'running'
  | 'detached'
  | 'stopped'
  | 'failed'
  | 'lost'

export type SessionRecord = {
  sessionId: string
  transcriptSessionId: string
  orgId: string
  userId: string
  role: string
  scopes: string[]
  cwd: string
  runtime: SessionRuntimeInfo
  status: SessionStatus
  desiredState: DesiredSessionState
  currentAttemptId: string | null
  transcriptPath: string
  title: string | null
  summary: string | null
  assistantName: string | null
  advancedSettings?: AdvancedSettings
  autoMemory?: AutoMemorySettings
  sessionMemory?: SessionMemorySettings
  runtimeOptions?: SessionRuntimeOptions
  createdAt: number
  lastActiveAt: number
  endedAt: number | null
  deletedAt: number | null
}

export type AttemptRecord = {
  attemptId: string
  sessionId: string
  generation: number
  backendType: 'docker'
  runtimeState: AttemptRuntimeState
  serverInstanceId: string | null
  runnerPid: number | null
  containerName: string | null
  attemptDir: string
  manifestPath: string
  attachPath: string | null
  resumeTranscriptSessionId: string
  startedAt: number
  lastHeartbeatAt: number | null
  stoppedAt: number | null
  exitCode: number | null
  exitSignal: string | null
  stopReason: string | null
  errorText: string | null
}

export type SessionEventRecord = {
  eventId: string
  sessionId: string
  attemptId: string | null
  eventType: string
  payload: Record<string, unknown>
  createdAt: number
}

export type ServerInstanceRecord = {
  instanceId: string
  host: string
  pid: number | null
  startedAt: number
  heartbeatAt: number
  stoppedAt: number | null
  status: 'running' | 'stopped'
}

export type SessionListFilter = {
  orgId: string
  userId?: string
  activeOnly?: boolean
  includeDeleted?: boolean
}

export type SessionSummary = {
  sessionId: string
  transcriptSessionId: string
  workDir: string
  userId: string
  orgId: string
  role: string
  scopes: string[]
  runtime: SessionRuntimeInfo
  status: SessionStatus
  desiredState: DesiredSessionState
  title: string | null
  summary: string | null
  assistantName: string | null
  createdAt: number
  lastActiveAt: number
  endedAt: number | null
}

export type SessionCreateInput = {
  cwd?: string
  title?: string
  dangerouslySkipPermissions: boolean
  userId: string
  orgId: string
  role: string
  scopes: string[]
  assistantName?: string
  advancedSettings?: AdvancedSettings
  autoMemory?: AutoMemorySettings
  sessionMemory?: SessionMemorySettings
  runtimeOptions?: SessionRuntimeOptions
}

export type SessionForkInput = {
  title?: string
  dangerouslySkipPermissions: boolean
  userId: string
  orgId: string
  role: string
  scopes: string[]
}

export type RunnerManifest = {
  config: ServerConfig
  session: {
    sessionId: string
    transcriptSessionId: string
    resumeFromTranscript: boolean
    cwd: string
    transcriptPath: string
    userId: string
    orgId: string
    role: string
    scopes: string[]
    dangerouslySkipPermissions: boolean
    mountDirs?: string[]
    runtime: SessionRuntimeInfo
    assistantName?: string
    advancedSettings?: AdvancedSettings
    autoMemory?: AutoMemorySettings
    sessionMemory?: SessionMemorySettings
    runtimeOptions?: SessionRuntimeOptions
  }
  attempt: {
    attemptId: string
    generation: number
    attemptDir: string
    backendManifestPath: string
    attachPath: string
    stdoutLogPath: string
    stderrLogPath: string
    statusPath: string
  }
}
