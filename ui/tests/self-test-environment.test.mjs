import { test, expect, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureTestEnvironment } from '../src/app-testing/environment-fingerprint.mjs'
import { createReusableTestInstance } from '../src/app-testing/reusable-instance.mjs'
import { inheritTestResources } from '../src/app-testing/profile.mjs'
const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-environment-')); roots.push(root)
  const source = path.join(root, 'source'), target = path.join(root, 'target')
  await fs.mkdir(path.join(source, 'skills/demo'), { recursive: true }); await fs.mkdir(target)
  await fs.writeFile(path.join(source, 'skills/demo/SKILL.md'), 'first')
  const settings = { model: 'model-a', apiKey: 'secret-never-exposed' }, state = { installations: {}, instances: {} }
  const runtime = { rootDir: source, state: { snapshot: () => state } }
  return { root, source, target, settings, state, runtime }
}
test('environment digest detects settings, resources, configuration and credential changes', async () => {
  const f = await fixture()
  const capture = () => captureTestEnvironment({ directory: f.target, settings: f.settings, runtime: f.runtime })
  let previous = await capture()
  expect((await capture()).digest).toBe(previous.digest)
  for (const change of [
    async () => { f.settings.model = 'model-b' },
    async () => { f.state.instances.demo = { config: { value: 1 } } },
    async () => fs.writeFile(path.join(f.source, 'skills/demo/SKILL.md'), 'changed resource'),
    async () => { await fs.mkdir(path.join(f.source, 'credentials')); await fs.writeFile(path.join(f.source, 'credentials/app-secrets.json'), 'encrypted bytes') },
  ]) {
    await change(); const next = await capture(); expect(next.digest).not.toBe(previous.digest); previous = next
  }
  expect(previous.digest).not.toContain('secret')
  expect((await fs.stat(path.join(f.target, '.environment-key'))).mode & 0o777).toBe(0o600)
})
test('unchanged resources reuse cache; modified and removed resources propagate', async () => {
  const f = await fixture(), options = { sourceHome: f.source, home: f.target }
  await inheritTestResources(options)
  const copied = path.join(f.target, 'skills/demo/SKILL.md'), first = await fs.stat(copied)
  await inheritTestResources(options)
  expect((await fs.stat(copied)).ino).toBe(first.ino)
  await fs.writeFile(path.join(f.source, 'skills/demo/SKILL.md'), 'updated skill')
  await inheritTestResources(options)
  expect(await fs.readFile(copied, 'utf8')).toBe('updated skill')
  await fs.rm(path.join(f.source, 'skills/demo'), { recursive: true })
  await inheritTestResources(options)
  await expect(fs.stat(copied)).rejects.toThrow()
})
test('next attachment refreshes changed settings, unchanged opens reuse the process', async () => {
  const f = await fixture(), launches = [], closed = []
  const manager = createReusableTestInstance({ directory: f.target, getSettings: () => f.settings,
    getAppRuntime: () => f.runtime, getRuntimeHome: () => '', launch: async input => {
      launches.push({ settings: structuredClone(input.settings), prepare: input.prepareEnvironment })
      let alive = true, resolve
      return { isAlive: () => alive, exited: new Promise(r => { resolve = r }), close: async () => { alive = false; closed.push(true); resolve() } }
    } })
  const run = {}; const first = await manager.attachRun(run)
  expect(await manager.open()).toBe(first)
  f.settings.model = 'updated-model'
  const next = {}; expect(await manager.attachRun(next)).not.toBe(first)
  expect(next.environmentRevision).not.toBe(run.environmentRevision)
  expect(launches).toHaveLength(2); expect(closed).toHaveLength(1)
  expect(launches[1]).toEqual({ settings: f.settings, prepare: true })
  await manager.close()
})
test('changing settings while copying cannot publish an inconsistent prepared profile', async () => {
  const f = await fixture(); let closed = false
  const manager = createReusableTestInstance({ directory: f.target, getSettings: () => f.settings,
    getAppRuntime: () => f.runtime, getRuntimeHome: () => '', launch: async () => {
      f.settings.model = 'changed-during-copy'
      return { close: async () => { closed = true } }
    } })
  await expect(manager.open()).rejects.toThrow('同步期间主环境发生变化')
  expect(closed).toBe(true); expect(manager.snapshot().prepared).toBe(false)
})

test('package cache requires a completed copy, and credential removal is synchronized', async () => {
  const f = await fixture();
  const { inheritTestApps } = await import('../src/app-testing/profile.mjs');
  const { AppCredentialAdapter } = await import('../src/apps/app-runtime.mjs');
  const sourcePackage = path.join(f.source, 'apps/example/versions/1.0.0');
  const targetPackage = path.join(f.target, 'apps/example/versions/1.0.0');
  await fs.mkdir(sourcePackage, { recursive: true }); await fs.mkdir(targetPackage, { recursive: true });
  for (const directory of [sourcePackage,targetPackage]) {
    await fs.writeFile(path.join(directory,'checksums.json'), '{"payload":"fixed"}');
    await fs.writeFile(path.join(directory,'app.moss.json'), '{}');
  }
  await fs.writeFile(path.join(sourcePackage,'payload'), 'complete package');
  let token = { token: 'temporary-value' };
  const runtime = { ...f.runtime, appsDir: path.join(f.source,'apps'), storageAppId: id => id, credentialAdapter: { get: async () => token } };
  Object.assign(f.state, { version: 5, installations: { example: { appId: 'example', activeVersion: '1.0.0' } }, instances: { demo: { appId: 'example', id: 'demo' } } });
  await inheritTestApps({ runtime, home: f.target });
  expect(await fs.readFile(path.join(targetPackage,'payload'),'utf8')).toBe('complete package');
  expect((await fs.readdir(targetPackage)).sort()).toEqual(['app.moss.json','checksums.json','payload']);
  const inode = (await fs.stat(path.join(targetPackage,'payload'))).ino;
  expect(await new AppCredentialAdapter(f.target).get('example','demo')).toEqual(token);
  token = {};
  await inheritTestApps({ runtime, home: f.target });
  expect((await fs.stat(path.join(targetPackage,'payload'))).ino).toBe(inode);
  expect(await new AppCredentialAdapter(f.target).get('example','demo')).toEqual({});
});
