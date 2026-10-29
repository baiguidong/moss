import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { BuiltinApps, readBuiltinManifest, verifyBuiltinArchive, publishBuiltinPackage } from '../src/apps/builtin-apps.mjs'
import { prepareBuiltinApps } from '../scripts/prepare-builtin-apps.mjs'
import selection from '../../packages/app-sdk/src/builtin-apps.json' with { type: 'json' }

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-builtins-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'bundled'); await fs.mkdir(directory)
  const archive = new JSZip().file('app.moss.json', JSON.stringify({ id: 'moss.test', version: '1.0.0' }))
  const bytes = await archive.generateAsync({ type: 'nodebuffer' })
  const entry = { id: 'moss.test', version: '1.0.0', displayName: 'Test', archive: 'app.zip', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  await fs.writeFile(path.join(directory, entry.archive), bytes)
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, platform: 'darwin-arm64', apps: [entry] }))
  let installed = null, revision = 0, installs = 0
  const options = { directory, statePath: path.join(root, 'state.json'), platform: 'darwin-arm64', getInstalled: () => installed, getRevision: () => revision,
    verifyInstalled: async app => app.reason === 'builtin',
    installPackage: async (packageRoot, options) => {
      assert.equal(options.expectedBaseVersion, installed?.version || null); assert.equal(options.expectedInstallationRevision, revision)
      installed = { ...installed, ...JSON.parse(await fs.readFile(path.join(packageRoot, 'app.moss.json'), 'utf8')), enabled: installed?.enabled ?? true, reason: options.reason }
      revision++; installs++
    } }
  return { root, directory, entry, options, get installed() { return installed }, get installs() { return installs }, remove() { installed = null; revision++ }, existing(value) { installed = value; revision++ } }
}
test('first install, restart, disable, user upgrade and uninstall are preserved; restore is explicit and serialized', async t => {
  const f = await fixture(t), service = await new BuiltinApps(f.options).initialize()
  assert.equal((await service.sync())[0].installed, true); assert.equal(f.installs, 1)
  f.installed.enabled = false
  const restarted = await new BuiltinApps(f.options).initialize(); await restarted.sync()
  assert.equal(f.installs, 1); assert.equal(f.installed.enabled, false)
  f.existing({ version: '9.0.0', localModification: true }); await restarted.sync()
  assert.equal(f.installed.version, '9.0.0')
  f.remove(); const removed = await new BuiltinApps(f.options).initialize(); await removed.sync()
  assert.equal(f.installs, 1); assert.equal(removed.list()[0].installed, false)
  await Promise.all([removed.restore('moss.test'), removed.restore('moss.test')]); assert.equal(f.installs, 2)
  await assert.rejects(removed.restore('moss.unknown'))
})
test('preexisting installation and historical uninstall are adopted without overwriting user choice', async t => {
  const f = await fixture(t); f.existing({ version: '0.1.0', enabled: false })
  await (await new BuiltinApps(f.options).initialize()).sync(); assert.equal(f.installs, 0)
  await fs.rm(f.options.statePath); f.remove()
  await (await new BuiltinApps(f.options).initialize()).sync(); assert.equal(f.installs, 0)
})
test('checksums, identity, platform and missing archives fail without recording successful installation', async t => {
  const f = await fixture(t)
  await assert.rejects(readBuiltinManifest(f.directory, 'win32-x64'), /platform/)
  await fs.appendFile(path.join(f.directory, 'app.zip'), 'corruption')
  const service = await new BuiltinApps(f.options).initialize(); await service.sync()
  assert.match(service.list()[0].error, /checksum/); assert.equal(f.installs, 0)
  await assert.rejects(service.restore('moss.test'), /checksum/)
  await fs.rm(path.join(f.directory, 'app.zip')); await assert.rejects(verifyBuiltinArchive(f.directory, f.entry), /ENOENT/)
})
test('source selection stages only compatible archives with a checksum manifest', async t => {
  const f = await fixture(t), appsRoot = path.join(f.root, 'moss-apps'), output = path.join(f.root, 'output')
  for (const id of selection.apps) {
    const app = path.join(appsRoot, 'apps', id); await fs.mkdir(app, { recursive: true })
    await fs.writeFile(path.join(app, 'app.moss.json'), JSON.stringify({ id, version: '1.0.0', displayName: id, ...(id !== 'moss.visualize' ? { platforms: ['darwin-arm64'] } : {}) }))
  }
  const artifact = path.join(appsRoot, 'artifacts/moss.visualize/1.0.0'); await fs.mkdir(artifact, { recursive: true })
  await fs.copyFile(path.join(f.directory, 'app.zip'), path.join(artifact, 'moss.visualize-1.0.0.zip'))
  const apps = await prepareBuiltinApps({ appsRoot, output, build: false, useMarketplace: false, platform: 'win32-x64' })
  assert.deepEqual(apps.map(item => item.id), ['moss.visualize'])
  assert.equal((await readBuiltinManifest(output, 'win32-x64')).omitted.length, selection.apps.length - 1)
  await verifyBuiltinArchive(output, apps[0])
})

