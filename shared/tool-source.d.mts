export type ToolSource = {
  kind: 'app' | 'mcp' | 'builtin'
  appId?: string
  appName?: string
  serverName?: string
  contributionId?: string
}
export function normalizeToolSource(value: unknown): ToolSource | undefined
export function toolSourceMetadata(message: unknown): { tool_sources?: Record<string, ToolSource> }
export function toolSourceLabel(value: unknown): string
