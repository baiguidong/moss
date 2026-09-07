function normalizeStartedAt(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function beginSessionBusyTiming(sessionRecord, now = Date.now()) {
  if (!sessionRecord || typeof sessionRecord !== 'object') return null;
  const existing = normalizeStartedAt(sessionRecord.busyStartedAt);
  if (existing !== null) return existing;
  const startedAt = normalizeStartedAt(now) ?? Date.now();
  sessionRecord.busyStartedAt = startedAt;
  return startedAt;
}

export function clearSessionBusyTiming(sessionRecord) {
  if (!sessionRecord || typeof sessionRecord !== 'object') return;
  sessionRecord.busyStartedAt = null;
}

export function getSessionBusyStartedAt(sessionRecord, busy) {
  if (!busy) return null;
  return normalizeStartedAt(sessionRecord?.busyStartedAt);
}
