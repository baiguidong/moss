import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import net from 'net'
import { spawn } from 'child_process'
import { join } from 'path'
import { MOSS_SERVER_HOME } from './lib/env.js'
import { DirectConnectStore, openDirectConnectStore, toSessionSummary } from './db.js'
import { getSystemSettings } from './systemSettings.js'
import type {
  AttemptRecord,
  RunnerManifest,
  ServerConfig,
  SessionCreateInput,
  SessionRecord,
  SessionSummary,
} from './types.js'
import {
  getAttachPath,
  getAttemptManifestPath,
  getAttemptDir,
  getDockerBackendManifestPath,
  getProfileDir,
  getRuntimeStatusPath,
  getRuntimeStderrLogPath,
  getRuntimeStdoutLogPath,
  getSessionRuntimeMountDirs,
  resolveSessionWorkspaceDir,
  getSessionTranscriptDir,
  getTranscriptPath,
} from './runtimePaths.js'
import { errorMessage } from './lib/json.js'
import type {
  SessionRuntimeInfo,
} from '../../packages/direct-connect-protocol/src/index.js'

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function resolveRunnerEntryPath(): string {
  const candidates = [
    join(MOSS_SERVER_HOME, 'bin', 'moss-session-runner.mjs'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(
    `Missing moss-session-runner.mjs. Build or install it to ${join(MOSS_SERVER_HOME, 'bin')}.`,
  )
}

async function readRunnerFailure(
  statusPath: string,
  stderrLogPath: string,
): Promise<string | null> {
  let statusError: string | null = null
  try {
    if (existsSync(statusPath)) {
      const raw = await readFile(statusPath, 'utf8')
      const parsed = JSON.parse(raw) as {
        state?: string
        error?: string
        code?: number | null
        signal?: string | null
      }
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        statusError = parsed.error.trim()
      } else if (
        parsed.state === 'failed' ||
        (typeof parsed.code === 'number' && parsed.code !== 0)
      ) {
        statusError = `Runner failed before attach (code=${parsed.code ?? 'null'}, signal=${parsed.signal ?? 'null'})`
      }
    }
  } catch {}

  let stderrTail: string | null = null
  try {
    if (existsSync(stderrLogPath)) {
      const stderr = (await readFile(stderrLogPath, 'utf8')).trim()
      if (stderr) {
        const lines = stderr.split('\n')
        stderrTail = lines.slice(-20).join('\n').trim() || null
      }
    }
  } catch {}

  if (statusError && stderrTail) {
    return `${statusError}\n${stderrTail}`
  }
  return statusError || stderrTail || null
}

async function waitForRunnerReady(
  attachPath: string,
  statusPath: string,
  stderrLogPath: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (existsSync(attachPath)) {
      return
    }
    const failure = await readRunnerFailure(statusPath, stderrLogPath)
    if (failure) {
      throw new Error(failure)
    }
    await wait(100)
  }
  const failure = await readRunnerFailure(statusPath, stderrLogPath)
  if (failure) {
    throw new Error(failure)
  }
  throw new Error(`Timed out waiting for runner socket at ${attachPath}`)
}

