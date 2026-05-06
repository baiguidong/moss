export function isMcpTool(): boolean {
  return false
}

export type MCPResultType = Record<string, unknown>

export function prefetchAllMcpResources(): Promise<void> {
  return Promise.resolve()
}

export function callIdeRpc(): Promise<unknown> {
  return Promise.resolve(null)
}