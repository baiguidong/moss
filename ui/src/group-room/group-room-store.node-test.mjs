import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createGroupRoomDataPaths } from './group-room-layout.mjs';
import { GroupRoomStore } from './group-room-store.mjs';
import { GroupRoomController } from './group-room-controller.mjs';

const roots = [];

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-group-room-v2-'));
  roots.push(root);
  const paths = createGroupRoomDataPaths(root);
  const workspace = path.join(root, 'workspace');
  await fsp.mkdir(workspace, { recursive: true });
  return { root, paths, workspace };
}

function member(name, sourceMemberId = null) {
  return {
    displayName: name,
    role: `${name} role`,
    source: { kind: sourceMemberId ? 'expert-team' : 'assistant', id: 'source', memberId: sourceMemberId, hash: `${name}-hash` },
    promptSnapshot: `${name} prompt`,
    teamCharterSnapshot: 'Shared charter',
    resourceSnapshot: { assistantName: name, assistantPath: `/tmp/${name}`, skillCommands: ['review'] },
    grants: { connectors: [], skills: ['review'] },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

describe('GroupRoomStore V2', () => {
  test('stores configuration and a stable normal-session binding only', async () => {
    const { paths, workspace } = await fixture();
    const store = new GroupRoomStore({ paths });
    const room = store.createRoom({
      id: 'room_one', sessionId: 'session_one', topic: 'Review', workspace,
      members: [member('Reviewer', 'reviewer')],
    });
    assert.equal(room.sessionId, 'session_one');
    assert.equal(room.members.length, 1);
    assert.equal(Object.hasOwn(room, 'messages'), false);
    store.close();

    const db = new DatabaseSync(paths.databasePath);
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
    assert.equal(names.includes('group_room_messages'), false);
    assert.equal(names.includes('group_room_runs'), false);
    assert.equal(names.includes('group_room_turns'), false);
    db.close();
  });

  test('destructively resets an unreleased legacy schema', async () => {
    const { paths } = await fixture();
    await fsp.mkdir(path.dirname(paths.databasePath), { recursive: true });
    const legacy = new DatabaseSync(paths.databasePath);
    legacy.exec(`
      CREATE TABLE group_room_schema(version INTEGER NOT NULL);
      INSERT INTO group_room_schema(version) VALUES (3);
      CREATE TABLE group_rooms(id TEXT PRIMARY KEY);
      CREATE TABLE group_room_messages(id TEXT PRIMARY KEY);
      INSERT INTO group_rooms(id) VALUES ('legacy');
    `);
    legacy.close();
    const store = new GroupRoomStore({ paths });
    assert.deepEqual(store.listRooms(), []);
    store.close();
    const db = new DatabaseSync(paths.databasePath);
    assert.equal(db.prepare('SELECT version FROM group_room_schema').get().version, 4);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='group_room_messages'").get().count, 0);
    db.close();
  });

  test('persists ordering and supports member add/remove with revision checks', async () => {
    const { paths, workspace } = await fixture();
    const store = new GroupRoomStore({ paths });
    const first = store.createRoom({ id: 'room_one', sessionId: 'session_one', topic: 'One', workspace, members: [member('A', 'a')] });
    store.createRoom({ id: 'room_two', sessionId: 'session_two', topic: 'Two', workspace, members: [member('B', 'b')] });
    assert.deepEqual(store.reorder(['room_two', 'room_one']).map((room) => room.id), ['room_two', 'room_one']);
    const added = store.addMembers(first.id, [member('C', 'c')], first.revision);
    assert.deepEqual(added.members.map((entry) => entry.displayName), ['A', 'C']);
    const removed = store.removeMember(first.id, added.members[0].id, added.revision);
    assert.deepEqual(removed.members.map((entry) => entry.displayName), ['C']);
    assert.throws(() => store.removeMember(first.id, removed.members[0].id, removed.revision), /at least one/);
    store.close();
  });
});

describe('GroupRoomController V2', () => {
  test('creates one native session and exposes a scoped fixed roster', async () => {
    const { paths, workspace } = await fixture();
    const store = new GroupRoomStore({ paths });
    const syncs = [];
    const sessions = new Map();
    const controller = new GroupRoomController({
      store,
      paths,
      catalog: {
        listInviteables: async () => [], listConnectors: async () => [], listSkills: async () => [],
        resolveInvitations: async () => [member('Reviewer', 'reviewer')],
        resolveCustomMembers: async () => [],
      },
      sessions: {
        create: ({ roomId }) => { const summary = { id: 'session_one', busy: false, preview: '', messageCount: 0, roomId }; sessions.set(summary.id, summary); return summary; },
        sync: async (room) => { syncs.push(room); },
        delete: async (id) => { sessions.delete(id); },
        getSummary: (id) => sessions.get(id),
        isActive: (id) => sessions.get(id)?.busy === true,
      },
      emit() {},
    });
    const room = await controller.createRoom({ topic: 'Review the repository', workspace, invitationIds: ['review'] });
    assert.equal(room.sessionId, 'session_one');
    assert.equal(syncs.length, 1);
    assert.equal(Object.hasOwn(room.members[0], 'promptSnapshot'), false);
    const descriptor = controller.getRuntimeDescriptor(room.id);
    assert.equal(descriptor.members[0].id, room.members[0].id);
    assert.match(await fsp.readFile(descriptor.members[0].expertInstructionsPath, 'utf8'), /Reviewer prompt/);
    assert.equal(path.basename(path.dirname(descriptor.members[0].expertInstructionsPath)), room.members[0].id);
    assert.equal(descriptor.addDirs.includes(paths.resourcesDir(room.id)), true);
    assert.equal(Object.hasOwn(descriptor, 'runtime'), false);
    sessions.get(room.sessionId).busy = true;
    await assert.rejects(
      controller.updateRoom(room.id, { title: 'Blocked while active' }, room.revision),
      /coordinator or a member is running/,
    );
    sessions.get(room.sessionId).busy = false;
    await controller.deleteRoom(room.id);
    assert.equal(sessions.size, 0);
    store.close();
  });
});
