export type ForcedDesktopToolPermissionMetadata = {
  readOnly: boolean
}

export type ForcedDesktopToolPermissionCallback = (
  tool: string,
  input: unknown,
  metadata: ForcedDesktopToolPermissionMetadata,
) => boolean | Promise<boolean>

export async function shouldForceDesktopToolPermission(
  callback: ForcedDesktopToolPermissionCallback | undefined,
  tool: string,
  input: unknown,
  metadata: ForcedDesktopToolPermissionMetadata,
): Promise<boolean> {
  if (!callback) return false
  return Boolean(await callback(tool, input, metadata))
}
