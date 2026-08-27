const TERMINAL_STATUSES = new Set(['completed', 'failed']);

export function isSubAgentFailureEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.type === 'error' || entry.subtype === 'error' || entry.is_error === true) {
    return true;
  }
  return entry.isApiErrorMessage === true ||
    (typeof entry.apiError === 'string' && entry.apiError.trim().length > 0) ||
    (typeof entry.error === 'string' && entry.error.trim().length > 0);
}

export function resolveSubAgentStatus({
  metadataStatus,
  transcriptStatus,
  transcriptFailed,
  parentBusy,
  runtimeActive,
}) {
  if (TERMINAL_STATUSES.has(transcriptStatus)) return transcriptStatus;
  if (transcriptFailed) return 'failed';
  if (TERMINAL_STATUSES.has(metadataStatus)) return metadataStatus;
  if (metadataStatus === 'running') {
    return parentBusy || runtimeActive ? 'running' : 'failed';
  }
  return parentBusy || runtimeActive ? 'running' : 'completed';
}
