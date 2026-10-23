import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProjectMemoryService } from '../src/project-memory-service.mjs';
import { createProjectStore } from '../src/project-store.mjs';
import { createDesktopDataPaths } from '../src/desktop-data-layout.mjs';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => resolve = done); return { promise, resolve }; };
async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'moss-project-memory-'));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  const store = createProjectStore({ DESKTOP_DATA_PATHS: createDesktopDataPaths(home), projectRecordQueues: new Map(), mossLog() {} });
  for (const id of ['p', 'other']) { await store.ensureProjectStructure(id); await store.writeProject({ id, name: id, createdAt: 1, updatedAt: 1 }); }
  await writeFile(store.getProjectMemoryOverviewPath('p'), 'Legacy knowledge');
  const sources: any[] = [{ id: 's1', title: 'first', projectId: 'p', updatedAt: 1, transcript: 'user: build A; assistant: built A' }];
  const assets: any[] = [];
  let time = 100_000;
  const calls: any[] = [];
  let query = async (input: any) => JSON.stringify(input.stage === 'extract' ? { summary: 'Verified A from s1' } : { overview: 'Legacy knowledge and verified A [s1]' });
  const make = () => {
    const service = createProjectMemoryService({ getProjectDir: store.getProjectDir, readProject: store.readProject,
      getMemory: store.getProjectMemory, listSources: async id => sources.filter(source => source.projectId === id).map(source => ({ ...source })),
      listAssets: async id => assets.filter(asset => asset.projectId === id),
      readSource: async source => source.transcript, query: async input => { calls.push(input); return query(input); }, now: () => time,
      options: { idleMs: 1000, cooldownMs: 10000, retryMs: 1000, maxAgeMs: 1e9, batchSize: 2 } });
    cleanups.push(() => service.stop());
    return service;
  };
  return { store, sources, assets, calls, make, advance: (ms: number) => time += ms, setQuery: (fn: typeof query) => query = fn };
}

test('two stages preserve legacy memory, deduplicate across restart, and isolate projects', async () => {
  const f = await fixture(); const service = f.make();
  await service.run('p');
  expect(f.calls.map(call => call.stage)).toEqual(['extract', 'consolidate']);
  expect(f.calls[1].prompt).toContain('Legacy knowledge');
  expect(await f.store.getProjectMemory('p')).toMatchObject({ version: 1, sourceIds: ['s1'] });
  expect((await service.read('other', { action: 'list' }))).toEqual([]);
  await expect(service.read('other', { sourceId: 's1' })).rejects.toThrow();
  await expect(service.addNote('other', { text: 'incorrect', sessionId: 's1' })).rejects.toThrow();
  await service.stop();
  const reopened = f.make();
  expect(await reopened.run('p')).toMatchObject({ skipped: 'unchanged' });
  f.advance(10001);
  expect(await reopened.run('p')).toMatchObject({ skipped: 'unchanged' });
  expect(f.calls).toHaveLength(2);
});

test('consolidation failure retains snapshot and reuses cached extraction on retry', async () => {
  const f = await fixture(); const service = f.make();
  await service.run('p'); f.advance(10001);
  f.sources[0].updatedAt = 2; f.sources[0].transcript += ' updated';
  f.setQuery(async input => { if (input.stage === 'consolidate') throw new Error('model unavailable'); return '{"summary":"changed"}'; });
  await expect(service.run('p')).rejects.toThrow('model unavailable');
  expect((await f.store.getProjectMemory('p')).version).toBe(1);
  expect((await service.getStatus('p')).phase).toBe('failed');
  f.advance(1001);
  f.setQuery(async () => '{"overview":"updated [s1]"}');
  await service.run('p');
  expect(f.calls.filter(call => call.stage === 'extract')).toHaveLength(2);
  expect((await f.store.getProjectMemory('p')).version).toBe(2);
});

