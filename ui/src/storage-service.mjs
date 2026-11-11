import fs from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { measureStorage } from './storage-usage.mjs';

const DAY = 86400000;

// Inspect metadata only. Do not follow links into user workspaces or other profiles.
async function walk(root, visit, { maxEntries = 200000, deadline = Date.now() + 15000 } = {}) {
  const pending = [root];
  let entries = 0, complete = true;
  while (pending.length) {
    if (++entries > maxEntries || Date.now() > deadline) return false;
    const target = pending.pop();
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        const names = await fs.readdir(target);
        for (const name of names.sort().reverse()) pending.push(path.join(target, name));
      } else if (stat.isFile()) visit(target, stat);
    } catch (error) {
      // Missing files during a scan make the result partial, too.
      complete = false;
    }
  }
  return complete;
}

export function createStorageService({ root, getRecords, isBusy, removeSession, isArchived = () => false, now = Date.now }) {
  root = path.resolve(root);
  const reviews = new Map();
  let scan, cleaning = false, cacheCleaning = false;
  const sessionPath = id => {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error('无效的会话标识。');
    return path.join(root, 'sessions', id);
  };
  const recordStamp = records => JSON.stringify(records.map(record => [record.id, record.updatedAt, record.workspace, record.parentSessionId, record.title, isArchived(record)]));
  // Check the container as well as its children: a linked sessions root must never
  // make a cleanup cross into a different profile. Called again in the final guard.
  function assertDirectories(records) {
    for (const directory of [root, path.join(root, 'sessions'), ...records.map(record => sessionPath(record.id))]) {
      let stat;
      try { stat = lstatSync(directory); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('会话目录不可用。');
    }
  }
  async function fingerprint(records, deadline = Date.now() + 15000) {
    assertDirectories(records);
    const stamp = recordStamp(records);
    const hash = createHash('sha256');
    hash.update(stamp);
    let bytes = 0;
    for (const record of records) {
      const directory = sessionPath(record.id);
      hash.update(record.id);
      const stat = await fs.lstat(directory).catch(() => null);
      if (!stat) { hash.update('missing'); continue; }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('会话目录不可用。');
      const complete = await walk(directory, (file, stat) => {
        bytes += stat.size;
        hash.update(JSON.stringify([path.relative(directory, file), stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino]));
      }, { maxEntries: 50000, deadline: Math.min(deadline, Date.now() + 5000) });
      if (!complete) throw new Error('会话文件未能完整读取。');
    }
    if (stamp !== recordStamp(records)) throw new Error('会话在扫描期间发生变化。');
    return { revision: hash.digest('hex'), bytes, stamp };
  }
  function candidates(days, parentId, archivedOnly = true) {
    if (![0, 30, 90, 180, 365].includes(days)) throw new Error('请选择有效的保留天数。');
    const records = getRecords(), cutoff = days === 0 ? Infinity : now() - days * DAY;
    const children = new Map(), workspaceOwners = new Map();
    for (const record of records) {
      if (record.parentSessionId) {
        const siblings = children.get(record.parentSessionId) || [];
        siblings.push(record); children.set(record.parentSessionId, siblings);
      }
      if (!record.deleted && record.workspace) {
        const relative = path.relative(path.join(root, 'sessions'), path.resolve(record.workspace));
        if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
          const containerId = relative.split(path.sep)[0], owners = workspaceOwners.get(containerId) || [];
          owners.push(record.id); workspaceOwners.set(containerId, owners);
        }
      }
    }
    return records.filter(record => (!parentId || record.id === parentId) && !record.isSubAgent && !record.parentSessionId
      && (!archivedOnly || isArchived(record))
      && !record.projectId && !record.appTestRunId && (record.sessionKind || 'chat') === 'chat'
      && record.agentMode !== 'remote-direct').flatMap(parent => {
      const family = [parent, ...(children.get(parent.id) || [])];
      if (family.some(record => !/^[a-zA-Z0-9_-]{1,160}$/.test(record.id))) return [];
      // The existing deletion path handles direct children. Deeper trees remain untouched.
      if (family.slice(1).some(child => children.has(child.id))) return [];
      // Another conversation can reuse a managed workspace. Keep that directory.
      const familyIds = new Set(family.map(record => record.id));
      if (family.some(member => (workspaceOwners.get(member.id) || []).some(owner => !familyIds.has(owner)))) return [];
      if (family.some(record => record.deleted || record.deleting || record.agentMode === 'remote-direct'
        || !Number.isFinite(record.updatedAt) || record.updatedAt <= 0 || record.updatedAt >= cutoff || isBusy(record))) return [];
      return [{ parent, family }];
    }).sort((a, b) => a.parent.updatedAt - b.parent.updatedAt);
  }
  async function overview() {
    if (scan) return scan;
    scan = measureStorage(root, { sessionKinds: new Map(getRecords().map(record => [record.id, isArchived(record) ? 'archived' : record.isSubAgent || record.parentSessionId ? 'subagents' : 'sessions'])) }).then(result => ({ ...result, measuredAt: now() }));
    try { return await scan; } finally { scan = null; }
  }
  async function review({ days = 90, archivedOnly = true, archivedIds } = {}) {
    if (archivedIds !== undefined) {
      if (!Array.isArray(archivedIds) || !archivedIds.length || archivedIds.length > 200 || archivedIds.some(id => typeof id !== 'string')) throw new Error('请选择归档会话。');
      days = 0; archivedOnly = true;
    } else if (![30, 90, 180, 365].includes(days)) throw new Error('请选择有效的保留天数。');
    if (typeof archivedOnly !== 'boolean') throw new Error('请选择清理范围。');
    for (const [token, entry] of reviews) if (entry.expiresAt < now()) reviews.delete(token);
    while (reviews.size >= 10) reviews.delete(reviews.keys().next().value);
    const eligible = candidates(days, undefined, archivedOnly).filter(entry => !archivedIds || archivedIds.includes(entry.parent.id)), items = [], snapshots = new Map();
    const deadline = Date.now() + 15000;
    let skipped = 0;
    let inspected = 0;
    for (const { parent, family } of eligible.slice(0, 200)) {
      if (Date.now() > deadline) break;
      inspected++;
      try {
        const snapshot = await fingerprint(family, deadline);
        const current = candidates(days, parent.id, archivedOnly)[0];
        if (!current || recordStamp(current.family) !== snapshot.stamp) { skipped++; continue; }
        snapshots.set(parent.id, snapshot.revision);
        items.push({ id: parent.id, title: parent.title || '未命名会话', updatedAt: parent.updatedAt,
          bytes: snapshot.bytes, subagents: family.length - 1 });
      } catch { skipped++; }
    }
    const token = randomUUID();
    reviews.set(token, { days, archivedOnly, snapshots, expiresAt: now() + 15 * 60000 });
    return { token, days, items, skipped, hasMore: eligible.length > inspected };
  }
  async function remove({ token, ids } = {}) {
    if (cleaning) throw new Error('清理正在进行中。');
    const reviewed = reviews.get(token);
    if (!reviewed || reviewed.expiresAt < now()) throw new Error('清理预览已过期，请重新查看。');
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => !reviewed.snapshots.has(id))) throw new Error('请选择预览中的会话。');
    cleaning = true;
    reviews.delete(token);
    const result = { deleted: 0, skipped: 0, failed: 0 };
    try {
      for (const id of new Set(ids)) {
        const entry = candidates(reviewed.days, id, reviewed.archivedOnly)[0];
        if (!entry) { result.skipped++; continue; }
        try {
          const snapshot = await fingerprint(entry.family);
          const current = candidates(reviewed.days, id, reviewed.archivedOnly)[0];
          if (!current || current.family.length !== entry.family.length || snapshot.revision !== reviewed.snapshots.get(id)
            || recordStamp(current.family) !== snapshot.stamp
            || current.family.some((record, index) => record !== entry.family[index])) { result.skipped++; continue; }
          // Final guard runs synchronously in removeSession, before it marks the session deleted.
          const removed = await removeSession(id, () => {
            assertDirectories(entry.family);
            const latest = candidates(reviewed.days, id, reviewed.archivedOnly)[0];
            return !!latest && recordStamp(latest.family) === snapshot.stamp && latest.family.length === entry.family.length && latest.family.every((record, index) =>
              record === entry.family[index] && !isBusy(record));
          });
          if (removed === false) { result.skipped++; continue; }
          const remaining = await Promise.all(entry.family.map(record => fs.lstat(sessionPath(record.id)).then(() => true, error => {
            if (error.code === 'ENOENT') return false;
            throw error;
          })));
          if (remaining.some(Boolean)) result.failed++; else result.deleted++;
        } catch { result.failed++; }
      }
      return result;
    } finally { cleaning = false; }
  }

  async function treeBytes(target) {
    let bytes = 0;
    await walk(target, (_file, stat) => { bytes += stat.size; });
    return bytes;
  }

  async function removeCachePath(target, result) {
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('缓存目录超出存储范围。');
    // Refuse linked parents: unlinking a leaf is safe, traversing a linked
    // container could otherwise delete data outside this Moss profile.
    for (let parent = path.dirname(target); ; parent = path.dirname(parent)) {
      const stat = await fs.lstat(parent).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!stat) return;
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('缓存父目录不可用。');
      if (parent === path.resolve(root)) break;
    }
    const stat = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      await fs.rm(target, { force: true });
      result.removed.push(path.relative(root, target));
      return;
    }
    result.deletedBytes += await treeBytes(target);
    await fs.rm(target, { recursive: true, force: true });
    result.removed.push(path.relative(root, target));
  }

  async function clearOldAppVersions(result) {
    const appsRoot = path.join(root, 'apps');
    const rootStat = await fs.lstat(appsRoot).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!rootStat) return;
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('应用目录不可用。');
    const state = await fs.readFile(path.join(root, 'app-runtime-state.json'), 'utf8')
      .then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
    const apps = await fs.readdir(appsRoot, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const app of apps) {
      if (!app.isDirectory() || app.name.startsWith('.')) continue;
      const appRoot = path.join(appsRoot, app.name);
      let current = null;
      try { current = JSON.parse(await fs.readFile(path.join(appRoot, 'current.json'), 'utf8')).version; } catch {}
      if (!current) continue;
      const retained = new Set([current]);
      for (const record of [...Object.values(state.installations || {}), ...Object.values(state.runtimes || {})]) {
        if (record.appId === app.name) { if (record.activeVersion) retained.add(record.activeVersion); if (record.version) retained.add(record.version); }
      }
      const versionsRoot = path.join(appRoot, 'versions');
      const versions = await fs.readdir(versionsRoot, { withFileTypes: true }).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const version of versions) {
        if (!version.isDirectory() || retained.has(version.name)) continue;
        await removeCachePath(path.join(versionsRoot, version.name), result);
        await removeCachePath(path.join(appRoot, 'verification', `${version.name}.json`), result);
        await removeCachePath(path.join(appRoot, 'version-metadata', `${version.name}.json`), result);
      }
      const sourcesRoot = path.join(appRoot, 'sources');
      const sources = await fs.readdir(sourcesRoot, { withFileTypes: true }).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const source of sources) {
        const sourceVersion = source.name.replace(/\.tar\.gz$/, '');
        if (source.isFile() && sourceVersion && !retained.has(sourceVersion)) await removeCachePath(path.join(sourcesRoot, source.name), result);
      }
    }
  }

  async function clearCaches() {
    if (cacheCleaning) throw new Error('缓存清理正在进行中。');
    if (getRecords().some(record => isBusy(record))) throw new Error('请等待运行中的会话完成后再清理缓存。');
    cacheCleaning = true;
    const result = { deletedBytes: 0, removed: [], failed: 0 };
    try {
      // These roots contain downloaded/generated material only. Current App
      // packages and App-owned data are deliberately excluded.
      await clearOldAppVersions(result);
      for (const name of ['generated-apps', 'app-authoring-previews', 'cloud-transfers', 'cache', '.cache', 'caches', 'browser-binaries', 'whisper-models', 'mcp/python']) {
        try { await removeCachePath(path.join(root, name), result); } catch { result.failed++; }
      }
      // The marketplace catalog is disposable; the bundled catalog remains in
      // the application resources and will repopulate it on the next request.
      try { await removeCachePath(path.join(root, 'app-market', 'catalog-v1.json'), result); } catch { result.failed++; }
      return result;
    } finally { cacheCleaning = false; }
  }

  return { overview, review, remove, clearCaches };
}
