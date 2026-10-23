function sameScope(left, right) {
  return (left?.parent_tool_use_id ?? null) === (right?.parent_tool_use_id ?? null)
    && Boolean(left?.isSidechain) === Boolean(right?.isSidechain);
}

export function appendSessionRuntimeEvent(history, event) {
  const current = Array.isArray(history) ? history : [];
  if (event?.type !== 'stream_event' || event.event?.type !== 'message_delta' || !event.event.usage) {
    return [...current, event];
  }
  let responseId;
  for (let index = current.length - 1; index >= 0; index -= 1) {
    const prior = current[index];
    if (!sameScope(prior, event)) continue;
    if (prior?.type === 'system' && prior.subtype === 'compact_boundary') break;
    if (prior?.type === 'stream_event' && prior.event?.type === 'message_start') {
      responseId = prior.event.message?.id;
      break;
    }
    if (!responseId && prior?.type === 'assistant' && prior.message?.id
      && prior.message.model !== '<synthetic>' && !prior.isApiErrorMessage) {
      responseId = prior.message.id;
    }
  }
  if (!responseId) return [...current, event];
  const usage = event.event.usage;
  const stopReason = event.event.delta?.stop_reason;
  return [...current.map(prior => {
    if (prior?.type !== 'assistant' || prior.message?.id !== responseId || !sameScope(prior, event)) {
      return prior;
    }
    return { ...prior, message: { ...prior.message, usage: { ...usage },
      stop_reason: stopReason ?? prior.message.stop_reason ?? null } };
  }), event];
}