test('coalesces concurrent jobs and rejects a stale consolidation when correction arrives', async () => {
  const f = await fixture(); const service = f.make();
  const entered = deferred(), release = deferred();
  f.setQuery(async input => {
    if (input.stage === 'extract') return '{"summary":"A"}';
    entered.resolve(); await release.promise; return '{"overview":"A"}';
  });
  const first = service.run('p');
  expect(service.run('p')).toBe(first);
  await entered.promise;
  await service.addNote('p', { text: 'Forget A', sessionId: 's1' });
  release.resolve();
  expect(await first).toMatchObject({ skipped: 'superseded' });
  expect((await f.store.getProjectMemory('p')).overview).toBe('Legacy knowledge');
  f.setQuery(async input => { expect(input.stage).toBe('consolidate'); return '{"overview":"A forgotten"}'; });
  await service.run('p', { force: true });
  expect(f.calls.at(-1).prompt).toContain('Forget A');
  expect((await service.read('p')).corrections).toEqual([]);
  expect((await readFile(path.join(f.store.getProjectDir('p'), 'memory/notes', `${(await f.store.getProjectMemory('p')).noteIds[0]}.json`), 'utf8'))).toContain('Forget A');
});

test('does not publish extraction for a changed/busy source, or write memory after project archival', async () => {
  const f = await fixture(); const service = f.make();
  f.setQuery(async input => { f.sources[0].updatedAt++; f.sources[0].busy = true; return '{"summary":"stale"}'; });
  await service.run('p');
  expect(await service.read('p', { action: 'list' })).toEqual([]);
  f.sources[0].busy = false;
  f.setQuery(async input => {
    if (input.stage === 'extract') return '{"summary":"good"}';
    await f.store.mutateProjectRecord('p', p => ({ ...p, archivedAt: 5 }));
    return '{"overview":"not committed"}';
  });
  await expect(service.run('p', { force: true })).rejects.toThrow('Project not found');
  expect((await f.store.getProjectMemory('p')).overview).toBe('Legacy knowledge');
});

