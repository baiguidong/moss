import { afterEach, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectStore } from '../src/project-store.mjs';
import { createProjectAssetService } from '../src/project-assets.mjs';
import { createDesktopDataPaths } from '../src/desktop-data-layout.mjs';
import { normalizeProjectId } from '../src/shared/project-normalization.mjs';
import { runInKeyedQueue } from '../src/shared/keyed-queue.mjs';
import { readJsonFileAsync, writeJsonFileAtomicAsync } from '../src/shared/json-files.mjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const deferred = () => {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
};
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-project-store-'));
  roots.push(root);
  const projectRecordQueues = new Map();
  const store = createProjectStore({ DESKTOP_DATA_PATHS: createDesktopDataPaths(root), projectRecordQueues, mossLog() {} });
  await store.ensureProjectStructure('project');
  await store.writeProject({ id: 'project', name: 'Original', instructions: '', updatedAt: 1, createdAt: 1 });
  return { root, store, projectRecordQueues };
}

it('preserves the project layout, memory and finalizer files across store instances', async () => {
  const { root, store } = await fixture();
  expect(store.getProjectAssetsDir('project')).toBe(path.join(root, 'projects/project/workspace'));
  expect((await store.getProjectMemory('project')).overview).toBe('');
  await writeFile(store.getProjectMemoryOverviewPath('project'), '  Retained knowledge\n');
  await writeJsonFileAtomicAsync(store.getProjectMemoryIndexPath('project'), { version: 3, lastSessionId: 'session', finalizedSessionCount: 2 });
  await writeJsonFileAtomicAsync(store.getProjectSessionFinalizerResultPath('project', 'session'), { completedAt: 9, conclusion: 'Done', assetIds: [' a ', 'a'], result: { summary: 'ok' } });
  await store.linkSessionToProject('project', { id: 'session' });
  const reopened = createProjectStore({ DESKTOP_DATA_PATHS: createDesktopDataPaths(root), projectRecordQueues: new Map(), mossLog() {} });
  expect(reopened.readProjectSync('project').name).toBe('Original');
  expect(await reopened.getProjectMemory('project')).toMatchObject({ version: 3, overview: 'Retained knowledge', finalizedSessionCount: 2 });
  expect(reopened.getProjectSessionFinalizerResultSync('project', 'session')).toMatchObject({ completedAt: 9, assetIds: ['a'], result: { summary: 'ok' } });
  const membership = path.join(reopened.getProjectSessionsDir('project'), 'session.json');
  expect(JSON.parse(await readFile(membership, 'utf8')).sessionId).toBe('session');
  await reopened.unlinkSessionFromProject('project', 'session');
  await expect(readFile(membership)).rejects.toThrow('ENOENT');
  expect(reopened.readProjectSync('../escape')).toBeNull();
  await expect(reopened.readProject('../escape')).rejects.toThrow('Invalid project id');
  expect((await readdir(store.getProjectDir('project'))).some(name => name.endsWith('.tmp'))).toBe(false);
});

it('serializes read-modify-write updates and recovers the queue after a failed mutation', async () => {
  const { store, projectRecordQueues } = await fixture();
  const entered = deferred();
  const release = deferred();
  const first = store.mutateProjectRecord('project', async current => {
    entered.resolve();
    await release.promise;
    return { ...current, name: 'Renamed' };
  });
  await entered.promise;
  const second = store.mutateProjectRecord('project', current => ({ ...current, instructions: current.name }));
  release.resolve();
  await Promise.all([first, second]);
  expect(await store.readProject('project')).toMatchObject({ name: 'Renamed', instructions: 'Renamed' });
  await expect(store.mutateProjectRecord('project', () => { throw new Error('failed update'); })).rejects.toThrow('failed update');
  await store.touchProjectBestEffort('project', 100);
  await store.touchProjectBestEffort('project', 50);
  expect((await store.readProject('project')).updatedAt).toBe(100);
  expect(projectRecordQueues.size).toBe(0);
});

it('shares the record queue with asset imports so an upload cannot overwrite a concurrent rename', async () => {
  const { root, store, projectRecordQueues } = await fixture();
  const sourcePath = path.join(root, 'input.txt');
  await writeFile(sourcePath, 'asset contents');
  const entered = deferred();
  const release = deferred();
  const assetRead = deferred();
  const rename = store.mutateProjectRecord('project', async current => {
    entered.resolve();
    await release.promise;
    return { ...current, name: 'New name', skillIds: ['retained-skill'] };
  });
  await entered.promise;
  const assets = createProjectAssetService({
    ...store, projectRecordQueues, normalizeProjectId, runInKeyedQueue,
    readJsonFileAsync, writeJsonFileAtomicAsync,
    readProject: async id => { const result = await store.readProject(id); assetRead.resolve(); return result; },
    appendProjectEvent: async () => {}, emitToRenderer() {}, invalidateProjectSessionRuntimes() {},
  });
  const upload = assets.addProjectAsset('project', { sourcePath });
  await assetRead.promise;
  release.resolve();
  await Promise.all([rename, upload]);
  expect(await store.readProject('project')).toMatchObject({ name: 'New name', skillIds: ['retained-skill'] });
  expect(await readFile(path.join(store.getProjectAssetsDir('project'), 'input.txt'), 'utf8')).toBe('asset contents');
  expect(await assets.listProjectAssets('project')).toHaveLength(1);
  expect(projectRecordQueues.size).toBe(0);
});

it('prunes old runtime runs using the existing age and count limits', async () => {
  const { store } = await fixture();
  const now = Date.now();
  await Promise.all(Array.from({ length: 55 }, async (_, index) => {
    const dir = path.join(store.getProjectRunsDir('project'), `run-${index}`);
    await mkdir(dir);
    const modified = new Date(index === 54 ? now - 31 * 86400_000 : now - index * 1000);
    await utimes(dir, modified, modified);
  }));
  await store.pruneProjectRuntimeRuns('project', now);
  const runs = await readdir(store.getProjectRunsDir('project'));
  expect(runs).toHaveLength(50);
  expect(runs).toContain('run-0');
  expect(runs).not.toContain('run-50');
  expect(runs).not.toContain('run-54');
});
