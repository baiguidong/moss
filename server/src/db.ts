import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { DatabaseSync } from 'node:sqlite'
import type {
  AttemptRecord,
  AttemptRuntimeState,
  DesiredSessionState,
  ServerConfig,
  ServerInstanceRecord,
  SessionCreateInput,
  SessionEventRecord,
  SessionListFilter,
  SessionRecord,
  SessionStatus,
  SessionSummary,
} from './types.js'
import type { SessionRuntimeInfo } from './sessionManager.js'

type SqlRow = Record<string, unknown>
export type ReportEventKind =
  | 'telemetry_event'
  | 'telemetry_metrics'
  | 'feedback'
  | 'transcript'

export type ReportEventRecord = {
  reportId: string
  orgId: string | null
  userId: string | null
  kind: ReportEventKind
  source: string | null
  payload: unknown
  createdAt: number
}

export type ReportEventSummary = {
  kind: ReportEventKind
  count: number
  lastCreatedAt: number | null
}

function now(): number {
  return Date.now()
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') {
    return []
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : []
  } catch {
    return []
  }
}

function mapRuntime(row: SqlRow): SessionRuntimeInfo {
  return {
    type: String(row.runtime_type) === 'docker' ? 'docker' : 'host',
    dockerImage: typeof row.docker_image === 'string' ? row.docker_image : undefined,
    dockerMode:
      row.docker_mode === 'user'
        ? 'user'
        : row.docker_mode === 'session'
          ? 'session'
          : undefined,
    containerName:
      typeof row.container_name === 'string' ? row.container_name : undefined,
    configDir: typeof row.config_dir === 'string' ? row.config_dir : undefined,
  }
}

