import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AppCredentialAdapter } from '../apps/app-runtime.mjs';
import { resourceStamp } from './environment-fingerprint.mjs';

async function copyTree(source, target, signal) {
  signal.throwIfAborted();
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Refresh replaces only the copied resource, never nesting a second package inside it.
  await fs.rm(target, { recursive: true, force: true });
  // Native cp handles large App dependency trees much faster than per-file JS
  // traversal. Reflinks keep copies isolated where the filesystem supports them.
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const copied = await new Promise((resolve, reject) => {
      const child = process.platform === 'darwin'
        ? spawn('/bin/cp', ['-cR', source, target], { signal, stdio: 'ignore' })
        : spawn('/bin/cp', ['-a', '--reflink=auto', '--', source, target], { signal, stdio: 'ignore' });
      let failure;
      child.on('error', error => { failure = error; });
      child.on('close', code => failure ? reject(failure) : resolve(code === 0));
    });
    signal.throwIfAborted();
    if (copied) return;
  }
  await fs.cp(source, target, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
    filter: () => { signal.throwIfAborted(); return true; } });
}

/** Copy package files and configuration, while leaving conversations and business data isolated. */
export async function inheritTestApps({ runtime, home, signal = new AbortController().signal, onProgress = async () => {} }) {
  if (!runtime) return [];
  const source = runtime.state.snapshot();
  const state = { version: source.version, installations: structuredClone(source.installations),
    instances: structuredClone(source.instances), runtimes: {} };
  const copied = new Set(), apps = [];
  const installations = Object.values(state.installations).filter(item => item.activeVersion);
  for (const [index, installation] of installations.entries()) {
    signal.throwIfAborted();
    const { appId, activeVersion, enabled, grants } = installation;
    await onProgress({ stage: 'apps', current: index, total: installations.length, item: appId,
      label: `正在复制 App ${index + 1}/${installations.length}：${appId}` });
    if (!activeVersion) continue;
    // Only copy package-store paths, never paths supplied by application configuration.
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(appId) || !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(activeVersion)) {
      throw new Error('无法继承无效的 App 安装记录。');
    }
    const key = `${appId}@${activeVersion}`;
    if (!copied.has(key)) {
      const sourceRoot = path.join(runtime.appsDir, appId, 'versions', activeVersion);
      const targetRoot = path.join(home, 'apps', appId, 'versions', activeVersion);
      const sourceChecksums = await fs.readFile(path.join(sourceRoot, 'checksums.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      const targetChecksums = await fs.readFile(path.join(targetRoot, 'checksums.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      const targetReady = await fs.stat(path.join(targetRoot, 'app.moss.json')).catch(() => null);
      const completionFile = path.join(home, '.test-package-copies', appId, `${activeVersion}.json`);
      const completedChecksums = await fs.readFile(completionFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!sourceChecksums || !targetChecksums?.equals(sourceChecksums) || !completedChecksums?.equals(sourceChecksums) || !targetReady) {
        await fs.rm(completionFile, { force: true });
        await copyTree(sourceRoot, targetRoot, signal);
        signal.throwIfAborted();
        if (sourceChecksums) { await fs.mkdir(path.dirname(completionFile), { recursive: true }); await fs.writeFile(completionFile, sourceChecksums); }
      }
      copied.add(key);
    }
    apps.push({ id: appId, version: activeVersion, enabled: Boolean(enabled), grants: [...(grants || [])] });
    await fs.writeFile(path.join(home, 'apps', appId, 'current.json'), JSON.stringify({ version: activeVersion, updatedAt: Date.now() }));
    await onProgress({ stage: 'apps', current: index + 1, total: installations.length, item: appId,
      label: `已复制 ${index + 1}/${installations.length} 个 App，正在继承配置…` });
  }
  // A removed credential must also disappear from the reused target profile.
  // Rebuild the store before the adapter performs any credential reads.
  await clearTestAppCredentials(home);
  const credentials = new AppCredentialAdapter(home);
  for (const instance of Object.values(state.instances)) {
    signal.throwIfAborted();
    // Re-encrypt App configuration credentials using the test profile's own key.
    const storageId = runtime.storageAppId(instance.appId, instance.owner);
    const values = await runtime.credentialAdapter.get(storageId, instance.id);
    if (Object.keys(values).length) await credentials.set(storageId, instance.id, values);
  }
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(home, 'app-runtime-state.json'), JSON.stringify(state), { mode: 0o600 });
  const sourceRegistry = runtime.rootDir
    ? await fs.readFile(path.join(runtime.rootDir, 'app-registry.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return {}; throw error; })
    : {};
  // Desktop listing uses its published registry as well as the runtime installation store.
  const registryApps = apps.map(app => {
    const sourceEntry = (sourceRegistry.apps || []).find(item => item.id === app.id);
    return { ...sourceEntry, id: app.id, name: sourceEntry?.name || app.id, kind: 'app',
      currentVersion: app.version, currentVersionId: app.version, publishedVersion: app.version,
      latestVersion: app.version, latestVersionId: app.version, versionCount: 1 };
  });
  await fs.writeFile(path.join(home, 'app-registry.json'), JSON.stringify({ version: 2, apps: registryApps }), { mode: 0o600 });
  return apps;
}

export async function inheritTestResources({ sourceHome, home, signal = new AbortController().signal, onProgress = async () => {} }) {
  if (!sourceHome) return;
  const stampPath = path.join(home, '.test-resource-stamps.json');
  const previous = await fs.readFile(stampPath, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
  const stamps = {};
  for (const directory of ['skills', 'assistants']) {
    signal.throwIfAborted();
    const source = path.join(sourceHome, directory);
    if (!(await fs.stat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))) {
      await fs.rm(path.join(home, directory), { recursive: true, force: true }); continue;
    }
    stamps[directory] = await resourceStamp(source);
    if (previous[directory] === stamps[directory] && await fs.stat(path.join(home, directory)).catch(() => null)) continue;
    await onProgress({ stage: 'resources', item: directory, label: `正在继承${directory === 'skills' ? '个人技能' : '助手'}配置…` });
    await copyTree(source, path.join(home, directory), signal);
  }
  await fs.writeFile(stampPath, JSON.stringify(stamps), { mode: 0o600 });
}

export async function clearTestAppCredentials(home) {
  await fs.rm(path.join(home, 'credentials', 'app-secrets.json'), { force: true });
}

export async function clearTestResources(home) {
  // Reports retain the package/version snapshot; disposable code copies need not accumulate.
  for (const directory of ['apps', 'skills', 'assistants']) await fs.rm(path.join(home, directory), { recursive: true, force: true });
}
