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

/** Call at a turn boundary; resource and execution defaults remain session-local. */
export function refreshProjectSessionInstructions(project, session) {
  if (!project || session.isSubAgent || !session.projectDefaults) return false;
  const instructions = project.instructions || '';
  if (session.projectDefaults.instructions === instructions) return false;
  session.projectDefaults = { ...session.projectDefaults, instructions };
  if (session.projectResourceManifest) session.projectResourceManifest = { ...session.projectResourceManifest, instructions };
  return true;
}