export async function probeAttachPath(
  attachPath: string,
  timeoutMs: number,
): Promise<boolean> {
  if (!existsSync(attachPath)) {
    return false
  }
  return await new Promise<boolean>(resolve => {
    const socket = net.createConnection(attachPath)
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

type RuntimeServiceOptions = {
  config: ServerConfig
  store?: DirectConnectStore
  serverInstanceId: string
}

export class RuntimeService {
  readonly store: DirectConnectStore
  private readonly pendingEnsures = new Map<string, Promise<AttemptRecord>>()

  constructor(private readonly options: RuntimeServiceOptions) {
    this.store = options.store ?? openDirectConnectStore(options.config)
  }

  listSessions(filter: {
    orgId: string
    userId?: string
    activeOnly?: boolean
  }): SessionSummary[] {
    return this.store.listSessions({
      orgId: filter.orgId,
      userId: filter.userId,
      activeOnly: filter.activeOnly,
    })
  }

  listSessionRecords(filter: {
    orgId: string
    userId?: string
    activeOnly?: boolean
  }): SessionRecord[] {
    return this.store.listSessionRecords({
      orgId: filter.orgId,
      userId: filter.userId,
      activeOnly: filter.activeOnly,
    })
  }

  getSession(sessionId: string): SessionRecord | null {
    return this.store.getSession(sessionId)
  }

  countActiveSessions(): number {
    return this.store.countActiveSessions()
  }

  async createSession(input: SessionCreateInput): Promise<SessionRecord> {
    const active = this.store.listSessions({
      orgId: input.orgId,
      activeOnly: true,
    })
    if (
      this.options.config.maxSessions > 0 &&
      active.length >= this.options.config.maxSessions
    ) {
      throw new Error(
        `Maximum concurrent sessions reached (${this.options.config.maxSessions})`,
      )
    }

    const sessionId = randomUUID()
    const settings = getSystemSettings()
    const runtimeSettings = settings.serverRuntime
    const profileMode = input.profileMode ?? runtimeSettings.defaultProfileMode
    if (!runtimeSettings.allowedProfileModes.includes(profileMode)) {
      throw new Error(`Profile mode "${profileMode}" is not allowed by server settings`)
    }
    if (runtimeSettings.backend === 'docker' && !runtimeSettings.dockerImage.trim()) {
      throw new Error('Docker backend is enabled but no docker image is configured')
    }
    const transcriptPath = getTranscriptPath(
      this.options.config,
      sessionId,
      sessionId,
    )
    const workspaceDir = resolveSessionWorkspaceDir(
      this.options.config,
      sessionId,
      input.userId,
      profileMode,
      input.cwd,
    )
    const runtime: SessionRuntimeInfo = {
      backend: runtimeSettings.backend,
      profileMode,
      dockerImage:
        runtimeSettings.backend === 'docker'
          ? runtimeSettings.dockerImage.trim()
          : undefined,
      profileDir: getProfileDir(
        this.options.config,
        sessionId,
        input.userId,
        profileMode,
      ),
      transcriptDir: getSessionTranscriptDir(this.options.config, sessionId),
      workspaceDir,
    }
    await Promise.all([
      mkdir(runtime.profileDir, { recursive: true }),
      mkdir(runtime.transcriptDir, { recursive: true }),
      mkdir(workspaceDir, { recursive: true }),
    ])
    const created = this.store.createSession({
      sessionId,
      transcriptSessionId: sessionId,
      transcriptPath,
      userId: input.userId,
      orgId: input.orgId,
      role: input.role,
      scopes: input.scopes,
      cwd: workspaceDir,
      runtime,
      status: 'creating',
      desiredState: 'active',
      assistantName: input.assistantName,
    })

    try {
      await this.spawnAttempt(created, {
        dangerouslySkipPermissions: input.dangerouslySkipPermissions,
        assistantName: input.assistantName,
      })
    } catch (error) {
      this.store.markSessionEnded(created.sessionId, 'failed', 'active')
      throw error
    }
    return this.store.getSession(created.sessionId) ?? created
  }

  async ensureSessionReady(
    sessionId: string,
  ): Promise<{
    session: SessionRecord
    attempt: AttemptRecord
  }> {
    const session = this.store.getSession(sessionId)
    if (!session) {
      throw new Error('Session not found')
    }
    const attempt = await this.ensureAttempt(session)
    return { session: this.store.getSession(sessionId) ?? session, attempt }
  }

  async reconcileOnStartup(): Promise<void> {
    const sessions = this.store.listSessionsToRecover()
    for (const session of sessions) {
      try {
        await this.ensureAttempt(session)
      } catch (error) {
        this.store.addEvent(session.sessionId, session.currentAttemptId, 'reconcile_failed', {
          error: errorMessage(error),
        })
      }
    }
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId)
    if (!session) return
    const attempt = this.store.getCurrentAttempt(sessionId)
    this.store.setSessionLifecycle(sessionId, 'terminated', 'terminated')
    this.store.addEvent(sessionId, attempt?.attemptId ?? null, 'session_terminate_requested', {})
    if (attempt?.runnerPid) {
      try {
        process.kill(attempt.runnerPid, 'SIGTERM')
      } catch {}
    }
  }

  async connectToAttempt(attempt: AttemptRecord): Promise<net.Socket> {
    if (!attempt.attachPath) {
      throw new Error('Attempt has no attach path')
    }
    const attachPath = attempt.attachPath
    return await new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection(attachPath)
      socket.once('connect', () => resolve(socket))
      socket.once('error', reject)
    })
  }

  private async ensureAttempt(session: SessionRecord): Promise<AttemptRecord> {
    const pending = this.pendingEnsures.get(session.sessionId)
    if (pending) {
      return pending
    }

    const ensurePromise = this.ensureAttemptInternal(session).finally(() => {
      if (this.pendingEnsures.get(session.sessionId) === ensurePromise) {
        this.pendingEnsures.delete(session.sessionId)
      }
    })
    this.pendingEnsures.set(session.sessionId, ensurePromise)
    return ensurePromise
  }

  private async ensureAttemptInternal(
    session: SessionRecord,
  ): Promise<AttemptRecord> {
    const existing = session.currentAttemptId
      ? this.store.getAttempt(session.currentAttemptId)
      : null
    if (existing?.attachPath) {
      const healthy = await probeAttachPath(
        existing.attachPath,
        this.options.config.reattachProbeTimeoutMs,
      )
      if (healthy) {
        this.store.setSessionLifecycle(session.sessionId, 'active', session.desiredState)
        return existing
      }
      this.store.markAttemptLost(existing.attemptId, 'attach socket unavailable')
      this.store.addEvent(session.sessionId, existing.attemptId, 'attempt_lost', {
        reason: 'attach_socket_unavailable',
      })
      this.store.setSessionLifecycle(session.sessionId, 'lost', 'active')
    }

    if (!this.options.config.resumeOnMissingRuntime) {
      throw new Error(`Runtime missing for session ${session.sessionId}`)
    }

    return await this.spawnAttempt(session, {
      resumeTranscriptSessionId: session.transcriptSessionId,
    })
  }

  private async spawnAttempt(
    session: SessionRecord,
    options: {
      dangerouslySkipPermissions?: boolean
      resumeTranscriptSessionId?: string
      assistantName?: string
    } = {},
  ): Promise<AttemptRecord> {
    const generation = this.store.getNextGeneration(session.sessionId)
    const attemptId = randomUUID()
    const attemptDir = getAttemptDir(this.options.config, session.sessionId, attemptId)
    const attachPath = getAttachPath(this.options.config, attemptId)
    const manifestPath = getAttemptManifestPath(attemptDir)
    const backendManifestPath = getDockerBackendManifestPath(attemptDir)
    const stdoutLogPath = getRuntimeStdoutLogPath(attemptDir)
    const stderrLogPath = getRuntimeStderrLogPath(attemptDir)
    const statusPath = getRuntimeStatusPath(attemptDir)
    const settings = getSystemSettings()
    const mountDirs =
      session.runtime.backend === 'docker'
        ? getSessionRuntimeMountDirs(
            this.options.config,
            session.sessionId,
            session.runtime.profileMode,
            session.runtime.profileMode === 'user'
              ? this.store
                  .listUserSessions(session.orgId, session.userId)
                  .map(userSession => userSession.sessionId)
              : [],
          )
        : undefined
    const dangerouslySkipPermissions =
      options.dangerouslySkipPermissions === true ||
      settings.bypassPermissions === true
    await mkdir(attemptDir, { recursive: true })
    const attempt = this.store.createAttempt({
      attemptId,
      sessionId: session.sessionId,
      generation,
      backendType: session.runtime.backend,
      resumeTranscriptSessionId:
        options.resumeTranscriptSessionId ?? session.transcriptSessionId,
      serverInstanceId: this.options.serverInstanceId,
      containerName:
        session.runtime.backend === 'docker'
          ? `moss-session-${session.sessionId.slice(0, 12)}-${attemptId.slice(0, 8)}`
          : undefined,
      attemptDir,
      manifestPath,
      attachPath,
    })
    this.store.setCurrentAttempt(session.sessionId, attempt.attemptId)

    const manifest: RunnerManifest = {
      config: this.options.config,
      session: {
        sessionId: session.sessionId,
        transcriptSessionId:
          options.resumeTranscriptSessionId ?? session.transcriptSessionId,
        resumeFromTranscript: Boolean(options.resumeTranscriptSessionId),
        cwd: session.cwd,
        transcriptPath: session.transcriptPath,
        userId: session.userId,
        orgId: session.orgId,
        role: session.role,
        scopes: session.scopes,
        dangerouslySkipPermissions,
        assistantName: options.assistantName,
        mountDirs,
        runtime: {
          ...session.runtime,
          containerName:
            session.runtime.backend === 'docker'
              ? `moss-session-${session.sessionId.slice(0, 12)}-${attemptId.slice(0, 8)}`
              : session.runtime.containerName,
        },
      },
      attempt: {
        attemptId: attempt.attemptId,
        generation,
        attemptDir,
        backendManifestPath,
        attachPath,
        stdoutLogPath,
        stderrLogPath,
        statusPath,
      },
    }

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    const runnerEntryPath = resolveRunnerEntryPath()
    const child = spawn(process.execPath, [runnerEntryPath, manifestPath], {
      detached: true,
      stdio: 'ignore',
      cwd: session.cwd,
    })
    child.unref()
    if (!child.pid) {
      throw new Error('Failed to spawn session runner')
    }
    this.store.updateAttemptRunner(attempt.attemptId, child.pid)
    await waitForRunnerReady(attachPath, statusPath, stderrLogPath, 5_000)
    this.store.setSessionLifecycle(session.sessionId, 'active', 'active')
    this.store.addEvent(session.sessionId, attempt.attemptId, 'attempt_spawned', {
      runnerPid: child.pid,
      generation,
      attachPath,
    })
    return this.store.getAttempt(attempt.attemptId) ?? attempt
  }
}

export function toSummary(session: SessionRecord): SessionSummary {
  return toSessionSummary(session)
}
