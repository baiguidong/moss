// Server session IDs survive reimports; desktop record IDs do not. Keep these
// tombstones after server confirmation so stale replies and restarts cannot
// reimport successfully deleted sessions.
export function createRemoteSessionDeletionStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deleted_remote_sessions (
      session_id TEXT PRIMARY KEY,
      deleted_at INTEGER NOT NULL
    )
  `);
  const lookup = db.prepare('SELECT 1 FROM deleted_remote_sessions WHERE session_id = ?');
  const insert = db.prepare(`
    INSERT OR IGNORE INTO deleted_remote_sessions (session_id, deleted_at) VALUES (?, ?)
  `);
  return {
    has(sessionId) {
      return Boolean(sessionId && lookup.get(sessionId));
    },
    mark(sessionId) {
      if (sessionId) insert.run(sessionId, Date.now());
    },
  };
}

export function createRemoteHistoryCheckpoint(sessionRecord, lastActiveAt, { isNew = false } = {}) {
  const previous = Number(sessionRecord?.remoteLastActiveAt) || 0;
  const current = Number(lastActiveAt) || 0;
  return {
    needsRefresh: isNew || current > previous,
    commit() {
      sessionRecord.remoteLastActiveAt = current;
      sessionRecord.remoteHistorySyncError = null;
    },
  };
}

export function applyRemoteSessionTitle(sessionRecord, remoteTitle, { isNew = false } = {}) {
  const title = typeof remoteTitle === 'string' ? remoteTitle.trim() : '';
  if (!title) return false;
  if (
    !isNew
    && sessionRecord.title
    && sessionRecord.title !== 'New Session'
    && sessionRecord.title !== 'Moss Server 会话'
    && sessionRecord.title !== 'App Channel 会话'
  ) {
    return false;
  }
  sessionRecord.title = title;
  return true;
}

export function applyRemoteSessionHistoryTitle(sessionRecord) {
  for (const entry of sessionRecord.history || []) {
    if (entry?.type !== 'user' || entry.isMeta || entry.isSidechain) continue;
    const content = entry.message?.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter(block => block?.type === 'text').map(block => block.text || '').join('\n')
        : '';
    const line = text.split('\n').map(part => part.trim()).find(Boolean);
    if (!line) continue;
    return applyRemoteSessionTitle(sessionRecord, line.length > 36 ? `${line.slice(0, 36)}...` : line);
  }
  return false;
}
