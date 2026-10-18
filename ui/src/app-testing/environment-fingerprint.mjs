import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';

const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export async function resourceStamp(directory) {
  const hash = createHash('sha256');
  const visit = async (root, relative = '') => {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.git', 'node_modules', '.DS_Store'].includes(entry.name)) continue;
      const full = path.join(root, entry.name), name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(full, name);
      else {
        const stat = await fs.lstat(full);
        hash.update(canonical([name, stat.size, stat.mtimeMs, entry.isSymbolicLink() ? await fs.readlink(full) : null]));
      }
    }
  };
  await visit(directory); return hash.digest('hex');
}

/** Private keyed comparison detects credential changes without publishing their hashes. */
export async function captureTestEnvironment({ directory, settings, runtime }) {
  const keyPath = path.join(directory, '.environment-key');
  await fs.writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const snapshot = runtime?.state?.snapshot?.() || {};
  const installations = Object.values(snapshot.installations || {}).filter(item => item.activeVersion)
    .map(({ appId, activeVersion, enabled, grants }) => ({ appId, activeVersion, enabled, grants: [...(grants || [])].sort() }))
    .sort((a, b) => a.appId.localeCompare(b.appId));
  const packages = [];
  if (runtime?.appsDir) for (const item of installations) {
    const checksums = await fs.readFile(path.join(runtime.appsDir, item.appId, 'versions', item.activeVersion, 'checksums.json')).catch(error => {
      if (error.code === 'ENOENT') return Buffer.from(item.activeVersion); throw error;
    });
    packages.push([item.appId, createHash('sha256').update(checksums).digest('hex')]);
  }
  const resources = runtime?.rootDir ? await Promise.all(['skills', 'assistants'].map(async name => [name, await resourceStamp(path.join(runtime.rootDir, name))])) : [];
  const credentials = runtime?.rootDir ? await fs.readFile(path.join(runtime.rootDir, 'credentials/app-secrets.json')).catch(error => {
    if (error.code === 'ENOENT') return Buffer.alloc(0); throw error;
  }) : Buffer.alloc(0);
  const digest = createHmac('sha256', await fs.readFile(keyPath))
    .update(canonical({ settings, installations, instances: snapshot.instances, packages, resources }))
    .update(credentials).digest('hex');
  return { digest, settings: structuredClone(settings), packages, resources };
}
