import { randomUUID } from 'crypto'
import type {
  AdvancedSettings,
  AutoMemorySettings,
  SessionMemorySettings,
  SessionRuntimeOptions,
} from '../../../../packages/direct-connect-protocol/src/index.js'
import {
  advancedSettingsSchema,
  autoMemorySettingsSchema,
  normalizeAdvancedSettings,
  normalizeAutoMemorySettings,
  normalizeSessionMemorySettings,
  normalizeSessionRuntimeOptions,
  sessionMemorySettingsSchema,
} from '../../../../packages/direct-connect-protocol/src/index.js'
import type { SessionRuntimeInfo } from '../../backendTypes.js'
import type {
  AttemptRecord,
  AttemptRuntimeState,
  DesiredSessionState,
  ServerInstanceRecord,
  SessionEventRecord,
  SessionListFilter,
  SessionRecord,
  SessionStatus,
  SessionSummary,
} from '../../types.js'
import type { Database } from '../database.js'

type SqlRow = Record<string, unknown>

function now(): number {
  return Date.now()
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') {
    return []
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter(v => typeof v === 'string')
      : []
  } catch {
    return []
  }
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function parseAutoMemorySettings(
  value: unknown,
): AutoMemorySettings | undefined {
  const parsed = autoMemorySettingsSchema().safeParse(parseJsonValue(value))
  if (!parsed.success || Object.keys(parsed.data).length === 0) return undefined
  return normalizeAutoMemorySettings(parsed.data)
}

function parseAdvancedSettings(value: unknown): AdvancedSettings | undefined {
  const parsed = advancedSettingsSchema().safeParse(parseJsonValue(value))
  if (!parsed.success || Object.keys(parsed.data).length === 0) return undefined
  return normalizeAdvancedSettings(parsed.data)
}

function parseSessionMemorySettings(
  value: unknown,
): SessionMemorySettings | undefined {
  const parsed = sessionMemorySettingsSchema().safeParse(parseJsonValue(value))
  if (!parsed.success || Object.keys(parsed.data).length === 0) return undefined
  return normalizeSessionMemorySettings(parsed.data)
}

function mapRuntime(row: SqlRow): SessionRuntimeInfo {
  return {
    backend: 'docker',
    dockerImage:
      typeof row.docker_image === 'string' ? row.docker_image : undefined,
    containerName:
      typeof row.container_name === 'string' ? row.container_name : undefined,
    profileDir: String(row.profile_dir),
    transcriptDir: String(row.transcript_dir),
    workspaceDir:
      typeof row.workspace_dir === 'string' ? row.workspace_dir : undefined,
  }
}

