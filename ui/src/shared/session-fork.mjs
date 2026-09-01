const OMITTED_ENTRY_TYPES = new Set([
  'attribution-snapshot',
  'file-history-snapshot',
  'queue-operation',
  'worktree-state',
]);

function isTranscriptMessage(entry) {
  return (
    entry?.type === 'user' ||
    entry?.type === 'assistant' ||
    entry?.type === 'attachment' ||
    entry?.type === 'system'
  );
}

export function getUniqueForkTitle(baseTitle, existingTitles) {
  const normalizedBase = typeof baseTitle === 'string' && baseTitle.trim()
    ? baseTitle.trim()
    : 'New Session';
  const titles = new Set(existingTitles);
  const first = `${normalizedBase} (Fork)`;
  if (!titles.has(first)) return first;

  let index = 2;
  while (titles.has(`${normalizedBase} (Fork ${index})`)) index += 1;
  return `${normalizedBase} (Fork ${index})`;
}

export function cloneSessionTranscriptJsonl(raw, {
  sourceSessionId,
  targetSessionId,
  title,
}) {
  const entries = [];
  let messageCount = 0;

  for (const line of String(raw || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    if (entry.isSidechain || OMITTED_ENTRY_TYPES.has(entry.type)) continue;
    if (entry.type === 'content-replacement' && entry.agentId) continue;
    if (entry.type === 'custom-title' || entry.type === 'ai-title') continue;

    const next = structuredClone(entry);
    if (typeof next.sessionId === 'string') {
      next.sessionId = targetSessionId;
    }
    if (isTranscriptMessage(next)) {
      messageCount += 1;
      delete next.slug;
      next.forkedFrom = {
        sessionId: sourceSessionId,
        messageUuid: next.uuid,
      };
    }
    entries.push(next);
  }

  if (messageCount === 0) {
    throw new Error('No conversation to fork.');
  }

  entries.push({
    type: 'custom-title',
    sessionId: targetSessionId,
    customTitle: title,
  });
  return `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`;
}
