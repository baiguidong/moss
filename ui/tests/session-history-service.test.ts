import { afterEach, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDesktopDataPaths } from '../src/desktop-data-layout.mjs';
import { createSessionPaths } from '../src/session-paths.mjs';
import { createSessionHistoryService } from '../src/session-history-service.mjs';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const user = (text: string, uuid = 'u1') => ({ type: 'user', uuid, message: { content: text } });
const assistant = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const jsonl = (history: unknown[]) => history.map(entry => JSON.stringify(entry)).join('\n') + '\n';

async function fixture(overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-session-history-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const paths = createDesktopDataPaths(root);
  const sessionPaths = createSessionPaths({ DESKTOP_DATA_PATHS: paths });
  await mkdir(sessionPaths.getLocalSessionEngineDir('session'), { recursive: true });
  const persisted: unknown[] = [];
  const published: unknown[] = [];
  let invalidations = 0;
  const service = createSessionHistoryService({
    DESKTOP_DATA_PATHS: paths, sessionPaths,
    disposeRuntime: record => { record.runtime = null; invalidations += 1; },
    hasActiveAgentTeam: () => false,
    schedulePersistSession: (record, immediate) => persisted.push([record.id, immediate]),
    emitSessionHistory: (record, options) => published.push(options), emitSessionMeta() {}, mossLog() {},
    ...overrides,
  });
  cleanups.push(() => service.localTranscriptSync.dispose());
  const record: any = { id: 'session', agentMode: 'local', underlyingSessionId: null, history: [user('question')], workspace: root };
  return { paths, service, record, persisted, published, invalidations: () => invalidations };
}

it('recovers the latest valid local transcript after interruption and persists its engine ID', async () => {
  const { paths, service, record, persisted } = await fixture();
  const old = paths.sessionTranscriptPath('session', 'older');
  await writeFile(old, jsonl([user('question'), assistant('old response')]));
  await utimes(old, new Date(1000), new Date(1000));
  const history = [user('question'), assistant('recovered response')];
  await writeFile(paths.sessionTranscriptPath('session', 'newer'), jsonl(history));
  await writeFile(path.join(paths.sessionEngineDir('session'), 'invalid name.jsonl'), jsonl([user('ignore')]));
  expect(await service.recoverInterruptedLocalSession(record)).toBe(true);
  expect(record.history).toEqual(history);
  expect(record.underlyingSessionId).toBe('newer');
  expect(record.preview).toBe('recovered response');
  expect(persisted).toEqual([['session', true]]);
  expect(await service.recoverInterruptedLocalSession(record)).toBe(false);
});

it('keeps cached history when recovery only finds an unrelated transcript and skips remote drafts', async () => {
  const { paths, service, record, persisted } = await fixture();
  await writeFile(paths.sessionTranscriptPath('session', 'unrelated'), jsonl([user('different conversation')]));
  expect(await service.recoverInterruptedLocalSession(record)).toBe(false);
  expect(record.underlyingSessionId).toBeNull();
  expect(record.history).toEqual([user('question')]);
  record.agentMode = 'remote-direct';
  expect(await service.recoverInterruptedLocalSession(record)).toBe(false);
  expect(persisted).toEqual([]);
});

it('uses the snapshot fallback when JSONL is absent and restores snapshot metadata', async () => {
  const calls: unknown[] = [];
  const history = [user('question'), assistant('from snapshot')];
  const { service, record } = await fixture({
    getLoadClaudeSessionSnapshotFn: async () => async (id, options) => {
      calls.push([id, options]);
      return { messages: history, metadata: { sourceSessionId: 'restored-engine', customTitle: 'Restored title' } };
    },
  });
  record.underlyingSessionId = 'missing-engine';
  expect(await service.loadSessionHistoryFromSource(record)).toEqual(history);
  expect(record.title).toBe('Restored title');
  expect(record.underlyingSessionId).toBe('restored-engine');
  expect(calls).toHaveLength(1);
});

it('applies a pending rewind as an explicit history replacement', async () => {
  const { paths, service, record, published } = await fixture();
  record.underlyingSessionId = 'engine';
  record.history = [user('question'), assistant('first reply'), user('rewind this', 'u2'), assistant('second reply')];
  record.rewindMessageId = 'u2';
  await writeFile(paths.sessionTranscriptPath('session', 'engine'), jsonl(record.history));
  expect(await service.loadSessionHistoryFromSource(record)).toEqual([user('question'), assistant('first reply')]);
  expect(published).toEqual([{ replaceHistory: true }]);
});

it('defers transcript replacement during active background work, then invalidates the stale runtime', async () => {
  const { paths, service, record, invalidations } = await fixture();
  record.underlyingSessionId = 'engine';
  const history = [user('question'), assistant('external reply')];
  await writeFile(paths.sessionTranscriptPath('session', 'engine'), jsonl(history));
  let running = true;
  record.runtime = { getAppState: () => ({ tasks: { worker: { status: running ? 'running' : 'completed' } } }) };
  expect(await service.localTranscriptSync.refresh(record)).toBe(false);
  expect(invalidations()).toBe(0);
  running = false;
  expect(await service.localTranscriptSync.refresh(record)).toBe(true);
  expect(record.history).toEqual(history);
  expect(invalidations()).toBe(1);
});

it('does not replace a more complete turn with a partially written transcript', async () => {
  const { paths, service, record, persisted } = await fixture();
  record.underlyingSessionId = 'engine';
  record.history = [user('question'), assistant('complete reply')];
  await writeFile(paths.sessionTranscriptPath('session', 'engine'), jsonl([user('question')]));
  expect(await service.refreshSessionHistoryFromTranscriptAfterTurn(record)).toBe(false);
  expect(record.history).toEqual([user('question'), assistant('complete reply')]);
  expect(persisted).toEqual([]);
});