function mapSession(row: SqlRow): SessionRecord {
  return {
    sessionId: String(row.session_id),
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
      typeof row.current_attempt_id === 'string' ? row.current_attempt_id : null,
    transcriptPath: String(row.transcript_path),
    title: typeof row.title === 'string' ? row.title : null,
    summary: typeof row.summary === 'string' ? row.summary : null,
    assistantName: typeof row.assistant_name === 'string' ? row.assistant_name : null,
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
    backendType: String(row.backend_type) === 'docker' ? 'docker' : 'host',
    runtimeState: String(row.runtime_state) as AttemptRuntimeState,
    serverInstanceId:
      typeof row.server_instance_id === 'string' ? row.server_instance_id : null,
    runnerPid: row.runner_pid == null ? null : Number(row.runner_pid),
    containerName:
      typeof row.container_name === 'string' ? row.container_name : null,
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

function parseReportPayload(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function mapReportEvent(row: SqlRow): ReportEventRecord {
  return {
    reportId: String(row.report_id),
    orgId: typeof row.org_id === 'string' ? row.org_id : null,
    userId: typeof row.user_id === 'string' ? row.user_id : null,
    kind: String(row.kind) as ReportEventKind,
    source: typeof row.source === 'string' ? row.source : null,
    payload: parseReportPayload(row.payload_json),
    createdAt: Number(row.created_at),
  }
}

export class DirectConnectStore {
  readonly db: DatabaseSync

  constructor(public readonly dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        transcript_session_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        cwd TEXT NOT NULL,
        runtime_type TEXT NOT NULL,
        docker_image TEXT,
        docker_mode TEXT,
        config_dir TEXT,
        container_name TEXT,
        status TEXT NOT NULL,
        desired_state TEXT NOT NULL,
        current_attempt_id TEXT,
        transcript_path TEXT NOT NULL,
        title TEXT,
        summary TEXT,
        assistant_name TEXT,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        ended_at INTEGER,
        deleted_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS session_attempts (
        attempt_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id),
        generation INTEGER NOT NULL,
        backend_type TEXT NOT NULL,
        runtime_state TEXT NOT NULL,
        server_instance_id TEXT,
        runner_pid INTEGER,
        container_name TEXT,
        attach_path TEXT,
        resume_transcript_session_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        last_heartbeat_at INTEGER,
        stopped_at INTEGER,
        exit_code INTEGER,
        exit_signal TEXT,
        stop_reason TEXT,
        error_text TEXT,
        UNIQUE (session_id, generation)
      );

      CREATE TABLE IF NOT EXISTS server_instances (
        instance_id TEXT PRIMARY KEY,
        host TEXT NOT NULL,
        pid INTEGER,
        started_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        stopped_at INTEGER,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_events (
        event_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id),
        attempt_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS report_events (
        report_id TEXT PRIMARY KEY,
        org_id TEXT,
        user_id TEXT,
        kind TEXT NOT NULL,
        source TEXT,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS sessions_user_idx
        ON sessions (org_id, user_id, last_active_at DESC);
      CREATE INDEX IF NOT EXISTS sessions_state_idx
        ON sessions (org_id, status, last_active_at DESC);
      CREATE INDEX IF NOT EXISTS attempts_session_idx
        ON session_attempts (session_id, generation DESC);
      CREATE INDEX IF NOT EXISTS report_events_kind_created_idx
        ON report_events (kind, created_at DESC);
      CREATE INDEX IF NOT EXISTS report_events_org_created_idx
        ON report_events (org_id, created_at DESC);
    `)

    // Migration: add assistant_name column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN assistant_name TEXT`)
    } catch {
      // Column already exists, ignore
    }
  }

  close(): void {
    this.db.close()
  }

  addReportEvent(input: {
    kind: ReportEventKind
    orgId?: string | null
    userId?: string | null
    source?: string | null
    payload: unknown
  }): { reportId: string; createdAt: number } {
    const reportId = randomUUID()
    const createdAt = now()
    this.db.prepare(`
      INSERT INTO report_events (
        report_id, org_id, user_id, kind, source, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      reportId,
      input.orgId ?? null,
      input.userId ?? null,
      input.kind,
      input.source ?? null,
      JSON.stringify(input.payload),
      createdAt,
    )
    return { reportId, createdAt }
  }

  listReportEvents(input: {
    orgId: string
    userId?: string
    kind?: ReportEventKind
    before?: number
    from?: number
    to?: number
    limit?: number
  }): { events: ReportEventRecord[]; nextCursor: number | null } {
    const clauses = ['org_id = ?']
    const values: Array<string | number> = [input.orgId]

    if (input.userId) {
      clauses.push('user_id = ?')
      values.push(input.userId)
    }
    if (input.kind) {
      clauses.push('kind = ?')
      values.push(input.kind)
    }
    if (input.before !== undefined) {
      clauses.push('created_at < ?')
      values.push(input.before)
    }
    if (input.from !== undefined) {
      clauses.push('created_at >= ?')
      values.push(input.from)
    }
    if (input.to !== undefined) {
      clauses.push('created_at <= ?')
      values.push(input.to)
    }

    const limit = Math.max(1, Math.min(input.limit ?? 50, 500))
    const rows = this.db.prepare(`
      SELECT *
      FROM report_events
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC, report_id DESC
      LIMIT ?
    `).all(...values, limit + 1) as SqlRow[]

    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const events = pageRows.map(mapReportEvent)
    return {
      events,
      nextCursor: hasMore
        ? Number(pageRows[pageRows.length - 1]?.created_at ?? null)
        : null,
    }
  }

  getReportEvent(orgId: string, reportId: string): ReportEventRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM report_events
      WHERE org_id = ? AND report_id = ?
      LIMIT 1
    `).get(orgId, reportId) as SqlRow | undefined
    return row ? mapReportEvent(row) : null
  }

  summarizeReportEvents(input: {
    orgId: string
    from?: number
    to?: number
  }): ReportEventSummary[] {
    const clauses = ['org_id = ?']
    const values: Array<string | number> = [input.orgId]
    if (input.from !== undefined) {
      clauses.push('created_at >= ?')
      values.push(input.from)
    }
    if (input.to !== undefined) {
      clauses.push('created_at <= ?')
      values.push(input.to)
    }
    const rows = this.db.prepare(`
      SELECT kind, COUNT(*) AS count, MAX(created_at) AS last_created_at
      FROM report_events
      WHERE ${clauses.join(' AND ')}
      GROUP BY kind
      ORDER BY kind ASC
    `).all(...values) as SqlRow[]
    return rows.map(row => ({
      kind: String(row.kind) as ReportEventKind,
      count: Number(row.count ?? 0),
      lastCreatedAt:
        row.last_created_at == null ? null : Number(row.last_created_at),
    }))
  }

  registerServerInstance(host: string, pid = process.pid): ServerInstanceRecord {
    const instanceId = randomUUID()
    const ts = now()
    this.db.prepare(`
      INSERT INTO server_instances (
        instance_id, host, pid, started_at, heartbeat_at, status
      ) VALUES (?, ?, ?, ?, ?, 'running')
    `).run(instanceId, host, pid, ts, ts)
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

  heartbeatServerInstance(instanceId: string): void {
    this.db.prepare(`
      UPDATE server_instances
      SET heartbeat_at = ?, status = 'running'
      WHERE instance_id = ?
    `).run(now(), instanceId)
  }

  stopServerInstance(instanceId: string): void {
    const ts = now()
    this.db.prepare(`
      UPDATE server_instances
      SET heartbeat_at = ?, stopped_at = ?, status = 'stopped'
      WHERE instance_id = ?
    `).run(ts, ts, instanceId)
  }

  createSession(input: {
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
    assistantName?: string
  }): SessionRecord {
    const ts = now()
    this.db.prepare(`
      INSERT INTO sessions (
        session_id, transcript_session_id, org_id, user_id, role, scopes_json,
        cwd, runtime_type, docker_image, docker_mode, config_dir, container_name,
        status, desired_state, current_attempt_id, transcript_path, assistant_name,
        created_at, last_active_at, ended_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL)
    `).run(
      input.sessionId,
      input.transcriptSessionId,
      input.orgId,
      input.userId,
      input.role,
      JSON.stringify(input.scopes),
      input.cwd,
      input.runtime.type,
      input.runtime.dockerImage ?? null,
      input.runtime.dockerMode ?? null,
      input.runtime.configDir ?? null,
      input.runtime.containerName ?? null,
      input.status,
      input.desiredState,
      input.transcriptPath,
      input.assistantName ?? null,
      ts,
      ts,
    )
    this.addEvent(input.sessionId, null, 'session_created', {
      runtime: input.runtime,
      cwd: input.cwd,
      assistantName: input.assistantName,
    })
    return this.getSession(input.sessionId)!
  }

  createAttempt(input: {
    sessionId: string
    generation: number
    backendType: 'host' | 'docker'
    resumeTranscriptSessionId: string
    serverInstanceId: string
    containerName?: string
    attachPath?: string
  }): AttemptRecord {
    const attemptId = randomUUID()
    const ts = now()
    this.db.prepare(`
      INSERT INTO session_attempts (
        attempt_id, session_id, generation, backend_type, runtime_state,
        server_instance_id, runner_pid, container_name, attach_path,
        resume_transcript_session_id, started_at, last_heartbeat_at
      ) VALUES (?, ?, ?, ?, 'starting', ?, NULL, ?, ?, ?, ?, ?)
    `).run(
      attemptId,
      input.sessionId,
      input.generation,
      input.backendType,
      input.serverInstanceId,
      input.containerName ?? null,
      input.attachPath ?? null,
      input.resumeTranscriptSessionId,
      ts,
      ts,
    )
    this.addEvent(input.sessionId, attemptId, 'attempt_created', {
      generation: input.generation,
      backendType: input.backendType,
      attachPath: input.attachPath,
      containerName: input.containerName,
    })
    return this.getAttempt(attemptId)!
  }

  setCurrentAttempt(sessionId: string, attemptId: string | null): void {
    this.db.prepare(`
      UPDATE sessions
      SET current_attempt_id = ?
      WHERE session_id = ?
    `).run(attemptId, sessionId)
  }

  setSessionLifecycle(
    sessionId: string,
    status: SessionStatus,
    desiredState: DesiredSessionState,
  ): void {
    const ts = now()
    this.db.prepare(`
      UPDATE sessions
      SET status = ?, desired_state = ?, last_active_at = ?
      WHERE session_id = ?
    `).run(status, desiredState, ts, sessionId)
  }

  markSessionEnded(
    sessionId: string,
    status: SessionStatus,
    desiredState: DesiredSessionState,
  ): void {
    const ts = now()
    this.db.prepare(`
      UPDATE sessions
      SET status = ?, desired_state = ?, ended_at = ?, last_active_at = ?
      WHERE session_id = ?
    `).run(status, desiredState, ts, ts, sessionId)
  }

  touchSessionActivity(sessionId: string): void {
    this.db.prepare(`
      UPDATE sessions
      SET last_active_at = ?
      WHERE session_id = ?
    `).run(now(), sessionId)
  }

  updateSessionTranscript(
    sessionId: string,
    patch: {
      transcriptSessionId: string
      transcriptPath: string
    },
  ): void {
    this.db.prepare(`
      UPDATE sessions
      SET transcript_session_id = ?,
          transcript_path = ?
      WHERE session_id = ?
    `).run(
      patch.transcriptSessionId,
      patch.transcriptPath,
      sessionId,
    )
  }

  updateSessionMetadata(
    sessionId: string,
    patch: { title?: string | null; summary?: string | null },
  ): void {
    this.db.prepare(`
      UPDATE sessions
      SET title = COALESCE(?, title),
          summary = COALESCE(?, summary)
      WHERE session_id = ?
    `).run(
      patch.title === undefined ? null : patch.title,
      patch.summary === undefined ? null : patch.summary,
      sessionId,
    )
  }

  deleteSession(sessionId: string): void {
    this.db.prepare(`
      UPDATE sessions
      SET deleted_at = ?
      WHERE session_id = ?
    `).run(now(), sessionId)
  }

  updateAttemptRunner(attemptId: string, runnerPid: number): void {
    const ts = now()
    this.db.prepare(`
      UPDATE session_attempts
      SET runner_pid = ?, runtime_state = 'running', last_heartbeat_at = ?
      WHERE attempt_id = ?
    `).run(runnerPid, ts, attemptId)
  }

  touchAttemptHeartbeat(
    attemptId: string,
    state: AttemptRuntimeState = 'running',
  ): void {
    this.db.prepare(`
      UPDATE session_attempts
      SET last_heartbeat_at = ?, runtime_state = ?
      WHERE attempt_id = ?
    `).run(now(), state, attemptId)
  }

  markAttemptStopped(
    attemptId: string,
    input: {
      runtimeState: AttemptRuntimeState
      exitCode?: number | null
      exitSignal?: string | null
      stopReason?: string | null
      errorText?: string | null
    },
  ): void {
    const ts = now()
    this.db.prepare(`
      UPDATE session_attempts
      SET runtime_state = ?, stopped_at = ?, last_heartbeat_at = ?,
          exit_code = ?, exit_signal = ?, stop_reason = ?, error_text = ?
      WHERE attempt_id = ?
    `).run(
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

  markAttemptLost(attemptId: string, errorText: string): void {
    this.markAttemptStopped(attemptId, {
      runtimeState: 'lost',
      stopReason: 'runner_unavailable',
      errorText,
    })
  }

  listSessionRecords(filter: SessionListFilter): SessionRecord[] {
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
    const rows = this.db.prepare(`
      SELECT *
      FROM sessions
      WHERE ${clauses.join(' AND ')}
      ORDER BY last_active_at DESC
    `).all(...values) as SqlRow[]
    return rows.map(mapSession)
  }

  listSessions(filter: SessionListFilter): SessionSummary[] {
    return this.listSessionRecords(filter).map(toSessionSummary)
  }

  listUserSessions(orgId: string, userId: string): SessionRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM sessions
      WHERE org_id = ? AND user_id = ? AND deleted_at IS NULL
      ORDER BY last_active_at DESC
    `).all(orgId, userId) as SqlRow[]
    return rows.map(mapSession)
  }

  listSessionsToRecover(): SessionRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM sessions
      WHERE desired_state = 'active'
        AND deleted_at IS NULL
        AND status IN ('creating', 'active', 'detached', 'lost', 'failed')
      ORDER BY last_active_at DESC
    `).all() as SqlRow[]
    return rows.map(mapSession)
  }

  countActiveSessions(): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM sessions
      WHERE deleted_at IS NULL
        AND status IN ('creating', 'active', 'detached')
    `).get() as SqlRow | undefined
    return Number(row?.count ?? 0)
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM sessions
      WHERE session_id = ? AND deleted_at IS NULL
      LIMIT 1
    `).get(sessionId) as SqlRow | undefined
    return row ? mapSession(row) : null
  }

  getAttempt(attemptId: string): AttemptRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM session_attempts
      WHERE attempt_id = ?
      LIMIT 1
    `).get(attemptId) as SqlRow | undefined
    return row ? mapAttempt(row) : null
  }

  getCurrentAttempt(sessionId: string): AttemptRecord | null {
    const row = this.db.prepare(`
      SELECT a.*
      FROM session_attempts a
      JOIN sessions s ON s.current_attempt_id = a.attempt_id
      WHERE s.session_id = ? AND s.deleted_at IS NULL
      LIMIT 1
    `).get(sessionId) as SqlRow | undefined
    return row ? mapAttempt(row) : null
  }

  getNextGeneration(sessionId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(generation), 0) AS max_generation
      FROM session_attempts
      WHERE session_id = ?
    `).get(sessionId) as SqlRow | undefined
    return Number(row?.max_generation ?? 0) + 1
  }

  addEvent(
    sessionId: string,
    attemptId: string | null,
    eventType: string,
    payload: Record<string, unknown>,
  ): SessionEventRecord {
    const eventId = randomUUID()
    const createdAt = now()
    this.db.prepare(`
      INSERT INTO session_events (
        event_id, session_id, attempt_id, event_type, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
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

  latestEvent(sessionId: string, eventType: string): SessionEventRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM session_events
      WHERE session_id = ? AND event_type = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(sessionId, eventType) as SqlRow | undefined
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

export function openDirectConnectStore(config: ServerConfig): DirectConnectStore {
  return new DirectConnectStore(config.dbPath)
}

export function toSessionSummary(session: SessionRecord): SessionSummary {
  return {
    sessionId: session.sessionId,
    transcriptSessionId: session.transcriptSessionId,
    workDir: session.cwd,
    userId: session.userId,
    orgId: session.orgId,
    role: session.role,
    scopes: session.scopes,
    runtime: session.runtime,
    status: session.status,
    desiredState: session.desiredState,
    assistantName: session.assistantName,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    endedAt: session.endedAt,
  }
}

export function mergeRuntime(
  config: ServerConfig,
  runtime?: SessionCreateInput['runtime'],
): SessionRuntimeInfo {
  const type = runtime?.type || config.defaultRuntime
  return {
    type,
    dockerImage: runtime?.dockerImage || config.dockerImage,
    dockerMode: runtime?.dockerMode || config.dockerMode,
    configDir: runtime?.configDir,
  }
}
