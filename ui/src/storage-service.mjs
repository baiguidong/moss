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
  const reviews = new Map();
  let scan, cleaning = false;
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
  return { overview, review, remove };
}
