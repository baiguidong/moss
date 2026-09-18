export const PERMISSION_MODES = Object.freeze([
  'plan',
  'acceptEdits',
  'default',
  'dontAsk',
  'bypassPermissions',
]);

export function isPermissionMode(value) {
  return typeof value === 'string' && PERMISSION_MODES.includes(value);
}

export function normalizePermissionMode(value, fallback = 'default') {
  return isPermissionMode(value)
    ? value
    : isPermissionMode(fallback) ? fallback : 'default';
}

export function permissionModeFromLegacyBypass(value) {
  return value === true ? 'bypassPermissions' : 'default';
}
