import { afterEach, describe, expect, it } from 'bun:test';
import { appendFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalTranscriptSync, readTranscriptHistory } from '../src/local-transcript-sync.mjs';
import { createSessionHistoryService } from '../src/session-history-service.mjs';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const user = (text: string) => ({ type: 'user', message: { content: text } });
const jsonl = (entries: unknown[]) => entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
const readOptions = { isDisplayEntry: (entry: any) => entry.type === 'user' || entry.type === 'assistant', requireComplete: true };

async function fixture(intervalMs = 60_000) {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-transcript-sync-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'session.jsonl');
  const original = [user('desktop prompt')];
  await writeFile(file, jsonl(original));
  const record = { file, history: original, busy: false, deleted: false, runtime: {} as object | null };
  const published: unknown[] = [];
  let invalidations = 0;
  const sync = createLocalTranscriptSync({
    getPath: (record: any) => record.file,
    readHistory: (record: any) => readTranscriptHistory(record.file, readOptions),
    canSync: (record: any) => !record.busy,
    invalidateRuntime: (record: any) => { record.runtime = null; invalidations += 1; },
    applyHistory: (record: any, history: any[]) => { record.history = history; published.push(history); },
    intervalMs,
  });
  cleanups.push(() => sync.dispose());
  await sync.acknowledge(record);
  return { record, sync, published, getInvalidations: () => invalidations };
}

