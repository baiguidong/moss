import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 4;

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

function mapRoom(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    topic: row.topic,
    workspace: row.workspace,
    order: Number(row.sort_order) || 0,
    revision: Number(row.revision) || 1,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    this.#initialize();
    this.#sweepOrphans();
  }

  #initialize() {
    this.#db.exec('CREATE TABLE IF NOT EXISTS group_room_schema (version INTEGER NOT NULL)');
    const version = Number(this.#db.prepare('SELECT version FROM group_room_schema LIMIT 1').get()?.version || 0);
    if (version !== SCHEMA_VERSION) {
      this.#db.exec('PRAGMA foreign_keys=OFF');
      this.#db.exec(`
        DROP TABLE IF EXISTS group_room_turns;
        DROP TABLE IF EXISTS group_room_runs;
        DROP TABLE IF EXISTS group_room_messages;
        DROP TABLE IF EXISTS group_room_members;
        DROP TABLE IF EXISTS group_rooms;
        DELETE FROM group_room_schema;
      `);
      this.#db.exec('PRAGMA foreign_keys=ON');
    }
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS group_rooms (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        topic TEXT NOT NULL,
        workspace TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS group_room_members (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES group_rooms(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_member_id TEXT,
        source_hash TEXT,
        prompt_snapshot TEXT NOT NULL,
        team_charter_snapshot TEXT,
        resource_snapshot_json TEXT NOT NULL DEFAULT '{}',
        grants_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(room_id, ordinal),
        UNIQUE(room_id, source_kind, source_id, source_member_id)
      );
      CREATE INDEX IF NOT EXISTS idx_group_room_order ON group_rooms(sort_order, created_at);
      CREATE INDEX IF NOT EXISTS idx_group_room_members_room ON group_room_members(room_id, ordinal);
    `);
    if (version !== SCHEMA_VERSION) {
      this.#db.prepare('INSERT INTO group_room_schema(version) VALUES (?)').run(SCHEMA_VERSION);
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

  #sweepOrphans() {
    if (!this.#paths || !fs.existsSync(this.#paths.root)) return;
    const known = new Set(this.#db.prepare('SELECT id FROM group_rooms').all().map((row) => row.id));
    for (const entry of fs.readdirSync(this.#paths.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || known.has(entry.name)) continue;
      try { fs.rmSync(path.join(this.#paths.root, entry.name), { recursive: true, force: true }); } catch {}
    }
  }

  createRoom(input) {
    const roomId = normalizeId(input?.id || `room_${randomUUID().replaceAll('-', '')}`, 'room id');
    const sessionId = normalizeId(input?.sessionId, 'room session id');
    const title = normalizeText(input?.title || input?.topic, 'Room title', { max: 160 });
    const topic = normalizeText(input?.topic, 'Room topic');
    const workspace = path.resolve(normalizeText(input?.workspace, 'Room workspace', { max: 4096 }));
    const members = Array.isArray(input?.members) ? input.members : [];
    if (members.length < 1 || members.length > 32) throw new Error('A Group Room requires 1 to 32 members.');
    const now = Date.now();
    const nextOrder = Number(this.#db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM group_rooms').get()?.value || 0);

    this.#transaction(() => {
      this.#db.prepare(`
        INSERT INTO group_rooms(
          id, session_id, title, topic, workspace, sort_order, revision,
          settings_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(roomId, sessionId, title, topic, workspace, nextOrder, JSON.stringify(input?.settings || {}), now, now);

      const insert = this.#db.prepare(`
        INSERT INTO group_room_members(
          id, room_id, display_name, role, ordinal,
          source_kind, source_id, source_member_id, source_hash,
          prompt_snapshot, team_charter_snapshot, resource_snapshot_json,
          grants_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      members.forEach((member, ordinal) => {
        const source = member?.source || {};
        insert.run(
          normalizeId(member?.id || `member_${randomUUID().replaceAll('-', '')}`, 'member id'),
          roomId,
          normalizeText(member?.displayName, 'Member display name', { max: 120 }),
          normalizeText(member?.role || member?.displayName, 'Member role', { max: 500 }),
          ordinal,
          normalizeText(source.kind || 'assistant', 'Member source kind', { max: 40 }),
          normalizeText(source.id || member?.displayName, 'Member source id', { max: 200 }),
          source.memberId ? normalizeText(source.memberId, 'Member source member id', { max: 200 }) : null,
          typeof source.hash === 'string' ? source.hash : '',
          normalizeText(member?.promptSnapshot, 'Member prompt', { max: 500_000 }),
          typeof member?.teamCharterSnapshot === 'string' ? member.teamCharterSnapshot : '',
          JSON.stringify(member?.resourceSnapshot || {}),
          JSON.stringify(member?.grants || { connectors: [], skills: [] }),
          now,
          now,
        );
      });
    });

    if (this.#paths) fs.mkdirSync(this.#paths.resourcesDir(roomId), { recursive: true });
    return this.getRoom(roomId);
  }

  listRooms() {
    return this.#db.prepare('SELECT * FROM group_rooms ORDER BY sort_order ASC, created_at ASC')
      .all()
      .map(mapRoom);
  }

  getRoom(roomId) {
    const room = mapRoom(this.#requireRoom(roomId));
    return { ...room, members: this.listMembers(room.id) };
  }

  listMembers(roomId) {
    const id = normalizeId(roomId, 'room id');
    return this.#db.prepare('SELECT * FROM group_room_members WHERE room_id = ? ORDER BY ordinal ASC')
      .all(id)
      .map(mapMember);
  }

  updateRoom(roomId, updates, expectedRevision) {
    const current = mapRoom(this.#requireRoom(roomId));
    if (Number(expectedRevision) !== current.revision) throw new Error('Group Room changed; reload before saving.');
    const title = updates?.title === undefined
      ? current.title
      : normalizeText(updates.title, 'Room title', { max: 160 });
    const topic = updates?.topic === undefined
      ? current.topic
      : normalizeText(updates.topic, 'Room topic');
    const workspace = updates?.workspace === undefined
      ? current.workspace
      : path.resolve(normalizeText(updates.workspace, 'Room workspace', { max: 4096 }));
    const settings = updates?.settings === undefined ? current.settings : updates.settings;
    const now = Date.now();
    const result = this.#db.prepare(`
      UPDATE group_rooms
      SET title = ?, topic = ?, workspace = ?, settings_json = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?
    `).run(title, topic, workspace, JSON.stringify(settings || {}), now, current.id, current.revision);
    if (Number(result.changes) !== 1) throw new Error('Group Room changed; reload before saving.');
    return this.getRoom(current.id);
  }

  updateMemberGrants(roomId, memberId, grants, expectedRevision) {
    const room = mapRoom(this.#requireRoom(roomId));
    if (Number(expectedRevision) !== room.revision) throw new Error('Group Room changed; reload before saving.');
    const id = normalizeId(memberId, 'member id');
    const now = Date.now();
    return this.#transaction(() => {
      const updated = this.#db.prepare(`
        UPDATE group_room_members SET grants_json = ?, updated_at = ?
        WHERE id = ? AND room_id = ?
      `).run(JSON.stringify(grants || { connectors: [], skills: [] }), now, id, room.id);
      if (Number(updated.changes) !== 1) throw new Error(`Room member not found: ${id}`);
      this.#db.prepare('UPDATE group_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(now, room.id);
      return this.getRoom(room.id);
    });
  }

  updateMemberSnapshot(roomId, memberId, snapshot, expectedRevision) {
    const room = mapRoom(this.#requireRoom(roomId));
    if (Number(expectedRevision) !== room.revision) throw new Error('Group Room changed; reload before saving.');
    const id = normalizeId(memberId, 'member id');
    const now = Date.now();
    return this.#transaction(() => {
      const updated = this.#db.prepare(`
        UPDATE group_room_members
        SET display_name = ?, role = ?, source_hash = ?, prompt_snapshot = ?,
            team_charter_snapshot = ?, resource_snapshot_json = ?, grants_json = ?, updated_at = ?
        WHERE id = ? AND room_id = ?
      `).run(
        normalizeText(snapshot?.displayName, 'Member display name', { max: 120 }),
        normalizeText(snapshot?.role || snapshot?.displayName, 'Member role', { max: 500 }),
        snapshot?.source?.hash || '',
        normalizeText(snapshot?.promptSnapshot, 'Member prompt', { max: 500_000 }),
        snapshot?.teamCharterSnapshot || '',
        JSON.stringify(snapshot?.resourceSnapshot || {}),
        JSON.stringify(snapshot?.grants || { connectors: [], skills: [] }),
        now,
        id,
        room.id,
      );
      if (Number(updated.changes) !== 1) throw new Error(`Room member not found: ${id}`);
      this.#db.prepare('UPDATE group_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(now, room.id);
      return this.getRoom(room.id);
    });
  }

  addMembers(roomId, members, expectedRevision) {
    const room = this.getRoom(roomId);
    if (Number(expectedRevision) !== room.revision) throw new Error('Group Room changed; reload before saving.');
    const additions = Array.isArray(members) ? members : [];
    if (additions.length < 1 || room.members.length + additions.length > 32) {
      throw new Error('A Group Room requires 1 to 32 members.');
    }
    const now = Date.now();
    this.#transaction(() => {
      const insert = this.#db.prepare(`
        INSERT INTO group_room_members(
          id, room_id, display_name, role, ordinal,
          source_kind, source_id, source_member_id, source_hash,
          prompt_snapshot, team_charter_snapshot, resource_snapshot_json,
          grants_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      additions.forEach((member, offset) => {
        const source = member?.source || {};
        insert.run(
          normalizeId(member?.id || `member_${randomUUID().replaceAll('-', '')}`, 'member id'),
          room.id,
          normalizeText(member?.displayName, 'Member display name', { max: 120 }),
          normalizeText(member?.role || member?.displayName, 'Member role', { max: 500 }),
          room.members.length + offset,
          normalizeText(source.kind || 'assistant', 'Member source kind', { max: 40 }),
          normalizeText(source.id || member?.displayName, 'Member source id', { max: 200 }),
          source.memberId ? normalizeText(source.memberId, 'Member source member id', { max: 200 }) : null,
          typeof source.hash === 'string' ? source.hash : '',
          normalizeText(member?.promptSnapshot, 'Member prompt', { max: 500_000 }),
          typeof member?.teamCharterSnapshot === 'string' ? member.teamCharterSnapshot : '',
          JSON.stringify(member?.resourceSnapshot || {}),
          JSON.stringify(member?.grants || { connectors: [], skills: [] }),
          now,
          now,
        );
      });
      this.#db.prepare('UPDATE group_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(now, room.id);
    });
    return this.getRoom(room.id);
  }

  removeMember(roomId, memberId, expectedRevision) {
    const room = this.getRoom(roomId);
    if (Number(expectedRevision) !== room.revision) throw new Error('Group Room changed; reload before saving.');
    if (room.members.length <= 1) throw new Error('A Group Room must keep at least one member.');
    const id = normalizeId(memberId, 'member id');
    const now = Date.now();
    this.#transaction(() => {
      const removed = this.#db.prepare('DELETE FROM group_room_members WHERE room_id = ? AND id = ?')
        .run(room.id, id);
      if (Number(removed.changes) !== 1) throw new Error(`Room member not found: ${id}`);
      const remaining = this.#db.prepare('SELECT id FROM group_room_members WHERE room_id = ? ORDER BY ordinal ASC').all(room.id);
      const reorder = this.#db.prepare('UPDATE group_room_members SET ordinal = ?, updated_at = ? WHERE id = ?');
      remaining.forEach((member, ordinal) => reorder.run(ordinal, now, member.id));
      this.#db.prepare('UPDATE group_rooms SET revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(now, room.id);
    });
    return this.getRoom(room.id);
  }

  reorder(roomIds) {
    const ids = Array.isArray(roomIds) ? roomIds.map((id) => normalizeId(id, 'room id')) : [];
    const existing = this.listRooms().map((room) => room.id);
    if (ids.length !== existing.length || new Set(ids).size !== ids.length || existing.some((id) => !ids.includes(id))) {
      throw new Error('Room order must include every room exactly once.');
    }
    const now = Date.now();
    this.#transaction(() => {
      const update = this.#db.prepare('UPDATE group_rooms SET sort_order = ?, updated_at = ? WHERE id = ?');
      ids.forEach((id, index) => update.run(index, now, id));
    });
    return this.listRooms();
  }

  async deleteRoom(roomId) {
    const room = mapRoom(this.#requireRoom(roomId));
    this.#db.prepare('DELETE FROM group_rooms WHERE id = ?').run(room.id);
    if (this.#paths) await fsp.rm(this.#paths.roomDir(room.id), { recursive: true, force: true });
    return room;
  }

  close() {
    this.#db.close();
  }
}
