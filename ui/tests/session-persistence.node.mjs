import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
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
        syncTitle: record => searchIndex.syncTitle(record),
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
    projectId: 'project', isCoordinatorMode: true, permissionMode: 'plan', effort: 'xhigh',
    projectDefaults: { version: 1, instructions: 'frozen rules', skillIds: ['skill'], agentTeamsEnabled: false },
    appIds: ['builder', 'mcp', 'builder'],
    appServiceIds: ['["customer.app","sales"]', '["customer.app","sales"]'],
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
  assert.equal(manifest.effort, 'xhigh');
  service = f.open();
  service.hydratePersistedSessions();
  const restored = service.sessions.get('parent');
  for (const key of ['title', 'workspace', 'createdAt', 'updatedAt', 'messageCount', 'underlyingSessionId',
    'history', 'projectId', 'projectDefaults', 'isCoordinatorMode', 'permissionMode', 'effort', 'sessionKind', 'originChannel',
    'sourceSessionId', 'cronTaskId', 'sessionRole', 'assistantName', 'workerSummariesJson',
    'projectTaskStatus', 'projectTaskPrompt', 'projectTaskError', 'projectTaskCompletedAt',
    'toolDisplayMode', 'rewindMessageId', 'rewindCreatedAt', 'channelAppId', 'channelInstanceId', 'channelRuntimePolicy']) {
    assert.deepEqual(restored[key], main[key], key);
  }
  assert.deepEqual(restored.connectorIds, ['mail', 'drive']);
  assert.deepEqual(restored.appIds, ['builder', 'mcp']);
  assert.deepEqual(restored.appServiceIds, ['["customer.app","sales"]']);
  assert.deepEqual(manifest.appServiceIds, restored.appServiceIds);
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

test('infers legacy modes without parsing corrupt history and refuses to erase it', t => {
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
  assert.throws(() => service.sessions.get('local').history, SyntaxError);
  service.sessions.get('local').title = 'Renamed';
  service.persistSessionRecord(service.sessions.get('local'));
  assert.equal(service.statements.loadSessionHistoryStmt.get('local').history_json, '{broken');
  assert.deepEqual(service.sessions.get('local').connectorIds, []);
  assert.equal(service.sessions.get('local').channelRuntimePolicy, null);
});

test('metadata hydration and unchanged shutdown do not read history or write business records', t => {
  const f = fixture(t);
  let service = f.open();
  service.persistSessionRecord(record('lazy'));
  const manifestPath = path.join(f.sessionPaths.getLocalSessionDir('lazy'), 'session.json');
  const manifestTime = statSync(manifestPath).mtimeMs;
  service = f.open();
  let reads = 0;
  const load = service.statements.loadSessionHistoryStmt.get.bind(service.statements.loadSessionHistoryStmt);
  service.statements.loadSessionHistoryStmt.get = id => { reads++; return load(id); };
  const before = service.db.prepare('SELECT total_changes() AS count').get().count;
  service.hydratePersistedSessions();
  const session = service.sessions.get('lazy');
  assert.equal(session.historyLoaded, false);
  service.flushPendingSessionPersist(session);
  assert.equal(reads, 0);
  assert.equal(service.db.prepare('SELECT total_changes() AS count').get().count, before);
  assert.equal(statSync(manifestPath).mtimeMs, manifestTime);
  assert.deepEqual(service.indexed, []);
  assert.equal(session.history[0].prompt, 'Preserve this conversation');
  assert.equal(session.history.length, 1);
  assert.equal(reads, 1);
});

test('unopened metadata edits preserve history, approval, source signatures and searchable messages', t => {
  const f = fixture(t);
  let service = f.open();
  service.persistSessionRecord(record('metadata', {
    sourceTranscriptSignature: 'source-v1', sourceResourceManifestSignature: 'resources-v1',
    history: [...record('unused').history, { type: 'app_plan_state', kind: 'plan', state: 'awaiting_approval', plan: 'Keep this plan', timestamp: 30 }],
  }));
  const original = service.statements.loadSessionHistoryStmt.get('metadata').history_json;
  service = f.open();
  service.hydratePersistedSessions();
  const session = service.sessions.get('metadata');
  assert.equal(session.pendingPlanApproval.plan, 'Keep this plan');
  session.title = 'Changed title';
  let snapshots = 0;
  f.setTraceHost({ async recordSession() { snapshots++; } });
  service.persistSessionRecord(session);
  assert.equal(session.historyLoaded, false);
  assert.equal(service.statements.loadSessionHistoryStmt.get('metadata').history_json, original);
  assert.equal(session.sourceTranscriptSignature, 'source-v1');
  assert.equal(session.sourceResourceManifestSignature, 'resources-v1');
  assert.equal(snapshots, 0);
  const search = createSessionSearchIndex(service.db);
  assert.equal(search.search('conversation', { sessionIds: ['metadata'] }).length, 1);
  assert.equal(search.search('Changed title', { sessionIds: ['metadata'] }).length, 1);
});
