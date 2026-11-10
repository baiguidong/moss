// Exercise installed packages against a private copy of legacy data. Never
// mutates the source profile, starts Apps, or prints credential values.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const source = path.resolve(process.argv[2] || path.join(os.homedir(), '.moss'));
const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-service-upgrade-')));
const profile = path.join(temporary, 'profile');
process.env.MOSS_HOME = profile;
process.env.HOME = temporary;
process.env.USERPROFILE = temporary;
const counts = { apps: 0, skills: 0, mcpServers: 0, credentialGroups: 0, overrides: 0 };
try {
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  let legacySource = path.join(source, 'connectors');
  if (!await fs.stat(legacySource).catch(() => null)) {
    const backups = await Promise.all((await fs.readdir(path.join(source, 'backups')))
      .filter(name => name.startsWith('connectors-before-app-services-'))
      .map(async name => { const file = path.join(source, 'backups', name); return { file, modified: (await fs.stat(file)).mtimeMs }; }));
    legacySource = backups.sort((a, b) => b.modified - a.modified)[0]?.file;
    if (!legacySource) throw new Error('No legacy connector directory or upgrade backup to verify');
  }
  await fs.cp(legacySource, path.join(profile, 'connectors'), { recursive: true });
  await fs.mkdir(path.join(profile, 'credentials'), { mode: 0o700 });
  await fs.copyFile(path.join(source, 'credentials/.master.key'), path.join(profile, 'credentials/.master.key'));
  await fs.chmod(path.join(profile, 'credentials/.master.key'), 0o600);
  const registry = JSON.parse(await fs.readFile(path.join(source, 'app-registry.json'), 'utf8')).apps;
  const runtimeState = JSON.parse(await fs.readFile(path.join(source, 'app-runtime-state.json'), 'utf8'));
  const installations = Object.values(runtimeState.installations);
  const hub = await import('../src/connector-hub-ipc.mjs');
  const { appServiceStorage: storage, legacyUpgrade: upgrade } = await import('../src/apps/app-service-context.mjs');
  const { validateAppPackage } = await import('../../packages/app-runtime/src/packages/index.mjs');
  const apps = registry.filter(app => app.manifest?.connectorApp || app.connectorApp);
  hub.setConnectorAppLifecycle({ getInstallation: id => installations.find(entry => entry.appId === id) });
  const packages = [];
  for (const app of apps) {
    const pkg = await validateAppPackage(path.join(source, 'apps', app.id, 'versions', app.currentVersion));
    packages.push(pkg);
    await hub.activateConnectorApp(pkg);
    assert.equal(hub.isConnectorAppActivationCurrent(app.id, app.currentVersion, pkg.manifest.connectorApp.id), true);
    counts.apps++;
  }
  upgrade.core();
  const before = await hub.listInstalledConnectors();
  for (const service of before) {
    for (const skill of service.skillNames || []) {
      assert.ok((await hub.readConnectorSkill(service.id, skill)).content);
      counts.skills++;
    }
    counts.mcpServers += Object.keys(hub.getConnectorMcpServers([service.id])).length;
    counts.credentialGroups += Object.keys(storage.credentials(service.id).read().connectorFields || {}).length;
    counts.overrides += (await fs.readdir(path.join(storage.rootFor(service.id), 'config')).catch(() => [])).length;
  }
  const beforeMcp = hub.getConnectorMcpServers(before.map(service => service.id));
  const retired = upgrade.finish(apps);
  assert.equal(retired.retired, true);
  // Remove even the copied backup to prove there is no runtime fallback.
  await fs.rm(retired.archive, { recursive: true });
  assert.deepEqual(await hub.listInstalledConnectors(), before);
  assert.deepEqual(hub.getConnectorMcpServers(before.map(service => service.id)), beforeMcp);
  assert.equal(await fs.stat(path.join(profile, 'connectors')).catch(() => null), null);
  for (const pkg of packages) await validateAppPackage(pkg.root);
  console.log(JSON.stringify({ ok: true, ...counts, packageFilesUnchanged: true, worksWithoutLegacyDirectory: true }));
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
