import { isDisplayTranscriptEntry } from './session-history-display.mjs';

const TERMINAL_STATUSES = new Set(['completed', 'failed']);

export function parseSubAgentTranscript(raw) {
  const history = [];
  let failed = false;
  let terminalStatus = null;
  for (const line of String(raw || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      // API errors can recover within a run, and SendMessage appends a new
      // prompt to the same transcript. Old terminal evidence is not permanent.
      const content = entry?.message?.content;
      const startsTurn = entry?.type === 'user' && !entry.isMeta && !entry.isSynthetic && (
        typeof content === 'string' || (Array.isArray(content) && content.some(block => block?.type === 'text') &&
          !content.some(block => block?.type === 'tool_result'))
      );
      if (startsTurn || entry?.type === 'assistant') {
        failed = false;
        terminalStatus = null;
      }
      if (isSubAgentFailureEntry(entry)) failed = true;
      if (entry?.type === 'result') {
        terminalStatus = entry?.subtype === 'success' ? 'completed' : 'failed';
      }
      const displayEntry = entry?.isSidechain ? { ...entry, isSidechain: false } : entry;
      if (isDisplayTranscriptEntry(displayEntry)) history.push(displayEntry);
    } catch {
      // The worker may still be appending a partial final line.
    }
  }
  return { history, failed, terminalStatus };
}

export function isSubAgentFailureEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.type === 'error' || entry.subtype === 'error' || entry.is_error === true) {
    return true;
  }
  return entry.isApiErrorMessage === true ||
    (typeof entry.apiError === 'string' && entry.apiError.trim().length > 0) ||
    (typeof entry.error === 'string' && entry.error.trim().length > 0);
}

export function isAgentTeamSidechain(metadata, history) {
  if (typeof metadata?.teamName === 'string' && metadata.teamName.trim()) {
    return true;
  }
  return Array.isArray(history) && history.some((entry) => {
    if (entry?.type !== 'user' || entry?.message?.role !== 'user') return false;
    const content = entry.message.content;
    return typeof content === 'string' &&
      content.includes('<teammate-message') &&
      content.includes('teammate_id="team-lead"');
  });
}

export function resolveSubAgentStatus({
  metadataStatus,
  transcriptStatus,
  transcriptFailed,
  parentBusy,
  runtimeStatus,
  runtimeAvailable = false,
}) {
  // A live task describes this run; disk metadata can still describe the
  // previous one while a continuation is starting or a stop is flushing.
  if (runtimeStatus === 'running') return 'running';
  if (runtimeStatus === 'killed') return 'failed';
  if (TERMINAL_STATUSES.has(runtimeStatus)) return runtimeStatus;
  if (TERMINAL_STATUSES.has(transcriptStatus)) return transcriptStatus;
  if (transcriptFailed) return 'failed';
  if (TERMINAL_STATUSES.has(metadataStatus)) return metadataStatus;
  if (metadataStatus === 'running') {
    return parentBusy && !runtimeAvailable ? 'running' : 'failed';
  }
  return parentBusy && !runtimeAvailable ? 'running' : 'completed';
}