test('batches long sources, applies corrections last, and stops without touching source sessions', async () => {
  const f = await fixture(); const service = f.make();
  for (let i = 2; i <= 8; i++) f.sources.push({ ...f.sources[0], id: `s${i}` });
  await service.addNote('p', { text: 'Forget the obsolete API.' });
  f.setQuery(async input => JSON.stringify(input.stage === 'extract' ? { summary: 'x'.repeat(12000) } : { overview: 'compact' }));
  await service.run('p', { force: true });
  const folds = f.calls.filter(call => call.stage === 'consolidate');
  expect(folds.length).toBeGreaterThan(1);
  expect(folds.every(call => call.prompt.length < 42000)).toBe(true);
  expect(folds.at(-1).prompt).toContain('Forget the obsolete API.');
  await service.stop();
  const other = f.make();
  const entered = deferred();
  f.sources[0].updatedAt++; f.sources[0].transcript += ' newer';
  f.setQuery(async input => { entered.resolve(); await new Promise<void>((resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); return ''; });
  const run = other.run('p', { force: true });
  const outcome = run.catch(error => error);
  await entered.promise; await other.stop(); expect((await outcome).name).toBe('AbortError');
  expect((await f.store.getProjectMemory('p')).version).toBe(1);
});

test('a second service respects the project lease while another project can run independently', async () => {
  const f = await fixture(); const first = f.make(), second = f.make();
  const entered = deferred(), release = deferred();
  f.setQuery(async input => { if (input.stage === 'extract') { entered.resolve(); await release.promise; return '{"summary":"A"}'; } return '{"overview":"A"}'; });
  const running = first.run('p');
  await entered.promise;
  expect(await second.run('p', { force: true })).toMatchObject({ skipped: 'running' });
  expect(await second.run('other')).toMatchObject({ skipped: 'empty' });
  release.resolve(); await running;
  expect(f.calls.filter(call => call.stage === 'extract')).toHaveLength(1);
});

test('automatic passes honor idle age, busy sources, batch size and cooldown', async () => {
  const f = await fixture(); const service = f.make();
  for (const [id, updatedAt, busy] of [['s2', 2, false], ['s3', 3, false], ['recent', 100000, false], ['busy', 1, true], ['old', -2e9, false]]) {
    f.sources.push({ ...f.sources[0], id, updatedAt, busy });
  }
  await service.run('p');
  expect(f.calls.filter(call => call.stage === 'extract').map(call => call.source.id)).toEqual(['s3', 's2']);
  expect(await service.run('p')).toMatchObject({ skipped: 'cooldown' });
  expect(f.calls.filter(call => call.stage === 'extract').map(call => call.source.id)).toEqual(['s3', 's2', 's1']);
  expect((await f.store.getProjectMemory('p')).version).toBe(1);
  f.advance(10001);
  await service.run('p');
  expect(f.calls.filter(call => call.stage === 'extract').map(call => call.source.id)).toEqual(['s3', 's2', 's1', 'recent']);
});

test('a damaged source cannot block healthy sources and has its own durable retry delay', async () => {
  const f = await fixture(); const service = f.make();
  f.sources.push({ ...f.sources[0], id: 'broken', updatedAt: 2 });
  f.setQuery(async input => {
    if (input.source?.id === 'broken') throw new Error('corrupt transcript');
    return JSON.stringify(input.stage === 'extract' ? { summary: 'healthy' } : { overview: 'Healthy [s1]' });
  });
  await service.run('p');
  expect((await f.store.getProjectMemory('p')).overview).toBe('Healthy [s1]');
  expect((await service.getStatus('p')).error).toContain('1 个会话');
  await service.stop();
  const reopened = f.make();
  await reopened.run('p');
  expect(f.calls.filter(call => call.source?.id === 'broken')).toHaveLength(1);
  f.advance(1001);
  f.setQuery(async input => JSON.stringify(input.stage === 'extract' ? { summary: 'recovered' } : { overview: 'Both sources' }));
  expect(await reopened.run('p')).toMatchObject({ skipped: 'cooldown', extractedCount: 1 });
  expect((await reopened.read('p', { sourceId: 'broken' })).summary).toBe('recovered');
  expect((await f.store.getProjectMemory('p')).version).toBe(1);
  f.advance(10000);
  await reopened.run('p');
  expect((await f.store.getProjectMemory('p')).overview).toBe('Both sources');
  expect((await reopened.getStatus('p')).error).toBe('');
});

test('automatic scheduling drains extraction batches during cooldown and resumes consolidation after restart', async () => {
  const f = await fixture(); const service = f.make();
  await service.run('p');
  for (let i = 2; i <= 4; i++) f.sources.push({ ...f.sources[0], id: `s${i}`, updatedAt: i });
  const extracted = deferred();
  f.setQuery(async input => {
    expect(input.stage).toBe('extract');
    if (input.source.id === 's2') extracted.resolve();
    return JSON.stringify({ summary: `Verified ${input.source.id}` });
  });
  await service.consider('p');
  await extracted.promise;
  await service.run('p'); // Join the already running scheduled pass.
  expect(f.calls.filter(call => call.stage === 'extract').map(call => call.source.id)).toEqual(['s1', 's4', 's3', 's2']);
  expect(f.calls.filter(call => call.stage === 'consolidate')).toHaveLength(1);
  expect((await f.store.getProjectMemory('p')).version).toBe(1);
  await service.stop();

  f.advance(10001);
  const reopened = f.make(), consolidated = deferred();
  f.setQuery(async input => {
    expect(input.stage).toBe('consolidate');
    expect(JSON.parse(input.prompt.split('\n').at(-1)).sources.map((source: any) => source.id)).toEqual(['s2', 's3', 's4']);
    consolidated.resolve();
    return '{"overview":"All sources consolidated"}';
  });
  await reopened.consider('p');
  await consolidated.promise;
  await reopened.run('p');
  expect(await f.store.getProjectMemory('p')).toMatchObject({ version: 2, sourceIds: ['s1', 's2', 's3', 's4'] });
}, 10000);

test('clearing a source does not reuse its old extraction', async () => {
  const f = await fixture(); const service = f.make();
  await service.run('p');
  f.sources[0].updatedAt++;
  f.sources[0].transcript = '';
  f.setQuery(async input => {
    expect(input.stage).toBe('consolidate');
    const data = JSON.parse(input.prompt.split('\n').at(-1));
    expect(data.sources[0].summary).toBe('');
    return '{"overview":""}';
  });
  await service.run('p', { force: true });
  expect((await service.read('p', { sourceId: 's1' })).summary).toBe('');
});

test('the automatic batch limit includes failed extractions', async () => {
  const f = await fixture(); const service = f.make();
  f.sources.push({ ...f.sources[0], id: 's2' }, { ...f.sources[0], id: 's3' });
  f.setQuery(async () => { throw new Error('model down'); });
  await service.run('p');
  expect(f.calls).toHaveLength(2);
});

test('removing the final source and result can clear the generated memory', async () => {
  const f = await fixture(); const service = f.make();
  f.assets.push({ id: 'result', projectId: 'p', name: 'report', path: '/report.md' });
  await service.run('p');
  f.sources.length = 0;
  f.assets.length = 0;
  f.setQuery(async input => {
    expect(input.stage).toBe('consolidate');
    const data = JSON.parse(input.prompt.split('\n').at(-1));
    expect(data.removedSourceIds).toEqual(['s1']);
    expect(data.removedAssetIds).toEqual(['result']);
    return '{"overview":""}';
  });
  await service.run('p', { force: true });
  expect(await f.store.getProjectMemory('p')).toMatchObject({ version: 2, overview: '', sourceIds: [], assetIds: [] });
});

test('an asset-only change schedules maintenance without a new session', async () => {
  const f = await fixture(); const service = f.make();
  f.sources.length = 0;
  f.assets.push({ id: 'result', projectId: 'p', name: 'report', path: '/report.md' });
  await f.store.mutateProjectRecord('p', project => ({ ...project, updatedAt: 1 }));
  const consolidated = deferred();
  f.setQuery(async input => {
    expect(input.stage).toBe('consolidate');
    expect(input.prompt).toContain('/report.md');
    consolidated.resolve();
    return '{"overview":"Report reference"}';
  });
  await service.consider('p');
  await consolidated.promise;
  await service.run('p');
  expect((await f.store.getProjectMemory('p')).overview).toBe('Report reference');
});

test('asset mutation during consolidation supersedes the pending snapshot', async () => {
  const f = await fixture(); const service = f.make();
  f.assets.push({ id: 'result', projectId: 'p', name: 'report', path: '/report.md' });
  f.setQuery(async input => {
    if (input.stage === 'extract') return '{"summary":"A"}';
    f.assets.length = 0;
    await f.store.mutateProjectRecord('p', project => ({ ...project, updatedAt: project.updatedAt + 1 }));
    return '{"overview":"stale report"}';
  });
  expect(await service.run('p')).toMatchObject({ skipped: 'superseded' });
  expect((await f.store.getProjectMemory('p')).overview).toBe('Legacy knowledge');
});

test('asset changes are detected even when the project timestamp has the same millisecond', async () => {
  const f = await fixture(); const service = f.make();
  f.assets.push({ id: 'result', projectId: 'p', name: 'report', path: '/report.md' });
  f.setQuery(async input => {
    if (input.stage === 'extract') return '{"summary":"A"}';
    f.assets[0].description = 'Newer result';
    return '{"overview":"old result"}';
  });
  expect(await service.run('p')).toMatchObject({ skipped: 'superseded' });
  expect((await f.store.getProjectMemory('p')).overview).toBe('Legacy knowledge');
});
