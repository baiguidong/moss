function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function toRecord(row) {
  if (!row) return null;
  return {
    serverUrl: row.server_url,
    messageId: row.message_id,
    consumerId: row.consumer_id,
    leaseToken: row.lease_token,
    leaseUntil: Number(row.lease_until) || 0,
    sessionId: row.session_id || null,
    message: parseJson(row.message_json),
    state: row.state,
    error: row.error || null,
    receivedAt: Number(row.received_at),
    updatedAt: Number(row.updated_at),
  };
}

export function createAgentMailStore(db, { now = () => Date.now() } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_mail_local_queue (
      server_url TEXT NOT NULL,
      message_id TEXT NOT NULL,
      consumer_id TEXT NOT NULL,
      lease_token TEXT NOT NULL,
      lease_until INTEGER NOT NULL,
      session_id TEXT,
      message_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('received','manual','queued','running','completed','failed')),
      error TEXT,
      received_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_url, message_id)
    );
    CREATE INDEX IF NOT EXISTS agent_mail_local_queue_state_idx
      ON agent_mail_local_queue (server_url, state, received_at);
    CREATE TABLE IF NOT EXISTS agent_mail_thread_context (
      server_url TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      summary_text TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_url, thread_id)
    );
  `);
  try { db.exec(`ALTER TABLE agent_mail_local_queue ADD COLUMN session_id TEXT`); } catch {}
  db.prepare(`
    UPDATE agent_mail_local_queue SET state = 'queued', updated_at = ? WHERE state = 'running'
  `).run(now());

  const getStmt = db.prepare(`SELECT * FROM agent_mail_local_queue WHERE server_url = ? AND message_id = ?`);
  const listManualStmt = db.prepare(`
    SELECT * FROM agent_mail_local_queue WHERE server_url = ? AND state = 'manual' ORDER BY received_at ASC
  `);
  const nextRunnableStmt = db.prepare(`
    SELECT * FROM agent_mail_local_queue
    WHERE server_url = ? AND state = 'queued'
    ORDER BY received_at ASC LIMIT 1
  `);
  const mailboxKeyForSessionStmt = db.prepare(`
    SELECT server_url
    FROM agent_mail_local_queue
    WHERE session_id = ? AND server_url LIKE 'mailbox:%'
    ORDER BY updated_at DESC
    LIMIT 1
  `);

  return {
    putLeased(serverUrl, consumerId, leaseToken, leaseUntil, message) {
      const timestamp = now();
      db.prepare(`
        INSERT INTO agent_mail_local_queue (
          server_url, message_id, consumer_id, lease_token, lease_until,
          message_json, state, received_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?)
        ON CONFLICT (server_url, message_id) DO UPDATE SET
          consumer_id = excluded.consumer_id,
          lease_token = excluded.lease_token,
          lease_until = excluded.lease_until,
          message_json = excluded.message_json,
          updated_at = excluded.updated_at
      `).run(serverUrl, message.messageId, consumerId, leaseToken, leaseUntil, JSON.stringify(message), timestamp, timestamp);
      return toRecord(getStmt.get(serverUrl, message.messageId));
    },
    get(serverUrl, messageId) {
      return toRecord(getStmt.get(serverUrl, messageId));
    },
    markAccepted(serverUrl, messageId, deliveryMode) {
      db.prepare(`
        UPDATE agent_mail_local_queue
        SET state = CASE
          WHEN state IN ('completed','failed') THEN state
          WHEN ? = 'auto' THEN 'queued'
          ELSE 'manual'
        END, updated_at = ?
        WHERE server_url = ? AND message_id = ?
      `).run(deliveryMode, now(), serverUrl, messageId);
      return toRecord(getStmt.get(serverUrl, messageId));
    },
    approve(serverUrl, messageId) {
      db.prepare(`
        UPDATE agent_mail_local_queue SET state = 'queued', updated_at = ?
        WHERE server_url = ? AND message_id = ? AND state = 'manual'
      `).run(now(), serverUrl, messageId);
      return toRecord(getStmt.get(serverUrl, messageId));
    },
    assignSession(serverUrl, messageId, sessionId) {
      db.prepare(`
        UPDATE agent_mail_local_queue SET session_id = ?, updated_at = ?
        WHERE server_url = ? AND message_id = ?
      `).run(String(sessionId || ''), now(), serverUrl, messageId);
      return toRecord(getStmt.get(serverUrl, messageId));
    },
    nextRunnable(serverUrl) {
      return toRecord(nextRunnableStmt.get(serverUrl));
    },
    listManual(serverUrl) {
      return listManualStmt.all(serverUrl).map(toRecord);
    },
    markRunning(serverUrl, messageId) {
      db.prepare(`
        UPDATE agent_mail_local_queue SET state = 'running', error = NULL, updated_at = ?
        WHERE server_url = ? AND message_id = ? AND state = 'queued'
      `).run(now(), serverUrl, messageId);
      return toRecord(getStmt.get(serverUrl, messageId));
    },
    finish(serverUrl, messageId, state, error = null) {
      if (state !== 'completed' && state !== 'failed') throw new Error(`Invalid Agent Mail terminal state: ${state}`);
      db.prepare(`
        UPDATE agent_mail_local_queue SET state = ?, error = ?, updated_at = ?
        WHERE server_url = ? AND message_id = ?
      `).run(state, error, now(), serverUrl, messageId);
      return toRecord(getStmt.get(serverUrl, messageId));
    },
    remove(serverUrl, messageId) {
      db.prepare(`DELETE FROM agent_mail_local_queue WHERE server_url = ? AND message_id = ?`).run(serverUrl, messageId);
    },
    getThreadContext(serverUrl, threadId) {
      const row = db.prepare(`
        SELECT summary_text, updated_at
        FROM agent_mail_thread_context
        WHERE server_url = ? AND thread_id = ?
      `).get(serverUrl, threadId);
      return row
        ? { summaryText: row.summary_text || '', updatedAt: Number(row.updated_at) || 0 }
        : { summaryText: '', updatedAt: 0 };
    },
    saveThreadContext(serverUrl, threadId, summaryText) {
      const timestamp = now();
      db.prepare(`
        INSERT INTO agent_mail_thread_context (server_url, thread_id, summary_text, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (server_url, thread_id) DO UPDATE SET
          summary_text = excluded.summary_text,
          updated_at = excluded.updated_at
      `).run(serverUrl, threadId, String(summaryText || ''), timestamp);
      return { summaryText: String(summaryText || ''), updatedAt: timestamp };
    },
    findMailboxKeyForSession(sessionId) {
      const row = mailboxKeyForSessionStmt.get(String(sessionId || ''));
      return row?.server_url || '';
    },
  };
}
