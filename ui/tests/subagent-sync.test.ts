import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { isAgentTeamSidechain, parseSubAgentTranscript, resolveSubAgentStatus } from '../src/shared/subagent-lifecycle.mjs';
import { deriveSessionPreview } from '../src/shared/session-history-display.mjs';
import { runInKeyedQueue } from '../src/shared/keyed-queue.mjs';

const source = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function syncSubAgentSessionsForParent');
const end = source.indexOf('async function syncSubAgentSessionsBestEffort', start);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(count = 1) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'moss-subagent-sync-'));
  roots.push(root);
  const dir = path.join(root, 'source');
  await fs.mkdir(dir);
  const parent: any = { id: 'parent', workspace: root, busy: false, projectId: null };
  const sessions = new Map([[parent.id, parent]]), children = new Map<string, any>();
  const emitted: any[] = [], histories: any[] = [], copies: string[] = [], manifests: any[] = [];
  let scans = 0;
  let copyHook: (() => Promise<void>) | undefined;
  const context = {
    sessions, subAgentSessions: children, path, parseSubAgentTranscript, isAgentTeamSidechain, resolveSubAgentStatus,
    runInKeyedQueue, subAgentSyncQueues: new Map(),
    findSessionSubagentDir: async () => dir,
    fsp: { ...fs, readdir: async (...args: any[]) => { scans++; return (fs.readdir as any)(...args); }, copyFile: async (from: string, to: string) => { copies.push(from); await copyHook?.(); await fs.copyFile(from, to); } },
    readJsonFileAsync: async (file: string, fallback: unknown) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } },
    scopeProjectResourceManifestForWorker: (manifest: any, resources: any) => ({ ...manifest, resources }),
    isPathInsideDirectory: () => false,
    writeJsonFileAtomicAsync: async (_file: string, manifest: any) => { manifests.push(manifest); },
    createDefaultWorkspacePath: (id: string) => path.join(root, 'mirror', id, 'workspace'),
    getLocalSessionEngineDir: (id: string) => path.join(root, 'mirror', id),
    getLocalSessionDir: (id: string) => path.join(root, 'mirror', id),
    getLocalSessionResourceManifestPath: (id: string) => path.join(root, 'mirror', id, 'resources.json'),
    getProjectSessionWorkspaceDirectories: () => [],
    DESKTOP_DATA_PATHS: { sessionTranscriptPath: (id: string, agent: string) => path.join(root, 'mirror', id, `${agent}.jsonl`) },
    normalizePermissionMode: (mode: string) => mode || 'default', desktopSettings: { permissionMode: 'default' },
    countSessionMessages: (history: any[]) => history.length, deriveSessionPreview,
    normalizeStringList: (value: any) => Array.isArray(value) ? value : [], schedulePersistSession: () => {},
    emitSessionMeta: (record: any) => emitted.push({ type: 'meta', length: record.history.length, status: record.subagentStatus }),
    emitSessionHistory: (record: any) => histories.push(record.history), emitToRenderer: () => {}, ensureSubAgentDirWatcher: () => {}, closeSubAgentDirWatcher: () => {},
    removeMirroredAgentTeamSidechain: async () => {},
  };
  const sync = runInNewContext(`${source.slice(start, end)}; syncSubAgentSessionsForParent`, context);
  async function write(index: number, texts: string[], status = 'completed') {
    await fs.writeFile(path.join(dir, `agent-a${index}.meta.json`), JSON.stringify({ agentType: 'general-purpose', status }));
    await fs.writeFile(path.join(dir, `agent-a${index}.jsonl`), texts.map((text, i) => JSON.stringify({ type: 'assistant', uuid: `m${i}`, message: { content: [{ type: 'text', text }] } })).join('\n') + '\n');
  }
  for (let i = 0; i < count; i++) await write(i, ['first']);
  const writeMeta = (meta: object) => fs.writeFile(path.join(dir, 'agent-a0.meta.json'), JSON.stringify(meta));
  return { root, dir, parent, sessions, children, copies, emitted, histories, manifests, write, writeMeta, scans: () => scans, sync: () => sync(parent), setCopyHook: (fn?: () => Promise<void>) => { copyHook = fn; } };
}