function mapSession(row: SqlRow): SessionRecord {
  return {
    sessionId: String(row.session_id),
    ...(row.cron_task_id ? { sessionKind: 'cron' as const, cronTaskId: String(row.cron_task_id), sourceSessionId: String(row.cron_source_session_id) } : {}),
    transcriptSessionId: String(row.transcript_session_id),
    orgId: String(row.org_id),
    userId: String(row.user_id),
    role: String(row.role),
    scopes: parseJsonArray(row.scopes_json),
    cwd: String(row.cwd),
    runtime: mapRuntime(row),
    status: String(row.status) as SessionStatus,
    desiredState: String(row.desired_state) as DesiredSessionState,
    currentAttemptId:
      typeof row.current_attempt_id === 'string'
        ? row.current_attempt_id
        : null,
    transcriptPath: String(row.transcript_path),
    title: typeof row.title === 'string' ? row.title : null,
    summary: typeof row.summary === 'string' ? row.summary : null,
    assistantName:
      typeof row.assistant_name === 'string' ? row.assistant_name : null,
    advancedSettings: parseAdvancedSettings(row.advanced_settings_json),
    autoMemory: parseAutoMemorySettings(row.auto_memory_json),
    sessionMemory: parseSessionMemorySettings(row.session_memory_json),
    runtimeOptions: normalizeSessionRuntimeOptions(
      parseJsonValue(row.runtime_options_json),
    ),
    createdAt: Number(row.created_at),
    lastActiveAt: Number(row.last_active_at),
    endedAt: row.ended_at == null ? null : Number(row.ended_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  }
}

function mapAttempt(row: SqlRow): AttemptRecord {
  return {
    attemptId: String(row.attempt_id),
    sessionId: String(row.session_id),
    generation: Number(row.generation),
    backendType: 'docker',
    runtimeState: String(row.runtime_state) as AttemptRuntimeState,
    serverInstanceId:
      typeof row.server_instance_id === 'string'
        ? row.server_instance_id
        : null,
    runnerPid: row.runner_pid == null ? null : Number(row.runner_pid),
    containerName:
      typeof row.container_name === 'string' ? row.container_name : null,
    attemptDir: String(row.attempt_dir),
    manifestPath: String(row.manifest_path),
    attachPath: typeof row.attach_path === 'string' ? row.attach_path : null,
    resumeTranscriptSessionId: String(row.resume_transcript_session_id),
    startedAt: Number(row.started_at),
    lastHeartbeatAt:
      row.last_heartbeat_at == null ? null : Number(row.last_heartbeat_at),
    stoppedAt: row.stopped_at == null ? null : Number(row.stopped_at),
    exitCode: row.exit_code == null ? null : Number(row.exit_code),
    exitSignal: typeof row.exit_signal === 'string' ? row.exit_signal : null,
    stopReason: typeof row.stop_reason === 'string' ? row.stop_reason : null,
    errorText: typeof row.error_text === 'string' ? row.error_text : null,
  }
}

export class SessionRepository {
  constructor(readonly db: Database) {}

  async createNextAttempt(
    input: Omit<
      Parameters<SessionRepository['createAttempt']>[0],
      'generation'
    >,
  ): Promise<AttemptRecord> {
    return this.db.transaction(async () => {
      const generation = await this.getNextGeneration(input.sessionId)
      const attempt = await this.createAttempt({ ...input, generation })
      await this.setCurrentAttempt(input.sessionId, attempt.attemptId)
      return attempt
    })
  }

  async close(): Promise<void> {
    await this.db.close()
  }

  async registerServerInstance(
    host: string,
    pid = process.pid,
  ): Promise<ServerInstanceRecord> {
    const instanceId = randomUUID()
    const ts = now()
    await this.db
      .prepare(
        `
      INSERT INTO server_instances (
        instance_id, host, pid, started_at, heartbeat_at, status
      ) VALUES (?, ?, ?, ?, ?, 'running')
    `,
      )
      .run(instanceId, host, pid, ts, ts)
    return {
      instanceId,
      host,
      pid,
      startedAt: ts,
      heartbeatAt: ts,
      stoppedAt: null,
      status: 'running',
    }
  }

  async heartbeatServerInstance(instanceId: string): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE server_instances
      SET heartbeat_at = ?, status = 'running'
      WHERE instance_id = ?
    `,
      )
      .run(now(), instanceId)
  }

  async stopServerInstance(instanceId: string): Promise<void> {
    const ts = now()
    await this.db
      .prepare(
        `
      UPDATE server_instances
      SET heartbeat_at = ?, stopped_at = ?, status = 'stopped'
      WHERE instance_id = ?
    `,
      )
      .run(ts, ts, instanceId)
  }

  async createSession(input: {
    sessionId: string
    transcriptSessionId: string
    transcriptPath: string
    userId: string
    orgId: string
    role: string
    scopes: string[]
    cwd: string
    runtime: SessionRuntimeInfo
    status: SessionStatus
    desiredState: DesiredSessionState
    title?: string
    assistantName?: string
    advancedSettings?: AdvancedSettings
    autoMemory?: AutoMemorySettings
    sessionMemory?: SessionMemorySettings
    runtimeOptions?: SessionRuntimeOptions
  }): Promise<SessionRecord> {
    const ts = now()
    await this.db
      .prepare(
        `
      INSERT INTO sessions (
        session_id, transcript_session_id, org_id, user_id, role, scopes_json,
        cwd, docker_image, profile_dir,
        workspace_dir, transcript_dir, container_name,
        status, desired_state, transcript_path, title, assistant_name,
        advanced_settings_json, auto_memory_json, session_memory_json, runtime_options_json,
        created_at, last_active_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        input.sessionId,
        input.transcriptSessionId,
        input.orgId,
        input.userId,
        input.role,
        JSON.stringify(input.scopes),
        input.cwd,
        input.runtime.dockerImage ?? null,
        input.runtime.profileDir,
        input.runtime.workspaceDir ?? null,
        input.runtime.transcriptDir,
        input.runtime.containerName ?? null,
        input.status,
        input.desiredState,
        input.transcriptPath,
        input.title?.trim() || null,
        input.assistantName ?? null,
        JSON.stringify(input.advancedSettings ?? {}),
        JSON.stringify(input.autoMemory ?? {}),
        JSON.stringify(input.sessionMemory ?? {}),
        JSON.stringify(input.runtimeOptions ?? {}),
        ts,
        ts,
      )
    await this.addEvent(input.sessionId, null, 'session_created', {
      runtime: input.runtime,
      cwd: input.cwd,
      title: input.title,
      assistantName: input.assistantName,
    })
    return (await this.getSession(input.sessionId))!
  }

  async createAttempt(input: {
    attemptId: string
    sessionId: string
    generation: number
    resumeTranscriptSessionId: string
    serverInstanceId: string
    containerName?: string
    attemptDir: string
    manifestPath: string
    attachPath?: string
  }): Promise<AttemptRecord> {
    const ts = now()
    await this.db
      .prepare(
        `
      INSERT INTO session_attempts (
        attempt_id, session_id, generation, runtime_state,
        server_instance_id, runner_pid, container_name, attempt_dir,
        manifest_path, attach_path,
        resume_transcript_session_id, started_at, last_heartbeat_at
      ) VALUES (?, ?, ?, 'starting', ?, NULL, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        input.attemptId,
        input.sessionId,
        input.generation,
        input.serverInstanceId,
        input.containerName ?? null,
        input.attemptDir,
        input.manifestPath,
        input.attachPath ?? null,
        input.resumeTranscriptSessionId,
        ts,
        ts,
      )
    await this.addEvent(input.sessionId, input.attemptId, 'attempt_created', {
      generation: input.generation,
      backendType: 'docker',
      attachPath: input.attachPath,
      containerName: input.containerName,
      attemptDir: input.attemptDir,
      manifestPath: input.manifestPath,
    })
    return (await this.getAttempt(input.attemptId))!
  }

  async setCurrentAttempt(
    sessionId: string,
    attemptId: string | null,
  ): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE sessions
      SET current_attempt_id = ?
      WHERE session_id = ?
    `,
      )
      .run(attemptId, sessionId)
  }

  async setSessionLifecycle(
    sessionId: string,
    status: SessionStatus,
    desiredState: DesiredSessionState,
  ): Promise<void> {
    const ts = now()
    await this.db
      .prepare(
        `
      UPDATE sessions
      SET status = ?,
          desired_state = ?,
          last_active_at = ?,
          ended_at = CASE
            WHEN ? IN ('creating', 'active', 'detached', 'lost') THEN NULL
            ELSE ended_at
          END
      WHERE session_id = ?
    `,
      )
      .run(status, desiredState, ts, status, sessionId)
  }

  async markSessionEnded(
    sessionId: string,
    status: SessionStatus,
    desiredState: DesiredSessionState,
  ): Promise<void> {
    const ts = now()
    await this.db
      .prepare(
        `
      UPDATE sessions
      SET status = ?, desired_state = ?, ended_at = ?, last_active_at = ?
      WHERE session_id = ?
    `,
      )
      .run(status, desiredState, ts, ts, sessionId)
  }

  async touchSessionActivity(sessionId: string): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE sessions
      SET last_active_at = ?
      WHERE session_id = ?
    `,
      )
      .run(now(), sessionId)
  }

  async updateSessionTranscript(
    sessionId: string,
    patch: {
      transcriptSessionId: string
      transcriptPath: string
    },
  ): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE sessions
      SET transcript_session_id = ?,
          transcript_path = ?
      WHERE session_id = ?
    `,
      )
      .run(patch.transcriptSessionId, patch.transcriptPath, sessionId)
  }

  async updateSessionMetadata(
    sessionId: string,
    patch: { title?: string | null; summary?: string | null },
  ): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE sessions
      SET title = COALESCE(?, title),
          summary = COALESCE(?, summary)
      WHERE session_id = ?
    `,
      )
      .run(
        patch.title === undefined ? null : patch.title,
        patch.summary === undefined ? null : patch.summary,
        sessionId,
      )
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE sessions
      SET deleted_at = ?
      WHERE session_id = ?
    `,
      )
      .run(now(), sessionId)
  }

  async updateAttemptRunner(
    attemptId: string,
    runnerPid: number,
  ): Promise<void> {
    const ts = now()
    await this.db
      .prepare(
        `
      UPDATE session_attempts
      SET runner_pid = ?, runtime_state = 'running', last_heartbeat_at = ?
      WHERE attempt_id = ?
    `,
      )
      .run(runnerPid, ts, attemptId)
  }

  async touchAttemptHeartbeat(
    attemptId: string,
    state: AttemptRuntimeState = 'running',
  ): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE session_attempts
      SET last_heartbeat_at = ?, runtime_state = ?
      WHERE attempt_id = ?
    `,
      )
      .run(now(), state, attemptId)
  }

  async markAttemptStopped(
    attemptId: string,
    input: {
      runtimeState: AttemptRuntimeState
      exitCode?: number | null
      exitSignal?: string | null
      stopReason?: string | null
      errorText?: string | null
    },
  ): Promise<void> {
    const ts = now()
    await this.db
      .prepare(
        `
      UPDATE session_attempts
      SET runtime_state = ?, stopped_at = ?, last_heartbeat_at = ?,
          exit_code = ?, exit_signal = ?, stop_reason = ?, error_text = ?
      WHERE attempt_id = ?
    `,
      )
      .run(
        input.runtimeState,
        ts,
        ts,
        input.exitCode ?? null,
        input.exitSignal ?? null,
        input.stopReason ?? null,
        input.errorText ?? null,
        attemptId,
      )
  }

  async markAttemptLost(attemptId: string, errorText: string): Promise<void> {
    await this.markAttemptStopped(attemptId, {
      runtimeState: 'lost',
      stopReason: 'runner_unavailable',
      errorText,
    })
  }

  async listSessionRecords(
    filter: SessionListFilter,
  ): Promise<SessionRecord[]> {
    const clauses = ['org_id = ?']
    const values: Array<string | number> = [filter.orgId]
    if (filter.userId) {
      clauses.push('user_id = ?')
      values.push(filter.userId)
    }
    if (!filter.includeDeleted) {
      clauses.push('deleted_at IS NULL')
    }
    if (filter.activeOnly) {
      clauses.push(`status IN ('creating', 'active', 'detached')`)
    }
    const rows = (await this.db
      .prepare(
        `
      SELECT sessions.*, (SELECT task_id FROM cron_session_links WHERE session_id=sessions.session_id) AS cron_task_id, (SELECT source_session_id FROM cron_session_links WHERE session_id=sessions.session_id) AS cron_source_session_id
      FROM sessions
      WHERE ${clauses.join(' AND ')}
      ORDER BY last_active_at DESC
    `,
      )
      .all(...values)) as SqlRow[]
    return rows.map(mapSession)
  }

  async listSessions(filter: SessionListFilter): Promise<SessionSummary[]> {
    return (await this.listSessionRecords(filter)).map(toSessionSummary)
  }

  async listUserSessions(
    orgId: string,
    userId: string,
  ): Promise<SessionRecord[]> {
    const rows = (await this.db
      .prepare(
        `
      SELECT sessions.*, (SELECT task_id FROM cron_session_links WHERE session_id=sessions.session_id) AS cron_task_id, (SELECT source_session_id FROM cron_session_links WHERE session_id=sessions.session_id) AS cron_source_session_id
      FROM sessions
      WHERE org_id = ? AND user_id = ? AND deleted_at IS NULL
      ORDER BY last_active_at DESC
    `,
      )
      .all(orgId, userId)) as SqlRow[]
    return rows.map(mapSession)
  }

  async listSessionsToRecover(): Promise<SessionRecord[]> {
    const rows = (await this.db
      .prepare(
        `
      SELECT sessions.*, (SELECT task_id FROM cron_session_links WHERE session_id=sessions.session_id) AS cron_task_id, (SELECT source_session_id FROM cron_session_links WHERE session_id=sessions.session_id) AS cron_source_session_id
      FROM sessions
      WHERE desired_state = 'active'
        AND deleted_at IS NULL
        AND status IN ('creating', 'active', 'detached', 'lost', 'failed')
      ORDER BY last_active_at DESC
    `,
      )
      .all()) as SqlRow[]
    return rows.map(mapSession)
  }

  async countActiveSessions(): Promise<number> {
    const row = (await this.db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM sessions
      WHERE deleted_at IS NULL
        AND status IN ('creating', 'active', 'detached')
    `,
      )
      .get()) as SqlRow | undefined
    return Number(row?.count ?? 0)
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT sessions.*, (SELECT task_id FROM cron_session_links WHERE session_id=sessions.session_id) AS cron_task_id, (SELECT source_session_id FROM cron_session_links WHERE session_id=sessions.session_id) AS cron_source_session_id
      FROM sessions
      WHERE session_id = ? AND deleted_at IS NULL
      LIMIT 1
    `,
      )
      .get(sessionId)) as SqlRow | undefined
    return row ? mapSession(row) : null
  }

  async getAttempt(attemptId: string): Promise<AttemptRecord | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT *
      FROM session_attempts
      WHERE attempt_id = ?
      LIMIT 1
    `,
      )
      .get(attemptId)) as SqlRow | undefined
    return row ? mapAttempt(row) : null
  }

  async getCurrentAttempt(sessionId: string): Promise<AttemptRecord | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT a.*
      FROM session_attempts a
      JOIN sessions s ON s.current_attempt_id = a.attempt_id
      WHERE s.session_id = ? AND s.deleted_at IS NULL
      LIMIT 1
    `,
      )
      .get(sessionId)) as SqlRow | undefined
    return row ? mapAttempt(row) : null
  }

  async getNextGeneration(sessionId: string): Promise<number> {
    const row = (await this.db
      .prepare(
        `
      SELECT COALESCE(MAX(generation), 0) AS max_generation
      FROM session_attempts
      WHERE session_id = ?
    `,
      )
      .get(sessionId)) as SqlRow | undefined
    return Number(row?.max_generation ?? 0) + 1
  }

  async addEvent(
    sessionId: string,
    attemptId: string | null,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<SessionEventRecord> {
    const eventId = randomUUID()
    const createdAt = now()
    await this.db
      .prepare(
        `
      INSERT INTO session_events (
        event_id, session_id, attempt_id, event_type, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        eventId,
        sessionId,
        attemptId,
        eventType,
        JSON.stringify(payload),
        createdAt,
      )
    return {
      eventId,
      sessionId,
      attemptId,
      eventType,
      payload,
      createdAt,
    }
  }

  async latestEvent(
    sessionId: string,
    eventType: string,
  ): Promise<SessionEventRecord | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT *
      FROM session_events
      WHERE session_id = ? AND event_type = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
      )
      .get(sessionId, eventType)) as SqlRow | undefined
    if (!row) {
      return null
    }
    return {
      eventId: String(row.event_id),
      sessionId: String(row.session_id),
      attemptId: typeof row.attempt_id === 'string' ? row.attempt_id : null,
      eventType: String(row.event_type),
      payload:
        typeof row.payload_json === 'string'
          ? (JSON.parse(row.payload_json) as Record<string, unknown>)
          : {},
      createdAt: Number(row.created_at),
    }
  }
}

export function toSessionSummary(session: SessionRecord): SessionSummary {
  return {
    sessionId: session.sessionId,
    sessionKind: session.sessionKind,
    cronTaskId: session.cronTaskId,
    sourceSessionId: session.sourceSessionId,
    transcriptSessionId: session.transcriptSessionId,
    workDir: session.cwd,
    userId: session.userId,
    orgId: session.orgId,
    role: session.role,
    scopes: session.scopes,
    runtime: session.runtime,
    status: session.status,
    desiredState: session.desiredState,
    title: session.title,
    summary: session.summary,
    assistantName: session.assistantName,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    endedAt: session.endedAt,
  }
}
