// Archival is independent of transcript updates. It hides a whole conversation
// tree without touching its content, timestamps, or workspace files.
export function createSessionArchives({ db, getRecords, isBusy, onChanged = () => {}, now = Date.now }) {
  db.exec('CREATE TABLE IF NOT EXISTS session_archives (session_id TEXT PRIMARY KEY, archived_at INTEGER NOT NULL)');
  const archived = new Map(db.prepare('SELECT session_id, archived_at FROM session_archives').all().map(row => [row.session_id, row.archived_at]));
  const save = db.prepare('INSERT OR REPLACE INTO session_archives (session_id, archived_at) VALUES (?, ?)');
  const erase = db.prepare('DELETE FROM session_archives WHERE session_id = ?');
  function archiveOwner(record, records = getRecords()) {
    const visited = new Set();
    while (record && !visited.has(record.id)) {
      visited.add(record.id);
      if (archived.has(record.id)) return record.id;
      record = record.parentSessionId ? records.find(item => item.id === record.parentSessionId) : null;
    }
    return null;
  }
  function archivedAt(record, records = getRecords()) { return archived.get(archiveOwner(record, records)) ?? null; }
  function set({ sessionId, archived: value } = {}) {
    if (typeof value !== 'boolean') throw new Error('请选择归档或恢复。');
    const records = getRecords(), parent = records.find(item => item.id === sessionId && !item.deleted);
    if (!parent || parent.isSubAgent || parent.parentSessionId || parent.projectId || parent.appTestRunId
      || parent.agentMode === 'remote-direct' || (parent.sessionKind || 'chat') !== 'chat') {
      throw new Error('仅支持归档此设备上的独立会话。');
    }
    const ids = new Set([parent.id]);
    let added;
    do {
      added = false;
      for (const record of records) if (ids.has(record.parentSessionId) && !ids.has(record.id)) { ids.add(record.id); added = true; }
    } while (added);
    const family = records.filter(record => ids.has(record.id));
    if (family.some(record => record.deleted || record.deleting || isBusy(record))) throw new Error('会话仍在使用中，请等待任务结束并保存文件后重试。');
    if (value) {
      const time = archived.get(sessionId) || now();
      save.run(sessionId, time); archived.set(sessionId, time);
    } else { erase.run(sessionId); archived.delete(sessionId); }
    onChanged({ ids: [...ids], archived: value });
    return { ok: true };
  }
  function list() {
    const records = getRecords();
    return records.filter(record => !record.deleted && archived.has(record.id)).map(record => ({
      id: record.id, title: record.title || '未命名会话', updatedAt: record.updatedAt, archivedAt: archived.get(record.id),
      subagents: records.filter(child => !child.deleted && child.id !== record.id && archiveOwner(child, records) === record.id).length,
    })).sort((a, b) => b.archivedAt - a.archivedAt);
  }
  function forget(id) { erase.run(id); archived.delete(id); }
  return { archivedAt, set, list, forget };
}
