import { randomUUID } from 'node:crypto';

const MAX_NOTIFICATIONS = 200;
const DEDUPE_WINDOW_MS = 10_000;

function sanitizeText(value, maxLength) {
  return String(value || '')
    .replace(/([?&](?:access_token|refresh_token|token|code|client_secret|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:token|access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password|authorization)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .slice(0, maxLength);
}

export function sanitizeMobileNotificationText(value, maxLength = 1_000) {
  return sanitizeText(value, maxLength)
    .replace(/\b[A-Za-z]:[\\/][^\s，。；、)）]+/g, '[LOCAL_PATH]')
    .replace(/(^|[\s（(：:])~?\/(?!\/)[^\s，。；、)）]+/g, '$1[LOCAL_PATH]');
}

function normalizeSeverity(value) {
  return value === 'error' || value === 'warning' ? value : 'info';
}

function normalizeDecisionOptions(value) {
  return (Array.isArray(value) ? value : [])
    .map((option) => ({
      id: sanitizeText(option?.id, 40).trim(),
      label: sanitizeText(option?.label, 80).trim(),
    }))
    .filter((option) => option.id && option.label)
    .slice(0, 3);
}

function parseDecisionOptions(value) {
  try {
    return normalizeDecisionOptions(JSON.parse(value || '[]'));
  } catch {
    return [];
  }
}

function toNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    severity: normalizeSeverity(row.severity),
    source: row.source,
    title: row.title,
    message: row.message,
    ...(row.desktop_details ? { details: row.desktop_details } : {}),
    createdAt: row.created_at,
    read: Boolean(row.read),
    occurrences: Math.max(1, Number(row.occurrences) || 1),
    ...(row.decision_request_id ? { decisionRequestId: row.decision_request_id } : {}),
    ...(row.decision_request_id
      ? { decisionOptions: parseDecisionOptions(row.decision_options_json) }
      : {}),
  };
}

