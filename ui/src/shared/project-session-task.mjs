const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled']);

export function deriveProjectSessionTaskStatus({
  persistedStatus,
  pendingDecisionCount = 0,
  busy = false,
  activeWorkerCount = 0,
  messageCount = 0,
} = {}) {
  if (TERMINAL_STATUSES.has(persistedStatus)) return persistedStatus;
  if (Number(pendingDecisionCount) > 0) return 'waiting_for_user';
  if (busy || Number(activeWorkerCount) > 0) return 'in_progress';
  if (persistedStatus === 'in_progress' || persistedStatus === 'waiting_for_user') {
    return persistedStatus;
  }
  return Number(messageCount) > 0 ? 'in_progress' : 'queued';
}

export function shouldRecoverInterruptedProjectTask({
  status,
  stateUpdatedAt = 0,
  sessionUpdatedAt = 0,
  recoveryCutoff = Date.now(),
} = {}) {
  if (!['queued', 'in_progress', 'waiting_for_user'].includes(status)) return false;
  return Math.max(Number(stateUpdatedAt) || 0, Number(sessionUpdatedAt) || 0) <= recoveryCutoff;
}

export function shouldCancelProjectTaskOnArchive({
  status,
  busy = false,
  activeWorkerCount = 0,
} = {}) {
  return ['queued', 'in_progress', 'waiting_for_user'].includes(status) ||
    busy || Number(activeWorkerCount) > 0;
}
