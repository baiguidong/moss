import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createGroupRoomDataPaths } from './group-room-layout.mjs';
import { GroupRoomStore } from './group-room-store.mjs';
import { GroupRoomController } from './group-room-controller.mjs';
import { RoomExecutionScheduler } from './group-room-scheduler.mjs';

const roots = [];

async function createStore() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-group-room-'));
  roots.push(root);
  const paths = createGroupRoomDataPaths(root);
  const store = new GroupRoomStore({ paths });
  await fsp.mkdir(path.join(paths.root, 'workspace'), { recursive: true });
  return { store, paths };
}

function member(name, sourceMemberId = null) {
  return {
    displayName: name,
    role: `${name} role`,
    source: { kind: sourceMemberId ? 'expert-team' : 'assistant', id: 'source', memberId: sourceMemberId },
    promptSnapshot: `${name} prompt`,
    resourceSnapshot: {},
    grants: { connectors: [], skills: [] },
  };
}

function controllerFixture(store, paths, captures, runtimeOverrides = {}, onEmit = () => {}) {
  const catalog = {
    listInviteables: async () => [],
    listConnectors: async () => [],
    listSkills: async () => [],
    resolveInvitations: async () => [member('A', 'a'), member('B', 'b')],
    resolveCustomMembers: async () => [],
    resolveRuntimeResources: async () => ({
      connectorGrants: [],
      mcpServers: {},
      mcpServerNames: [],
      addDirs: [],
      environment: {},
      skillCommands: [],
      fingerprint: 'resources',
    }),
  };
  const runtime = {
    execute: async (input) => {
      captures.push(input);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        content: `${input.member.displayName} conclusion`,
        trace: [{ type: 'tool_call', name: 'Read' }],
        usage: { input_tokens: 1 },
        promptHash: 'prompt',
      };
    },
    abortMember() {},
    disposeMember() {},
    disposeRoom() {},
    disposeAll() {},
    ...runtimeOverrides,
  };
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const controller = new GroupRoomController({
    store,
    catalog,
    runtime,
    scheduler: new RoomExecutionScheduler({ globalLimit: 4, roomLimit: 3 }),
    emit: (channel, payload) => {
      if (channel === 'group-room:event' && payload.type === 'run-finished') finish(payload);
      onEmit(channel, payload);
    },
  });
  return { controller, finished };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

