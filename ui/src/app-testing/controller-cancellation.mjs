// Only a Host-requested stop may turn an SDK abort diagnostic into normal
// controller cleanup. Authentication, network and tool failures stay visible.
export function isExpectedControllerCancellation(value, signal) {
  if (!signal?.aborted) return false;
  if (value === signal.reason) return true;
  let texts;
  if (value?.type === 'result') {
    if (value.subtype !== 'error_during_execution') return false;
    texts = value.errors;
  } else if (value?.type === 'assistant' && value.isApiErrorMessage) {
    texts = (value.message?.content || []).filter(block => block.type === 'text').map(block => block.text);
  } else if (value instanceof Error) texts = [value.message];
  if (!Array.isArray(texts) || !texts.length || texts.some(text => typeof text !== 'string')) return false;
  const lines = texts.flatMap(text => text.split(/\r?\n/)).map(line => line.trim()).filter(Boolean);
  let hasAbort = false;
  for (const line of lines) {
    if (/^(?:(?:API Error|Error|AbortError|APIUserAbortError):\s*)?(?:Request was aborted\.?|Request interrupted by user\.?|(?:The|This) operation was aborted\.?)$/.test(line)) { hasAbort = true; continue; }
    if (/^\[ede_diagnostic\] result_type=\S+ last_content_type=\S+ stop_reason=\S+$/.test(line)) continue;
    if (/^at\s/.test(line)) continue;
    return false;
  }
  return hasAbort;
}
