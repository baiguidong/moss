const MAX_INDEXED_MESSAGE_CHARS = 100_000;

function textFromContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function eventText(event) {
  if (!event || typeof event !== 'object') return '';
  if (event.type === 'user') {
    if (
      event.parent_tool_use_id != null
      || event.tool_use_result
      || event.toolUseResult
      || event.isMeta === true
      || event.isSynthetic === true
      || event.isVisibleInTranscriptOnly === true
      || (typeof event.origin?.kind === 'string' && event.origin.kind !== 'human')
    ) return '';
    const text = (typeof event.prompt === 'string'
      ? event.prompt
      : textFromContent(event.message?.content)).trim();
    if (text.startsWith('<local-command-caveat>') || text.startsWith('<command-name>')) return '';
    return text;
  }
  if (event.type === 'assistant') {
    if (
      event.parent_tool_use_id != null
      || (event.isSidechain === true && typeof event.agentId === 'string')
    ) return '';
    return textFromContent(event.message?.content ?? event.content);
  }
  return '';
}

function stableTextHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function getSearchMessageId(event) {
  if (typeof event?.uuid === 'string' && event.uuid.trim()) return event.uuid.trim();
  if (typeof event?.id === 'string' && event.id.trim()) return `id:${event.id.trim()}`;
  const role = event?.type === 'assistant' ? 'assistant' : 'user';
  const timestamp = event?.timestamp instanceof Date
    ? event.timestamp.toISOString()
    : String(event?.timestamp ?? '');
  return `event:${role}:${stableTextHash(`${timestamp}\n${eventText(event)}`)}`;
}

export function extractSearchableSessionMessages(history) {
  const byMessage = new Map();
  for (const event of (Array.isArray(history) ? history : [])) {
    if (event?.type !== 'user' && event?.type !== 'assistant') continue;
    const body = eventText(event);
    if (!body) continue;
    const role = event.type;
    const timestamp = Number.isFinite(event.timestamp)
      ? Number(event.timestamp)
      : Number.isFinite(Date.parse(event.timestamp)) ? Date.parse(event.timestamp) : index;
    const messageId = getSearchMessageId(event);
    const current = byMessage.get(`${role}:${messageId}`);
    if (!current || body.length >= current.body.length) {
      byMessage.set(`${role}:${messageId}`, {
        messageId,
        role,
        body: body.slice(0, MAX_INDEXED_MESSAGE_CHARS),
        timestamp,
      });
    }
  }
  return [...byMessage.values()];
}

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
  const insertRow = db.prepare(`
    INSERT INTO session_message_search (
      session_id, message_id, role, title, body, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const syncSession = (sessionRecord) => {
    if (!sessionRecord?.id) return;
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
      for (const message of extractSearchableSessionMessages(sessionRecord.history)) {
        insertRow.run(
          sessionRecord.id,
          message.messageId,
          message.role,
          '',
          message.body,
          message.timestamp,
        );
      }
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
    deleteSession: (sessionId) => deleteSession.run(sessionId),
    search,
  };
}
