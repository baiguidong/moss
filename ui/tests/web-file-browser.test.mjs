import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFileBrowser } from '../src/web/file-browser.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-file-browser-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '资料 目录'));
  await fs.mkdir(path.join(root, '.hidden'));
  await fs.writeFile(path.join(root, '笔记.txt'), 'note');
  await fs.writeFile(path.join(root, 'skill.ZIP'), 'archive');
  return { root, browser: createFileBrowser({ homeDirectory: root }) };
}

test('browse home, empty directories, parents and hidden items; directories sort before files', async t => {
  const { root, browser } = await fixture(t);
  const initial = await browser.list();
  assert.equal(initial.path, root);
  assert.equal(initial.homePath, root);
  assert.equal(initial.parentPath, path.dirname(root));
  assert.equal(initial.entries[0].name, '资料 目录');
  assert.equal(initial.total, 3);
  assert.equal((await browser.list({ directory: '~', kind: 'directory' })).total, 1);
  assert.equal((await browser.list({ hidden: true, kind: 'directory' })).total, 2);
  assert.equal((await browser.list({ directory: '~/资料 目录' })).total, 0);
  assert.equal((await browser.list({ directory: path.parse(root).root, kind: 'directory' })).parentPath, null);
  assert.deepEqual((await browser.select({ kind: 'directory', paths: ['~/资料 目录'] }))[0].path, path.join(root, '资料 目录'));
});

test('search, ZIP filtering and pagination do not hide directories needed for navigation', async t => {
  const { root, browser } = await fixture(t);
  const filtered = await browser.list({ kind: 'any', extensions: ['zip'] });
  assert.deepEqual(filtered.entries.map(item => item.name), ['资料 目录', 'skill.ZIP']);
  await Promise.all(Array.from({ length: 205 }, (_, i) => fs.writeFile(path.join(root, `page-${i}.txt`), '')));
  const first = await browser.list({ query: 'PAGE-' });
  const second = await browser.list({ query: 'PAGE-', offset: 200 });
  assert.equal(first.entries.length, 200);
  assert.equal(first.hasMore, true);
  assert.equal(second.entries.length, 5);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.entries, ...second.entries].map(item => item.path)).size, 205);
  const reveal = await browser.list({ reveal: path.join(root, 'page-204.txt') });
  assert.equal(reveal.path, root);
  assert.ok(reveal.entries.some(item => item.path === reveal.highlightedPath));
  const hidden = await browser.list({ reveal: path.join(root, '.hidden') });
  assert.ok(hidden.entries.some(item => item.path === hidden.highlightedPath));
});

test('validates selections again, rejects relative paths and wrong kinds; supports readable symlinks', async t => {
  const { root, browser } = await fixture(t);
  await fs.symlink(path.join(root, '资料 目录'), path.join(root, 'linked-directory'), 'dir');
  await fs.symlink(path.join(root, 'gone'), path.join(root, 'broken-link'));
  const items = await browser.list({ kind: 'directory' });
  assert.ok(items.entries.some(item => item.name === 'linked-directory' && item.isDirectory));
  assert.ok(!items.entries.some(item => item.name === 'broken-link'));
  for (const directory of ['relative/path', '/invalid\0path', 42]) await assert.rejects(browser.list({ directory }));
  await assert.rejects(browser.list({ directory: path.join(root, '笔记.txt') }), /不是文件夹/);
  await assert.rejects(browser.select({ paths: [root], kind: 'file' }));
  await assert.rejects(browser.select({ paths: [path.join(root, '笔记.txt')], kind: 'directory' }));
  await assert.rejects(browser.select({ paths: [], kind: 'file' }));
  await assert.rejects(browser.select({ paths: [root], kind: 'browse' }));
  await assert.rejects(browser.select({ paths: [path.join(root, '笔记.txt')], kind: 'any', extensions: ['zip'] }));
  const selected = await browser.select({ paths: [path.join(root, 'skill.ZIP'), root], kind: 'any', extensions: ['zip'] });
  assert.equal(selected[0].size, 7);
  assert.equal(selected[1].isDirectory, true);
  await fs.rm(path.join(root, 'skill.ZIP'));
  await assert.rejects(browser.select({ paths: [path.join(root, 'skill.ZIP')], kind: 'file' }), /不存在/);
});
