import { isTopLevelUserMessage } from './turn-changes.mjs';
import { isDisplayTranscriptEntry } from './session-history-display.mjs';

// Correlation uses host/runtime IDs only. Prompt text, file names and tool
// arguments cannot identify a turn (especially after retries or a rewind).
export function indexHistoryTurns(history) {
  const turns = new Map(), toolOwners = new Map(), messageOwners = new Map();
  const addOwner = (map, id, owner) => {
    if (typeof id !== 'string' || !id) return;
    const owners = map.get(id) || new Set(); owners.add(owner); map.set(id, owners);
  };
  let current = null;
  for (const event of history || []) {
    if (event?.type === 'system' && event.subtype === 'compact_boundary') current = null;
    if (!isDisplayTranscriptEntry(event) || event.parent_tool_use_id) continue;
    if (isTopLevelUserMessage(event)) {
      current = typeof event.uuid === 'string' && event.uuid ? event.uuid : null;
      if (current && !turns.has(current)) turns.set(current, { userMessageId: current, hasTools: false });
    } else if (current && event.type === 'assistant') {
      addOwner(messageOwners, event.uuid, current);
      for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
        if (block?.type !== 'tool_use' || !block.id) continue;
        turns.get(current).hasTools = true;
        addOwner(toolOwners, block.id, current);
      }
    }
  }
  return { turns, toolOwners, messageOwners };
}

export function resolveObservationUser(record, index, bindings = []) {
  const known = new Set([record.userMessageId, ...(record.userMessageAliases || [])].filter(id => index.turns.has(id)));
  if (known.size) return known.size === 1 ? [...known][0] : null;
  const owners = new Set();
  const toolIds = new Set([...(record.toolUseIds || []), ...bindings.filter(binding => binding.turnId === record.id).map(binding => binding.sourceToolUseId)]);
  for (const id of toolIds) for (const owner of index.toolOwners.get(id) || []) owners.add(owner);
  for (const id of record.assistantMessageIds || []) for (const owner of index.messageOwners.get(id) || []) owners.add(owner);
  return owners.size === 1 ? [...owners][0] : null;
}
