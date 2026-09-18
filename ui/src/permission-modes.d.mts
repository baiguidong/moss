export type PermissionMode =
  | 'plan'
  | 'acceptEdits'
  | 'default'
  | 'dontAsk'
  | 'bypassPermissions';

export const PERMISSION_MODES: readonly PermissionMode[];
export function isPermissionMode(value: unknown): value is PermissionMode;
export function normalizePermissionMode(
  value: unknown,
  fallback?: PermissionMode,
): PermissionMode;
export function permissionModeFromLegacyBypass(value: unknown): PermissionMode;
