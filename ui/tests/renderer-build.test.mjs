import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

test('rebuilding keeps the lazy chunks referenced by an already open window', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-renderer-build-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outDir = path.join(root, 'dist');
  await fs.writeFile(path.join(root, 'index.html'), '<script type="module" src="/main.js"></script>');
  await fs.writeFile(path.join(root, 'main.js'), 'window.openPreview = () => import("./preview.js");');
  const options = {
    root, configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), logLevel: 'silent',
    build: { outDir, rollupOptions: { input: { index: path.join(root, 'index.html') } } },
  };
  await fs.writeFile(path.join(root, 'preview.js'), 'export default "old preview";');
  await build(options);
  const oldHtml = await fs.readFile(path.join(outDir, 'index.html'), 'utf8');
  const previousFiles = await fs.readdir(path.join(outDir, 'assets'));
  assert.ok(previousFiles.some(name => name.startsWith('preview-')));
  const previousContent = await Promise.all(previousFiles.map(name => fs.readFile(path.join(outDir, 'assets', name))));

  await fs.writeFile(path.join(root, 'preview.js'), 'export default "updated preview";');
  await build(options);
  assert.notEqual(await fs.readFile(path.join(outDir, 'index.html'), 'utf8'), oldHtml);
  for (const [index, name] of previousFiles.entries()) {
    assert.deepEqual(await fs.readFile(path.join(outDir, 'assets', name)), previousContent[index]);
  }
  assert.equal((await fs.readdir(path.join(outDir, 'assets'))).filter(name => name.startsWith('preview-')).length, 2);
});
