import type { McpConfig } from './index.mjs'

export type McpRoots = NonNullable<McpConfig['roots']>
export function expandMcpHomePath(value: string, homeDir?: string): string
export function normalizeMcpRoots(value: unknown): McpRoots
export function resolveMcpDirectories(value: unknown, workspace?: string): Promise<string[]>
export function prepareMcpDirectoryLaunch(config: Pick<McpConfig, 'args' | 'roots'>, workspace?: string): Promise<{
  args: string[]
  roots: Array<{ uri: string }>
} | null>
