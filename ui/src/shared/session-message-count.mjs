const IGNORED_TEXT_OUTPUTS = new Set([
  'No response requested.',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

export function isIgnoredTextOutput(value) {
  return IGNORED_TEXT_OUTPUTS.has(normalizeText(value));
}

function extractLocalCommandOutput(value) {
  const text = normalizeText(value);
  const match = text.match(/^<local-command-(stdout|stderr)>\s*([\s\S]*?)\s*<\/local-command-\1>$/);
  return normalizeText(match ? match[2] : '');
}

function hasAgentTextOutput(event) {
  if (event?.type !== 'assistant') return false;

  const content = event?.message?.content;
  if (typeof content === 'string') {
    const text = normalizeText(content);
    return text.length > 0 && !isIgnoredTextOutput(text);
  }

  if (!Array.isArray(content)) return false;
  return content.some((block) => (
    block?.type === 'text' &&
    typeof block.text === 'string' &&
    normalizeText(block.text).length > 0 &&
    !isIgnoredTextOutput(block.text)
  ));
}

function hasLocalCommandTextOutput(event) {
  if (event?.type === 'system' && event.subtype === 'local_command') {
    return extractLocalCommandOutput(event.content).length > 0;
  }

  if (event?.type !== 'user') return false;
  const content = event?.message?.content;
  if (typeof content === 'string') {
    return extractLocalCommandOutput(content).length > 0;
  }
  if (!Array.isArray(content)) return false;
  return content.some((block) => (
    block?.type === 'text' &&
    typeof block.text === 'string' &&
    extractLocalCommandOutput(block.text).length > 0
  ));
}

export function countSessionMessages(history) {
  if (!Array.isArray(history)) return 0;
  return history.reduce(
    (count, event) => count + (hasAgentTextOutput(event) || hasLocalCommandTextOutput(event) ? 1 : 0),
    0,
  );
}
