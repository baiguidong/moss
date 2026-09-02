import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 2;
const ROOM_STATUSES = new Set(['idle', 'running', 'paused', 'deleting']);
const RUN_MODES = new Set(['orchestrated', 'conversation', 'parallel']);

function asJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeText(value, label, { required = true, max = 20_000 } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new Error(`${label} is required.`);
  if (text.length > max) throw new Error(`${label} is too long.`);
  return text;
}

function normalizeId(value, label) {
  const id = normalizeText(value, label, { max: 160 });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Invalid ${label}.`);
  return id;
}

function nowMs() {
  return Date.now();
}

function mapRoom(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    workspace: row.workspace,
    status: row.status,
    revision: row.revision,
    summary: row.summary || '',
    summaryThroughSeq: row.summary_through_seq,
    settings: asJson(row.settings_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    ordinal: row.ordinal,
    source: {
      kind: row.source_kind,
      id: row.source_id,
      memberId: row.source_member_id || null,
      hash: row.source_hash || '',
    },
    promptSnapshot: row.prompt_snapshot,
    teamCharterSnapshot: row.team_charter_snapshot || '',
    resourceSnapshot: asJson(row.resource_snapshot_json, {}),
    grants: asJson(row.grants_json, { connectors: [], skills: [] }),
    runtimeSessionId: row.runtime_session_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    runId: row.run_id || null,
    seq: row.seq,
    authorType: row.author_type,
    authorId: row.author_id || null,
    audience: asJson(row.audience_json, ['room']),
    causationId: row.causation_id || null,
    correlationId: row.correlation_id || null,
    kind: row.kind,
    content: row.content || '',
    status: row.status,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    triggerMessageId: row.trigger_message_id || null,
    mode: row.mode,
    contextSnapshotSeq: row.context_snapshot_seq,
    status: row.status,
    stopReason: row.stop_reason || '',
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
  };
}

function mapTurn(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    roomId: row.room_id,
    memberId: row.member_id,
    assignment: row.assignment,
    ordinal: row.ordinal,
    contextSnapshotSeq: row.context_snapshot_seq,
    promptHash: row.prompt_hash || '',
    outputMessageId: row.output_message_id,
    resourceFingerprint: row.resource_fingerprint || '',
    status: row.status,
    trace: asJson(row.trace_json, []),
    usage: asJson(row.usage_json, null),
    error: row.error || '',
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
  };
}

export class GroupRoomStore {
  #db;
  #paths;

  constructor({ paths, databasePath = paths?.databasePath } = {}) {
    if (!databasePath) throw new Error('Group Room database path is required.');
    this.#paths = paths || null;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.#db = new DatabaseSync(databasePath);
    this.#db.exec('PRAGMA foreign_keys=ON');
    this.#db.exec('PRAGMA journal_mode=WAL');
    this.#db.exec('PRAGMA synchronous=NORMAL');
    this.#db.exec('PRAGMA busy_timeout=5000');
    this.#migrate();
    this.recoverInterrupted();
    this.#sweepOrphans();
  }

  #migrate() {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS group_room_schema (
        version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS group_rooms (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        topic TEXT NOT NULL,
        workspace TEXT NOT NULL,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        summary TEXT NOT NULL DEFAULT '',
        summary_through_seq INTEGER NOT NULL DEFAULT 0,
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS group_room_members (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES group_rooms(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        ordinal INTEGER NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_member_id TEXT,
        source_hash TEXT,
        prompt_snapshot TEXT NOT NULL,
        team_charter_snapshot TEXT,
        resource_snapshot_json TEXT NOT NULL DEFAULT '{}',
        grants_json TEXT NOT NULL DEFAULT '{}',
        runtime_session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(room_id, ordinal),
        UNIQUE(room_id, source_kind, source_id, source_member_id)
      );
      CREATE TABLE IF NOT EXISTS group_room_messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES group_rooms(id) ON DELETE CASCADE,
        run_id TEXT,
        seq INTEGER NOT NULL,
        author_type TEXT NOT NULL,
        author_id TEXT,
        audience_json TEXT NOT NULL DEFAULT '["room"]',
        causation_id TEXT,
        correlation_id TEXT,
        kind TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        visibility TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(room_id, seq)
      );
      CREATE TABLE IF NOT EXISTS group_room_runs (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES group_rooms(id) ON DELETE CASCADE,
        trigger_message_id TEXT,
        mode TEXT NOT NULL,
        context_snapshot_seq INTEGER NOT NULL,
        status TEXT NOT NULL,
        stop_reason TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS group_room_turns (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES group_room_runs(id) ON DELETE CASCADE,
        room_id TEXT NOT NULL REFERENCES group_rooms(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL REFERENCES group_room_members(id) ON DELETE CASCADE,
        assignment TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        context_snapshot_seq INTEGER NOT NULL,
        prompt_hash TEXT,
        output_message_id TEXT NOT NULL REFERENCES group_room_messages(id),
        resource_fingerprint TEXT,
        status TEXT NOT NULL,
        trace_json TEXT NOT NULL DEFAULT '[]',
        usage_json TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        UNIQUE(run_id, ordinal),
        UNIQUE(output_message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_group_room_members_room ON group_room_members(room_id, ordinal);
      CREATE INDEX IF NOT EXISTS idx_group_room_messages_room ON group_room_messages(room_id, seq);
      CREATE INDEX IF NOT EXISTS idx_group_room_runs_room ON group_room_runs(room_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_group_room_turns_run ON group_room_turns(run_id, ordinal);
      CREATE INDEX IF NOT EXISTS idx_group_room_turns_status ON group_room_turns(status);
    `);
    const row = this.#db.prepare('SELECT version FROM group_room_schema LIMIT 1').get();
    if (!row) {
      this.#db.prepare('INSERT INTO group_room_schema(version) VALUES (?)').run(SCHEMA_VERSION);
    } else if (Number(row.version) === 1) {
      try { this.#db.exec("ALTER TABLE group_room_turns ADD COLUMN trace_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
      this.#db.prepare('UPDATE group_room_schema SET version = ?').run(SCHEMA_VERSION);
    } else if (Number(row.version) !== SCHEMA_VERSION) {
      throw new Error(`Unsupported Group Room schema version: ${row.version}`);
    }
  }

  #sweepOrphans() {
    if (!this.#paths || !fs.existsSync(this.#paths.root)) return;
    const deleting = this.#db.prepare("SELECT id FROM group_rooms WHERE status = 'deleting'").all();
    for (const row of deleting) this.#db.prepare('DELETE FROM group_rooms WHERE id = ?').run(row.id);
    const known = new Set(this.#db.prepare('SELECT id FROM group_rooms').all().map((row) => row.id));
    for (const entry of fs.readdirSync(this.#paths.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || known.has(entry.name)) continue;
      try { fs.rmSync(path.join(this.#paths.root, entry.name), { recursive: true, force: true }); } catch {}
    }
  }

  #transaction(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.#db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  #requireRoom(roomId) {
    const id = normalizeId(roomId, 'room id');
    const row = this.#db.prepare('SELECT * FROM group_rooms WHERE id = ?').get(id);
    if (!row) throw new Error(`Group Room not found: ${id}`);
    return row;
  }

  #nextSeq(roomId) {
    const row = this.#db.prepare(
      'SELECT COALESCE(MAX(seq), 0) AS seq FROM group_room_messages WHERE room_id = ?',
    ).get(roomId);
    return Number(row?.seq || 0) + 1;
  }

  createRoom(input) {
    const roomId = normalizeId(input?.id || `room_${randomUUID().replaceAll('-', '')}`, 'room id');
    const title = normalizeText(input?.title || input?.topic, 'Room title', { max: 160 });
    const topic = normalizeText(input?.topic, 'Room topic');
    const workspace = path.resolve(normalizeText(input?.workspace, 'Room workspace', { max: 4096 }));
    const members = Array.isArray(input?.members) ? input.members : [];
    if (members.length < 1 || members.length > 32) {
      throw new Error('A Group Room requires 1 to 32 members.');
    }
    const timestamp = nowMs();

    this.#transaction(() => {
      this.#db.prepare(`
        INSERT INTO group_rooms(
          id, title, topic, workspace, status, revision, settings_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'idle', 1, ?, ?, ?)
      `).run(roomId, title, topic, workspace, JSON.stringify(input?.settings || {}), timestamp, timestamp);

      const insertMember = this.#db.prepare(`
        INSERT INTO group_room_members(
          id, room_id, display_name, role, status, ordinal,
          source_kind, source_id, source_member_id, source_hash,
          prompt_snapshot, team_charter_snapshot, resource_snapshot_json,
          grants_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      members.forEach((member, index) => {
        const source = member?.source || {};
        insertMember.run(
          normalizeId(member?.id || `member_${randomUUID().replaceAll('-', '')}`, 'member id'),
          roomId,
          normalizeText(member?.displayName, 'Member display name', { max: 120 }),
          normalizeText(member?.role || member?.displayName, 'Member role', { max: 500 }),
          index,
          normalizeText(source.kind || 'assistant', 'Member source kind', { max: 40 }),
          normalizeText(source.id || member?.displayName, 'Member source id', { max: 200 }),
          source.memberId ? normalizeText(source.memberId, 'Member source member id', { max: 200 }) : null,
          typeof source.hash === 'string' ? source.hash : '',
          normalizeText(member?.promptSnapshot, 'Member prompt', { max: 500_000 }),
          typeof member?.teamCharterSnapshot === 'string' ? member.teamCharterSnapshot : '',
          JSON.stringify(member?.resourceSnapshot || {}),
          JSON.stringify(member?.grants || { connectors: [], skills: [] }),
          timestamp,
          timestamp,
        );
      });
    });

    if (this.#paths) {
      fs.mkdirSync(this.#paths.roomDir(roomId), { recursive: true });
      for (const member of this.listMembers(roomId)) {
        fs.mkdirSync(this.#paths.memberEngineDir(roomId, member.id), { recursive: true });
      }
    }
    return this.getRoom(roomId);
  }

  listRooms() {
    return this.#db.prepare('SELECT * FROM group_rooms WHERE status != ? ORDER BY updated_at DESC')
      .all('deleting')
      .map(mapRoom);
  }

  getRoom(roomId) {
    const room = mapRoom(this.#requireRoom(roomId));
    return {
      ...room,
      members: this.listMembers(room.id),
      messages: this.listMessages(room.id),
      activeRun: this.getActiveRun(room.id),
    };
  }

  listMembers(roomId) {
    const id = normalizeId(roomId, 'room id');
    return this.#db.prepare(
      'SELECT * FROM group_room_members WHERE room_id = ? ORDER BY ordinal ASC',
    ).all(id).map(mapMember);
  }

  listMessages(roomId, { includeHidden = false, afterSeq = 0 } = {}) {
    const id = normalizeId(roomId, 'room id');
    const visibilityClause = includeHidden ? '' : "AND visibility = 'public' AND status = 'completed'";
    return this.#db.prepare(`
      SELECT * FROM group_room_messages
      WHERE room_id = ? AND seq > ? ${visibilityClause}
      ORDER BY seq ASC
    `).all(id, Math.max(0, Number(afterSeq) || 0)).map(mapMessage);
  }

  promoteMessage(messageId) {
    const id = normalizeId(messageId, 'message id');
    const timestamp = nowMs();
    const result = this.#db.prepare(`
      UPDATE group_room_messages SET status = 'completed', updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(timestamp, id);
    if (Number(result.changes) !== 1) throw new Error(`Queued message not found: ${id}`);
    const message = mapMessage(this.#db.prepare('SELECT * FROM group_room_messages WHERE id = ?').get(id));
    this.#db.prepare('UPDATE group_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(timestamp, message.roomId);
    return message;
  }

  addMessage(roomId, input) {
    const id = normalizeId(roomId, 'room id');
    this.#requireRoom(id);
    const timestamp = nowMs();
    return this.#transaction(() => {
      const messageId = normalizeId(input?.id || `msg_${randomUUID().replaceAll('-', '')}`, 'message id');
      const seq = this.#nextSeq(id);
      this.#db.prepare(`
        INSERT INTO group_room_messages(
          id, room_id, run_id, seq, author_type, author_id, audience_json,
          causation_id, correlation_id, kind, content, status, visibility,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        id,
        input?.runId || null,
        seq,
        normalizeText(input?.authorType || 'human', 'Message author type', { max: 40 }),
        input?.authorId || null,
        JSON.stringify(input?.audience || ['room']),
        input?.causationId || null,
        input?.correlationId || null,
        normalizeText(input?.kind || 'message', 'Message kind', { max: 40 }),
        normalizeText(input?.content, 'Message content', { max: 500_000 }),
        input?.status || 'completed',
        input?.visibility || 'public',
        timestamp,
        timestamp,
      );
      this.#db.prepare('UPDATE group_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(timestamp, id);
      return mapMessage(this.#db.prepare('SELECT * FROM group_room_messages WHERE id = ?').get(messageId));
    });
  }

  createRun(roomId, input) {
    const id = normalizeId(roomId, 'room id');
    this.#requireRoom(id);
    const mode = RUN_MODES.has(input?.mode) ? input.mode : 'orchestrated';
    const turns = Array.isArray(input?.turns) ? input.turns : [];
    const minimumTurns = mode === 'orchestrated' ? 0 : 1;
    if (turns.length < minimumTurns || turns.length > 32) {
      throw new Error(mode === 'orchestrated'
        ? 'An orchestrated run requires 0 to 32 initial turns.'
        : 'A legacy run requires 1 to 32 turns.');
    }
    const memberIds = new Set(this.listMembers(id).map((member) => member.id));
    const runId = normalizeId(input?.id || `run_${randomUUID().replaceAll('-', '')}`, 'run id');
    const timestamp = nowMs();

    this.#transaction(() => {
      const maxSeq = this.#nextSeq(id) - 1;
      const requestedSnapshot = Number(input?.contextSnapshotSeq);
      const snapshotSeq = Number.isFinite(requestedSnapshot)
        ? Math.max(0, Math.min(maxSeq, Math.floor(requestedSnapshot)))
        : maxSeq;
      this.#db.prepare(`
        INSERT INTO group_room_runs(
          id, room_id, trigger_message_id, mode, context_snapshot_seq,
          status, created_at, started_at
        ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)
      `).run(runId, id, input?.triggerMessageId || null, mode, snapshotSeq, timestamp, timestamp);

      let seq = maxSeq + 1;
      const insertMessage = this.#db.prepare(`
        INSERT INTO group_room_messages(
          id, room_id, run_id, seq, author_type, author_id, audience_json,
          causation_id, correlation_id, kind, content, status, visibility,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'agent', ?, '["room"]', ?, ?, 'conclusion', '', 'pending', 'public', ?, ?)
      `);
      const insertTurn = this.#db.prepare(`
        INSERT INTO group_room_turns(
          id, run_id, room_id, member_id, assignment, ordinal,
          context_snapshot_seq, output_message_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `);
      turns.forEach((turn, index) => {
        const memberId = normalizeId(turn?.memberId, 'turn member id');
        if (!memberIds.has(memberId)) throw new Error(`Member does not belong to room: ${memberId}`);
        const outputMessageId = `msg_${randomUUID().replaceAll('-', '')}`;
        const turnId = normalizeId(turn?.id || `turn_${randomUUID().replaceAll('-', '')}`, 'turn id');
        insertMessage.run(
          outputMessageId,
          id,
          runId,
          seq++,
          memberId,
          input?.triggerMessageId || null,
          runId,
          timestamp,
          timestamp,
        );
        insertTurn.run(
          turnId,
          runId,
          id,
          memberId,
          normalizeText(turn?.assignment, 'Turn assignment', { max: 100_000 }),
          index,
          snapshotSeq,
          outputMessageId,
          timestamp,
        );
      });
      this.#db.prepare("UPDATE group_rooms SET status = 'running', revision = revision + 1, updated_at = ? WHERE id = ?")
        .run(timestamp, id);
    });
    return this.getRun(runId);
  }

  appendRunTurns(runId, turns, { contextSnapshotSeq } = {}) {
    const id = normalizeId(runId, 'run id');
    const inputs = Array.isArray(turns) ? turns : [];
    if (inputs.length < 1 || inputs.length > 32) throw new Error('A discussion round requires 1 to 32 turns.');
    const timestamp = nowMs();
    return this.#transaction(() => {
      const run = this.#db.prepare('SELECT * FROM group_room_runs WHERE id = ?').get(id);
      if (!run || run.status !== 'running') throw new Error(`Run is not active: ${id}`);
      const memberIds = new Set(this.listMembers(run.room_id).map((member) => member.id));
      const maxSeq = this.#nextSeq(run.room_id) - 1;
      const requestedSnapshot = Number(contextSnapshotSeq);
      const snapshotSeq = Number.isFinite(requestedSnapshot)
        ? Math.max(0, Math.min(maxSeq, Math.floor(requestedSnapshot)))
        : maxSeq;
      const ordinalRow = this.#db.prepare(
        'SELECT COALESCE(MAX(ordinal), -1) AS ordinal FROM group_room_turns WHERE run_id = ?',
      ).get(id);
      let ordinal = Number(ordinalRow?.ordinal) + 1;
      let seq = maxSeq + 1;
      const insertMessage = this.#db.prepare(`
        INSERT INTO group_room_messages(
          id, room_id, run_id, seq, author_type, author_id, audience_json,
          causation_id, correlation_id, kind, content, status, visibility,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'agent', ?, '["room"]', ?, ?, 'conclusion', '', 'pending', 'public', ?, ?)
      `);
      const insertTurn = this.#db.prepare(`
        INSERT INTO group_room_turns(
          id, run_id, room_id, member_id, assignment, ordinal,
          context_snapshot_seq, output_message_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `);
      for (const turn of inputs) {
        const memberId = normalizeId(turn?.memberId, 'turn member id');
        if (!memberIds.has(memberId)) throw new Error(`Member does not belong to room: ${memberId}`);
        const outputMessageId = `msg_${randomUUID().replaceAll('-', '')}`;
        const turnId = normalizeId(turn?.id || `turn_${randomUUID().replaceAll('-', '')}`, 'turn id');
        insertMessage.run(
          outputMessageId,
          run.room_id,
          id,
          seq++,
          memberId,
          run.trigger_message_id || null,
          id,
          timestamp,
          timestamp,
        );
        insertTurn.run(
          turnId,
          id,
          run.room_id,
          memberId,
          normalizeText(turn?.assignment, 'Turn assignment', { max: 100_000 }),
          ordinal++,
          snapshotSeq,
          outputMessageId,
          timestamp,
        );
      }
      this.#db.prepare('UPDATE group_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(timestamp, run.room_id);
      return this.getRun(id);
    });
  }

  getRun(runId) {
    const id = normalizeId(runId, 'run id');
    const run = mapRun(this.#db.prepare('SELECT * FROM group_room_runs WHERE id = ?').get(id));
    if (!run) return null;
    return {
      ...run,
      turns: this.#db.prepare(
        'SELECT * FROM group_room_turns WHERE run_id = ? ORDER BY ordinal ASC',
      ).all(id).map(mapTurn),
    };
  }

  getActiveRun(roomId) {
    const id = normalizeId(roomId, 'room id');
    const row = this.#db.prepare(`
      SELECT * FROM group_room_runs
      WHERE room_id = ? AND status IN ('running', 'stopping')
      ORDER BY created_at DESC LIMIT 1
    `).get(id);
    return row ? this.getRun(row.id) : null;
  }

  listRuns(roomId, { limit = 20 } = {}) {
    const id = normalizeId(roomId, 'room id');
    const rows = this.#db.prepare(`
      SELECT * FROM group_room_runs WHERE room_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(id, Math.max(1, Math.min(100, Math.floor(Number(limit) || 20))));
    return rows.map((row) => this.getRun(row.id));
  }

  startTurn(turnId, { promptHash = '', resourceFingerprint = '', contextSnapshotSeq } = {}) {
    const id = normalizeId(turnId, 'turn id');
    const timestamp = nowMs();
    const result = this.#db.prepare(`
      UPDATE group_room_turns
      SET status = 'running', prompt_hash = ?, resource_fingerprint = ?,
          context_snapshot_seq = COALESCE(?, context_snapshot_seq), started_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(
      promptHash,
      resourceFingerprint,
      Number.isFinite(contextSnapshotSeq)
        ? Math.max(0, Math.floor(contextSnapshotSeq))
        : null,
      timestamp,
      id,
    );
    if (Number(result.changes) !== 1) throw new Error(`Turn is not pending: ${id}`);
    const turn = mapTurn(this.#db.prepare('SELECT * FROM group_room_turns WHERE id = ?').get(id));
    this.#db.prepare('UPDATE group_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(timestamp, turn.roomId);
    return turn;
  }

  completeTurn(turnId, { content, usage = null, trace = [], promptHash = '' } = {}) {
    const id = normalizeId(turnId, 'turn id');
    const timestamp = nowMs();
    return this.#transaction(() => {
      const row = this.#db.prepare('SELECT * FROM group_room_turns WHERE id = ?').get(id);
      if (!row || !['pending', 'running'].includes(row.status)) throw new Error(`Turn is not active: ${id}`);
      this.#db.prepare(`
        UPDATE group_room_messages
        SET content = ?, status = 'completed', updated_at = ?
        WHERE id = ?
      `).run(normalizeText(content, 'Turn output', { max: 500_000 }), timestamp, row.output_message_id);
      this.#db.prepare(`
        UPDATE group_room_turns
        SET status = 'completed', trace_json = ?, usage_json = ?,
            prompt_hash = CASE WHEN ? = '' THEN prompt_hash ELSE ? END,
            completed_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify(Array.isArray(trace) ? trace : []),
        usage ? JSON.stringify(usage) : null,
        promptHash,
        promptHash,
        timestamp,
        id,
      );
      this.#db.prepare('UPDATE group_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(timestamp, row.room_id);
      return mapTurn(this.#db.prepare('SELECT * FROM group_room_turns WHERE id = ?').get(id));
    });
  }

  failTurn(turnId, error, status = 'failed', { trace = [], usage = null } = {}) {
    const id = normalizeId(turnId, 'turn id');
    if (!['failed', 'interrupted'].includes(status)) throw new Error('Invalid turn failure status.');
    const timestamp = nowMs();
    return this.#transaction(() => {
      const row = this.#db.prepare('SELECT * FROM group_room_turns WHERE id = ?').get(id);
      if (!row) throw new Error(`Turn not found: ${id}`);
      this.#db.prepare(`
        UPDATE group_room_turns
        SET status = ?, error = ?, trace_json = ?, usage_json = ?, completed_at = ?
        WHERE id = ?
      `).run(
        status,
        String(error || ''),
        JSON.stringify(Array.isArray(trace) ? trace : []),
        usage ? JSON.stringify(usage) : null,
        timestamp,
        id,
      );
      this.#db.prepare(`
        UPDATE group_room_messages SET status = ?, visibility = 'hidden', updated_at = ? WHERE id = ?
      `).run(status, timestamp, row.output_message_id);
      this.#db.prepare('UPDATE group_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(timestamp, row.room_id);
      return mapTurn(this.#db.prepare('SELECT * FROM group_room_turns WHERE id = ?').get(id));
    });
  }

  finishRun(runId, { status = 'completed', stopReason = '' } = {}) {
    const id = normalizeId(runId, 'run id');
    if (!['completed', 'failed', 'interrupted', 'superseded'].includes(status)) {
      throw new Error('Invalid run completion status.');
    }
    const timestamp = nowMs();
    return this.#transaction(() => {
      const run = this.#db.prepare('SELECT * FROM group_room_runs WHERE id = ?').get(id);
      if (!run) throw new Error(`Run not found: ${id}`);
      if (status !== 'completed') {
        const activeTurns = this.#db.prepare(
          "SELECT id, output_message_id FROM group_room_turns WHERE run_id = ? AND status IN ('pending', 'running')",
        ).all(id);
        const updateTurn = this.#db.prepare(`
          UPDATE group_room_turns
          SET status = 'interrupted', error = ?, completed_at = ? WHERE id = ?
        `);
        const updateMessage = this.#db.prepare(`
          UPDATE group_room_messages
          SET status = 'interrupted', visibility = 'hidden', updated_at = ? WHERE id = ?
        `);
        for (const turn of activeTurns) {
          updateTurn.run(stopReason || status, timestamp, turn.id);
          updateMessage.run(timestamp, turn.output_message_id);
        }
      }
      this.#db.prepare(`
        UPDATE group_room_runs SET status = ?, stop_reason = ?, completed_at = ? WHERE id = ?
      `).run(status, stopReason, timestamp, id);
      this.#db.prepare(`
        UPDATE group_rooms SET status = ?, revision = revision + 1, updated_at = ? WHERE id = ?
      `).run(status === 'completed' ? 'idle' : 'paused', timestamp, run.room_id);
      return this.getRun(id);
    });
  }

  setMemberRuntimeSession(memberId, runtimeSessionId) {
    const id = normalizeId(memberId, 'member id');
    this.#db.prepare(`
      UPDATE group_room_members SET runtime_session_id = ?, updated_at = ? WHERE id = ?
    `).run(runtimeSessionId || null, nowMs(), id);
  }

  updateMemberGrants(roomId, memberId, grants, expectedRevision) {
    const room = this.#requireRoom(roomId);
    const id = normalizeId(memberId, 'member id');
    if (Number.isFinite(expectedRevision) && room.revision !== expectedRevision) {
      throw new Error('Group Room was updated elsewhere. Refresh and retry.');
    }
    const member = this.#db.prepare(
      'SELECT id FROM group_room_members WHERE id = ? AND room_id = ?',
    ).get(id, room.id);
    if (!member) throw new Error(`Room member not found: ${id}`);
    const timestamp = nowMs();
    this.#transaction(() => {
      this.#db.prepare(`
        UPDATE group_room_members SET grants_json = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(grants || { connectors: [], skills: [] }), timestamp, id);
      this.#db.prepare('UPDATE group_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(timestamp, room.id);
    });
    return this.getRoom(room.id);
  }

  updateMemberSnapshot(roomId, memberId, snapshot, expectedRevision) {
    const room = this.#requireRoom(roomId);
    const id = normalizeId(memberId, 'member id');
    if (Number.isFinite(expectedRevision) && room.revision !== expectedRevision) {
      throw new Error('Group Room was updated elsewhere. Refresh and retry.');
    }
    const timestamp = nowMs();
    const result = this.#db.prepare(`
      UPDATE group_room_members
      SET display_name = ?, role = ?, source_hash = ?, prompt_snapshot = ?,
          team_charter_snapshot = ?, resource_snapshot_json = ?,
          runtime_session_id = NULL, updated_at = ?
      WHERE id = ? AND room_id = ?
    `).run(
      normalizeText(snapshot?.displayName, 'Member display name', { max: 120 }),
      normalizeText(snapshot?.role || snapshot?.displayName, 'Member role', { max: 500 }),
      String(snapshot?.source?.hash || ''),
      normalizeText(snapshot?.promptSnapshot, 'Member prompt', { max: 500_000 }),
      String(snapshot?.teamCharterSnapshot || ''),
      JSON.stringify(snapshot?.resourceSnapshot || {}),
      timestamp,
      id,
      room.id,
    );
    if (Number(result.changes) !== 1) throw new Error(`Room member not found: ${id}`);
    this.#db.prepare('UPDATE group_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(timestamp, room.id);
    return this.getRoom(room.id);
  }

  updateRoom(roomId, updates, expectedRevision) {
    const id = normalizeId(roomId, 'room id');
    const current = this.#requireRoom(id);
    if (Number.isFinite(expectedRevision) && current.revision !== expectedRevision) {
      throw new Error('Group Room was updated elsewhere. Refresh and retry.');
    }
    const title = updates?.title === undefined
      ? current.title
      : normalizeText(updates.title, 'Room title', { max: 160 });
    const topic = updates?.topic === undefined
      ? current.topic
      : normalizeText(updates.topic, 'Room topic');
    const settings = updates?.settings === undefined
      ? current.settings_json
      : JSON.stringify(updates.settings || {});
    const status = updates?.status === undefined ? current.status : updates.status;
    if (!ROOM_STATUSES.has(status)) throw new Error('Invalid room status.');
    this.#db.prepare(`
      UPDATE group_rooms
      SET title = ?, topic = ?, settings_json = ?, status = ?, revision = revision + 1, updated_at = ?
      WHERE id = ?
    `).run(title, topic, settings, status, nowMs(), id);
    return this.getRoom(id);
  }

  updateSummary(roomId, summary, summaryThroughSeq) {
    const id = normalizeId(roomId, 'room id');
    this.#requireRoom(id);
    const throughSeq = Math.max(0, Math.floor(Number(summaryThroughSeq) || 0));
    const maxCompleted = this.#db.prepare(`
      SELECT COALESCE(MAX(seq), 0) AS seq FROM group_room_messages
      WHERE room_id = ? AND status = 'completed' AND visibility = 'public'
    `).get(id);
    if (throughSeq > Number(maxCompleted?.seq || 0)) throw new Error('Summary watermark exceeds public history.');
    this.#db.prepare(`
      UPDATE group_rooms
      SET summary = ?, summary_through_seq = ?, revision = revision + 1, updated_at = ?
      WHERE id = ?
    `).run(normalizeText(summary, 'Room summary', { max: 200_000 }), throughSeq, nowMs(), id);
    return this.getRoom(id);
  }

  recoverInterrupted() {
    const timestamp = nowMs();
    this.#transaction(() => {
      this.#db.prepare(`
        UPDATE group_room_turns
        SET status = 'interrupted', error = 'Application restarted during execution', completed_at = ?
        WHERE status IN ('pending', 'running')
      `).run(timestamp);
      this.#db.prepare(`
        UPDATE group_room_messages
        SET status = 'interrupted', visibility = 'hidden', updated_at = ?
        WHERE status = 'pending'
      `).run(timestamp);
      this.#db.prepare(`
        UPDATE group_room_runs
        SET status = 'interrupted', stop_reason = 'Application restarted during execution', completed_at = ?
        WHERE status IN ('running', 'stopping')
      `).run(timestamp);
      this.#db.prepare(`
        UPDATE group_rooms SET status = 'paused', revision = revision + 1, updated_at = ?
        WHERE status = 'running'
      `).run(timestamp);
    });
  }

  async deleteRoom(roomId) {
    const id = normalizeId(roomId, 'room id');
    this.#requireRoom(id);
    this.#transaction(() => {
      this.#db.prepare("UPDATE group_rooms SET status = 'deleting', updated_at = ? WHERE id = ?")
        .run(nowMs(), id);
      this.#db.prepare('DELETE FROM group_rooms WHERE id = ?').run(id);
    });
    if (this.#paths) await fsp.rm(this.#paths.roomDir(id), { recursive: true, force: true });
  }

  close() {
    this.#db.close();
  }
}