test('legacy builtin receipts upgrade only verified packages and preserve disabled state and settings', async t => {
  const f = await fixture(t);
  f.existing({ version: '0.9.0', reason: 'builtin', enabled: false, settings: { theme: 'dark' }, grants: [] });
  await fs.writeFile(f.options.statePath, JSON.stringify({ version: 1, seen: { 'moss.test': '0.9.0' } }));
  const service = await new BuiltinApps(f.options).initialize();
  await service.sync();
  assert.equal(f.installs, 1); assert.equal(f.installed.version, '1.0.0'); assert.equal(f.installed.enabled, false);
  assert.deepEqual(f.installed.settings, { theme: 'dark' }); assert.deepEqual(f.installed.grants, []);
  assert.equal(service.list()[0].installedVersion, '1.0.0');
  await service.sync(); assert.equal(f.installs, 1);
  f.existing({ version: '0.9.0', reason: 'builtin' }); await service.sync(); assert.equal(f.installs, 1, 'manual rollback is preserved');
});

test('local edits, marketplace installs, newer versions and unverified packages are never overwritten', async t => {
  for (const installed of [
    { version: '0.9.0', reason: 'builtin', localModification: { sourceHash: 'local' } },
    { version: '0.9.0', reason: 'builtin', marketplaceSource: { appId: 'moss.test' } },
    { version: '2.0.0', reason: 'builtin' }, { version: '0.9.0', reason: 'installed' },
  ]) {
    const f = await fixture(t); f.existing(installed);
    await (await new BuiltinApps(f.options).initialize()).sync(); assert.equal(f.installs, 0);
  }
});

test('failed upgrade retains its receipt for retry, while concurrent uninstall wins', async t => {
  const f = await fixture(t); f.existing({ version: '0.9.0', reason: 'builtin' });
  const service = await new BuiltinApps(f.options).initialize();
  const install = service.installPackage; service.installPackage = async () => { throw new Error('activation failed'); };
  await service.sync(); assert.equal(f.installed.version, '0.9.0'); assert.equal(service.state.seen['moss.test'], '0.9.0');
  service.installPackage = install; await service.sync(); assert.equal(f.installed.version, '1.0.0'); assert.equal(service.list()[0].error, null);
  const g = await fixture(t); g.existing({ version: '0.9.0', reason: 'builtin' });
  const racing = await new BuiltinApps({ ...g.options, verifyInstalled: async () => { g.remove(); return true; } }).initialize();
  await racing.sync(); assert.equal(g.installs, 0); assert.equal(g.installed, null); assert.match(racing.list()[0].error, /changed/);
});

test('modified package verification failures never replace the original installation', async t => {
  const f = await fixture(t); f.existing({ version: '0.9.0', reason: 'builtin' });
  const service = await new BuiltinApps({ ...f.options, verifyInstalled: async () => { throw new Error('Checksum mismatch: backend.mjs'); } }).initialize();
  await service.sync(); assert.equal(f.installs, 0); assert.equal(f.installed.version, '0.9.0'); assert.match(service.list()[0].error, /Checksum/);
});

test('activation failure rolls publication and runtime back without restoring revoked permissions', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.root, 'app.moss.json'), JSON.stringify({ id: 'moss.test', version: '1.0.0', permissions: ['local-files:read'] }));
  let stored = { version: '0.9.0' }, revision = 1, runtimeState = { activeVersion: '0.9.0', grants: ['local-files:read'], enabled: false };
  const runtime = { getInstallation: () => runtimeState, transitionApp: async (_id, fn) => fn(),
    registerInstalledNow: async (_id, version, options) => { runtimeState = { ...runtimeState, activeVersion: version, ...(options.grants ? { grants: options.grants } : {}) }; } };
  await assert.rejects(publishBuiltinPackage(f.root, { expectedBaseVersion: '0.9.0' }, {
    runtime, getRevision: () => revision, getInstalled: () => stored,
    publish: async (_root, options) => { stored = { version: '1.0.0' }; options.onCommit({ installationRevision: ++revision }); return options.activateInstallation(stored); },
    activate: async (_app, grants) => { assert.equal(grants, undefined); runtimeState = { ...runtimeState, activeVersion: '1.0.0', grants: [] }; throw new Error('activation failed'); },
    rollback: async (_id, options) => { assert.equal(options.previousVersion, '0.9.0'); assert.equal(options.expectedInstallationRevision, revision); stored = { version: '0.9.0' }; revision++; return true; },
  }), /activation failed/);
  assert.equal(stored.version, '0.9.0'); assert.equal(runtimeState.activeVersion, '0.9.0'); assert.equal(runtimeState.enabled, false); assert.deepEqual(runtimeState.grants, []);
});
