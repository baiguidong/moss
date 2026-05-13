import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { DatabaseSync } from 'node:sqlite'
import type {
  AttemptRecord,
  AttemptRuntimeState,
  DesiredSessionState,
  EnterpriseRecord,
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
    engine: String(row.engine) === 'scode' ? 'scode' : 'scode',
    dockerImage: typeof row.docker_image === 'string' ? row.docker_image : undefined,
    dockerMode:
      row.docker_mode === 'user'
        ? 'user'
        : row.docker_mode === 'session'
          ? 'session'
          : undefined,
    container_name:
      typeof row.container_name === 'string' ? row.container_name : undefined,
    config_dir: typeof row.config_dir === 'string' ? row.config_dir : undefined,
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
    source: typeof row.source === 'string' ? row.source : undefined,
    channelChatId: typeof row.channel_chat_id === 'string' ? row.channel_chat_id : undefined,
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
        source TEXT,
        channel_chat_id TEXT,
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

      CREATE TABLE IF NOT EXISTS enterprises (
        id TEXT PRIMARY KEY DEFAULT 'default',
        logo TEXT,
        app_name TEXT,
        top_name TEXT,
        about_name TEXT,
        app_company_name TEXT,
        login_desp TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS sessions_user_idx
        ON sessions (org_id, user_id, last_active_at DESC);
      CREATE INDEX IF NOT EXISTS sessions_state_idx
        ON sessions (org_id, status, last_active_at DESC);
      CREATE INDEX IF NOT EXISTS sessions_source_chat
        ON sessions (source, channel_chat_id, last_active_at DESC);
      CREATE INDEX IF NOT EXISTS attempts_session_idx
        ON session_attempts (session_id, generation DESC);

      CREATE TABLE IF NOT EXISTS channel_plugins (
        id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        credentials_json TEXT,
        config_json TEXT,
        status TEXT NOT NULL,
        last_connected INTEGER,
        user_id TEXT NOT NULL,
        org_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (id, user_id)
      );

      CREATE TABLE IF NOT EXISTS channel_users (
        id TEXT PRIMARY KEY,
        platform_user_id TEXT NOT NULL,
        platform_type TEXT NOT NULL,
        display_name TEXT,
        authorized_at INTEGER NOT NULL,
        last_active INTEGER,
        session_id TEXT,
        org_id TEXT,
        user_id TEXT,
        UNIQUE(platform_user_id, platform_type, user_id)
      );

      CREATE TABLE IF NOT EXISTS channel_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        conversation_id TEXT,
        workspace TEXT,
        chat_id TEXT,
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_pairing_requests (
        code TEXT PRIMARY KEY,
        platform_user_id TEXT NOT NULL,
        platform_type TEXT NOT NULL,
        display_name TEXT,
        requested_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        user_id TEXT
      );
    `)

    const nowTs = now()
    this.db.prepare(`
      INSERT OR IGNORE INTO enterprises (id, app_name, created_at, updated_at)
      VALUES ('default', 'Moss', ?, ?)
    `).run(nowTs, nowTs)

    // Migration: add assistant_name column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN assistant_name TEXT`)
    } catch {
      // Column already exists, ignore
    }

    // Migration: add source and channel_chat_id columns if they don't exist
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN source TEXT`)
      console.log('[DB] Added source column to sessions')
    } catch (error) {
      // Column already exists, ignore
    }
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN channel_chat_id TEXT`)
      console.log('[DB] Added channel_chat_id column to sessions')
    } catch (error) {
      // Column already exists, ignore
    }
    try {
      this.db.exec(`ALTER TABLE channel_plugins ADD COLUMN org_id TEXT`)
    } catch {
      // Column already exists, ignore
    }
    try {
      this.db.exec(`ALTER TABLE channel_pairing_requests ADD COLUMN user_id TEXT`)
    } catch {
      // Column already exists, ignore
    }
    // Migrate channel_users UNIQUE constraint from (platform_user_id, platform_type)
    // to (platform_user_id, platform_type, user_id) for multi-user isolation.
    // SQLite doesn't support ALTER TABLE constraints, so recreate the table.
    try {
      const existingConstraint = this.db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='channel_users'`).get() as SqlRow | undefined;
      if (existingConstraint && String(existingConstraint.sql).includes('UNIQUE(platform_user_id, platform_type)') && !String(existingConstraint.sql).includes('platform_user_id, platform_type, user_id')) {
        this.db.exec(`
          CREATE TABLE channel_users_new (
            id TEXT PRIMARY KEY,
            platform_user_id TEXT NOT NULL,
            platform_type TEXT NOT NULL,
            display_name TEXT,
            authorized_at INTEGER NOT NULL,
            last_active INTEGER,
            session_id TEXT,
            org_id TEXT,
            user_id TEXT,
            UNIQUE(platform_user_id, platform_type, user_id)
          );
          INSERT OR IGNORE INTO channel_users_new SELECT * FROM channel_users;
          DROP TABLE channel_users;
          ALTER TABLE channel_users_new RENAME TO channel_users;
        `)
        console.log('[DB] Migrated channel_users UNIQUE constraint to include user_id')
      }
    } catch (error) {
      console.error('[DB] Failed to migrate channel_users constraint:', error)
    }

    // Create index for channel session lookup if it doesn't exist
    try {
      this.db.exec(`CREATE INDEX IF NOT EXISTS sessions_source_chat ON sessions (source, channel_chat_id, last_active_at DESC)`)
    } catch {
      // Index creation failed, ignore
    }

    // Create tenant_skills table for enterprise exclusive skills
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenant_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        version TEXT,
        author_id TEXT NOT NULL,
        author_name TEXT,
        status TEXT DEFAULT 'pending',
        source_url TEXT,
        checksum TEXT,
        file_path TEXT,
        publish_note TEXT,
        review_note TEXT,
        reviewed_by TEXT,
        reviewed_at INTEGER,
        enabled INTEGER DEFAULT 1,
        visible_to TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tenant_skills_author ON tenant_skills (author_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_skills_status ON tenant_skills (status);
    `)

    // Create tenant_assistants table for enterprise exclusive assistants
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenant_assistants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        version TEXT,
        author_id TEXT NOT NULL,
        author_name TEXT,
        status TEXT DEFAULT 'pending',
        source_url TEXT,
        checksum TEXT,
        file_path TEXT,
        enabled_skills TEXT,
        memory_mode TEXT DEFAULT 'session',
        publish_note TEXT,
        review_note TEXT,
        reviewed_by TEXT,
        reviewed_at INTEGER,
        enabled INTEGER DEFAULT 1,
        visible_to TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tenant_assistants_author ON tenant_assistants (author_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_assistants_status ON tenant_assistants (status);
    `)
  }

  close(): void {
    (this as any)._closed = true
    this.db.close()
  }

  isOpen(): boolean {
    return !(this as any)._closed
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
    source?: string
    channelChatId?: string
  }): SessionRecord {
    const ts = now()
    this.db.prepare(`
      INSERT INTO sessions (
        session_id, transcript_session_id, org_id, user_id, role, scopes_json,
        cwd, runtime_type, docker_image, docker_mode, config_dir, container_name,
        status, desired_state, current_attempt_id, transcript_path, title, summary, assistant_name,
        source, channel_chat_id,
        created_at, last_active_at, ended_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, NULL)
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
      input.source ?? null,
      input.channelChatId ?? null,
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

  findChannelSession(source: string, chatId: string, userId: string): SessionRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM sessions
      WHERE source = ? AND channel_chat_id = ? AND user_id = ? AND deleted_at IS NULL
      ORDER BY last_active_at DESC
      LIMIT 1
    `).get(source, chatId, userId) as SqlRow | undefined
    return row ? mapSession(row) : null
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

  /** Look up a user's org_id from the users table */
  getUserOrgId(userId: string): string | null {
    const row = this.db.prepare(`SELECT org_id FROM users WHERE id = ?`).get(userId) as SqlRow | undefined
    return row?.org_id ? String(row.org_id) : null
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

  getEnterprise(): EnterpriseRecord {
    const row = this.db.prepare(`
      SELECT * FROM enterprises WHERE id = 'default' LIMIT 1
    `).get() as SqlRow | undefined

    if (!row) {
      throw new Error('Default enterprise record not found')
    }

    return {
      id: String(row.id),
      logo: typeof row.logo === 'string' ? row.logo : null,
      app_name: typeof row.app_name === 'string' ? row.app_name : null,
      top_name: typeof row.top_name === 'string' ? row.top_name : null,
      about_name: typeof row.about_name === 'string' ? row.about_name : null,
      app_company_name: typeof row.app_company_name === 'string' ? row.app_company_name : null,
      login_desp: typeof row.login_desp === 'string' ? row.login_desp : null,
      created_at: Number(row.created_at),
      updated_at: Number(row.updated_at),
    }
  }

  updateEnterprise(patch: Partial<Omit<EnterpriseRecord, 'id' | 'created_at' | 'updated_at'>>): void {
    const entries = Object.entries(patch)
    if (entries.length === 0) return

    const sets = entries.map(([key]) => `${key} = ?`).join(', ')
    const values = entries.map(([, value]) => value ?? null)
    const ts = now()

    this.db.prepare(`
      UPDATE enterprises
      SET ${sets}, updated_at = ?
      WHERE id = 'default'
    `).run(...values, ts)
  }

  // ==================== Channel Plugins ====================

  listChannelPlugins(userId?: string): SqlRow[] {
    if (userId) {
      return this.db.prepare(`SELECT * FROM channel_plugins WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as SqlRow[]
    }
    return this.db.prepare(`SELECT * FROM channel_plugins ORDER BY created_at DESC`).all() as SqlRow[]
  }

  getChannelPlugin(id: string, userId?: string): SqlRow | null {
    if (userId) {
      return (this.db.prepare(`SELECT * FROM channel_plugins WHERE id = ? AND user_id = ?`).get(id, userId) as SqlRow) ?? null
    }
    return (this.db.prepare(`SELECT * FROM channel_plugins WHERE id = ?`).get(id) as SqlRow) ?? null
  }

  upsertChannelPlugin(row: {
    id: string
    type: string
    name: string
    enabled: number
    credentials_json?: string | null
    config_json?: string | null
    status: string
    last_connected?: number | null
    user_id: string
    org_id?: string | null
  }): void {
    const ts = now()
    this.db.prepare(`
      INSERT INTO channel_plugins (
        id, type, name, enabled, credentials_json, config_json, status, last_connected, user_id, org_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id, user_id) DO UPDATE SET
        name = excluded.name,
        enabled = excluded.enabled,
        credentials_json = COALESCE(excluded.credentials_json, credentials_json),
        config_json = COALESCE(excluded.config_json, config_json),
        status = excluded.status,
        last_connected = COALESCE(excluded.last_connected, last_connected),
        org_id = COALESCE(excluded.org_id, org_id),
        updated_at = excluded.updated_at
    `).run(
      row.id,
      row.type,
      row.name,
      row.enabled,
      row.credentials_json ?? null,
      row.config_json ?? null,
      row.status,
      row.last_connected ?? null,
      row.user_id,
      row.org_id ?? null,
      ts,
      ts,
    )
  }

  updateChannelPluginStatus(id: string, status: string, lastConnected?: number, userId?: string): void {
    const ts = now()
    if (userId) {
      this.db.prepare(`
        UPDATE channel_plugins
        SET status = ?, last_connected = COALESCE(?, last_connected), updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(status, lastConnected ?? null, ts, id, userId)
    } else {
      this.db.prepare(`
        UPDATE channel_plugins
        SET status = ?, last_connected = COALESCE(?, last_connected), updated_at = ?
        WHERE id = ?
      `).run(status, lastConnected ?? null, ts, id)
    }
  }

  // ==================== Channel Users ====================

  listChannelUsers(userId?: string): SqlRow[] {
    if (userId) {
      return this.db.prepare(`SELECT * FROM channel_users WHERE user_id = ? ORDER BY authorized_at DESC`).all(userId) as SqlRow[]
    }
    return this.db.prepare(`SELECT * FROM channel_users ORDER BY authorized_at DESC`).all() as SqlRow[]
  }

  getChannelUserByPlatform(platformUserId: string, platformType: string): SqlRow | null {
    return (this.db.prepare(`SELECT * FROM channel_users WHERE platform_user_id = ? AND platform_type = ?`).get(platformUserId, platformType) as SqlRow) ?? null
  }

  upsertChannelUser(row: {
    id: string
    platform_user_id: string
    platform_type: string
    display_name?: string | null
    authorized_at: number
    last_active?: number | null
    session_id?: string | null
    org_id?: string | null
    user_id?: string | null
  }): void {
    this.db.prepare(`
      INSERT INTO channel_users (
        id, platform_user_id, platform_type, display_name, authorized_at, last_active, session_id, org_id, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform_user_id, platform_type, user_id) DO UPDATE SET
        display_name = excluded.display_name,
        last_active = excluded.last_active,
        session_id = excluded.session_id,
        org_id = excluded.org_id,
        user_id = excluded.user_id
    `).run(
      row.id,
      row.platform_user_id,
      row.platform_type,
      row.display_name ?? null,
      row.authorized_at,
      row.last_active ?? null,
      row.session_id ?? null,
      row.org_id ?? null,
      row.user_id ?? null,
    )
  }

  getChannelUserById(id: string): SqlRow | null {
    return (this.db.prepare(`SELECT * FROM channel_users WHERE id = ?`).get(id) as SqlRow) ?? null
  }

  deleteChannelUser(id: string): void {
    this.db.prepare(`DELETE FROM channel_users WHERE id = ?`).run(id)
  }

  deleteChannelUsersByPlatform(platformType: string, userId?: string): number {
    if (userId) {
      const result = this.db.prepare(`DELETE FROM channel_users WHERE platform_type = ? AND user_id = ?`).run(platformType, userId)
      return result.changes
    }
    const result = this.db.prepare(`DELETE FROM channel_users WHERE platform_type = ?`).run(platformType)
    return result.changes
  }

  // ==================== Channel Sessions ====================

  listChannelSessions(): SqlRow[] {
    return this.db.prepare(`SELECT * FROM channel_sessions ORDER BY last_activity DESC`).all() as SqlRow[]
  }

  upsertChannelSession(row: {
    id: string
    user_id: string
    agent_type: string
    conversation_id?: string | null
    workspace?: string | null
    chat_id?: string | null
    created_at: number
    last_activity: number
  }): void {
    this.db.prepare(`
      INSERT INTO channel_sessions (
        id, user_id, agent_type, conversation_id, workspace, chat_id, created_at, last_activity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        conversation_id = excluded.conversation_id,
        workspace = excluded.workspace,
        chat_id = excluded.chat_id,
        last_activity = excluded.last_activity
    `).run(
      row.id,
      row.user_id,
      row.agent_type,
      row.conversation_id ?? null,
      row.workspace ?? null,
      row.chat_id ?? null,
      row.created_at,
      row.last_activity,
    )
  }

  deleteChannelSession(id: string): void {
    this.db.prepare(`DELETE FROM channel_sessions WHERE id = ?`).run(id)
  }

  // ==================== Channel Pairings ====================

  listPendingPairingRequests(userId?: string): SqlRow[] {
    if (userId) {
      return this.db.prepare(`SELECT * FROM channel_pairing_requests WHERE status = 'pending' AND expires_at > ? AND (user_id = ? OR user_id IS NULL)`).all(now(), userId) as SqlRow[]
    }
    return this.db.prepare(`SELECT * FROM channel_pairing_requests WHERE status = 'pending' AND expires_at > ?`).all(now()) as SqlRow[]
  }

  getPairingRequest(code: string): SqlRow | null {
    return (this.db.prepare(`SELECT * FROM channel_pairing_requests WHERE code = ?`).get(code) as SqlRow) ?? null
  }

  upsertPairingRequest(row: {
    code: string
    platform_user_id: string
    platform_type: string
    display_name?: string | null
    requested_at: number
    expires_at: number
    status: string
    user_id?: string | null
  }): void {
    this.db.prepare(`
      INSERT INTO channel_pairing_requests (
        code, platform_user_id, platform_type, display_name, requested_at, expires_at, status, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        status = excluded.status,
        user_id = excluded.user_id,
        platform_type = excluded.platform_type,
        display_name = excluded.display_name,
        requested_at = excluded.requested_at,
        expires_at = excluded.expires_at
    `).run(
      row.code,
      row.platform_user_id,
      row.platform_type,
      row.display_name ?? null,
      row.requested_at,
      row.expires_at,
      row.status,
      row.user_id ?? null,
    )
  }

  updatePairingRequestStatus(code: string, status: string): void {
    this.db.prepare(`UPDATE channel_pairing_requests SET status = ? WHERE code = ?`).run(status, code)
  }

  deletePairingRequestsByUserAndPlatform(userId: string, platformType: string): void {
    this.db.prepare(`DELETE FROM channel_pairing_requests WHERE user_id = ? AND platform_type = ?`).run(userId, platformType)
  }

  // ==================== Tenant Skills ====================

  listTenantSkills(status?: string): SqlRow[] {
    if (status) {
      return this.db.prepare(`SELECT * FROM tenant_skills WHERE status = ? ORDER BY created_at DESC`).all(status) as SqlRow[]
    }
    return this.db.prepare(`SELECT * FROM tenant_skills ORDER BY created_at DESC`).all() as SqlRow[]
  }

  getTenantSkill(id: string): SqlRow | null {
    return (this.db.prepare(`SELECT * FROM tenant_skills WHERE id = ?`).get(id) as SqlRow) ?? null
  }

  getTenantSkillByName(name: string): SqlRow | null {
    return (this.db.prepare(`SELECT * FROM tenant_skills WHERE name = ?`).get(name) as SqlRow) ?? null
  }

  createTenantSkill(row: {
    id: string
    name: string
    display_name?: string | null
    description?: string | null
    version?: string | null
    author_id: string
    author_name?: string | null
    status?: string
    source_url?: string | null
    checksum?: string | null
    file_path?: string | null
    publish_note?: string | null
    enabled?: number
    visible_to?: string | null
  }): void {
    const ts = now()
    this.db.prepare(`
      INSERT INTO tenant_skills (
        id, name, display_name, description, version, author_id, author_name, status,
        source_url, checksum, file_path, publish_note, enabled, visible_to, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.name,
      row.display_name ?? null,
      row.description ?? null,
      row.version ?? null,
      row.author_id,
      row.author_name ?? null,
      row.status ?? 'pending',
      row.source_url ?? null,
      row.checksum ?? null,
      row.file_path ?? null,
      row.publish_note ?? null,
      row.enabled ?? 1,
      row.visible_to ?? null,
      ts,
      ts,
    )
  }

  updateTenantSkillStatus(id: string, status: string, reviewedBy: string, reviewNote?: string): void {
    const ts = now()
    this.db.prepare(`
      UPDATE tenant_skills
      SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ?
      WHERE id = ?
    `).run(status, reviewedBy, ts, reviewNote ?? null, ts, id)
  }

  updateTenantSkillMeta(id: string, updates: {
    display_name?: string
    description?: string
    enabled?: number
    visible_to?: string | null
  }): void {
    const ts = now()
    const existing = this.getTenantSkill(id)
    if (!existing) return

    const displayName = updates.display_name ?? existing.display_name
    const description = updates.description ?? existing.description
    const enabled = updates.enabled ?? existing.enabled
    const visibleTo = updates.visible_to !== undefined ? updates.visible_to : existing.visible_to

    this.db.prepare(`
      UPDATE tenant_skills
      SET display_name = ?, description = ?, enabled = ?, visible_to = ?, updated_at = ?
      WHERE id = ?
    `).run(displayName as string, description as string, enabled as number, visibleTo as string | null, ts, id)
  }

  updateTenantSkillFilePath(id: string, filePath: string, sourceUrl: string, checksum: string): void {
    const ts = now()
    this.db.prepare(`
      UPDATE tenant_skills
      SET file_path = ?, source_url = ?, checksum = ?, updated_at = ?
      WHERE id = ?
    `).run(filePath, sourceUrl, checksum, ts, id)
  }

  deleteTenantSkill(id: string): void {
    this.db.prepare(`DELETE FROM tenant_skills WHERE id = ?`).run(id)
  }

  // ==================== Tenant Assistants ====================

  listTenantAssistants(status?: string): SqlRow[] {
    if (status) {
      return this.db.prepare(`SELECT * FROM tenant_assistants WHERE status = ? ORDER BY created_at DESC`).all(status) as SqlRow[]
    }
    return this.db.prepare(`SELECT * FROM tenant_assistants ORDER BY created_at DESC`).all() as SqlRow[]
  }

  getTenantAssistant(id: string): SqlRow | null {
    return (this.db.prepare(`SELECT * FROM tenant_assistants WHERE id = ?`).get(id) as SqlRow) ?? null
  }

  getTenantAssistantByName(name: string): SqlRow | null {
    return (this.db.prepare(`SELECT * FROM tenant_assistants WHERE name = ?`).get(name) as SqlRow) ?? null
  }

  createTenantAssistant(row: {
    id: string
    name: string
    display_name?: string | null
    description?: string | null
    version?: string | null
    author_id: string
    author_name?: string | null
    status?: string
    source_url?: string | null
    checksum?: string | null
    file_path?: string | null
    enabled_skills?: string | null
    memory_mode?: string
    publish_note?: string | null
    enabled?: number
    visible_to?: string | null
  }): void {
    const ts = now()
    this.db.prepare(`
      INSERT INTO tenant_assistants (
        id, name, display_name, description, version, author_id, author_name, status,
        source_url, checksum, file_path, enabled_skills, memory_mode, publish_note, enabled, visible_to, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.name,
      row.display_name ?? null,
      row.description ?? null,
      row.version ?? null,
      row.author_id,
      row.author_name ?? null,
      row.status ?? 'pending',
      row.source_url ?? null,
      row.checksum ?? null,
      row.file_path ?? null,
      row.enabled_skills ?? null,
      row.memory_mode ?? 'session',
      row.publish_note ?? null,
      row.enabled ?? 1,
      row.visible_to ?? null,
      ts,
      ts,
    )
  }

  updateTenantAssistantStatus(id: string, status: string, reviewedBy: string, reviewNote?: string): void {
    const ts = now()
    this.db.prepare(`
      UPDATE tenant_assistants
      SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ?
      WHERE id = ?
    `).run(status, reviewedBy, ts, reviewNote ?? null, ts, id)
  }

  updateTenantAssistantMeta(id: string, updates: {
    display_name?: string
    description?: string
    enabled?: number
    visible_to?: string | null
    enabled_skills?: string | null
  }): void {
    const ts = now()
    const existing = this.getTenantAssistant(id)
    if (!existing) return

    const displayName = updates.display_name ?? existing.display_name
    const description = updates.description ?? existing.description
    const enabled = updates.enabled ?? existing.enabled
    const visibleTo = updates.visible_to !== undefined ? updates.visible_to : existing.visible_to
    const enabledSkills = updates.enabled_skills ?? existing.enabled_skills

    this.db.prepare(`
      UPDATE tenant_assistants
      SET display_name = ?, description = ?, enabled = ?, visible_to = ?, enabled_skills = ?, updated_at = ?
      WHERE id = ?
    `).run(displayName as string, description as string, enabled as number, visibleTo as string | null, enabledSkills as string | null, ts, id)
  }

  updateTenantAssistantFilePath(id: string, filePath: string, sourceUrl: string, checksum: string): void {
    const ts = now()
    this.db.prepare(`
      UPDATE tenant_assistants
      SET file_path = ?, source_url = ?, checksum = ?, updated_at = ?
      WHERE id = ?
    `).run(filePath, sourceUrl, checksum, ts, id)
  }

  deleteTenantAssistant(id: string): void {
    this.db.prepare(`DELETE FROM tenant_assistants WHERE id = ?`).run(id)
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
    source: session.source,
    channelChatId: session.channelChatId,
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
    engine: runtime?.engine || config.engine || 'scode',
    dockerImage: runtime?.dockerImage || config.dockerImage,
    dockerMode: runtime?.dockerMode || config.dockerMode,
    configDir: runtime?.configDir,
    scodePath: runtime?.scodePath || config.scodePath,
  }
}
