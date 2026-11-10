import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppServiceStorage, writeServiceJson } from '../src/apps/app-service-storage.mjs';
import { createLegacyAppServiceUpgrade } from '../src/apps/legacy-app-service-upgrade.mjs';
import { createConnectorCredentialStore } from '../src/connector-credential-store.mjs';
import { resolveAppServiceCommand, resolveAppServiceInvocation } from '../src/apps/app-service-command.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-service-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mossHome = path.join(root, 'home');
  const keyPaths = { primaryPath: path.join(mossHome, 'credentials/.master.key'), backupPath: path.join(root, 'backup/master.key') };
  const options = { mossHome, keyPaths }, storage = createAppServiceStorage(options);
  const upgrade = createLegacyAppServiceUpgrade({ mossHome, storage });
  const json = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  const pkg = (appId = 'example.one', id = 'one', version = '1.0.0') => {
    const root = path.join(mossHome, 'apps', appId, 'versions', version);
    json(path.join(root, 'connector/connector.json'), { id, name: id, enabled: true });
    json(path.join(root, 'connector/cli.json'), { status: 'node status.mjs' });
    fs.writeFileSync(path.join(root, 'connector/status.mjs'), 'console.log("ready")');
    return { root, manifest: { id: appId, version, connectorApp: { id } } };
  };
  const legacy = packageInfo => {
    const { manifest, root } = packageInfo, id = manifest.connectorApp.id;
    const directory = path.join(mossHome, 'connectors/installed', id);
    fs.cpSync(path.join(root, 'connector'), directory, { recursive: true });
    json(path.join(directory, 'connector.json'), { id, appId: manifest.id, appVersion: manifest.version });
    json(path.join(directory, '.app-package-files.json'), ['connector.json', 'cli.json', 'status.mjs']);
    json(path.join(directory, '.app-package-defaults.json'), { 'cli.json': { status: 'node status.mjs' } });
    json(path.join(mossHome, 'connectors/state', `${id}.json`), { connected: true });
    return directory;
  };
  const credentials = () => createConnectorCredentialStore({ storagePath: path.join(mossHome, 'connectors/credentials.v3.json'),
    primaryKeyPath: keyPaths.primaryPath, backupKeyPath: keyPaths.backupPath });
  return { root, mossHome, options, storage, upgrade, json, pkg, legacy, credentials };
}

test('activation references package assets; upgrades and restart preserve mutable state without creating connectors', t => {
  const f = fixture(t), first = f.pkg();
  f.upgrade.app(first); f.storage.activate(first);
  fs.writeFileSync(path.join(f.storage.workspace('one'), 'local.txt'), 'user data');
  assert.equal(fs.existsSync(path.join(f.storage.workspace('one'), 'status.mjs')), false);
  const next = f.pkg('example.one', 'one', '2.0.0');
  f.json(path.join(next.root, 'connector/cli.json'), { status: 'node next.mjs' });
  f.storage.activate(next);
  const restarted = createAppServiceStorage(f.options);
  assert.equal(restarted.read('one', 'cli.json').status, 'node next.mjs');
  assert.equal(fs.readFileSync(path.join(restarted.workspace('one'), 'local.txt'), 'utf8'), 'user data');
  assert.equal(fs.existsSync(path.join(f.mossHome, 'connectors')), false);
  f.storage.activate(first);
  assert.equal(f.storage.read('one', 'cli.json').status, 'node status.mjs');
});

test('upgrade imports user overrides and state but not identical package files', t => {
  const f = fixture(t), pkg = f.pkg(), old = f.legacy(pkg);
  f.json(path.join(old, 'cli.json'), { status: 'custom status' });
  fs.writeFileSync(path.join(old, 'login-state.txt'), 'local state');
  f.upgrade.app(pkg); f.storage.activate(pkg);
  fs.rmSync(path.join(f.mossHome, 'connectors'), { recursive: true });
  assert.deepEqual(f.storage.read('one', 'cli.json'), { status: 'custom status' });
  assert.equal(fs.readFileSync(path.join(f.storage.workspace('one'), 'login-state.txt'), 'utf8'), 'local state');
  assert.equal(fs.existsSync(path.join(f.storage.workspace('one'), 'status.mjs')), false);
  assert.equal(JSON.parse(fs.readFileSync(f.storage.statePath('one'))).connected, true);
  f.storage.activate(f.pkg('example.one', 'one', '2.0.0'));
  assert.equal(f.storage.read('one', 'cli.json').status, 'custom status');
});