describe('local transcript synchronization', () => {
  it('reloads an already cached, live Desktop session from its transcript when opened again', async () => {
    const { record } = await fixture();
    Object.assign(record, { underlyingSessionId: 'engine-session', historyLoadedFromSource: true });
    const service = createSessionHistoryService({
      sessionPaths: { getLocalSessionTranscriptPath: (record: any) => record.file },
      disposeRuntime: (record: any) => { record.runtime = null; },
      hasActiveAgentTeam: () => false,
      schedulePersistSession() {}, emitSessionMeta() {}, emitSessionHistory() {}, mossLog() {},
    });
    cleanups.push(() => service.localTranscriptSync.dispose());
    await service.localTranscriptSync.acknowledge(record);
    await appendFile(record.file, jsonl([user('CLI turn after the Desktop cache was loaded')]));
    expect(await service.loadSessionHistoryFromSource(record)).toEqual([user('desktop prompt'), user('CLI turn after the Desktop cache was loaded')]);
    expect(record.runtime).toBeNull();
  });

  it('publishes CLI appends while Desktop stays open, and invalidates its stale runtime', async () => {
    const { record, published, getInvalidations } = await fixture(10);
    await appendFile(record.file, jsonl([user('CLI prompt'), { type: 'assistant', message: { content: 'CLI reply' } }]));
    const deadline = Date.now() + 2000;
    while (published.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    expect(record.history).toHaveLength(3);
    expect(JSON.stringify(record.history)).toContain('CLI reply');
    expect(record.runtime).toBeNull();
    expect(getInvalidations()).toBe(1);
  });

  it('treats file replacements as authoritative even when the new history is shorter', async () => {
    const { record, sync, published } = await fixture();
    await appendFile(record.file, jsonl([user('old branch')]));
    await sync.refresh(record);
    const replacement = record.file + '.tmp';
    await writeFile(replacement, jsonl([user('new branch')]));
    await rename(replacement, record.file);
    await sync.refresh(record);
    expect(record.history).toEqual([user('new branch')]);
    expect(published).toHaveLength(2);
    await sync.refresh(record);
    expect(published).toHaveLength(2);
  });

  it('keeps the current display during a partial append and retries after it completes', async () => {
    const { record, sync, published } = await fixture();
    const line = JSON.stringify(user('CLI partial'));
    await appendFile(record.file, line.slice(0, -3));
    expect(await sync.refresh(record)).toBe(false);
    expect(published).toHaveLength(0);
    await appendFile(record.file, line.slice(-3) + '\n');
    await sync.refresh(record);
    expect(record.history).toHaveLength(2);
    expect(published).toHaveLength(1);
  });

  it('defers updates during a Desktop turn and acknowledges its own writes without resetting the runtime', async () => {
    const { record, sync, published, getInvalidations } = await fixture();
    record.busy = true;
    await appendFile(record.file, jsonl([user('desktop turn')]));
    expect(await sync.refresh(record)).toBe(false);
    await sync.acknowledge(record);
    record.busy = false;
    await sync.refresh(record);
    expect(published).toHaveLength(0);
    expect(getInvalidations()).toBe(0);
    await appendFile(record.file, jsonl([user('next CLI turn')]));
    await sync.refresh(record);
    expect(published).toHaveLength(1);
  });

  it('does not publish a read that races with an append, a new turn, or session removal', async () => {
    const { record } = await fixture();
    let resolveRead!: (value: unknown) => void;
    let started!: () => void;
    let published = 0;
    const createRace = () => {
      const ready = new Promise<void>(resolve => { started = resolve; });
      const sync = createLocalTranscriptSync({
        getPath: () => record.file,
        readHistory: async () => { started(); return new Promise(resolve => { resolveRead = resolve; }); },
        canSync: () => !record.busy,
        invalidateRuntime: () => {},
        applyHistory: () => { published += 1; },
        intervalMs: 60_000,
      });
      cleanups.push(() => sync.dispose());
      return { sync, ready };
    };
    for (const action of ['append', 'busy', 'forget']) {
      const { sync, ready } = createRace();
      const pending = sync.refresh(record);
      await ready;
      if (action === 'append') await appendFile(record.file, jsonl([user('racing append')]));
      if (action === 'busy') record.busy = true;
      if (action === 'forget') sync.forget(record);
      resolveRead([user('stale read')]);
      expect(await pending).toBe(false);
      expect(published).toBe(0);
      sync.dispose();
      record.busy = false;
    }
  });

  it('keeps cached history if the transcript is temporarily absent', async () => {
    const { record, sync, published } = await fixture();
    const raw = await readFile(record.file, 'utf8');
    await rm(record.file);
    expect(await sync.refresh(record)).toBe(false);
    expect(published).toHaveLength(0);
    await writeFile(record.file, raw + jsonl([user('restored')]));
    await sync.refresh(record);
    expect(record.history).toHaveLength(2);
  });

  for (const action of ['dispose', 'path-change', 'acknowledge'] as const) {
    it(`discards a pending history read after ${action}`, async () => {
      const { record } = await fixture();
      let resolveRead!: (history: unknown[]) => void;
      let started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const published: unknown[] = [];
      const sync = createLocalTranscriptSync({
        getPath: (record: any) => record.file,
        readHistory: () => { started(); return new Promise(resolve => { resolveRead = resolve; }); },
        invalidateRuntime: () => { throw new Error('Stale history must not invalidate the runtime'); },
        applyHistory: (_record: unknown, history: unknown[]) => published.push(history),
        intervalMs: 60_000,
      });
      cleanups.push(() => sync.dispose());
      const pending = sync.refresh(record);
      await ready;
      if (action === 'dispose') sync.dispose();
      if (action === 'path-change') {
        record.file = path.join(path.dirname(record.file), 'new-session.jsonl');
        await writeFile(record.file, jsonl([user('new transcript')]));
      }
      if (action === 'acknowledge') await sync.acknowledge(record);
      resolveRead([user('stale snapshot')]);
      expect(await pending).toBe(false);
      expect(published).toEqual([]);
    });
  }

  it('does not let an old read replace history after the same record is forgotten and reopened', async () => {
    const { record } = await fixture();
    const reads: Array<(history: unknown[]) => void> = [];
    let started!: () => void;
    let ready = new Promise<void>(resolve => { started = resolve; });
    const published: unknown[] = [];
    const sync = createLocalTranscriptSync({
      getPath: (record: any) => record.file,
      readHistory: () => { started(); return new Promise(resolve => reads.push(resolve)); },
      invalidateRuntime: () => {},
      applyHistory: (_record: unknown, history: unknown[]) => published.push(history),
      intervalMs: 60_000,
    });
    cleanups.push(() => sync.dispose());
    const oldRead = sync.refresh(record);
    await ready;
    sync.forget(record);
    ready = new Promise<void>(resolve => { started = resolve; });
    const newRead = sync.refresh(record);
    await ready;
    reads[1]!([user('current history')]);
    expect(await newRead).toBe(true);
    reads[0]!([user('old history')]);
    expect(await oldRead).toBe(false);
    expect(published).toEqual([[user('current history')]]);
  });
});