export function createAppNotificationBroker(db, { onChanged = () => {}, onDeliver = () => {} } = {}) {
  const listStmt = db.prepare(`
    SELECT * FROM app_notifications ORDER BY updated_at DESC LIMIT ${MAX_NOTIFICATIONS}
  `);
  const getStmt = db.prepare('SELECT * FROM app_notifications WHERE id = ?');
  const listMobileStmt = db.prepare(`
    SELECT * FROM app_notifications
    WHERE mobile_policy = 'summary' AND mobile_title IS NOT NULL AND mobile_summary IS NOT NULL
    ORDER BY updated_at ASC
  `);
  const findDuplicateStmt = db.prepare(`
    SELECT * FROM app_notifications
    WHERE source = ? AND title = ? AND message = ? AND updated_at >= ?
    ORDER BY updated_at DESC LIMIT 1
  `);
  const insertStmt = db.prepare(`
    INSERT INTO app_notifications (
      id, severity, source, title, message, desktop_details,
      mobile_title, mobile_summary, mobile_policy, decision_request_id,
      decision_options_json, read, occurrences, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
  `);
  const updateDuplicateStmt = db.prepare(`
    UPDATE app_notifications
    SET severity = ?, desktop_details = COALESCE(?, desktop_details), read = 0,
        occurrences = occurrences + 1, updated_at = ?
    WHERE id = ?
  `);
  const markReadStmt = db.prepare('UPDATE app_notifications SET read = 1, updated_at = ? WHERE id = ?');
  const markAllReadStmt = db.prepare('UPDATE app_notifications SET read = 1, updated_at = ? WHERE read = 0');
  const removeStmt = db.prepare(`
    DELETE FROM app_notifications WHERE id = ? AND decision_request_id IS NULL
  `);
  const clearStmt = db.prepare(`
    DELETE FROM app_notifications WHERE decision_request_id IS NULL
  `);
  const resolveDecisionStmt = db.prepare(`
    UPDATE app_notifications
    SET decision_request_id = NULL, mobile_policy = 'disabled', read = 1, updated_at = ?
    WHERE decision_request_id = ?
  `);
  const trimStmt = db.prepare(`
    DELETE FROM app_notifications WHERE id NOT IN (
      SELECT id FROM app_notifications ORDER BY updated_at DESC LIMIT ${MAX_NOTIFICATIONS}
    )
  `);

  function list() {
    return listStmt.all().map(toNotification);
  }

  function emit(reason, notification = null) {
    onChanged({ reason, notification, notifications: list() });
  }

  function create(input = {}, options = {}) {
    const timestamp = Number(options.now) || Date.now();
    const requestedId = typeof options.id === 'string' && options.id.trim() ? options.id.trim() : '';
    if (requestedId) {
      const existing = toNotification(getStmt.get(requestedId));
      if (existing) return existing;
    }
    const severity = normalizeSeverity(input.severity);
    const source = sanitizeText(input.source, 120).trim() || 'Moss';
    const title = sanitizeText(input.title, 240).trim() || '应用消息';
    const message = sanitizeText(input.message, 4_000).trim() || '未提供消息内容';
    const details = sanitizeText(input.details, 16_000).trim();
    const mobileTitle = sanitizeMobileNotificationText(input.mobileTitle, 160).trim();
    const mobileSummary = sanitizeMobileNotificationText(input.mobileSummary, 1_000).trim();
    const mobilePolicy = input.mobilePolicy === 'summary' ? 'summary' : 'disabled';
    const decisionRequestId = sanitizeText(input.decisionRequestId, 120).trim();
    const decisionOptions = normalizeDecisionOptions(input.decisionOptions);
    const duplicate = findDuplicateStmt.get(source, title, message, timestamp - DEDUPE_WINDOW_MS);
    let notification;
    if (duplicate && !requestedId) {
      updateDuplicateStmt.run(severity, details || null, timestamp, duplicate.id);
      notification = toNotification(getStmt.get(duplicate.id));
    } else {
      const id = requestedId || randomUUID();
      insertStmt.run(
        id, severity, source, title, message, details || null,
        mobileTitle || null, mobileSummary || null, mobilePolicy,
        decisionRequestId || null, JSON.stringify(decisionOptions), timestamp, timestamp,
      );
      trimStmt.run();
      notification = toNotification(getStmt.get(id));
    }
    emit('created', notification);
    if (mobilePolicy === 'summary' && mobileTitle && mobileSummary) {
      onDeliver({
        notificationId: notification.id,
        title: mobileTitle,
        summary: mobileSummary,
        decisionRequestId: decisionRequestId || null,
      });
    }
    return notification;
  }

  return {
    list,
    get(id) {
      return toNotification(getStmt.get(id));
    },
    getMobilePayload(id) {
      const row = getStmt.get(id);
      if (!row || row.mobile_policy !== 'summary' || !row.mobile_title || !row.mobile_summary) return null;
      return {
        notificationId: row.id,
        title: sanitizeMobileNotificationText(row.mobile_title, 160),
        summary: sanitizeMobileNotificationText(row.mobile_summary, 1_000),
        decisionRequestId: row.decision_request_id || null,
      };
    },
    listMobilePayloads() {
      return listMobileStmt.all().map((row) => ({
        notificationId: row.id,
        title: sanitizeMobileNotificationText(row.mobile_title, 160),
        summary: sanitizeMobileNotificationText(row.mobile_summary, 1_000),
        decisionRequestId: row.decision_request_id || null,
      }));
    },
    create,
    importLegacy(items) {
      for (const item of Array.isArray(items) ? items.slice(0, MAX_NOTIFICATIONS) : []) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string') continue;
        create({
          severity: item.severity,
          source: item.source,
          title: item.title,
          message: item.message,
          details: item.details,
          mobilePolicy: 'disabled',
        }, { id: item.id, now: item.createdAt });
        if (item.read) markReadStmt.run(Date.now(), item.id);
      }
      emit('imported');
      return list();
    },
    markRead(id) {
      markReadStmt.run(Date.now(), id);
      emit('read', toNotification(getStmt.get(id)));
      return list();
    },
    markAllRead() {
      markAllReadStmt.run(Date.now());
      emit('read-all');
      return list();
    },
    remove(id) {
      removeStmt.run(id);
      emit('removed');
      return list();
    },
    clear() {
      clearStmt.run();
      emit('cleared');
      return [];
    },
    resolveDecision(decisionRequestId) {
      resolveDecisionStmt.run(Date.now(), decisionRequestId);
      emit('decision-resolved');
      return list();
    },
  };
}
