import { randomUUID } from 'node:crypto';

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createFeishuAdapterStore(db, { now = () => Date.now() } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS external_conversations (
      id TEXT PRIMARY KEY,
      adapter_instance_id TEXT NOT NULL,
      tenant_key TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      paired_open_id TEXT NOT NULL,
      active_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(adapter_instance_id, tenant_key, chat_id)
    );
    CREATE TABLE IF NOT EXISTS external_events (
      adapter_instance_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      conversation_id TEXT,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      session_id TEXT,
      turn_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(adapter_instance_id, event_id)
    );
    CREATE TABLE IF NOT EXISTS session_turn_queue (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      conversation_id TEXT,
      source_channel TEXT NOT NULL,
      source_event_id TEXT,
      prompt TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      result_text TEXT,
      error TEXT,
      delivered_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(source_channel, source_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_turn_queue_status
      ON session_turn_queue(status, created_at);
    CREATE TABLE IF NOT EXISTS app_notifications (
      id TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      desktop_details TEXT,
      mobile_title TEXT,
      mobile_summary TEXT,
      mobile_policy TEXT NOT NULL DEFAULT 'disabled',
      decision_request_id TEXT,
      decision_options_json TEXT NOT NULL DEFAULT '[]',
      read INTEGER NOT NULL DEFAULT 0,
      occurrences INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      external_message_id TEXT,
      external_card_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(notification_id, conversation_id)
    );
    CREATE TABLE IF NOT EXISTS decision_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      mobile_title TEXT NOT NULL,
      mobile_summary TEXT NOT NULL,
      action_token_hash TEXT NOT NULL,
      notification_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      expires_at INTEGER,
      resolution_source TEXT,
      resolution_json TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  try {
    db.exec(`ALTER TABLE session_turn_queue ADD COLUMN delivered_at INTEGER`);
  } catch {
    // Column already exists.
  }
  try {
    db.exec(`ALTER TABLE app_notifications ADD COLUMN decision_options_json TEXT NOT NULL DEFAULT '[]'`);
  } catch {
    // Column already exists.
  }
  try {
    db.exec(`ALTER TABLE decision_requests ADD COLUMN notification_id TEXT`);
  } catch {
    // Column already exists.
  }
  try {
    db.exec(`ALTER TABLE decision_requests ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}'`);
  } catch {
    // Column already exists.
  }

  // A runtime that disappeared cannot safely continue an in-flight tool call.
  db.prepare(`
    UPDATE session_turn_queue
    SET status = 'failed', error = 'Moss exited while this turn was running.', updated_at = ?
    WHERE status = 'running'
  `).run(now());
  db.prepare(`
    UPDATE decision_requests
    SET status = 'expired', error = 'Moss exited before this decision was resolved.', updated_at = ?
    WHERE status IN ('pending', 'resolving') AND kind <> 'plan_approval'
  `).run(now());
  db.prepare(`
    UPDATE decision_requests
    SET status = 'pending', resolution_source = NULL, updated_at = ?
    WHERE status = 'resolving' AND kind = 'plan_approval'
  `).run(now());
  db.prepare(`
    UPDATE app_notifications
    SET decision_request_id = NULL, mobile_policy = 'disabled', read = 1, updated_at = ?
    WHERE decision_request_id IN (
      SELECT id FROM decision_requests
      WHERE status IN ('resolved', 'rejected', 'failed', 'expired')
    )
  `).run(now());

  const selectConversation = db.prepare(`
    SELECT * FROM external_conversations
    WHERE adapter_instance_id = ? AND tenant_key = ? AND chat_id = ?
  `);
  const insertConversation = db.prepare(`
    INSERT INTO external_conversations (
      id, adapter_instance_id, tenant_key, chat_id, paired_open_id,
      active_session_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(adapter_instance_id, tenant_key, chat_id) DO UPDATE SET
      paired_open_id = excluded.paired_open_id,
      updated_at = excluded.updated_at
  `);
  const selectConversationById = db.prepare('SELECT * FROM external_conversations WHERE id = ?');
  const listConversations = db.prepare('SELECT * FROM external_conversations ORDER BY updated_at DESC');
  const updateActiveSession = db.prepare(`
    UPDATE external_conversations SET active_session_id = ?, updated_at = ? WHERE id = ?
  `);
  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO external_events (
      adapter_instance_id, event_id, conversation_id, event_type, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'received', ?, ?)
  `);
  const selectEvent = db.prepare(`
    SELECT * FROM external_events WHERE adapter_instance_id = ? AND event_id = ?
  `);
  const updateEvent = db.prepare(`
    UPDATE external_events
    SET status = ?, session_id = COALESCE(?, session_id), turn_id = COALESCE(?, turn_id),
        error = ?, updated_at = ?
    WHERE adapter_instance_id = ? AND event_id = ?
  `);
  const insertTurn = db.prepare(`
    INSERT INTO session_turn_queue (
      id, session_id, conversation_id, source_channel, source_event_id,
      prompt, payload_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
  `);
  const selectTurn = db.prepare('SELECT * FROM session_turn_queue WHERE id = ?');
  const updateTurn = db.prepare(`
    UPDATE session_turn_queue
    SET status = ?, result_text = ?, error = ?, updated_at = ?
    WHERE id = ?
  `);
  const listQueuedTurns = db.prepare(`
    SELECT * FROM session_turn_queue WHERE status = 'queued' ORDER BY created_at ASC
  `);
  const listPendingTurnDeliveries = db.prepare(`
    SELECT * FROM session_turn_queue
    WHERE status IN ('completed', 'failed') AND delivered_at IS NULL
    ORDER BY updated_at ASC
  `);
  const markTurnDelivered = db.prepare(`
    UPDATE session_turn_queue SET delivered_at = ?, updated_at = ?
    WHERE id = ? AND status IN ('completed', 'failed')
  `);
  const insertNotificationDelivery = db.prepare(`
    INSERT INTO notification_deliveries (
      id, notification_id, conversation_id, status, attempts, created_at, updated_at
    ) VALUES (?, ?, ?, 'pending', 0, ?, ?)
    ON CONFLICT(notification_id, conversation_id) DO NOTHING
  `);
  const selectNotificationDelivery = db.prepare(`
    SELECT * FROM notification_deliveries WHERE notification_id = ? AND conversation_id = ?
  `);
  const selectNotificationDeliveryById = db.prepare('SELECT * FROM notification_deliveries WHERE id = ?');
  const listPendingNotificationDeliveries = db.prepare(`
    SELECT * FROM notification_deliveries
    WHERE status IN ('pending', 'failed')
    ORDER BY updated_at ASC
  `);
  const listNotificationDeliveries = db.prepare(`
    SELECT * FROM notification_deliveries WHERE notification_id = ? ORDER BY created_at ASC
  `);
  const updateNotificationDelivery = db.prepare(`
    UPDATE notification_deliveries
    SET status = ?, external_message_id = COALESCE(?, external_message_id),
        external_card_id = COALESCE(?, external_card_id), attempts = attempts + ?,
        last_error = ?, updated_at = ?
    WHERE id = ?
  `);
  const insertDecision = db.prepare(`
    INSERT INTO decision_requests (
      id, session_id, kind, status, mobile_title, mobile_summary,
      action_token_hash, notification_id, payload_json, expires_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectDecision = db.prepare('SELECT * FROM decision_requests WHERE id = ?');
  const findPendingDecision = db.prepare(`
    SELECT * FROM decision_requests
    WHERE session_id = ? AND kind = ? AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1
  `);
  const listPendingDecisionsForSession = db.prepare(`
    SELECT * FROM decision_requests
    WHERE session_id = ? AND status = 'pending'
    ORDER BY created_at ASC
  `);
  const listPendingDecisions = db.prepare(`
    SELECT * FROM decision_requests
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `);
  const listTerminalDecisions = db.prepare(`
    SELECT * FROM decision_requests
    WHERE status IN ('resolved', 'rejected', 'failed', 'expired')
    ORDER BY updated_at DESC LIMIT 200
  `);
  const claimDecision = db.prepare(`
    UPDATE decision_requests
    SET status = 'resolving', resolution_source = ?, updated_at = ?
    WHERE id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > ?)
  `);
  const settleDecision = db.prepare(`
    UPDATE decision_requests
    SET status = ?, resolution_source = ?, resolution_json = ?, error = ?, updated_at = ?
    WHERE id = ? AND status = 'resolving'
  `);
  const expireDecision = db.prepare(`
    UPDATE decision_requests SET status = 'expired', error = ?, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `);
  const cancelQueuedTurns = db.prepare(`
    UPDATE session_turn_queue
    SET status = 'cancelled', error = ?, updated_at = ?
    WHERE session_id = ? AND status = 'queued'
  `);

  function normalizeConversation(row) {
    if (!row) return null;
    return {
      id: row.id,
      adapterInstanceId: row.adapter_instance_id,
      tenantKey: row.tenant_key,
      chatId: row.chat_id,
      pairedOpenId: row.paired_open_id,
      activeSessionId: row.active_session_id || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function normalizeEvent(row) {
    if (!row) return null;
    return {
      adapterInstanceId: row.adapter_instance_id,
      eventId: row.event_id,
      conversationId: row.conversation_id || null,
      eventType: row.event_type,
      status: row.status,
      sessionId: row.session_id || null,
      turnId: row.turn_id || null,
      error: row.error || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function normalizeTurn(row) {
    if (!row) return null;
    return {
      id: row.id,
      sessionId: row.session_id,
      conversationId: row.conversation_id || null,
      sourceChannel: row.source_channel,
      sourceEventId: row.source_event_id || null,
      prompt: row.prompt,
      payload: parseJson(row.payload_json, {}),
      status: row.status,
      resultText: row.result_text || '',
      error: row.error || null,
      deliveredAt: row.delivered_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function normalizeNotificationDelivery(row) {
    if (!row) return null;
    return {
      id: row.id,
      notificationId: row.notification_id,
      conversationId: row.conversation_id,
      status: row.status,
      externalMessageId: row.external_message_id || null,
      externalCardId: row.external_card_id || null,
      attempts: Number(row.attempts) || 0,
      lastError: row.last_error || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function normalizeDecision(row) {
    if (!row) return null;
    return {
      id: row.id,
      sessionId: row.session_id,
      kind: row.kind,
      status: row.status,
      mobileTitle: row.mobile_title,
      mobileSummary: row.mobile_summary,
      actionTokenHash: row.action_token_hash,
      notificationId: row.notification_id || null,
      payload: parseJson(row.payload_json, {}),
      expiresAt: row.expires_at || null,
      resolutionSource: row.resolution_source || null,
      resolution: parseJson(row.resolution_json, null),
      error: row.error || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    getOrCreateConversation({ adapterInstanceId, tenantKey, chatId, pairedOpenId }) {
      const normalized = [adapterInstanceId, tenantKey, chatId, pairedOpenId].map(normalizeText);
      if (normalized.some((value) => !value)) throw new Error('External conversation identity is incomplete.');
      const timestamp = now();
      insertConversation.run(randomUUID(), ...normalized, timestamp, timestamp);
      return normalizeConversation(selectConversation.get(normalized[0], normalized[1], normalized[2]));
    },

    getConversation(id) {
      return normalizeConversation(selectConversationById.get(id));
    },

    findConversation({ adapterInstanceId, tenantKey, chatId }) {
      return normalizeConversation(selectConversation.get(
        normalizeText(adapterInstanceId),
        normalizeText(tenantKey),
        normalizeText(chatId),
      ));
    },

    listConversations() {
      return listConversations.all().map(normalizeConversation);
    },

    setActiveSession(conversationId, sessionId) {
      const result = updateActiveSession.run(normalizeText(sessionId) || null, now(), conversationId);
      if (result.changes !== 1) throw new Error('External conversation not found.');
      return normalizeConversation(selectConversationById.get(conversationId));
    },

    claimEvent({ adapterInstanceId, eventId, conversationId, eventType }) {
      const timestamp = now();
      const result = insertEvent.run(
        normalizeText(adapterInstanceId),
        normalizeText(eventId),
        conversationId || null,
        normalizeText(eventType) || 'unknown',
        timestamp,
        timestamp,
      );
      return {
        claimed: result.changes === 1,
        event: normalizeEvent(selectEvent.get(adapterInstanceId, eventId)),
      };
    },

    getEvent(adapterInstanceId, eventId) {
      return normalizeEvent(selectEvent.get(adapterInstanceId, eventId));
    },

    updateEvent(adapterInstanceId, eventId, { status, sessionId, turnId, error = null }) {
      updateEvent.run(status, sessionId || null, turnId || null, error, now(), adapterInstanceId, eventId);
      return normalizeEvent(selectEvent.get(adapterInstanceId, eventId));
    },

    enqueueTurn({ sessionId, conversationId, sourceChannel, sourceEventId, prompt, payload = {} }) {
      const id = randomUUID();
      const timestamp = now();
      insertTurn.run(
        id,
        sessionId,
        conversationId || null,
        sourceChannel,
        sourceEventId || null,
        prompt,
        JSON.stringify(payload),
        timestamp,
        timestamp,
      );
      return normalizeTurn(selectTurn.get(id));
    },

    getTurn(turnId) {
      return normalizeTurn(selectTurn.get(turnId));
    },

    updateTurn(turnId, { status, resultText = '', error = null }) {
      updateTurn.run(status, resultText || null, error, now(), turnId);
      return normalizeTurn(selectTurn.get(turnId));
    },

    listQueuedTurns() {
      return listQueuedTurns.all().map(normalizeTurn);
    },

    listPendingTurnDeliveries() {
      return listPendingTurnDeliveries.all().map(normalizeTurn);
    },

    markTurnDelivered(turnId) {
      const timestamp = now();
      markTurnDelivered.run(timestamp, timestamp, turnId);
      return normalizeTurn(selectTurn.get(turnId));
    },

    cancelQueuedTurns(sessionId, message = 'Turn cancelled by user.') {
      return cancelQueuedTurns.run(message, now(), sessionId).changes;
    },

    ensureNotificationDelivery(notificationId, conversationId) {
      const timestamp = now();
      insertNotificationDelivery.run(randomUUID(), notificationId, conversationId, timestamp, timestamp);
      return normalizeNotificationDelivery(selectNotificationDelivery.get(notificationId, conversationId));
    },

    getNotificationDelivery(id) {
      return normalizeNotificationDelivery(selectNotificationDeliveryById.get(id));
    },

    listPendingNotificationDeliveries() {
      return listPendingNotificationDeliveries.all().map(normalizeNotificationDelivery);
    },

    listNotificationDeliveries(notificationId) {
      return listNotificationDeliveries.all(notificationId).map(normalizeNotificationDelivery);
    },

    updateNotificationDelivery(id, {
      status,
      externalMessageId,
      externalCardId,
      incrementAttempts = false,
      error = null,
    }) {
      updateNotificationDelivery.run(
        status,
        externalMessageId || null,
        externalCardId || null,
        incrementAttempts ? 1 : 0,
        error,
        now(),
        id,
      );
      return normalizeNotificationDelivery(selectNotificationDeliveryById.get(id));
    },

    createDecision({
      id,
      sessionId,
      kind,
      mobileTitle,
      mobileSummary,
      actionTokenHash,
      notificationId,
      payload = {},
      expiresAt = null,
    }) {
      const timestamp = now();
      insertDecision.run(
        id, sessionId, kind, mobileTitle, mobileSummary, actionTokenHash,
        notificationId || null, JSON.stringify(payload), expiresAt, timestamp, timestamp,
      );
      return normalizeDecision(selectDecision.get(id));
    },

    getDecision(id) {
      return normalizeDecision(selectDecision.get(id));
    },

    findPendingDecision(sessionId, kind) {
      return normalizeDecision(findPendingDecision.get(sessionId, kind));
    },

    listPendingDecisionsForSession(sessionId) {
      return listPendingDecisionsForSession.all(sessionId).map(normalizeDecision);
    },

    listPendingDecisions() {
      return listPendingDecisions.all().map(normalizeDecision);
    },

    listTerminalDecisions() {
      return listTerminalDecisions.all().map(normalizeDecision);
    },

    claimDecision(id, source) {
      const timestamp = now();
      const result = claimDecision.run(source, timestamp, id, timestamp);
      return {
        claimed: result.changes === 1,
        decision: normalizeDecision(selectDecision.get(id)),
      };
    },

    settleDecision(id, { status, source, resolution = null, error = null }) {
      settleDecision.run(
        status,
        source,
        resolution === null ? null : JSON.stringify(resolution),
        error,
        now(),
        id,
      );
      return normalizeDecision(selectDecision.get(id));
    },

    expireDecision(id, message = 'Decision expired.') {
      expireDecision.run(message, now(), id);
      return normalizeDecision(selectDecision.get(id));
    },
  };
}