test('upgrade partitions encrypted App and Core credentials; clearing never reimports them', t => {
  const f = fixture(t), one = f.pkg(), two = f.pkg('example.two', 'two');
  f.legacy(one); f.legacy(two);
  f.credentials().write({ connectorFields: { one: { token: { value: 'one-secret' } }, two: { token: { value: 'two-secret' } } },
    mcpAccessTokens: { 'one:server': { value: 'one-mcp-token' }, 'two:server': { value: 'two-mcp-token' } },
    webSearchCredentials: { braveApiKey: { value: 'core-search-key' } },
    enterpriseAccountCredentials: { server: { apiKey: { value: 'core-login-key' } } } });
  f.upgrade.core(); f.upgrade.app(one); f.upgrade.app(two);
  f.storage.activate(one); f.storage.activate(two);
  assert.deepEqual(Object.keys(f.storage.credentials('one').read().connectorFields), ['one']);
  assert.deepEqual(Object.keys(f.storage.credentials('two').read().mcpAccessTokens), ['two:server']);
  assert.equal(f.storage.coreCredentials.read().webSearchCredentials.braveApiKey.value, 'core-search-key');
  assert.deepEqual(f.storage.coreCredentials.read().connectorFields, {});
  const file = f.storage.credentials('one').storagePath;
  assert.equal(fs.readFileSync(file, 'utf8').includes('one-secret'), false);
  assert.throws(() => f.storage.credentialsForApp('example.two').write({ connectorFields: { two: { token: { value: 7 } } } }));
  f.storage.deactivate('one', { deleteData: true, deleteCredentials: true });
  fs.rmSync(path.join(f.mossHome, 'apps-data/example.one'), { recursive: true });
  const restarted = createAppServiceStorage(f.options);
  const retry = createLegacyAppServiceUpgrade({ mossHome: f.mossHome, storage: restarted });
  retry.app(one); restarted.activate(one);
  assert.deepEqual(restarted.credentials('one').read(), {});
  f.storage.coreCredentials.write({}); f.upgrade.core();
  assert.equal(f.storage.coreCredentials.read().webSearchCredentials, undefined);
  assert.equal(f.storage.credentials('two').read().connectorFields.two.token.value, 'two-secret');
});

test('edited package resources are preserved for review without replacing package execution', t => {
  const f = fixture(t), pkg = f.pkg(), old = f.legacy(pkg);
  fs.writeFileSync(path.join(old, 'status.mjs'), 'modified source');
  f.upgrade.app(pkg); f.storage.activate(pkg);
  assert.equal(fs.readFileSync(path.join(f.storage.rootFor('one'), 'legacy-package-edits/status.mjs'), 'utf8'), 'modified source');
  assert.equal(fs.readFileSync(path.join(f.storage.get('one').packageRoot, 'status.mjs'), 'utf8'), 'console.log("ready")');
});

test('legacy uninstalled services are not silently adopted', t => {
  const f = fixture(t), pkg = f.pkg(), old = f.legacy(pkg);
  f.json(path.join(old, 'connector.json'), { id: 'one', enabled: true });
  f.upgrade.app(pkg); f.storage.activate(pkg);
  assert.equal(fs.existsSync(f.storage.statePath('one')), false);
  assert.equal(f.storage.get('unknown'), null);
});

test('failed import is retryable and preserves newer destination data', t => {
  const f = fixture(t), pkg = f.pkg(), old = f.legacy(pkg);
  f.json(path.join(old, 'cli.json'), { status: 'old custom status' });
  f.json(path.join(f.mossHome, 'connectors/credentials.v3.json'), { version: 'broken' });
  assert.throws(() => f.upgrade.app(pkg), /credential file format/);
  writeServiceJson(path.join(f.storage.serviceRoot('example.one'), 'config/cli.json'), { status: 'new user status' });
  fs.rmSync(path.join(f.mossHome, 'connectors/credentials.v3.json'));
  f.upgrade.app(pkg); f.storage.activate(pkg);
  assert.equal(f.storage.read('one', 'cli.json').status, 'new user status');
});

