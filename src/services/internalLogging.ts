import type { ToolPermissionContext } from '../Tool.js'

export const getContainerId = async (): Promise<string | null> => null

export async function logPermissionContextForAnts(
  _toolPermissionContext: ToolPermissionContext | null,
  _moment: 'summary' | 'initialization',
): Promise<void> {}
