import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareSessionStatements } from '../src/session-database.mjs';
import { createSessionPersistence } from '../src/session-persistence.mjs';
import { createSessionPaths } from '../src/session-paths.mjs';
import { createDesktopDataPaths } from '../src/desktop-data-layout.mjs';
import { createSessionSearchIndex } from '../src/session-search-index.mjs';
import { createRemoteSessionDeletionStore } from '../src/remote-session-reconcile.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'moss-session-persistence-'));
  const paths = createDesktopDataPaths(root);
  const sessionPaths = createSessionPaths({ DESKTOP_DATA_PATHS: paths });
  let db;
  let settings = { permissionMode: 'default' };
  let traceHost = null;
  const timers = new Set();
  t.after(() => {
    for (const record of timers) clearTimeout(record.persistTimer);
    db?.close();
    rmSync(root, { recursive: true, force: true });
  });
  function open() {
    db?.close();
    db = new DatabaseSync(path.join(root, 'sessions.db'));
    const statements = prepareSessionStatements(db);
    const sessions = new Map();
    const subAgentSessions = new Map();
    const remoteSessionDeletions = createRemoteSessionDeletionStore(db);
    const searchIndex = createSessionSearchIndex(db);
    const indexed = [];
    const warnings = [];
    const service = createSessionPersistence({
      statements, sessions, subAgentSessions, DESKTOP_DATA_PATHS: paths, sessionPaths,
      remoteSessionDeletions,
      sessionSearchIndex: {
        syncSession(record) { indexed.push(record.id); searchIndex.syncSession(record); },
        deleteSession: id => searchIndex.deleteSession(id),
      },
      getSettings: () => settings, getTraceHost: () => traceHost,
      getDesktopAgentMode: () => 'remote-direct',
      mossLog: (...args) => warnings.push(args),
    });
    return { db, statements, sessions, subAgentSessions, remoteSessionDeletions, indexed, warnings, ...service };
  }
  return {
    root, paths, sessionPaths, open, timers,
    setSettings: value => { settings = value; },
    setTraceHost: value => { traceHost = value; },
  };
}

function record(id, extra = {}) {
  return {
    id, title: 'Round trip', workspace: '/local/workspace', agentMode: 'local',
    createdAt: 10, updatedAt: 20, messageCount: 1, underlyingSessionId: 'engine',
    history: [{ type: 'user', uuid: 'u1', prompt: 'Preserve this conversation' }],
    ...extra,
  };
}

test('reopens real SQLite records, manifests and read-only child sessions with metadata intact', t => {
  const f = fixture(t);
  let service = f.open();
  const main = record('parent', {
    projectId: 'project', isCoordinatorMode: true, permissionMode: 'plan',
    connectorIds: [' mail ', 'drive', 'mail'], sessionKind: 'cron', originChannel: 'cron',
    sourceSessionId: 'source', cronTaskId: 'cron-1', sessionRole: 'coordinator',
    assistantName: 'Expert', workerSummariesJson: '[{"status":"completed"}]',
    projectTaskStatus: 'waiting_for_user', projectTaskPrompt: 'Task', projectTaskError: 'detail',
    projectTaskCompletedAt: 42, toolDisplayMode: 'merged', rewindMessageId: 'u1', rewindCreatedAt: 35,
    channelAppId: 'app', channelInstanceId: 'instance', channelRuntimePolicy: { tools: ['Read'] },
    history: [
      ...record('unused').history,
      { type: 'app_plan_state', kind: 'plan', state: 'awaiting_approval', plan: 'Review me', timestamp: 30 },
    ],
  });
  service.sessions.set('source', { title: 'Source title' });
  service.persistSessionRecord(main);
  service.persistSessionRecord(record('child', { parentSessionId: 'parent', sessionRole: 'worker', isSubAgent: true }), true);
  const manifest = JSON.parse(readFileSync(path.join(f.sessionPaths.getLocalSessionDir('parent'), 'session.json'), 'utf8'));
  assert.equal(manifest.sourceSessionTitle, 'Source title');
  assert.equal(manifest.layoutVersion, 2);
  assert.equal(manifest.toolDisplayMode, 'merged');
  service = f.open();
  service.hydratePersistedSessions();
  const restored = service.sessions.get('parent');
  for (const key of ['title', 'workspace', 'createdAt', 'updatedAt', 'messageCount', 'underlyingSessionId',
    'history', 'projectId', 'isCoordinatorMode', 'permissionMode', 'sessionKind', 'originChannel',
    'sourceSessionId', 'cronTaskId', 'sessionRole', 'assistantName', 'workerSummariesJson',
    'projectTaskStatus', 'projectTaskPrompt', 'projectTaskError', 'projectTaskCompletedAt',
    'toolDisplayMode', 'rewindMessageId', 'rewindCreatedAt', 'channelAppId', 'channelInstanceId', 'channelRuntimePolicy']) {
    assert.deepEqual(restored[key], main[key], key);
  }
  assert.deepEqual(restored.connectorIds, ['mail', 'drive']);
  assert.equal(restored.busy, false);
  assert.equal(restored.runtime, null);
  assert.equal(restored.workspaceWatcher, null);
  assert.equal(restored.persistTimer, null);
  assert.equal(restored.pendingPlanApproval.plan, 'Review me');
  assert.equal(service.sessions.has('child'), false);
  assert.equal(service.subAgentSessions.get('child').parentSessionId, 'parent');
  assert.match(service.subAgentSessions.get('child').resumeReadOnlyReason, /只读/);
  assert.deepEqual(service.warnings, []);
});