test('service paths and identity collisions cannot access another App', t => {
  const f = fixture(t), pkg = f.pkg();
  f.storage.activate(pkg);
  assert.throws(() => f.storage.serviceRoot('../outside'), /identity/);
  assert.throws(() => f.storage.activate(f.pkg('example.two', 'one')), /already owned/);
  fs.mkdirSync(path.join(f.root, 'outside'));
  fs.symlinkSync(path.join(f.root, 'outside'), path.join(f.mossHome, 'apps-data/example.one/service/config'));
  assert.throws(() => f.storage.read('one', 'cli.json'), /symbolic link/);
});

test('relative CLI scripts resolve to package assets with safe quoting, leaving inline code alone', t => {
  const f = fixture(t), dir = path.join(f.root, "package with ' quote");
  fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'entry.mjs'), '');
  const command = resolveAppServiceCommand('node entry.mjs --output state.json', dir);
  assert.match(command, /'\\''/);
  assert.ok(command.endsWith('--output state.json'));
  assert.equal(resolveAppServiceCommand('node -e "console.log(1)"', dir), 'node -e "console.log(1)"');
  assert.equal(resolveAppServiceCommand('node -e "entry.mjs"', dir), 'node -e "entry.mjs"');
  assert.equal(resolveAppServiceCommand('echo entry.mjs', dir), 'echo entry.mjs');
  assert.ok(resolveAppServiceCommand('node entry.mjs --output entry.mjs', dir).endsWith('--output entry.mjs'));
  assert.deepEqual(resolveAppServiceInvocation('node', ['entry.mjs', '--output', 'entry.mjs'], dir).args,
    [path.join(dir, 'entry.mjs'), '--output', 'entry.mjs']);
  assert.deepEqual(resolveAppServiceInvocation('node', ['-e', 'entry.mjs'], dir).args, ['-e', 'entry.mjs']);
});

test('retirement waits for every installed App, preserves orphans in backup and never recreates the root', t => {
  const f = fixture(t), one = f.pkg(), two = f.pkg('example.two', 'two');
  f.legacy(one); f.legacy(two);
  const installed = [one, two].map(pkg => ({ id: pkg.manifest.id, currentVersion: pkg.manifest.version, manifest: pkg.manifest }));
  f.json(path.join(f.mossHome, 'connectors/installed/orphan/connector.json'), { id: 'orphan' });
  f.upgrade.app(one); f.storage.activate(one);
  assert.deepEqual(f.upgrade.finish(installed).pending, ['example.two']);
  f.upgrade.app(two); f.storage.activate(two);
  const result = f.upgrade.finish(installed);
  assert.equal(result.retired, true);
  assert.equal(fs.existsSync(path.join(result.archive, 'installed/orphan/connector.json')), true);
  assert.equal(fs.existsSync(path.join(f.mossHome, 'connectors')), false);
  const restarted = createAppServiceStorage(f.options);
  assert.equal(restarted.read('one', 'cli.json').status, 'node status.mjs');
  assert.equal(f.upgrade.finish(installed).retired, false);
  assert.equal(fs.existsSync(path.join(f.mossHome, 'connectors')), false);
});

test('deleteData can retain credentials independently of deleteCredentials', t => {
  const f = fixture(t), pkg = f.pkg();
  f.storage.activate(pkg);
  f.storage.credentials('one').write({ connectorFields: { one: { token: { value: 'retained-secret' } } } });
  const restore = f.storage.retainCredentials('example.one');
  fs.rmSync(path.join(f.mossHome, 'apps-data/example.one'), { recursive: true });
  restore(); f.storage.deactivate('one', { deleteData: true, deleteCredentials: false });
  assert.equal(f.storage.credentials('one').read().connectorFields.one.token.value, 'retained-secret');
  assert.equal(fs.existsSync(f.storage.workspace('one')), false);
});
