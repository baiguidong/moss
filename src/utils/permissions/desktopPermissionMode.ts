export type DesktopPermissionMode = 'allow-all' | 'default'

export function shouldBypassDesktopToolPermission(
  permissionMode: DesktopPermissionMode,
  requiresUserInteraction: boolean,
): boolean {
  return permissionMode === 'allow-all' && !requiresUserInteraction
}
