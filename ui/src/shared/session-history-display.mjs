function extractDisplayTextFromTranscriptEntry(entry) {
  const content = entry?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
  }
  if (typeof entry?.content === 'string') {
    return entry.content;
  }
  if (typeof entry?.prompt === 'string') {
    return entry.prompt;
  }
  return '';
}

export function isDisplayTranscriptEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.isSidechain) return false;
  if (entry.type === 'user') {
    if (entry.isMeta || entry.isSynthetic || entry.isVisibleInTranscriptOnly) return false;
    const text = extractDisplayTextFromTranscriptEntry(entry).trim();
    if (text.startsWith('<local-command-caveat>')) return false;
    if (text.startsWith('<command-name>')) return false;
    return true;
  }
  if (entry.type === 'assistant') return true;
  if (entry.type === 'system') {
    return entry.subtype === 'compact_boundary'
      || entry.subtype === 'local_command'
      || entry.subtype === 'connector_auth'
      || entry.subtype === 'app_task';
  }
  if (entry.type === 'tool_progress' || entry.type === 'tool_use_summary') return true;
  return false;
}

function isVisibleUserTextEntry(entry) {
  if (!entry || entry.type !== 'user') return false;
  if (entry.isMeta || entry.isSynthetic || entry.isVisibleInTranscriptOnly) return false;
  const text = extractDisplayTextFromTranscriptEntry(entry).trim();
  if (!text) return false;
  if (text.startsWith('<local-command-caveat>')) return false;
  if (text.startsWith('<command-name>')) return false;
  return true;
}

function hasAssistantTextEntry(entry) {
  if (!entry || entry.type !== 'assistant') return false;
  return extractTextFromAssistantMessage(entry).trim().length > 0;
}

export function historyCompletenessScore(history) {
  if (!Array.isArray(history)) return 0;
  return history.reduce((score, entry) => {
    if (isVisibleUserTextEntry(entry)) return score + 1;
    if (hasAssistantTextEntry(entry)) return score + 1;
    return score;
  }, 0);
}

export function normalizePreviewText(value, maxLength = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function extractTextFromAssistantMessage(message) {
  if (!Array.isArray(message?.message?.content)) return '';
  return message.message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function extractPreviewFromAssistantMessage(message) {
  const text = extractTextFromAssistantMessage(message);
  if (text) return normalizePreviewText(text);
  return '';
}

function extractPreviewFromStreamEvent(message) {
  const event = message?.event;
  if (!event || typeof event !== 'object') return '';

  if (
    event.type === 'content_block_delta' &&
    event.delta?.type === 'text_delta' &&
    typeof event.delta.text === 'string'
  ) {
    return normalizePreviewText(event.delta.text);
  }

  return '';
}

export function deriveSessionPreview(history) {
  if (!Array.isArray(history) || history.length === 0) return '';

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!entry || typeof entry !== 'object') continue;

    if (entry.type === 'assistant') {
      const preview = extractPreviewFromAssistantMessage(entry);
      if (preview) return preview;
      continue;
    }

    if (entry.type === 'stream_event') {
      const preview = extractPreviewFromStreamEvent(entry);
      if (preview) return preview;
      continue;
    }

    if (entry.type === 'user' && typeof entry.prompt === 'string') {
      const preview = normalizePreviewText(entry.prompt);
      if (preview) return preview;
      continue;
    }

    if (entry.type === 'error' && typeof entry.message === 'string') {
      const preview = normalizePreviewText(entry.message);
      if (preview) return preview;
    }

    if (entry.type === 'system' && ['connector_auth', 'app_task'].includes(entry.subtype) && typeof entry.content === 'string') {
      const preview = normalizePreviewText(entry.content);
      if (preview) return preview;
    }
  }

  return '';
}

export function derivePendingPlanApproval(history) {
  if (!Array.isArray(history)) return null;

  let pending = null;
  for (const entry of history) {
    if (!entry || entry.type !== 'app_plan_state' || entry.kind !== 'plan') continue;

    if (entry.state === 'awaiting_approval') {
      pending = {
        kind: 'plan',
        originalPrompt: typeof entry.originalPrompt === 'string' ? entry.originalPrompt : '',
        plan: typeof entry.plan === 'string' ? entry.plan : '',
        requestedAt: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
      };
      continue;
    }

    if (entry.state === 'approved' || entry.state === 'rejected') {
      pending = null;
    }
  }

  return pending;
}
