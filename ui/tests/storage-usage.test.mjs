import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { measureStorage } from '../src/storage-usage.mjs';

test('complete allocation agrees with du, includes hidden directories, excludes external links and deduplicates hardlinks', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-usage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const names = ['apps/demo/node_modules/cache/index.js', 'apps-data/demo/Cache/data', 'apps-data/large/file', 'apps-data/small/file', '.cache/index', 'runtimes/python/bin', 'sessions/normal/transcript', 'sessions/child/transcript', 'sessions/archived/transcript'];
  for (const name of names) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), Buffer.alloc(4096)); }
  await fs.writeFile(path.join(root, 'apps-data/large/file'), Buffer.alloc(8192));
  await fs.writeFile(path.join(root, 'apps-data/small/file'), Buffer.alloc(1024));
  await fs.link(path.join(root, names[0]), path.join(root, 'apps/demo/hardlink'));
  await fs.symlink(os.homedir(), path.join(root, 'external'));
  const result = await measureStorage(root, { sessionKinds: new Map([['normal', 'sessions'], ['child', 'subagents'], ['archived', 'archived']]) });
  const du = Number(execFileSync('du', ['-sk', root], { encoding: 'utf8' }).split(/\s/)[0]) * 1024;
  assert.ok(Math.abs(result.totalBytes - du) < 1024, `scan=${result.totalBytes} du=${du}`);
  assert.equal(result.complete, true);
  const caches = result.categories.find(item => item.id === 'cache');
  assert.deepEqual(caches.entries.map(item => item.path).sort(), ['.cache', 'apps/demo']);
  assert.deepEqual(result.categories.find(item => item.id === 'app-data').entries.map(item => item.path), ['apps-data/large', 'apps-data/demo', 'apps-data/small']);
  for (const id of ['cache', 'runtimes', 'sessions', 'subagents', 'archived']) assert.ok(result.categories.find(item => item.id === id).bytes >= 4096);
});

test('large app trees do not exhaust a scan budget before later categories', async () => {
  const count = 200010;
  const fileSystem = {
    async lstat(target) { const dir = ['/profile', '/profile/apps'].includes(target); return { size: dir ? 0 : 512, blocks: dir ? 0 : 1, nlink: 1, isDirectory: () => dir, isFile: () => !dir, isSymbolicLink: () => false }; },
    async readdir(target) { return target === '/profile' ? ['logs', 'sessions', 'apps'] : Array.from({ length: count }, (_, i) => String(i)); },
  };
  const result = await measureStorage('/profile', { fileSystem });
  assert.equal(result.complete, true);
  assert.equal(result.totalBytes, (count + 2) * 512);
  assert.equal(result.categories.find(item => item.id === 'sessions').bytes, 512);
  assert.equal(result.categories.find(item => item.id === 'logs').bytes, 512);
});

test('permission errors identify only affected categories; vanished caches are normal', async () => {
  const fileSystem = {
    async lstat(target) {
      if (target.endsWith('vanished')) throw Object.assign(new Error(), { code: 'ENOENT' });
      return { size: 0, blocks: 0, nlink: 1, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false };
    },
    async readdir(target) {
      if (target === '/profile') return ['apps', 'logs', 'vanished'];
      if (target.endsWith('apps')) throw Object.assign(new Error(), { code: 'EACCES' });
      return [];
    },
  };
  const result = await measureStorage('/profile', { fileSystem });
  assert.equal(result.errorCount, 1);
  assert.equal(result.complete, false);
  assert.equal(result.categories.find(item => item.id === 'cache').complete, false);
  assert.equal(result.categories.find(item => item.id === 'logs').complete, true);
});

test('keeps app-owned DBX and Trace data with Apps and exposes legacy roots separately', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-usage-roots-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, size] of [['dbx-mcp/dbx.db', 4096], ['db/trace-index-v1.sqlite', 2048], ['minimal-go-agent/main.go', 1024], ['server_bgd/moss-server.db', 2048]]) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.alloc(size));
  }
  const result = await measureStorage(root);
  const appData = result.categories.find(item => item.id === 'app-data');
  assert.deepEqual(appData.entries.map(item => item.path), ['moss.dbx (dbx-mcp)', 'moss.trace (legacy db)']);
  assert.equal(result.categories.find(item => item.id === 'projects').entries[0].path, 'minimal-go-agent');
  assert.equal(result.categories.find(item => item.id === 'other').entries[0].path, 'server_bgd');
});

test('groups durable App state files and preferences separately from App data', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-usage-state-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'app-preferences'), { recursive: true });
  await fs.writeFile(path.join(root, 'app-preferences', 'desktop.json'), 'prefs');
  await fs.writeFile(path.join(root, 'app-registry.json'), 'registry');
  await fs.writeFile(path.join(root, 'app-runtime-state.json'), 'runtime');
  await fs.writeFile(path.join(root, 'settings.json'), 'core settings');
  const result = await measureStorage(root);
  const state = result.categories.find(item => item.id === 'app-state');
  assert.deepEqual(state.entries.map(item => item.path), ['app-preferences', 'app-registry.json', 'app-runtime-state.json']);
  assert.equal(result.categories.find(item => item.id === 'other').entries[0].path, 'settings.json');
});

test('classifies the Expert Hub download cache as rebuildable cache', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-usage-expert-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'expert-hub', 'cache', 'bundles'), { recursive: true });
  await fs.writeFile(path.join(root, 'expert-hub', 'cache', 'bundles', 'expert.tar.gz'), 'bundle');
  const result = await measureStorage(root);
  assert.deepEqual(result.categories.find(item => item.id === 'cache').entries.map(item => item.path), ['expert-hub']);
  assert.equal(result.categories.find(item => item.id === 'resources').entries.length, 0);
});
