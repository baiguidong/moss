import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import {
  applyRemoteSessionHistoryTitle,
  applyRemoteSessionTitle,
  createRemoteHistoryCheckpoint,
} from '../src/remote-session-reconcile.mjs';
import {
  excludeRemovedSessions,
  isSessionAlreadyRemovedError,
} from '../src/renderer-react/lib/session-removal';

const mainSource = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');

function functionSource(name: string, nextName: string): string {
  const start = mainSource.indexOf(`function ${name}`);
  const end = mainSource.indexOf(`function ${nextName}`, start + 1);
  return mainSource.slice(start, end);
}

describe('session deletion', () => {
  test('keeps the sidebar entry during deletion and after failure, then removes it on success', async () => {
    let finish!: (value: unknown) => void;
    let summaries = [{ id: 'desktop-id' }];
    const removed = new Set<string>();
    const notices: string[] = [];
    const renderer = readFileSync(new URL('../src/renderer-react/App.tsx', import.meta.url), 'utf8');
    const start = renderer.indexOf('const handleDeleteSession = React.useCallback');
    const end = renderer.indexOf('const handleRenameSession', start);
    const source = new Bun.Transpiler({ loader: 'tsx' }).transformSync(renderer.slice(start, end));
    const remove = runInNewContext(`${source}; handleDeleteSession;`, {
      React: { useCallback: (callback: unknown) => callback },
      deletingSessionIdsRef: { current: new Set() },
      removedSessionIdsRef: { current: removed },
      setSummaries: (update: (previous: typeof summaries) => typeof summaries) => { summaries = update(summaries); },
      window: { agentDesktop: { deleteSession: () => new Promise(resolve => { finish = resolve; }) } },
      isSessionAlreadyRemovedError,
      refreshSummaries: async () => {},
      showPermissionNotice: (message: string) => { notices.push(message); },
      activeSessionIdRef: { current: null },
      navigateToHome: () => {},
      sessionAgentModes: new Map(),
      persistSessionAgentModes: () => {},
    });
    const failed = remove('desktop-id');
    expect(summaries).toEqual([{ id: 'desktop-id' }]);
    expect(removed.size).toBe(0);
    finish({ ok: false });
    await failed;
    expect(summaries).toEqual([{ id: 'desktop-id' }]);
    expect(removed.size).toBe(0);
    expect(notices[0]).toContain('删除未完成');
    const success = remove('desktop-id');
    finish({ ok: true });
    await success;
    expect(summaries).toEqual([]);
    expect(removed.has('desktop-id')).toBe(true);
  });

  test('keeps the local record until remote deletion is confirmed', async () => {
    let confirm!: () => void;
    let started!: () => void;
    const requested = new Promise<void>(resolve => { started = resolve; });
    const harness = deletionHarness(() => {
      started();
      return new Promise<void>(resolve => { confirm = resolve; });
    });
    const pending = harness.remove();
    await requested;
    expect(harness.sessions.has('desktop-id')).toBe(true);
    expect(harness.record.deleted).toBeUndefined();
    expect(harness.actions).toEqual(['remote-request']);
    confirm();
    expect(await pending).toMatchObject({ ok: true });
    expect(harness.actions).toEqual([
      'remote-request', 'remote-confirmed', 'tombstone', 'abort', 'local-delete', 'removed-event',
    ]);
    expect(harness.sessions.has('desktop-id')).toBe(false);
  });

  test('preserves local history and allows retry after a remote deletion failure', async () => {
    let fail = true;
    const harness = deletionHarness(async () => {
      if (fail) throw new Error('Server unavailable');
    });
    await expect(harness.remove()).rejects.toThrow('已保留本地记录');
    expect(harness.sessions.get('desktop-id')).toBe(harness.record);
    expect(harness.record.history).toEqual([{ type: 'user', message: { content: 'Keep this history' } }]);
    expect(harness.record.deleted).toBeUndefined();
    expect(harness.record.deleting).toBe(false);
    expect(harness.actions).toEqual(['remote-request']);
    fail = false;
    expect(await harness.remove()).toMatchObject({ ok: true });
    expect(harness.sessions.size).toBe(0);
  });

  test('waits for an in-flight server creation before deleting its session', async () => {
    const harness = deletionHarness(async () => {});
    let created!: () => void;
    harness.record.underlyingSessionId = null;
    harness.record.runtime.waitForSessionCreation = () => new Promise<void>(resolve => {
      created = () => {
        harness.record.underlyingSessionId = 'server-session';
        resolve();
      };
    });
    const pending = harness.remove();
    expect(harness.actions).toEqual([]);
    expect(harness.sessions.size).toBe(1);
    created();
    expect(await pending).toMatchObject({ ok: true });
    expect(harness.actions[0]).toBe('remote-request');
  });

  test('deletes an untouched remote draft without creating a server session', async () => {
    const harness = deletionHarness(async () => { throw new Error('Should not call the server'); });
    harness.record.underlyingSessionId = null;
    expect(await harness.remove()).toMatchObject({ ok: true });
    expect(harness.actions).toEqual(['abort', 'local-delete', 'removed-event']);
  });

  test('remembers remote deletions after reopening the database', () => {
    const storeUrl = new URL('../src/remote-session-reconcile.mjs', import.meta.url).href;
    const result = spawnSync('node', ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { mkdtempSync, rmSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      import { DatabaseSync } from 'node:sqlite';
      import { createRemoteSessionDeletionStore } from ${JSON.stringify(storeUrl)};
      const root = mkdtempSync(join(tmpdir(), 'moss-deletions-'));
      let db;
      try {
        const filename = join(root, 'sessions.db');
        db = new DatabaseSync(filename);
        let store = createRemoteSessionDeletionStore(db);
        store.mark('server-session');
        store.mark('server-session');
        store.mark(null);
        db.close();
        db = new DatabaseSync(filename);
        store = createRemoteSessionDeletionStore(db);
        assert.equal(store.has('server-session'), true);
        assert.equal(store.has('different-session'), false);
        assert.equal(store.has(null), false);
      } finally {
        db?.close();
        rmSync(root, { recursive: true, force: true });
      }
    `], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });

  test('does not reimport a deleted server session under a new desktop ID', async () => {
    const harness = remoteSyncHarness();
    harness.deleted.add('server-session');
    await harness.sync();
    expect(harness.sessions.size).toBe(0);
    expect(harness.published).toEqual([]);
  });

  test('discards a context response that arrives after deletion', async () => {
    let finishContext!: (value: unknown) => void;
    let notifyContextStarted!: () => void;
    const contextStarted = new Promise<void>(resolve => { notifyContextStarted = resolve; });
    const harness = remoteSyncHarness(() => {
      notifyContextStarted();
      return new Promise(resolve => { finishContext = resolve; });
    });
    const pending = harness.sync();
    await contextStarted;
    const record = [...harness.sessions.values()][0];
    expect(record.underlyingSessionId).toBe('server-session');
    record.deleted = true;
    harness.deleted.add('server-session');
    harness.sessions.delete(record.id);
    finishContext({ context: { messages: [{ type: 'user', message: { content: 'late response' } }] } });
    expect(await pending).toEqual([]);
    expect(harness.published).toEqual([]);
    expect(harness.persisted).toEqual([]);
    await harness.sync();
    expect(harness.sessions.size).toBe(0);
  });

  test('does not restore a removed session from a stale list response', () => {
    const removed = new Set(['deleted-session']);
    const sessions = [
      { id: 'active-session' },
      { id: 'deleted-session' },
    ];

    expect(excludeRemovedSessions(sessions, removed)).toEqual([
      { id: 'active-session' },
    ]);
  });

  test('recognizes an already-removed session as an idempotent delete', () => {
    expect(isSessionAlreadyRemovedError(
      new Error('Error invoking remote method: Unknown session: deleted-session'),
    )).toBe(true);
    expect(isSessionAlreadyRemovedError(new Error('Database is locked'))).toBe(false);
  });

  test('marks a session deleted before aborting its runtime', () => {
    const start = mainSource.indexOf('async function deleteSessionRecordById');
    const end = mainSource.indexOf("ipcMain.handle('agent:delete-session'", start);
    const source = mainSource.slice(start, end);
    expect(source.indexOf('sessionRecord.deleted = true;')).toBeGreaterThan(-1);
    expect(source.indexOf('sessionRecord.deleted = true;')).toBeLessThan(
      source.indexOf('sessionRecord.runtime?.abort?.()'),
    );
    expect(source).toContain('alreadyRemoved: true');
    expect(source.indexOf('remoteSessionDeletions.mark(')).toBeLessThan(
      source.indexOf('sessionRecord.runtime?.abort?.()'),
    );
  });

  test('does not publish metadata or history for deleted sessions', () => {
    expect(functionSource('emitSessionMeta', 'emitSessionHistory')).toContain(
      'if (!sessionRecord || sessionRecord.deleted) return;',
    );
    expect(functionSource('emitSessionHistory', 'isPlainObject')).toContain(
      'if (!sessionRecord || sessionRecord.deleted) return;',
    );
  });

  test('does not list or publish final state for deletion-pending sessions', () => {
    const listStart = mainSource.indexOf('function listVisibleSessionSummaries');
    const listEnd = mainSource.indexOf("ipcMain.handle('agent:list-sessions'", listStart);
    expect(mainSource.slice(listStart, listEnd)).toContain(
      '.filter(s => !s.deleted)',
    );

    const runSource = functionSource('runSessionPromptNow', 'runSessionPrompt');
    expect(runSource).toContain('if (!sessionRecord.deleted) {');
    expect(runSource).toContain("emitToRenderer('agent:state'");
  });

  test('does not continue queued or completed prompt work after deletion', () => {
    const queuedRunSource = functionSource('runSessionPrompt', 'getLatestAssistantTextFromHistory');
    expect(queuedRunSource).toContain('if (options.sessionRecord.deleted)');

    const sendStart = mainSource.indexOf('async function sendAgentPromptNow');
    const sendEnd = mainSource.indexOf('\nfunction sendAgentPrompt(', sendStart);
    const sendSource = mainSource.slice(sendStart, sendEnd);
    expect(sendSource).toContain('if (sessionRecord.deleted)');
    expect(sendSource).toContain('deleted: true');
  });
});

// Exercise the actual Electron sync function with controlled network timing.
function remoteSyncHarness(fetchContext = async () => ({ context: { messages: [] } })) {
  const sessions = new Map<string, any>();
  const deleted = new Set<string>();
  const published: string[] = [];
  const persisted: string[] = [];
  const source = functionSource('syncRemoteDirectSessionsFromServer', 'getSessionRecord');
  const sync = runInNewContext(`
    let remoteSessionSyncPromise = null;
    let lastRemoteSessionSyncErrorMessage = '';
    async ${source}
    syncRemoteDirectSessionsFromServer;
  `, {
    resolveRemoteDirectConnection: async () => ({ serverUrl: 'https://moss.test', authToken: 'test' }),
    fetchRemoteDirectSessions: async () => ({ sessions: [{ sessionId: 'server-session', createdAt: 100, lastActiveAt: 200 }] }),
    fetchRemoteDirectSessionContext: fetchContext,
    remoteSessionDeletions: { has: (id: string) => deleted.has(id) },
    normalizeOriginChannel: () => 'desktop',
    remoteSessionTimestamp: (value: number, fallback = 1) => Number(value) || fallback,
    findRemoteDirectSessionRecord: (id: string) => [...sessions.values()].find(record => record.underlyingSessionId === id),
    createSessionRecord: (input: any) => {
      const record = { id: 'desktop-id', history: [], ...input };
      sessions.set(record.id, record);
      return record;
    },
    closeWorkspaceWatcher: () => {},
    createRemoteHistoryCheckpoint,
    applyRemoteSessionTitle,
    applyRemoteSessionHistoryTitle,
    applyRemoteSessionWorkspace: () => false,
    syncSessionRecordHistory: (record: any, history: any[]) => { record.history = history; return true; },
    emitSessionHistory: (record: any) => { published.push(record.id); },
    emitSessionMeta: (record: any) => { published.push(record.id); },
    schedulePersistSession: (record: any) => { persisted.push(record.id); },
    mossLog: () => {},
  });
  return { sync, sessions, deleted, published, persisted };
}

function deletionHarness(deleteRemote: () => Promise<void>) {
  const actions: string[] = [];
  const record: any = {
    id: 'desktop-id', agentMode: 'remote-direct', underlyingSessionId: 'server-session',
    history: [{ type: 'user', message: { content: 'Keep this history' } }],
    runtime: { abort: async () => { actions.push('abort'); } },
  };
  const sessions = new Map([[record.id, record]]);
  const start = mainSource.indexOf('async function deleteSessionRecordById');
  const end = mainSource.indexOf("ipcMain.handle('agent:delete-session'", start);
  const remove = runInNewContext(`${mainSource.slice(start, end)}; deleteSessionRecordById;`, {
    sessions, subAgentSessions: new Map(), projectCoordinatorTaskRuns: new Map(),
    projectTaskCancellationRequests: new Set(), subAgentSyncTimers: new Map(),
    browserAutomationSessionOrigins: new Map(), pendingBrowserAutomationGrants: new Map(),
    isProjectTaskRootSession: () => false,
    resolveRemoteDirectConnection: async () => ({ serverUrl: 'https://moss.test', authToken: 'test' }),
    deleteRemoteDirectSession: async ({ sessionId }: { sessionId: string }) => {
      expect(sessionId).toBe('server-session');
      actions.push('remote-request');
      await deleteRemote();
      actions.push('remote-confirmed');
    },
    remoteSessionDeletions: { mark: () => { actions.push('tombstone'); } },
    AbortSignal,
    mossLog: () => {},
    removeCronTasksForSession: async () => [],
    closeWorkspaceWatcher: () => {},
    rejectPendingQuestionRequestsForSession: async () => {},
    shutdownSessionAgentTeam: async () => {},
    agentTeamsService: null,
    disposeRuntime: () => {},
    browserViewManager: null,
    removeSubAgentSessionRecords: async () => 0,
    deletePersistedSession: () => { actions.push('local-delete'); },
    fsp: { rm: async () => {} },
    getLocalSessionDir: () => '/unused-test-session',
    emitToRenderer: () => { actions.push('removed-event'); },
  });
  return { record, sessions, actions, remove: () => remove(record.id) };
}
