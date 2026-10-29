import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorageService } from '../src/storage-service.mjs';

const DAY = 86400000;
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-storage-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const records = [], removed = [];
  let time = Date.now();
  const write = async (relative, content) => {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), content);
  };
  const add = async (id, extra = {}) => {
    const record = { id, title: id, updatedAt: time - 100 * DAY, agentMode: 'local', workspace: path.join(root, 'sessions', id, 'workspace'), ...extra };
    records.push(record); await write(`sessions/${id}/workspace/result.txt`, 'data'); return record;
  };
  const options = {
    root, getRecords: () => records, isBusy: record => record.busy, isArchived: record => record.archived !== false, now: () => time,
    removeSession: async (id, guard) => {
      if (!guard()) return false;
      removed.push(id);
      for (const record of records.filter(record => record.id === id || record.parentSessionId === id)) {
        record.deleted = true; await fs.rm(path.join(root, 'sessions', record.id), { recursive: true, force: true });
      }
    },
  };
  return { root, records, removed, write, add, options, service: createStorageService(options), advance: ms => { time += ms; } };
}

test('overview accounts for managed files once, skips symlinks, marks incomplete scans', async t => {
  const f = await fixture(t);
  await f.write('sessions/a/file', '1234'); await f.write('projects/a/file', '12');
  await f.write('apps/a/file', '123'); await f.write('workspace-versions/a', '1');
  await f.write('logs/a', '12'); await f.write('settings.json', '12345');
  await fs.symlink(path.join(f.root, 'projects'), path.join(f.root, 'sessions', 'link'));
  const result = await f.service.overview();
  assert.equal(result.complete, true);
  assert.equal(result.sizeKind, 'allocated');
  assert.equal(result.totalBytes, result.categories.reduce((sum, category) => sum + category.bytes, 0));
  for (const id of ['sessions', 'projects', 'apps', 'history', 'logs', 'other']) assert.ok(result.categories.find(item => item.id === id).bytes > 0);
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-external-'));
  t.after(() => fs.rm(external, { recursive: true, force: true }));
  await fs.writeFile(path.join(external, 'large'), Buffer.alloc(1024 * 1024));
  await fs.symlink(external, path.join(f.root, 'external-link'));
  const linked = await f.service.overview();
  assert.ok(linked.totalBytes - result.totalBytes < 1024 * 1024, 'must not follow symlinks');
  const absent = createStorageService({ ...f.options, root: path.join(f.root, 'absent') });
  assert.equal((await absent.overview()).complete, false);
});

test('review excludes active, remote, project, special, recent and deeper nested conversations', async t => {
  const f = await fixture(t);
  await f.add('old'); await f.add('busy', { busy: true }); await f.add('project', { projectId: 'p' });
  await f.add('remote', { agentMode: 'remote-direct' }); await f.add('mail', { sessionKind: 'agent-mail' });
  await f.add('recent', { updatedAt: Date.now() }); await f.add('unknown-date', { updatedAt: null });
  await f.add('nested'); await f.add('child', { parentSessionId: 'nested', isSubAgent: true });
  await f.add('grandchild', { parentSessionId: 'child', isSubAgent: true });
  assert.deepEqual((await f.service.review()).items.map(item => item.id), ['old']);
});

test('cleanup includes descendants and deletes only explicitly selected reviewed families', async t => {
  const f = await fixture(t);
  await f.add('selected'); await f.add('child', { isSubAgent: true, parentSessionId: 'selected' }); await f.add('retained');
  const review = await f.service.review({ days: 90 });
  assert.equal(review.items.find(item => item.id === 'selected').bytes, 8);
  assert.equal(review.items.find(item => item.id === 'selected').subagents, 1);
  assert.deepEqual(await f.service.remove({ token: review.token, ids: ['selected'] }), { deleted: 1, skipped: 0, failed: 0 });
  assert.deepEqual(f.removed, ['selected']); assert.equal(await fs.readFile(path.join(f.root, 'sessions/retained/workspace/result.txt'), 'utf8'), 'data');
  await assert.rejects(f.service.remove({ token: review.token, ids: ['selected'] }), /过期/);
});

