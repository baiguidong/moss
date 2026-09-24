import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { chmod, mkdir, readFile, writeFile } from 'fs/promises'
import net from 'net'
import { join } from 'path'
import type { SessionRuntimeInfo } from '../../packages/direct-connect-protocol/src/index.js'
import {
  normalizeAdvancedSettings,
  normalizeAutoMemorySettings,
  normalizeSessionMemorySettings,
  normalizeSessionRuntimeOptions,
} from '../../packages/direct-connect-protocol/src/index.js'
import { MOSS_SERVER_ASSET_ROOT } from './lib/env.js'
import { errorMessage } from './lib/json.js'
import {
  SessionRepository,
  toSessionSummary,
} from './model/repositories/session.js'
import {
  getAttachPath,
  getAttemptDir,
  getAttemptManifestPath,
  getDockerBackendManifestPath,
  getRuntimeStatusPath,
  getRuntimeStderrLogPath,
  getRuntimeStdoutLogPath,
  getSessionRuntimeMountDirs,
  getSessionTranscriptDir,
  getTranscriptPath,
  getUserProfileDir,
  resolveSessionWorkspaceDir,
} from './runtimePaths.js'
import { SessionTurnLock } from './sessionTurnLock.js'
import { getSystemSettings } from './systemSettings.js'
import { cloneSessionTranscript } from './transcript.js'
import type {
  AttemptRecord,
  RunnerManifest,
  ServerConfig,
  SessionCreateInput,
  SessionForkInput,
  SessionRecord,
  SessionSummary,
} from './types.js'

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function resolveRunnerEntryPath(): string {
  const candidates = [
    join(MOSS_SERVER_ASSET_ROOT, 'bin', 'moss-session-runner.mjs'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(
    `Missing moss-session-runner.mjs. Build or install it to ${join(MOSS_SERVER_ASSET_ROOT, 'bin')}.`,
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
  processFailure: () => Error | null,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const exited = processFailure()
    if (exited) throw exited
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
  store: SessionRepository
  serverInstanceId: string
  runnerStartupTimeoutMs?: number
}

export class RuntimeService {
  readonly store: SessionRepository
  private readonly pendingEnsures = new Map<string, Promise<AttemptRecord>>()
  private readonly sessionTurnLock = new SessionTurnLock()

  constructor(private readonly options: RuntimeServiceOptions) {
    this.store = options.store
  }

  async listSessions(filter: {
    orgId: string
    userId?: string
    activeOnly?: boolean
  }): Promise<SessionSummary[]> {
    return await this.store.listSessions({
      orgId: filter.orgId,
      userId: filter.userId,
      activeOnly: filter.activeOnly,
    })
  }

  async listSessionRecords(filter: {
    orgId: string
    userId?: string
    activeOnly?: boolean
  }): Promise<SessionRecord[]> {
    return await this.store.listSessionRecords({
      orgId: filter.orgId,
      userId: filter.userId,
      activeOnly: filter.activeOnly,
    })
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    return await this.store.getSession(sessionId)
  }

  async countActiveSessions(): Promise<number> {
    return await this.store.countActiveSessions()
  }

  async createSession(input: SessionCreateInput): Promise<SessionRecord> {
    const active = await this.store.listSessions({
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
    const normalizedAutoMemory = input.autoMemory
      ? normalizeAutoMemorySettings(input.autoMemory)
      : undefined
    const normalizedAdvancedSettings = input.advancedSettings
      ? normalizeAdvancedSettings(input.advancedSettings)
      : undefined
    const dockerImage = runtimeSettings.dockerImage.trim()
    if (!dockerImage) {
      throw new Error('Docker runtime image is not configured')
    }
    const transcriptPath = getTranscriptPath(
      this.options.config,
      sessionId,
      sessionId,
    )
    const workspaceDir = resolveSessionWorkspaceDir(
      this.options.config,
      sessionId,
      input.cwd,
    )
    const runtime: SessionRuntimeInfo = {
      backend: 'docker',
      dockerImage,
      profileDir: getUserProfileDir(this.options.config, input.userId),
      transcriptDir: getSessionTranscriptDir(this.options.config, sessionId),
      workspaceDir,
    }
    await Promise.all([
      mkdir(runtime.profileDir, { recursive: true }),
      mkdir(runtime.transcriptDir, { recursive: true }),
      mkdir(workspaceDir, { recursive: true }),
    ])
    const created = await this.store.db.transaction(async () => {
      const created = await this.store.createSession({
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
        title: input.title,
        assistantName: input.assistantName,
        advancedSettings: normalizedAdvancedSettings,
        autoMemory: normalizedAutoMemory,
        sessionMemory: input.sessionMemory
          ? normalizeSessionMemorySettings(input.sessionMemory)
          : undefined,
        runtimeOptions: normalizeSessionRuntimeOptions(input.runtimeOptions),
      })

      if (input.scheduledTask) {
        await this.store.db.prepare('INSERT INTO cron_session_links (session_id,task_id,source_session_id) VALUES (?,?,?)')
          .run(created.sessionId, input.scheduledTask.taskId, input.scheduledTask.sourceSessionId)
        created.sessionKind = 'cron'
        created.cronTaskId = input.scheduledTask.taskId
        created.sourceSessionId = input.scheduledTask.sourceSessionId
      }
      return created
    })

    try {
      await this.spawnAttempt(created, {
        dangerouslySkipPermissions: input.dangerouslySkipPermissions,
        assistantName: input.assistantName,
      })
    } catch (error) {
      await this.store.markSessionEnded(created.sessionId, 'failed', 'terminated')
      await this.store.deleteSession(created.sessionId)
      throw error
    }
    return (await this.store.getSession(created.sessionId)) ?? created
  }

  async forkSession(
    sourceSessionId: string,
    input: SessionForkInput,
  ): Promise<SessionRecord> {
    const source = await this.store.getSession(sourceSessionId)
    if (!source) {
      throw new Error('Session not found')
    }
    const active = await this.store.listSessions({
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
    const transcriptPath = getTranscriptPath(
      this.options.config,
      sessionId,
      sessionId,
    )
    const transcriptDir = getSessionTranscriptDir(
      this.options.config,
      sessionId,
    )
    const profileDir = getUserProfileDir(this.options.config, input.userId)
    const dockerImage = getSystemSettings().serverRuntime.dockerImage.trim()
    if (!dockerImage) {
      throw new Error('Docker runtime image is not configured')
    }
    const title = input.title?.trim() || `${source.title || 'Session'} (Fork)`
    const runtime: SessionRuntimeInfo = {
      ...source.runtime,
      backend: 'docker',
      dockerImage,
      profileDir,
      transcriptDir,
      containerName: undefined,
    }

    await Promise.all([
      mkdir(profileDir, { recursive: true }),
      mkdir(transcriptDir, { recursive: true }),
      mkdir(source.cwd, { recursive: true }),
    ])
    await cloneSessionTranscript(
      source.transcriptPath,
      transcriptPath,
      source.transcriptSessionId,
      sessionId,
      title,
    )

    const created = await this.store.createSession({
      sessionId,
      transcriptSessionId: sessionId,
      transcriptPath,
      userId: input.userId,
      orgId: input.orgId,
      role: input.role,
      scopes: input.scopes,
      cwd: source.cwd,
      runtime,
      status: 'creating',
      desiredState: 'active',
      title,
      assistantName: source.assistantName ?? undefined,
      advancedSettings: source.advancedSettings,
      autoMemory: source.autoMemory,
      sessionMemory: source.sessionMemory,
      runtimeOptions: source.runtimeOptions,
    })

    try {
      await this.spawnAttempt(created, {
        dangerouslySkipPermissions: input.dangerouslySkipPermissions,
        resumeTranscriptSessionId: sessionId,
        assistantName: source.assistantName ?? undefined,
      })
    } catch (error) {
      await this.store.markSessionEnded(created.sessionId, 'failed', 'terminated')
      await this.store.deleteSession(created.sessionId)
      throw error
    }
    return (await this.store.getSession(created.sessionId)) ?? created
  }

  async ensureSessionReady(sessionId: string): Promise<{
    session: SessionRecord
    attempt: AttemptRecord
  }> {
    const session = await this.store.getSession(sessionId)
    if (!session) {
      throw new Error('Session not found')
    }
    const attempt = await this.ensureAttempt(session)
    return {
      session: (await this.store.getSession(sessionId)) ?? session,
      attempt,
    }
  }

  async reconcileOnStartup(): Promise<void> {
    const sessions = await this.store.listSessionsToRecover()
    for (const session of sessions) {
      try {
        await this.ensureAttempt(session)
      } catch (error) {
        await this.store.addEvent(
          session.sessionId,
          session.currentAttemptId,
          'reconcile_failed',
          {
            error: errorMessage(error),
          },
        )
      }
    }
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = await this.store.getSession(sessionId)
    if (!session) return
    const attempt = await this.store.getCurrentAttempt(sessionId)
    await this.store.setSessionLifecycle(sessionId, 'terminated', 'terminated')
    await this.store.addEvent(
      sessionId,
      attempt?.attemptId ?? null,
      'session_terminate_requested',
      {},
    )
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

  async deleteSession(sessionId: string): Promise<void> {
    await this.terminateSession(sessionId)
    await this.store.deleteSession(sessionId)
  }

  async acquireSessionTurn(sessionId: string): Promise<() => void> {
    return await this.sessionTurnLock.acquire(sessionId)
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
      ? await this.store.getAttempt(session.currentAttemptId)
      : null
    if (existing?.attachPath) {
      const healthy = await probeAttachPath(
        existing.attachPath,
        this.options.config.reattachProbeTimeoutMs,
      )
      if (healthy) {
        await this.store.setSessionLifecycle(
          session.sessionId,
          'active',
          session.desiredState,
        )
        return existing
      }
      await this.store.markAttemptLost(
        existing.attemptId,
        'attach socket unavailable',
      )
      await this.store.addEvent(
        session.sessionId,
        existing.attemptId,
        'attempt_lost',
        {
          reason: 'attach_socket_unavailable',
        },
      )
      await this.store.setSessionLifecycle(session.sessionId, 'lost', 'active')
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
    const attemptId = randomUUID()
    const attemptDir = getAttemptDir(
      this.options.config,
      session.sessionId,
      attemptId,
    )
    const attachPath = getAttachPath(this.options.config, attemptId)
    const manifestPath = getAttemptManifestPath(attemptDir)
    const backendManifestPath = getDockerBackendManifestPath(attemptDir)
    const stdoutLogPath = getRuntimeStdoutLogPath(attemptDir)
    const stderrLogPath = getRuntimeStderrLogPath(attemptDir)
    const statusPath = getRuntimeStatusPath(attemptDir)
    const settings = getSystemSettings()
    const mountDirs = getSessionRuntimeMountDirs(
      this.options.config,
      session.sessionId,
    )
    const dangerouslySkipPermissions = session.sessionKind !== 'cron' && (
      options.dangerouslySkipPermissions === true ||
      settings.bypassPermissions === true
    )
    await mkdir(attemptDir, { recursive: true })
    const attempt = await this.store.createNextAttempt({
      attemptId,
      sessionId: session.sessionId,
      resumeTranscriptSessionId:
        options.resumeTranscriptSessionId ?? session.transcriptSessionId,
      serverInstanceId: this.options.serverInstanceId,
      containerName: `moss-session-${session.sessionId.slice(0, 12)}-${attemptId.slice(0, 8)}`,
      attemptDir,
      manifestPath,
      attachPath,
    })
    const generation = attempt.generation

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
        unattended: session.sessionKind === 'cron',
        assistantName: options.assistantName ?? session.assistantName ?? undefined,
        advancedSettings: session.advancedSettings
          ? normalizeAdvancedSettings(session.advancedSettings)
          : undefined,
        autoMemory: session.autoMemory
          ? normalizeAutoMemorySettings(session.autoMemory)
          : undefined,
        sessionMemory: session.sessionMemory
          ? normalizeSessionMemorySettings(session.sessionMemory)
          : undefined,
        runtimeOptions: normalizeSessionRuntimeOptions(session.runtimeOptions),
        mountDirs,
        runtime: {
          ...session.runtime,
          backend: 'docker',
          containerName: `moss-session-${session.sessionId.slice(0, 12)}-${attemptId.slice(0, 8)}`,
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

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await chmod(manifestPath, 0o600)

    const runnerEntryPath = resolveRunnerEntryPath()
    const child = spawn(process.execPath, [runnerEntryPath, manifestPath], {
      detached: true,
      stdio: 'ignore',
      cwd: session.cwd,
    })
    let spawnError: Error | null = null
    const onError = (error: Error) => { spawnError = error }
    child.on('error', onError)
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
    try {
      if (!child.pid) throw new Error('Failed to spawn session runner')
      await this.store.updateAttemptRunner(attempt.attemptId, child.pid)
      const current = await this.store.getSession(session.sessionId)
      if (!current || current.desiredState !== 'active') {
        throw new Error('Session was deleted or terminated during startup')
      }
      await waitForRunnerReady(
        attachPath, statusPath, stderrLogPath,
        this.options.runnerStartupTimeoutMs ?? 30_000,
        () => spawnError ?? (child.exitCode !== null || child.signalCode !== null
          ? new Error(`Runner exited before attach (code=${child.exitCode}, signal=${child.signalCode})`)
          : null),
      )
      // A concurrent delete may have missed the PID before it was persisted.
      // Activate only the current, still-wanted attempt; otherwise reap it below.
      const activated = await this.store.db.prepare(`UPDATE sessions
        SET status='active', desired_state='active', last_active_at=?, ended_at=NULL
        WHERE session_id=? AND current_attempt_id=? AND deleted_at IS NULL AND desired_state='active'`)
        .run(Date.now(), session.sessionId, attempt.attemptId)
      if (!activated.changes) throw new Error('Session was deleted or terminated during startup')
    } catch (error) {
      // Stop and reap the unready runner before recording failure; it must not
      // become ready later and revive an unsuccessful session creation.
      child.kill('SIGTERM')
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 1_000)
      try { await closed } finally { clearTimeout(forceKill) }
      await this.store.markAttemptStopped(attempt.attemptId, {
        runtimeState: 'failed', stopReason: 'startup_failed', errorText: errorMessage(error),
        exitCode: child.exitCode, exitSignal: child.signalCode,
      })
      throw error
    } finally {
      child.off('error', onError)
    }
    child.unref()
    await this.store.addEvent(
      session.sessionId,
      attempt.attemptId,
      'attempt_spawned',
      {
        runnerPid: child.pid,
        generation,
        attachPath,
      },
    )
    return (await this.store.getAttempt(attempt.attemptId)) ?? attempt
  }
}

export function toSummary(session: SessionRecord): SessionSummary {
  return toSessionSummary(session)
}
