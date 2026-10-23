import { isTaskNotificationText, splitLegacyProjectMemory } from '../../../shared/message-context.mjs';

const MAX_INDEXED_MESSAGE_CHARS = 100_000;

function textFromContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function eventText(event) {
  if (!event || typeof event !== 'object') return '';
  if (event.type === 'user') {
    if (
      event.parent_tool_use_id != null
      || event.tool_use_result
      || event.toolUseResult
      || event.isCompactSummary === true
      || event.isMeta === true
      || event.isSynthetic === true
      || event.isVisibleInTranscriptOnly === true
      || (typeof event.origin?.kind === 'string' && event.origin.kind !== 'human')
    ) return '';
    const text = (typeof event.prompt === 'string'
      ? event.prompt
      : textFromContent(event.message?.content)).trim();
    if (text.startsWith('<local-command-caveat>') || text.startsWith('<command-name>')) return '';
    if (isTaskNotificationText(text)) return '';
    return splitLegacyProjectMemory(text)?.prompt ?? text;
  }
  if (event.type === 'assistant') {
    if (
      event.parent_tool_use_id != null
      || (event.isSidechain === true && typeof event.agentId === 'string')
    ) return '';
    return textFromContent(event.message?.content ?? event.content);
  }
  return '';
}

function stableTextHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function getSearchMessageId(event) {
  if (typeof event?.uuid === 'string' && event.uuid.trim()) return event.uuid.trim();
  if (typeof event?.id === 'string' && event.id.trim()) return `id:${event.id.trim()}`;
  const role = event?.type === 'assistant' ? 'assistant' : 'user';
  const timestamp = event?.timestamp instanceof Date
    ? event.timestamp.toISOString()
    : String(event?.timestamp ?? '');
  return `event:${role}:${stableTextHash(`${timestamp}\n${eventText(event)}`)}`;
}

export function extractSearchableSessionMessages(history) {
  const byMessage = new Map();
  for (const [eventIndex, event] of (Array.isArray(history) ? history : []).entries()) {
    if (event?.type !== 'user' && event?.type !== 'assistant') continue;
    const body = eventText(event);
    if (!body) continue;
    const role = event.type;
    const timestamp = Number.isFinite(event.timestamp)
      ? Number(event.timestamp)
      : Number.isFinite(Date.parse(event.timestamp)) ? Date.parse(event.timestamp) : eventIndex;
    const messageId = getSearchMessageId(event);
    const current = byMessage.get(`${role}:${messageId}`);
    if (!current || body.length >= current.body.length) {
      byMessage.set(`${role}:${messageId}`, {
        messageId,
        role,
        body: body.slice(0, MAX_INDEXED_MESSAGE_CHARS),
        timestamp,
      });
    }
  }
  return [...byMessage.values()];
}