test('changed files, records, newly active sessions and added descendants are skipped after review', async t => {
  const f = await fixture(t);
  const changed = await f.add('changed'), busy = await f.add('busy');
  await f.add('file'); await f.add('family');
  const review = await f.service.review();
  changed.updatedAt += 1000; busy.busy = true; await f.write('sessions/file/workspace/new.txt', 'new');
  await f.add('new-child', { parentSessionId: 'family', isSubAgent: true });
  assert.deepEqual(await f.service.remove({ token: review.token, ids: review.items.map(item => item.id) }), { deleted: 0, skipped: 4, failed: 0 });
  assert.deepEqual(f.removed, []);
});

test('final synchronous guard catches changes between the scan and actual removal', async t => {
  const f = await fixture(t), record = await f.add('old');
  const service = createStorageService({ ...f.options, removeSession: (id, guard) => { record.updatedAt++; return f.options.removeSession(id, guard); } });
  const review = await service.review();
  assert.deepEqual(await service.remove({ token: review.token, ids: ['old'] }), { deleted: 0, skipped: 1, failed: 0 });
  assert.deepEqual(f.removed, []);
});

test('review tokens reject forged selection and expiration', async t => {
  const f = await fixture(t); await f.add('old');
  const review = await f.service.review();
  await assert.rejects(f.service.remove({ token: 'forged', ids: ['old'] }), /过期/);
  await assert.rejects(f.service.remove({ token: review.token, ids: ['../other'] }), /预览/);
  f.advance(16 * 60000);
  await assert.rejects(f.service.remove({ token: review.token, ids: ['old'] }), /过期/);
  assert.deepEqual(f.removed, []);
});

test('symlinked session containers and directories cannot enter a cleanup review', async t => {
  const f = await fixture(t); await f.add('old');
  await fs.rename(path.join(f.root, 'sessions'), path.join(f.root, 'external'));
  await fs.symlink(path.join(f.root, 'external'), path.join(f.root, 'sessions'));
  assert.equal((await f.service.review()).items.length, 0);
  await fs.unlink(path.join(f.root, 'sessions')); await fs.mkdir(path.join(f.root, 'sessions'));
  await fs.symlink(path.join(f.root, 'external/old'), path.join(f.root, 'sessions/old'));
  assert.equal((await f.service.review()).items.length, 0);
  assert.equal(await fs.readFile(path.join(f.root, 'external/old/workspace/result.txt'), 'utf8'), 'data');
});

test('shared workspace owners retain the source conversation; failed removal is reported', async t => {
  const f = await fixture(t), source = await f.add('source');
  await f.add('consumer', { workspace: source.workspace, updatedAt: Date.now() });
  assert.equal((await f.service.review()).items.length, 0);
  await f.add('other');
  const service = createStorageService({ ...f.options, removeSession: async (_id, guard) => { assert.equal(guard(), true); } });
  const review = await service.review();
  assert.deepEqual(await service.remove({ token: review.token, ids: ['other'] }), { deleted: 0, skipped: 0, failed: 1 });
});

test('archived-only default, explicit all scope, archive changes and individual archived deletion', async t => {
  const f = await fixture(t);
  const archived = await f.add('archived');
  await f.add('visible', { archived: false });
  await f.add('recent-archive', { updatedAt: Date.now() });
  assert.deepEqual((await f.service.review()).items.map(item => item.id), ['archived']);
  assert.equal((await f.service.review({ archivedOnly: false })).items.length, 2);
  const oldReview = await f.service.review();
  archived.archived = false;
  assert.deepEqual(await f.service.remove({ token: oldReview.token, ids: ['archived'] }), { deleted: 0, skipped: 1, failed: 0 });
  const individual = await f.service.review({ archivedIds: ['recent-archive', 'visible'] });
  assert.equal(individual.days, 0);
  assert.deepEqual(individual.items.map(item => item.id), ['recent-archive']);
  assert.deepEqual(await f.service.remove({ token: individual.token, ids: ['recent-archive'] }), { deleted: 1, skipped: 0, failed: 0 });
  await assert.rejects(f.service.review({ days: 0 }), /保留天数/);
});
