function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractContentText(content) {
  if (typeof content === 'string') return normalizeText(content);
  if (!Array.isArray(content)) return '';
  return normalizeText(content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n'));
}

function getHistoryEventToken(event) {
  if (!event || typeof event !== 'object') return null;

  if (event.type === 'user') {
    if (event.isMeta || event.isVisibleInTranscriptOnly) return null;
    const content = event?.message?.content;
    if (Array.isArray(content) && content.some((block) => block?.type === 'tool_result')) {
      return null;
    }
    const text = normalizeText(event.prompt) || extractContentText(content);
    return text ? `user:${text}` : null;
  }

  const uuid = normalizeText(event.uuid || event.id);
  if (uuid) return `id:${uuid}`;

  if (event.type === 'assistant') {
    const text = extractContentText(event?.message?.content);
    return text ? `assistant:${text}` : null;
  }

  if (event.type === 'system' && event.subtype === 'local_command') {
    const text = normalizeText(event.content);
    return text ? `local-command:${text}` : null;
  }

  if (event.type === 'error') {
    const text = normalizeText(event.message);
    return text ? `error:${text}` : null;
  }

  if (event.type === 'bash_command') {
    return `bash:${normalizeText(event.command)}:${normalizeText(event.output)}`;
  }

  if (event.type === 'app_plan_state') {
    return `plan:${normalizeText(event.kind)}:${normalizeText(event.state)}:${normalizeText(event.plan)}`;
  }

  return null;
}

export function shouldAdoptSessionHistory(currentHistory, candidateHistory) {
  const current = Array.isArray(currentHistory) ? currentHistory : [];
  const candidate = Array.isArray(candidateHistory) ? candidateHistory : [];
  if (current.length === 0) return true;
  if (candidate.length === 0) return false;

  const requiredTokens = current.map(getHistoryEventToken).filter(Boolean);
  if (requiredTokens.length === 0) return false;

  const candidateTokens = candidate.map(getHistoryEventToken).filter(Boolean);
  let requiredIndex = 0;
  for (const token of candidateTokens) {
    if (token !== requiredTokens[requiredIndex]) continue;
    requiredIndex += 1;
    if (requiredIndex === requiredTokens.length) return true;
  }
  return false;
}

export function mergeInterruptedSessionHistory(currentHistory, candidateHistory) {
  const current = Array.isArray(currentHistory) ? currentHistory : [];
  const candidate = Array.isArray(candidateHistory) ? candidateHistory : [];

  if (shouldAdoptSessionHistory(current, candidate)) {
    return candidate;
  }

  const latestCurrentUserToken = current
    .map(getHistoryEventToken)
    .findLast(token => token?.startsWith('user:'));
  const candidateUserIndex = candidate.findIndex(event => (
    getHistoryEventToken(event) === latestCurrentUserToken
  ));

  if (!latestCurrentUserToken || candidateUserIndex < 0) {
    return current;
  }

  return [
    ...current,
    ...candidate.slice(0, candidateUserIndex),
    ...candidate.slice(candidateUserIndex + 1),
  ];
}