test('metadata arriving after the transcript updates worker identity and resource scope', async () => {
  const f = await fixture();
  f.parent.projectId = 'project';
  f.parent.projectResourceManifest = { assets: [], revision: 1 };
  const meta = { agentType: 'general-purpose', description: 'Same title', status: 'completed' };
  await f.writeMeta(meta);
  await f.sync();
  const resources = { connectorIds: ['connector-b'] };
  await f.writeMeta({ ...meta, agentName: 'reviewer', projectResources: resources });
  await f.sync();
  expect(f.children.get('subagent-a0').workerName).toBe('reviewer');
  expect(f.children.get('subagent-a0').connectorIds).toEqual(['connector-b']);
  expect(f.manifests.at(-1).resources).toEqual(resources);
  expect(f.copies).toHaveLength(1);
});

test('parent configuration changes update child metadata without resending a long transcript', async () => {
  const f = await fixture();
  await f.write(0, Array.from({ length: 10000 }, (_, i) => `Entry ${i}: ${'x'.repeat(100)}`));
  await f.sync();
  f.parent.permissionMode = 'plan';
  f.parent.appIds = ['app-b'];
  f.parent.appServiceIds = ['service-b'];
  f.parent.connectorIds = ['connector-b'];
  await f.sync();
  const child = f.children.get('subagent-a0');
  expect(child.permissionMode).toBe('plan');
  expect(child.appIds).toEqual(['app-b']);
  expect(child.appServiceIds).toEqual(['service-b']);
  expect(child.connectorIds).toEqual(['connector-b']);
  expect(f.histories).toHaveLength(1);
  expect(f.copies).toHaveLength(1);
});

test('status-only changes do not resend a 10000-message history', async () => {
  const f = await fixture();
  await f.write(0, Array.from({ length: 10000 }, (_, i) => `Entry ${i}`));
  await f.sync();
  await f.writeMeta({ agentType: 'general-purpose', status: 'failed' });
  await f.sync();
  expect(f.children.get('subagent-a0').subagentStatus).toBe('failed');
  expect(f.histories).toHaveLength(1);
});

test('a failed copy does not poison the parent sync queue', async () => {
  const f = await fixture();
  f.setCopyHook(async () => { throw new Error('copy failed'); });
  await expect(f.sync()).rejects.toThrow('copy failed');
  f.setCopyHook();
  await f.sync();
  expect(f.children.get('subagent-a0').history).toHaveLength(1);
});

test('split UTF-8, truncated and rewritten transcripts converge to source history', async () => {
  const f = await fixture();
  const file = path.join(f.dir, 'agent-a0.jsonl');
  const complete = Buffer.from(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '中文🙂' }] } }) + '\n');
  const split = complete.indexOf(Buffer.from('🙂')) + 2;
  await fs.writeFile(file, complete.subarray(0, split));
  await f.sync();
  expect(f.children.get('subagent-a0').history).toHaveLength(0);
  await fs.appendFile(file, complete.subarray(split));
  await f.sync();
  expect(f.children.get('subagent-a0').preview).toBe('中文🙂');
  await fs.writeFile(file, '');
  await f.sync();
  expect(f.children.get('subagent-a0').history).toHaveLength(0);
  await fs.writeFile(file, complete);
  await f.sync();
  expect(f.children.get('subagent-a0').history).toHaveLength(1);
});

test('atomic transcript replacement with identical size and mtime still refreshes history', async () => {
  const f = await fixture();
  const file = path.join(f.dir, 'agent-a0.jsonl');
  await fs.utimes(file, 1000, 1000);
  await f.sync();
  const raw = await fs.readFile(file, 'utf8');
  await fs.writeFile(`${file}.new`, raw.replace('first', 'other'));
  await fs.utimes(`${file}.new`, 1000, 1000);
  await fs.rename(`${file}.new`, file);
  await f.sync();
  expect(f.children.get('subagent-a0').preview).toBe('other');
});

