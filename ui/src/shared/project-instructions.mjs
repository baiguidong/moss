/** Repair model output only. User-authored code/escapes must remain literal. */
export function normalizeGeneratedProjectInstructions(value) {
  let text = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
  if (!text.includes('\n') && /\\n(?:\\n|\s*(?:#{1,6} |[-*] |\d+\. ))/.test(text)) {
    text = text.replace(/\\r\\n|\\n/g, '\n');
  }
  const fenced = text.match(/^```(?:markdown|md)\s*\n([\s\S]*?)\n```$/i);
  return fenced ? fenced[1].trim() : text;
}

export const DEFAULT_PROJECT_PERMISSION_MODE = 'bypassPermissions';