test('uses current settings and late Trace Host while deferring search indexing of busy sessions', t => {
  const f = fixture(t);
  const service = f.open();
  const session = record('live', { busy: true, permissionMode: null });
  service.persistSessionRecord(session);
  assert.deepEqual(service.indexed, []);
  const traced = [];
  f.setSettings({ permissionMode: 'plan' });
  f.setTraceHost({ recordSession: async record => traced.push(record.id) });
  session.busy = false;
  service.persistSessionRecord(session);
  assert.equal(service.statements.loadSessionsStmt.all()[0].permission_mode, 'plan');
  const manifest = JSON.parse(readFileSync(path.join(f.sessionPaths.getLocalSessionDir('live'), 'session.json'), 'utf8'));
  assert.equal(manifest.permissionMode, 'plan');
  assert.deepEqual(service.indexed, ['live']);
  assert.deepEqual(traced, ['live']);
});

test('coalesces delayed saves and flushes the latest record immediately without a duplicate write', async t => {
  const f = fixture(t);
  const service = f.open();
  const session = record('debounced');
  f.timers.add(session);
  service.schedulePersistSession(session);
  const timer = session.persistTimer;
  session.title = 'Latest title';
  service.schedulePersistSession(session);
  assert.equal(session.persistTimer, timer);
  assert.equal(service.statements.loadSessionsStmt.all().length, 0);
  service.schedulePersistSession(session, true);
  assert.equal(session.persistTimer, null);
  assert.equal(service.statements.loadSessionsStmt.all()[0].title, 'Latest title');
  await delay(250);
  assert.deepEqual(service.indexed, ['debounced']);
});

test('a pending timer and explicit flush cannot recreate a deleted record or manifest', async t => {
  const f = fixture(t);
  const service = f.open();
  const session = record('removed');
  f.timers.add(session);
  service.persistSessionRecord(session);
  service.schedulePersistSession(session);
  session.deleted = true;
  service.deletePersistedSession(session.id);
  rmSync(f.sessionPaths.getLocalSessionDir(session.id), { recursive: true });
  await delay(250);
  assert.equal(session.persistTimer, null);
  service.flushPendingSessionPersist(session);
  service.schedulePersistSession(session, true);
  assert.deepEqual(service.statements.loadSessionsStmt.all(), []);
  assert.throws(() => readFileSync(path.join(f.sessionPaths.getLocalSessionDir(session.id), 'session.json')), /ENOENT/);
  assert.deepEqual(service.indexed, ['removed']);
});

test('restores remote workspace/title mappings and honors durable remote tombstones', t => {
  const f = fixture(t);
  let service = f.open();
  for (const id of ['remote', 'removed-remote']) service.persistSessionRecord(record(id, {
    title: 'New Session', agentMode: 'remote-direct', remoteWorkspace: '/server/project',
    underlyingSessionId: `server-${id}`,
    history: [{ type: 'user', message: { content: 'Preserve this conversation' } }],
  }));
  service.remoteSessionDeletions.mark('server-removed-remote');
  service = f.open();
  service.hydratePersistedSessions();
  const remote = service.sessions.get('remote');
  assert.equal(remote.underlyingSessionId, 'server-remote');
  assert.equal(remote.remoteWorkspace, '/server/project');
  assert.equal(remote.workspace, '/server/project');
  assert.equal(remote.title, 'Preserve this conversation');
  assert.equal(service.sessions.has('removed-remote'), false);
});

test('infers legacy modes from local transcript existence and tolerates corrupt cached JSON', t => {
  const f = fixture(t);
  const service = f.open();
  for (const id of ['local', 'remote']) {
    service.persistSessionRecord(record(id));
    service.db.prepare("UPDATE sessions SET agent_mode = 'legacy', history_json = '{broken', connector_ids_json = 'bad', channel_runtime_policy_json = '[]' WHERE id = ?").run(id);
  }
  writeFileSync(f.paths.sessionTranscriptPath('local', 'engine'), '{}\n');
  service.hydratePersistedSessions();
  assert.equal(service.sessions.get('local').agentMode, 'local');
  assert.equal(service.sessions.get('remote').agentMode, 'remote-direct');
  assert.deepEqual(service.sessions.get('local').history, []);
  assert.deepEqual(service.sessions.get('local').connectorIds, []);
  assert.equal(service.sessions.get('local').channelRuntimePolicy, null);
});