describe('GroupRoomStore', () => {
  test('creates rooms outside the Session store with complete member snapshots', async () => {
    const { store, paths } = await createStore();
    const room = store.createRoom({
      topic: 'Review a design',
      workspace: path.join(paths.root, 'workspace'),
      members: [member('Reviewer', 'reviewer'), member('Architect', 'architect')],
    });

    assert.equal(room.members.length, 2);
    assert.deepEqual(room.messages, []);
    assert.equal(room.revision, 1);
    store.close();
  });

  test('reserves deterministic output order for parallel turns', async () => {
    const { store, paths } = await createStore();
    const room = store.createRoom({
      topic: 'Parallel review',
      workspace: path.join(paths.root, 'workspace'),
      members: [member('A', 'a'), member('B', 'b')],
    });
    const trigger = store.addMessage(room.id, { authorType: 'human', content: 'Start' });
    const run = store.createRun(room.id, {
      mode: 'parallel',
      triggerMessageId: trigger.id,
      turns: room.members.map((entry) => ({ memberId: entry.id, assignment: `Task ${entry.displayName}` })),
    });

    store.startTurn(run.turns[1].id);
    store.completeTurn(run.turns[1].id, { content: 'B result' });
    store.startTurn(run.turns[0].id);
    store.completeTurn(run.turns[0].id, { content: 'A result' });
    store.finishRun(run.id);

    assert.deepEqual(store.listMessages(room.id).map((entry) => entry.content), ['Start', 'A result', 'B result']);
    store.close();
  });

  test('marks uncertain work interrupted on restart without publishing it', async () => {
    const { store, paths } = await createStore();
    const room = store.createRoom({
      topic: 'Recovery',
      workspace: path.join(paths.root, 'workspace'),
      members: [member('A', 'a')],
    });
    const run = store.createRun(room.id, {
      mode: 'conversation',
      turns: [{ memberId: room.members[0].id, assignment: 'Work' }],
    });
    store.startTurn(run.turns[0].id);
    store.close();

    const reopened = new GroupRoomStore({ paths });
    assert.equal(reopened.getRun(run.id).status, 'interrupted');
    assert.equal(reopened.getRun(run.id).turns[0].status, 'interrupted');
    assert.equal(reopened.getRoom(room.id).status, 'paused');
    assert.deepEqual(reopened.listMessages(room.id), []);
    reopened.close();
  });

  test('persists stable private trace records and promotes queued intervention', async () => {
    const { store, paths } = await createStore();
    const room = store.createRoom({
      topic: 'Trace',
      workspace: path.join(paths.root, 'workspace'),
      members: [member('A', 'a')],
    });
    const queued = store.addMessage(room.id, {
      authorType: 'human',
      content: 'Intervene',
      status: 'queued',
    });
    assert.deepEqual(store.listMessages(room.id), []);
    store.promoteMessage(queued.id);
    const run = store.createRun(room.id, {
      mode: 'conversation',
      turns: [{ memberId: room.members[0].id, assignment: 'Work' }],
    });
    store.startTurn(run.turns[0].id);
    store.completeTurn(run.turns[0].id, {
      content: 'Done',
      trace: [{ type: 'tool', name: 'Read' }],
    });
    store.finishRun(run.id);
    assert.deepEqual(store.getRun(run.id).turns[0].trace, [{ type: 'tool', name: 'Read' }]);
    assert.equal(store.listMessages(room.id)[0].content, 'Intervene');
    store.close();
  });

  test('persists private trace and usage when a turn fails', async () => {
    const { store, paths } = await createStore();
    const room = store.createRoom({
      topic: 'Failed trace',
      workspace: path.join(paths.root, 'workspace'),
      members: [member('A', 'a')],
    });
    const run = store.createRun(room.id, {
      mode: 'conversation',
      turns: [{ memberId: room.members[0].id, assignment: 'Read connector' }],
    });
    store.startTurn(run.turns[0].id);
    store.failTurn(run.turns[0].id, 'Authorization required', 'failed', {
      trace: [{ type: 'tool_result', isError: true, content: 'Authorization required' }],
      usage: { input_tokens: 3 },
    });
    store.finishRun(run.id, { status: 'failed', stopReason: 'Authorization required' });

    const failed = store.getRun(run.id).turns[0];
    assert.equal(failed.status, 'failed');
    assert.equal(failed.trace[0].isError, true);
    assert.equal(failed.usage.input_tokens, 3);
    assert.deepEqual(store.listMessages(room.id), []);
    store.close();
  });

  test('serial discussion advances snapshots and repeats members for the challenge round', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const { controller, finished } = controllerFixture(store, paths, captures);
    const room = await controller.createRoom({
      topic: 'Serial',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    const listedRoom = controller.listRooms().find((entry) => entry.id === room.id);
    assert.deepEqual(listedRoom.members.map((entry) => entry.displayName), ['A', 'B']);
    assert.equal(Object.hasOwn(listedRoom.members[0], 'promptSnapshot'), false);
    await controller.dispatch(room.id, {
      content: 'Discuss',
      mode: 'conversation',
      memberIds: room.members.map((entry) => entry.id),
    });
    await finished;

    assert.deepEqual(captures.map((entry) => entry.snapshotSeq), [1, 2, 3, 4]);
    assert.match(captures[0].turn.assignment, /独立分析/);
    assert.match(captures[2].turn.assignment, /质疑、补充并收敛/);
    assert.deepEqual(controller.getRoom(room.id).messages[0].audience, room.members.map((entry) => entry.id));
    assert.deepEqual(controller.getRoom(room.id).messages.map((entry) => entry.content), [
      'Discuss',
      'A conclusion',
      'B conclusion',
      'A conclusion',
      'B conclusion',
    ]);
    controller.dispose();
    store.close();
  });

  test('supports a caller-specified discussion length beyond the old three-round limit', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const { controller, finished } = controllerFixture(store, paths, captures);
    const room = await controller.createRoom({
      topic: 'Long review',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    const started = await controller.dispatch(room.id, {
      content: 'Review through five rounds',
      mode: 'conversation',
      rounds: 5,
      memberIds: room.members.map((entry) => entry.id),
    });
    await finished;

    const completed = store.getRun(started.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.turns.length, 10);
    assert.equal(captures.length, 10);
    assert.match(captures.at(-1).turn.assignment, /第 5\/5 轮/);
    controller.dispose();
    store.close();
  });

  test('continues discussion until the convergence reviewer finds no material issue', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const assessments = [];
    const { controller, finished } = controllerFixture(store, paths, captures, {
      assessDiscussion: async ({ round }) => {
        assessments.push(round);
        return round >= 2
          ? { stable: true, reason: 'No material disagreement remains.', unresolvedIssues: [] }
          : { stable: false, reason: 'Evidence is incomplete.', unresolvedIssues: ['Missing evidence'] };
      },
    });
    const room = await controller.createRoom({
      topic: 'Convergence review',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    const started = await controller.dispatch(room.id, {
      content: 'Continue until this is resolved',
      mode: 'conversation',
      untilStable: true,
      memberIds: room.members.map((entry) => entry.id),
    });
    await finished;

    const completed = store.getRun(started.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.turns.length, 4);
    assert.deepEqual(assessments, [1, 2]);
    assert.match(completed.stopReason, /converged after round 2/);
    assert.match(captures[2].turn.assignment, /持续讨论|讨论第 2 轮/);
    controller.dispose();
    store.close();
  });

  test('prioritizes a soft host intervention that arrives during convergence review', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    let markAssessmentStarted;
    let releaseAssessment;
    const assessmentStarted = new Promise((resolve) => { markAssessmentStarted = resolve; });
    const assessmentGate = new Promise((resolve) => { releaseAssessment = resolve; });
    const { controller, finished } = controllerFixture(store, paths, captures, {
      assessDiscussion: async () => {
        markAssessmentStarted();
        return assessmentGate;
      },
    });
    const room = await controller.createRoom({
      topic: 'Host correction',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    const started = await controller.dispatch(room.id, {
      content: 'Discuss until stable',
      mode: 'conversation',
      untilStable: true,
      memberIds: room.members.map((entry) => entry.id),
    });
    await assessmentStarted;
    await controller.intervene(room.id, { content: 'Include the missing constraint', mode: 'soft' });
    releaseAssessment({ stable: true, reason: 'Old scope looked complete.', unresolvedIssues: [] });
    await finished;

    const completed = store.getRun(started.id);
    assert.equal(completed.status, 'superseded');
    assert.equal(completed.stopReason, 'Superseded by a host intervention');
    const messages = controller.getRoom(room.id).messages;
    assert.equal(messages.at(-1).content, 'Include the missing constraint');
    assert.equal(messages.some((message) => message.kind === 'moderation'), false);
    controller.dispose();
    store.close();
  });

  test('parallel turns use one snapshot and publish in reserved order', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const { controller, finished } = controllerFixture(store, paths, captures);
    const room = await controller.createRoom({
      topic: 'Parallel',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    await controller.dispatch(room.id, {
      content: 'Split',
      mode: 'parallel',
      memberIds: room.members.map((entry) => entry.id),
    });
    await finished;

    assert.deepEqual(captures.map((entry) => entry.snapshotSeq), [1, 1]);
    assert.deepEqual(controller.getRoom(room.id).messages.map((entry) => entry.content), [
      'Split',
      'A conclusion',
      'B conclusion',
    ]);
    controller.dispose();
    store.close();
  });

  test('stops one parallel member without discarding another member conclusion', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const pending = new Map();
    const { controller, finished } = controllerFixture(store, paths, captures, {
      execute: (input) => new Promise((resolve, reject) => {
        captures.push(input);
        pending.set(input.member.id, { resolve, reject });
      }),
      abortMember: (_roomId, memberId) => pending.get(memberId)?.reject(new Error('Stopped by host')),
    });
    const room = await controller.createRoom({
      topic: 'Selective stop',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    await controller.dispatch(room.id, {
      content: 'Split',
      mode: 'parallel',
      memberIds: room.members.map((entry) => entry.id),
    });
    while (captures.length < 2) await new Promise((resolve) => setImmediate(resolve));

    controller.stopMember(room.id, room.members[0].id);
    pending.get(room.members[1].id).resolve({
      content: 'B survived',
      trace: [],
      usage: { input_tokens: 1 },
      promptHash: 'prompt',
    });
    await finished;

    const completed = controller.getRoom(room.id);
    assert.equal(completed.recentRuns[0].status, 'superseded');
    assert.deepEqual(completed.recentRuns[0].turns.map((turn) => turn.status), ['interrupted', 'completed']);
    assert.deepEqual(completed.messages.map((message) => message.content), ['Split', 'B survived']);
    controller.dispose();
    store.close();
  });

  test('does not publish a late conclusion returned after the room was stopped', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const pending = new Map();
    const { controller, finished } = controllerFixture(store, paths, captures, {
      execute: (input) => new Promise((resolve) => {
        captures.push(input);
        pending.set(input.member.id, resolve);
      }),
      abortMember: (_roomId, memberId) => pending.get(memberId)?.({
        content: 'Late conclusion that must remain hidden',
        trace: [{ type: 'tool_result', isError: true, content: 'Stopped by host' }],
        usage: { input_tokens: 2 },
        promptHash: 'late',
      }),
    });
    const room = await controller.createRoom({
      topic: 'Stop late output',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    await controller.dispatch(room.id, {
      content: 'Split',
      mode: 'parallel',
      memberIds: room.members.map((entry) => entry.id),
    });
    while (captures.length < 2) await new Promise((resolve) => setImmediate(resolve));

    await controller.stop(room.id);
    await finished;

    const stopped = controller.getRoom(room.id);
    assert.equal(stopped.recentRuns[0].status, 'interrupted');
    assert.deepEqual(stopped.recentRuns[0].turns.map((turn) => turn.status), ['interrupted', 'interrupted']);
    assert.ok(stopped.recentRuns[0].turns.every((turn) => turn.trace.length === 1));
    assert.deepEqual(stopped.messages.map((message) => message.content), ['Split']);
    controller.dispose();
    store.close();
  });

  test('keeps a completed run completed when an intervention lands during finalization', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    let controller;
    let interventionPromise;
    const fixture = controllerFixture(store, paths, captures, {}, (channel, payload) => {
      if (channel !== 'group-room:event' || payload.type !== 'turn-completed' || interventionPromise) return;
      interventionPromise = controller.intervene(payload.roomId, { content: 'Post-run note', mode: 'hard' });
    });
    controller = fixture.controller;
    const room = await controller.createRoom({
      topic: 'Finalization race',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    await controller.dispatch(room.id, {
      content: 'Work',
      mode: 'conversation',
      memberIds: [room.members[0].id],
    });
    await fixture.finished;
    await interventionPromise;

    const completed = controller.getRoom(room.id);
    assert.equal(completed.recentRuns[0].status, 'completed');
    assert.deepEqual(completed.messages.map((message) => message.content), ['Work', 'A conclusion', 'Post-run note']);
    controller.dispose();
    store.close();
  });

  test('does not append a host trigger when context compaction fails', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const { controller } = controllerFixture(store, paths, captures, {
      summarize: async () => { throw new Error('summary unavailable'); },
    });
    const room = await controller.createRoom({
      topic: 'Compaction failure',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
      settings: { summaryThresholdChars: 40_000 },
    });
    for (let index = 0; index < 10; index += 1) {
      store.addMessage(room.id, { authorType: 'human', content: `${index}:${'x'.repeat(5_000)}` });
    }

    await assert.rejects(() => controller.dispatch(room.id, {
      content: 'This trigger must not persist',
      mode: 'conversation',
      memberIds: [room.members[0].id],
    }), /Unable to summarize/);

    const failed = controller.getRoom(room.id);
    assert.equal(failed.status, 'paused');
    assert.equal(failed.messages.length, 10);
    assert.equal(failed.recentRuns.length, 0);
    controller.dispose();
    store.close();
  });

  test('waits for an active run to settle before deleting its room', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const pending = new Map();
    const { controller } = controllerFixture(store, paths, captures, {
      execute: (input) => new Promise((_resolve, reject) => {
        captures.push(input);
        pending.set(input.member.id, { reject });
      }),
      abortMember: (_roomId, memberId) => pending.get(memberId)?.reject(new Error('Stopped for deletion')),
    });
    const room = await controller.createRoom({
      topic: 'Delete active room',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    await controller.dispatch(room.id, {
      content: 'Run',
      mode: 'conversation',
      memberIds: [room.members[0].id],
    });
    while (captures.length < 1) await new Promise((resolve) => setImmediate(resolve));

    await controller.deleteRoom(room.id);

    assert.deepEqual(store.listRooms(), []);
    controller.dispose();
    store.close();
  });

  test('serializes delete behind a dispatch that is still initializing', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const pending = new Map();
    const { controller } = controllerFixture(store, paths, captures, {
      execute: (input) => new Promise((_resolve, reject) => {
        captures.push(input);
        pending.set(input.member.id, { reject });
      }),
      abortMember: (_roomId, memberId) => pending.get(memberId)?.reject(new Error('Stopped for deletion')),
    });
    const room = await controller.createRoom({
      topic: 'Concurrent delete',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });

    const dispatching = controller.dispatch(room.id, {
      content: 'Run',
      mode: 'conversation',
      memberIds: [room.members[0].id],
    });
    const deleting = controller.deleteRoom(room.id);
    await dispatching;
    await deleting;

    assert.deepEqual(store.listRooms(), []);
    controller.dispose();
    store.close();
  });

  test('restores pending permission metadata without exposing raw input', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    let controller;
    const fixture = controllerFixture(store, paths, captures, {
      execute: async (input) => {
        captures.push(input);
        const decision = await controller.requestPermission({
          roomId: input.room.id,
          memberId: input.member.id,
          connectorId: 'mail',
          toolName: 'mcp__mail__read',
          input: { authorization: 'Bearer room-secret-value' },
          request: { readOnly: true },
        });
        if (decision.behavior !== 'allow') throw new Error('Permission denied');
        return { content: 'Approved', trace: [], usage: null, promptHash: 'prompt' };
      },
    });
    controller = fixture.controller;
    const room = await controller.createRoom({
      topic: 'Permission restore',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    await controller.dispatch(room.id, {
      content: 'Read mail',
      mode: 'conversation',
      memberIds: [room.members[0].id],
    });
    while (controller.listPendingPermissions().length < 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const [permission] = controller.listPendingPermissions();
    assert.equal(permission.roomTitle, room.title);
    assert.equal(permission.memberName, room.members[0].displayName);
    assert.equal(permission.connectorId, 'mail');
    assert.equal(permission.input.authorization, '[REDACTED]');
    controller.resolvePermission(permission.requestId, true);
    await fixture.finished;
    assert.deepEqual(controller.listPendingPermissions(), []);
    controller.dispose();
    store.close();
  });

  test('removes orphan room directories without touching known rooms', async () => {
    const { store, paths } = await createStore();
    const room = store.createRoom({
      topic: 'Known',
      workspace: path.join(paths.root, 'workspace'),
      members: [member('A', 'a')],
    });
    await fsp.mkdir(path.join(paths.root, 'room_orphan'), { recursive: true });
    store.close();

    const reopened = new GroupRoomStore({ paths });
    await assert.doesNotReject(() => fsp.access(paths.roomDir(room.id)));
    await assert.rejects(() => fsp.access(path.join(paths.root, 'room_orphan')));
    reopened.close();
  });
});
