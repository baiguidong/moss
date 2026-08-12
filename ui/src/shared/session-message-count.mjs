function hasAgentTextOutput(event) {
  if (event?.type !== 'assistant') return false;

  const content = event?.message?.content;
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }

  if (!Array.isArray(content)) return false;
  return content.some((block) => (
    block?.type === 'text' &&
    typeof block.text === 'string' &&
    block.text.trim().length > 0
  ));
}

export function countSessionMessages(history) {
  if (!Array.isArray(history)) return 0;
  return history.reduce(
    (count, event) => count + (hasAgentTextOutput(event) ? 1 : 0),
    0,
  );
}
