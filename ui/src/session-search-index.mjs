import { createHash } from 'node:crypto';
import { extractSearchableSessionMessages } from './shared/session-search-messages.mjs';
export { getSearchMessageId, extractSearchableSessionMessages } from './shared/session-search-messages.mjs';

function makeSnippet(body, query, maxLength = 180) {
  const compact = String(body || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  const index = compact.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, index < 0 ? 0 : index - Math.floor(maxLength / 3));
  const end = Math.min(compact.length, start + maxLength);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

export function createSessionSearchIndex(db) {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS session_message_search USING fts5(
      session_id UNINDEXED,
      message_id UNINDEXED,
      role UNINDEXED,
      title,
      body,
      created_at UNINDEXED,
      tokenize='trigram'
    )
  `);
  const deleteSession = db.prepare('DELETE FROM session_message_search WHERE session_id = ?');
  db.exec('CREATE TABLE IF NOT EXISTS session_search_revisions (session_id TEXT PRIMARY KEY, signature TEXT NOT NULL)');
  const loadSignature = db.prepare('SELECT signature FROM session_search_revisions WHERE session_id = ?');
  const saveSignature = db.prepare('INSERT INTO session_search_revisions VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET signature = excluded.signature');
  const deleteSignature = db.prepare('DELETE FROM session_search_revisions WHERE session_id = ?');
  const insertRow = db.prepare(`
    INSERT INTO session_message_search (
      session_id, message_id, role, title, body, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const syncSession = (sessionRecord) => {
    if (!sessionRecord?.id) return;
    const messages = extractSearchableSessionMessages(sessionRecord.history);
    const signature = createHash('sha256').update(JSON.stringify([sessionRecord.title || '', messages])).digest('hex');
    if (loadSignature.get(sessionRecord.id)?.signature === signature) return;
    db.exec('BEGIN');
    try {
      deleteSession.run(sessionRecord.id);
      insertRow.run(
        sessionRecord.id,
        '',
        'title',
        String(sessionRecord.title || ''),
        '',
        Number(sessionRecord.updatedAt) || 0,
      );
      for (const message of messages) {
        insertRow.run(
          sessionRecord.id,
          message.messageId,
          message.role,
          '',
          message.body,
          message.timestamp,
        );
      }
      saveSignature.run(sessionRecord.id, signature);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  };

  const search = (query, { sessionIds = [], limit = 50 } = {}) => {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    const allowedIds = [...new Set(sessionIds.filter((id) => typeof id === 'string' && id))];
    if (!normalizedQuery || allowedIds.length === 0) return [];
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const allowedJson = JSON.stringify(allowedIds);
    let rows;
    if ([...normalizedQuery].length < 3) {
      rows = db.prepare(`
        SELECT session_id, message_id, role, title, body, created_at, 0 AS rank
        FROM session_message_search
        WHERE session_id IN (SELECT value FROM json_each(?))
          AND (instr(lower(title), lower(?)) > 0 OR instr(lower(body), lower(?)) > 0)
        ORDER BY created_at DESC
        LIMIT ?
      `).all(allowedJson, normalizedQuery, normalizedQuery, boundedLimit);
    } else {
      const ftsQuery = `"${normalizedQuery.replaceAll('"', '""')}"`;
      rows = db.prepare(`
        SELECT session_id, message_id, role, title, body, created_at,
          bm25(session_message_search, 0, 0, 0, 4, 1, 0) AS rank
        FROM session_message_search
        WHERE session_message_search MATCH ?
          AND session_id IN (SELECT value FROM json_each(?))
        ORDER BY rank, created_at DESC
        LIMIT ?
      `).all(ftsQuery, allowedJson, boundedLimit);
    }
    return rows.map((row) => ({
      sessionId: row.session_id,
      messageId: row.message_id || null,
      role: row.role === 'user' || row.role === 'assistant' ? row.role : null,
      snippet: makeSnippet(row.body || row.title, normalizedQuery),
      timestamp: Number(row.created_at) || 0,
      rank: Number(row.rank) || 0,
    }));
  };

  return {
    syncSession,
    syncTitle: (record) => {
      const existing = db.prepare("SELECT title FROM session_message_search WHERE session_id = ? AND role = 'title'").get(record.id);
      if (!existing || existing.title === (record.title || '')) return;
      db.prepare("UPDATE session_message_search SET title = ?, created_at = ? WHERE session_id = ? AND role = 'title'").run(record.title || '', Number(record.updatedAt) || 0, record.id);
      deleteSignature.run(record.id);
    },
    hasSession: (sessionId) => Boolean(loadSignature.get(sessionId) || db.prepare('SELECT 1 FROM session_message_search WHERE session_id = ? LIMIT 1').get(sessionId)),
    deleteSession: (sessionId) => { deleteSession.run(sessionId); deleteSignature.run(sessionId); },
    search,
  };
}