test('a restarted parent cannot make an abandoned worker look running', async () => {
  const f = await fixture();
  await f.write(0, ['unfinished'], 'running');
  f.parent.busy = true;
  f.parent.runtime = { getAppState: () => ({ tasks: {} }) };
  await f.sync();
  expect(f.children.get('subagent-a0').subagentStatus).toBe('failed');
});

test('100 refresh requests during a slow scan coalesce into one fresh follow-up', async () => {
  const f = await fixture();
  const blocked = deferred(), release = deferred();
  f.setCopyHook(async () => { blocked.resolve(); await release.promise; });
  const initial = f.sync();
  await blocked.promise;
  const waiting = Array.from({ length: 100 }, () => f.sync());
  await f.write(0, ['first', 'latest']);
  release.resolve();
  await Promise.all([initial, ...waiting]);
  expect(f.scans()).toBe(2);
  expect(f.children.get('subagent-a0').history).toHaveLength(2);
});

test('an earlier caller finishes even while a later refresh is still copying', async () => {
  const f = await fixture();
  const firstEntered = deferred(), firstRelease = deferred(), secondEntered = deferred(), secondRelease = deferred();
  let copying = 0, firstFinished = false;
  f.setCopyHook(async () => {
    if (++copying === 1) { firstEntered.resolve(); await firstRelease.promise; }
    else { secondEntered.resolve(); await secondRelease.promise; }
  });
  const first = f.sync().then(() => { firstFinished = true; });
  await firstEntered.promise;
  await f.write(0, ['first', 'next']);
  const next = f.sync();
  firstRelease.resolve();
  try {
    await secondEntered.promise;
    expect(firstFinished).toBe(true);
  } finally { secondRelease.resolve(); await Promise.all([first, next]); }
});

test('parent resource changes still update mirrors without recopying unchanged transcripts', async () => {
  const f = await fixture();
  f.parent.projectResourceManifest = { assets: [], revision: 1 };
  await f.sync();
  f.parent.projectResourceManifest = { assets: [], revision: 2 };
  await f.sync();
  expect(f.manifests.at(-1).revision).toBe(2);
  expect(f.manifests).toHaveLength(2);
  expect(f.copies).toHaveLength(1);
  await f.sync();
  expect(f.manifests).toHaveLength(2);
});

test('overlapping disk synchronizations cannot replace newer history with an older snapshot', async () => {
  const f = await fixture();
  const blocked = deferred(), release = deferred();
  let first = true;
  f.setCopyHook(async () => { if (first) { first = false; blocked.resolve(); await release.promise; } });
  const older = f.sync();
  await blocked.promise;
  await f.write(0, ['first', 'newest']);
  const newer = f.sync();
  // Without serialization the second call can finish before the first one.
  await Promise.race([newer, new Promise(resolve => setTimeout(resolve, 30))]);
  release.resolve();
  await Promise.all([older, newer]);
  expect(f.children.get('subagent-a0').history).toHaveLength(2);
  expect(f.children.get('subagent-a0').preview).toBe('newest');
});

test('unchanged histories do not recopy every worker transcript on each runtime tick', async () => {
  const f = await fixture(120);
  await f.sync();
  expect(f.children.size).toBe(120);
  f.copies.length = 0;
  for (let tick = 0; tick < 3; tick++) await f.sync();
  expect(f.copies).toHaveLength(0);
  await f.write(7, ['first', 'updated']);
  await f.sync();
  expect(f.copies).toHaveLength(1);
  expect(f.children.get('subagent-a7').preview).toBe('updated');
});

test('deleting the parent during a disk copy does not recreate its children', async () => {
  const f = await fixture(3);
  const blocked = deferred(), release = deferred();
  f.setCopyHook(async () => { blocked.resolve(); await release.promise; });
  const run = f.sync();
  await blocked.promise;
  f.parent.deleted = true;
  f.sessions.delete('parent');
  release.resolve();
  await run;
  expect(f.children.size).toBe(0);
  expect(f.emitted).toHaveLength(0);
});
