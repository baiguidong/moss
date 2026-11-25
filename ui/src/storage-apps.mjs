import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { assertServicePath } from './apps/app-service-storage.mjs';

const dataRoots = ['apps-data', 'apps-runtime', 'generated-app-data'];
const isAppId = id => typeof id === 'string' && /^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/.test(id)
  && !['owners', 'retired-native-packages'].includes(id);

// Only paths with an explicit App owner become actionable. Shared databases,
// profiles and unassigned legacy archives remain ordinary storage entries.
export function groupAppStorage(overview, registry, ownerSegment) {
  const apps = new Map();
  function item(id) {
    if (!apps.has(id)) apps.set(id, { path: id, appId: id, label: id, bytes: 0, packageBytes: 0, dataBytes: 0, complete: true, installed: false });
    return apps.get(id);
  }
  for (const app of registry) {
    if (isAppId(app.id)) Object.assign(item(app.id), { label: app.displayName || app.title || app.id, installed: true, version: app.currentVersion });
  }
  const combined = { id: 'apps', label: '应用', bytes: 0, complete: true, entries: [] };
  for (const category of overview.categories.filter(c => ['apps', 'app-data'].includes(c.id))) {
    combined.bytes += category.bytes;
    combined.complete &&= category.complete;
    for (const entry of category.entries) {
      const [root, name, owner, scopedId] = entry.path.split('/');
      const id = name === 'owners' && ownerSegment && owner === ownerSegment ? scopedId : name;
      if (!isAppId(id) || !(root === 'apps' || dataRoots.includes(root))) {
        combined.entries.push(entry);
        continue;
      }
      const app = item(id);
      app.bytes += entry.bytes;
      app[root === 'apps' ? 'packageBytes' : 'dataBytes'] += entry.bytes;
      app.complete &&= entry.complete;
    }
  }
  combined.entries.push(...apps.values());
  combined.entries.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { ...overview, categories: overview.categories.filter(c => c.id !== 'app-data').map(c => c.id === 'apps' ? combined : c) };
}

export async function cleanAppStorage({ root, appId, mode, expectedVersion, registry, retainedVersions, uninstall, updateVersions, ownerSegment }) {
  if (!isAppId(appId) || !['history', 'uninstall', 'purge'].includes(mode)) throw new Error('无效的应用清理操作。');
  const app = registry.find(entry => entry.id === appId);
  const safePath = (...parts) => assertServicePath(root, path.join(root, ...parts));
  const appDir = safePath('apps', appId);
  const currentFile = safePath('apps', appId, 'current.json');
  const current = fs.existsSync(currentFile) ? JSON.parse(fs.readFileSync(currentFile, 'utf8')).version : null;
  if ((app?.currentVersion ?? null) !== expectedVersion || (current && current !== expectedVersion)) throw new Error('应用版本已变化，请刷新后重试。');
  if (mode === 'history') {
    if (!app || !semver.valid(current)) throw new Error('无法识别应用当前版本。');
    const versions = safePath('apps', appId, 'versions');
    if (!fs.statSync(safePath('apps', appId, 'versions', current)).isDirectory()) throw new Error('当前安装包不可用。');
    const retained = new Set([current, ...retainedVersions()]);
    let removed = 0;
    // Move obsolete directories out of the version list before yielding. A
    // concurrent rollback can never pick a version that is being unlinked.
    const trash = safePath('apps', appId, '.discarded-versions');
    fs.mkdirSync(trash, { recursive: true });
    try {
      for (const entry of fs.readdirSync(versions, { withFileTypes: true })) {
        if (!entry.isDirectory() || !semver.valid(entry.name) || retained.has(entry.name)) continue;
        const sidecars = [['verification', '.json'], ['version-metadata', '.json'], ['sources', '.tar.gz']]
          .map(([dir, ext]) => safePath('apps', appId, dir, entry.name + ext));
        fs.renameSync(path.join(versions, entry.name), path.join(fs.mkdtempSync(path.join(trash, 'package-')), 'version'));
        removed++;
        for (const file of sidecars) fs.rmSync(file, { force: true });
      }
    } finally {
      if (removed) updateVersions(appId);
      await fsp.rm(trash, { recursive: true, force: true });
    }
    return { removed };
  }
  const data = dataRoots.map(dir => safePath(dir, appId));
  if (ownerSegment) {
    for (const dir of ['apps-data', 'apps-runtime']) data.push(safePath(dir, 'owners', ownerSegment, appId));
  }
  if (!app && !data.some(directory => fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory())) throw new Error('未找到此应用的数据。');
  if (!app && mode !== 'purge') throw new Error('应用已卸载。');
  if (!app && fs.existsSync(appDir)) throw new Error('应用安装状态已变化，请刷新后重试。');
  // Use the regular uninstall lifecycle to close views, stop services and
  // release installations before removing any old or retained data.
  await uninstall(appId, mode === 'purge');
  if (mode === 'purge') {
    for (const directory of data) await fsp.rm(directory, { recursive: true, force: true });
  }
  return { removed: 0 };
}
