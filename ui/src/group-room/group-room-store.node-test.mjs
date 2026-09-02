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

function controllerFixture(store, paths, captures, runtimeOverrides = {}, onEmit = () => {}, catalogOverrides = {}) {
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
    ...catalogOverrides,
  };
  const runtime = {
    moderate: async () => ({
      decision: { action: 'respond', response: 'Moderator answer' },
      usage: { input_tokens: 1 },
    }),
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

function scriptedModerator(decisions, captures = []) {
  let index = 0;
  return async (input) => {
    captures.push(input);
    const selected = decisions[Math.min(index, decisions.length - 1)];
    index += 1;
    const decision = typeof selected === 'function' ? await selected(input) : selected;
    return { decision, usage: { input_tokens: 1 } };
  };
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

  test('creates a room with one expert plus the implicit moderator and drops legacy discussion settings', async () => {
    const { store, paths } = await createStore();
    const { controller } = controllerFixture(store, paths, [], {}, () => {}, {
      resolveInvitations: async () => [member('Solo', 'solo')],
    });
    const room = await controller.createRoom({
      topic: 'One expert is enough',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['solo'],
      settings: { mode: 'parallel', discussionPolicy: 'fixed', discussionRounds: 99, permissionMode: 'ask' },
    });

    assert.equal(room.members.length, 1);
    assert.equal(room.settings.permissionMode, 'ask');
    assert.equal(Object.hasOwn(room.settings, 'mode'), false);
    assert.equal(Object.hasOwn(room.settings, 'discussionPolicy'), false);
    assert.equal(Object.hasOwn(room.settings, 'discussionRounds'), false);
    controller.dispose();
    store.close();
  });

  test('lets the moderator dynamically delegate dependent work and publish the final answer', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const moderationCaptures = [];
    const { controller, finished } = controllerFixture(store, paths, captures, {
      moderate: scriptedModerator([
        ({ room }) => ({ action: 'delegate', assignments: [{ memberId: room.members[0].id, task: 'Inspect first' }] }),
        ({ room }) => ({ action: 'delegate', assignments: [{ memberId: room.members[1].id, task: 'Verify the first result' }] }),
        { action: 'respond', response: 'Moderator synthesis' },
      ], moderationCaptures),
    });
    const room = await controller.createRoom({
      topic: 'Serial',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    const listedRoom = controller.listRooms().find((entry) => entry.id === room.id);
    assert.deepEqual(listedRoom.members.map((entry) => entry.displayName), ['A', 'B']);
    assert.equal(Object.hasOwn(listedRoom.members[0], 'promptSnapshot'), false);
    const started = await controller.dispatch(room.id, { content: 'Discuss' });
    await finished;

    assert.equal(started.mode, 'orchestrated');
    assert.deepEqual(captures.map((entry) => entry.snapshotSeq), [1, 2]);
    assert.deepEqual(captures.map((entry) => entry.turn.assignment), ['Inspect first', 'Verify the first result']);
    assert.equal(moderationCaptures[1].run.turns[0].status, 'completed');
    assert.deepEqual(controller.getRoom(room.id).messages[0].audience, ['moderator']);
    assert.equal(controller.getRoom(room.id).messages[0].authorId, 'user');
    assert.deepEqual(controller.getRoom(room.id).messages.map((entry) => entry.content), [
      'Discuss',
      'A conclusion',
      'B conclusion',
      'Moderator synthesis',
    ]);
    assert.equal(controller.getRoom(room.id).messages.at(-1).authorType, 'moderator');
    controller.dispose();
    store.close();
  });

  test('ignores legacy caller orchestration fields and allows a direct moderator answer', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const { controller, finished } = controllerFixture(store, paths, captures);
    const room = await controller.createRoom({
      topic: 'Direct answer',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    const started = await controller.dispatch(room.id, {
      content: 'Answer directly',
      mode: 'parallel',
      rounds: 100,
      memberIds: ['not-a-room-member'],
      assignments: { 'not-a-room-member': 'must not execute' },
    });
    await finished;

    const completed = store.getRun(started.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.mode, 'orchestrated');
    assert.equal(completed.turns.length, 0);
    assert.equal(captures.length, 0);
    assert.equal(controller.getRoom(room.id).messages.at(-1).content, 'Moderator answer');
    controller.dispose();
    store.close();
  });

  test('routes an intervention that arrives after a run boundary into a new moderator run', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const { controller, finished } = controllerFixture(store, paths, captures);
    const room = await controller.createRoom({
      topic: 'Boundary message',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    const started = await controller.intervene(room.id, { content: 'Late UI message', mode: 'soft' });
    await finished;

    assert.equal(started.mode, 'orchestrated');
    assert.equal(store.getRun(started.id).status, 'completed');
    assert.deepEqual(controller.getRoom(room.id).messages.map((message) => message.content), [
      'Late UI message',
      'Moderator answer',
    ]);
    controller.dispose();
    store.close();
  });

  test('discards a stale moderator decision and incorporates a soft user intervention', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const moderationCaptures = [];
    let markModerationStarted;
    let releaseModeration;
    let calls = 0;
    const moderationStarted = new Promise((resolve) => { markModerationStarted = resolve; });
    const moderationGate = new Promise((resolve) => { releaseModeration = resolve; });
    const { controller, finished } = controllerFixture(store, paths, captures, {
      moderate: async (input) => {
        moderationCaptures.push(input);
        calls += 1;
        if (calls === 1) {
          markModerationStarted();
          await moderationGate;
          return { decision: { action: 'respond', response: 'Stale answer' } };
        }
        return { decision: { action: 'respond', response: 'Corrected answer' } };
      },
    });
    const room = await controller.createRoom({
      topic: 'User correction',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    const started = await controller.dispatch(room.id, { content: 'Initial scope' });
    await moderationStarted;
    await controller.intervene(room.id, { content: 'Include the missing constraint', mode: 'soft' });
    releaseModeration();
    await finished;

    const completed = store.getRun(started.id);
    assert.equal(completed.status, 'completed');
    assert.equal(moderationCaptures.length, 2);
    assert.equal(moderationCaptures[1].room.messages.at(-1).content, 'Include the missing constraint');
    const messages = controller.getRoom(room.id).messages;
    assert.deepEqual(messages.map((message) => message.content), [
      'Initial scope',
      'Include the missing constraint',
      'Corrected answer',
    ]);
    controller.dispose();
    store.close();
  });

  test('forces a final answer instead of executing a repeated delegation', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const moderationCaptures = [];
    const { controller, finished } = controllerFixture(store, paths, captures, {
      moderate: scriptedModerator([
        ({ room }) => ({ action: 'delegate', assignments: [{ memberId: room.members[0].id, task: 'Inspect once' }] }),
        ({ room }) => ({ action: 'delegate', assignments: [{ memberId: room.members[0].id, task: 'Inspect once' }] }),
        { action: 'respond', response: 'Best available answer' },
      ], moderationCaptures),
    });
    const room = await controller.createRoom({
      topic: 'Avoid stalls',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    const started = await controller.dispatch(room.id, { content: 'Do not loop' });
    await finished;

    const completed = store.getRun(started.id);
    assert.equal(completed.turns.length, 1);
    assert.equal(captures.length, 1);
    assert.equal(moderationCaptures.at(-1).forceFinish, true);
    assert.equal(completed.stopReason, 'Moderator repeated the same delegation');
    assert.equal(controller.getRoom(room.id).messages.at(-1).content, 'Best available answer');
    controller.dispose();
    store.close();
  });

  test('returns failed member work to the moderator instead of failing the whole run', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const moderationCaptures = [];
    const { controller, finished } = controllerFixture(store, paths, captures, {
      moderate: scriptedModerator([
        ({ room }) => ({ action: 'delegate', assignments: [{ memberId: room.members[0].id, task: 'Try evidence' }] }),
        { action: 'respond', response: 'The evidence source failed; here is the bounded answer.' },
      ], moderationCaptures),
      execute: async (input) => {
        captures.push(input);
        throw new Error('Evidence source unavailable');
      },
    });
    const room = await controller.createRoom({
      topic: 'Failure recovery',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    const started = await controller.dispatch(room.id, { content: 'Investigate' });
    await finished;

    const completed = store.getRun(started.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.turns[0].status, 'failed');
    assert.equal(moderationCaptures[1].run.turns[0].error, 'Evidence source unavailable');
    assert.deepEqual(controller.getRoom(room.id).messages.map((message) => message.content), [
      'Investigate',
      'The evidence source failed; here is the bounded answer.',
    ]);
    controller.dispose();
    store.close();
  });

  test('uses a final-only moderator step when the token budget is reached', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const moderationCaptures = [];
    const { controller, finished } = controllerFixture(store, paths, captures, {
      moderate: async (input) => {
        moderationCaptures.push(input);
        return input.forceFinish
          ? { decision: { action: 'respond', response: 'Budget-bounded answer' }, usage: { input_tokens: 1 } }
          : {
            decision: { action: 'delegate', assignments: [{ memberId: input.room.members[0].id, task: 'Would exceed budget' }] },
            usage: { input_tokens: 1_000 },
          };
      },
    });
    const room = await controller.createRoom({
      topic: 'Budget',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
      settings: { tokenBudget: 1_000 },
    });
    const started = await controller.dispatch(room.id, { content: 'Stay bounded' });
    await finished;

    const completed = store.getRun(started.id);
    assert.equal(completed.turns.length, 0);
    assert.equal(captures.length, 0);
    assert.equal(moderationCaptures.at(-1).forceFinish, true);
    assert.equal(completed.stopReason, 'Room token budget reached');
    controller.dispose();
    store.close();
  });

  test('lets the moderator explain connector auth failure while preserving paused recovery state', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const moderationCaptures = [];
    const { controller, finished } = controllerFixture(store, paths, captures, {
      moderate: scriptedModerator([
        ({ room }) => ({ action: 'delegate', assignments: [{ memberId: room.members[0].id, task: 'Read connector' }] }),
        { action: 'respond', response: 'Please refresh the connector authorization.' },
      ], moderationCaptures),
      execute: async (input) => {
        captures.push(input);
        throw new Error('连接器授权需要在连接器中心刷新: mail');
      },
    });
    const room = await controller.createRoom({
      topic: 'Connector recovery',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    const started = await controller.dispatch(room.id, { content: 'Read mail' });
    await finished;

    const completed = controller.getRoom(room.id);
    assert.equal(store.getRun(started.id).status, 'failed');
    assert.equal(completed.status, 'paused');
    assert.match(completed.recentRuns[0].stopReason, /连接器授权需要/);
    assert.equal(moderationCaptures.at(-1).forceFinish, true);
    assert.equal(completed.messages.at(-1).authorType, 'moderator');
    controller.dispose();
    store.close();
  });

  test('runs one moderator-selected independent batch on a shared snapshot and reserved order', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const { controller, finished } = controllerFixture(store, paths, captures, {
      moderate: scriptedModerator([
        ({ room }) => ({
          action: 'delegate',
          assignments: room.members.map((member) => ({ memberId: member.id, task: `Independent ${member.displayName}` })),
        }),
        { action: 'respond', response: 'Batch synthesis' },
      ]),
    });
    const room = await controller.createRoom({
      topic: 'Parallel',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    await controller.dispatch(room.id, { content: 'Split' });
    await finished;

    assert.deepEqual(captures.map((entry) => entry.snapshotSeq), [1, 1]);
    assert.deepEqual(controller.getRoom(room.id).messages.map((entry) => entry.content), [
      'Split',
      'A conclusion',
      'B conclusion',
      'Batch synthesis',
    ]);
    controller.dispose();
    store.close();
  });

  test('stops one parallel member without discarding another member conclusion', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const pending = new Map();
    const { controller, finished } = controllerFixture(store, paths, captures, {
      moderate: scriptedModerator([
        ({ room }) => ({
          action: 'delegate',
          assignments: room.members.map((member) => ({ memberId: member.id, task: `Independent ${member.displayName}` })),
        }),
        { action: 'respond', response: 'Partial synthesis' },
      ]),
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
    await controller.dispatch(room.id, { content: 'Split' });
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
    assert.equal(completed.recentRuns[0].status, 'completed');
    assert.deepEqual(completed.recentRuns[0].turns.map((turn) => turn.status), ['interrupted', 'completed']);
    assert.deepEqual(completed.messages.map((message) => message.content), ['Split', 'B survived', 'Partial synthesis']);
    controller.dispose();
    store.close();
  });

  test('does not publish a late conclusion returned after the room was stopped', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    const pending = new Map();
    const { controller, finished } = controllerFixture(store, paths, captures, {
      moderate: scriptedModerator([
        ({ room }) => ({
          action: 'delegate',
          assignments: room.members.map((member) => ({ memberId: member.id, task: `Independent ${member.displayName}` })),
        }),
      ]),
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
    await controller.dispatch(room.id, { content: 'Split' });
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

  test('hard intervention aborts moderator finalization but keeps completed evidence', async () => {
    const { store, paths } = await createStore();
    const captures = [];
    let rejectFinalization;
    let markFinalizationStarted;
    const finalizationStarted = new Promise((resolve) => { markFinalizationStarted = resolve; });
    const fixture = controllerFixture(store, paths, captures, {
      moderate: async ({ room, run }) => {
        if (run.turns.length === 0) {
          return { decision: { action: 'delegate', assignments: [{ memberId: room.members[0].id, task: 'Work' }] } };
        }
        markFinalizationStarted();
        return new Promise((_resolve, reject) => { rejectFinalization = reject; });
      },
      abortModerator: () => rejectFinalization?.(new Error('Interrupted by the user')),
    });
    const controller = fixture.controller;
    const room = await controller.createRoom({
      topic: 'Finalization race',
      workspace: path.join(paths.root, 'workspace'),
      invitationIds: ['team'],
    });
    await controller.dispatch(room.id, { content: 'Work' });
    await finalizationStarted;
    await controller.intervene(room.id, { content: 'Post-run note', mode: 'hard' });
    await fixture.finished;

    const completed = controller.getRoom(room.id);
    assert.equal(completed.recentRuns[0].status, 'interrupted');
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
      moderate: scriptedModerator([
        ({ room }) => ({ action: 'delegate', assignments: [{ memberId: room.members[0].id, task: 'Run' }] }),
      ]),
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
    await controller.dispatch(room.id, { content: 'Run' });
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
      moderate: scriptedModerator([
        ({ room }) => ({ action: 'delegate', assignments: [{ memberId: room.members[0].id, task: 'Run' }] }),
      ]),
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

    const dispatching = controller.dispatch(room.id, { content: 'Run' });
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
      moderate: scriptedModerator([
        ({ room }) => ({ action: 'delegate', assignments: [{ memberId: room.members[0].id, task: 'Read mail' }] }),
        { action: 'respond', response: 'Permission-backed answer' },
      ]),
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
    await controller.dispatch(room.id, { content: 'Read mail' });
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
