export function normalizeSessionKind(value) {
  if (value === 'cron') return 'cron';
  if (value === 'agent-mail') return 'agent-mail';
  return 'chat';
}

export function normalizeOriginChannel(value, sessionKind) {
  if (value === 'agent-mail' || sessionKind === 'agent-mail') return 'agent-mail';
  if (value === 'cron' || sessionKind === 'cron') return 'cron';
  if (typeof value === 'string' && /^(?:app:)?[a-z0-9][a-z0-9._-]{0,79}$/.test(value)) return value;
  return 'desktop';
}

export function normalizeToolDisplayMode(value, legacyAutoCollapse = null) {
  if (value === 'expanded' || value === 'collapsed' || value === 'merged') return value;
  if (typeof legacyAutoCollapse === 'boolean') {
    return legacyAutoCollapse ? 'collapsed' : 'expanded';
  }
  return null;
}
