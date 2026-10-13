import { isToolSourceAvailable, isToolSourceSelected, type ToolSource } from '../../packages/app-sdk/src/tool-services.mjs'
import type { Tool } from '../Tool.js'

export type AppToolPolicy = {
  appIds: string[]
  appServiceIds?: string[]
  mcpServers: Record<string, ToolSource>
}

/** Project cached tools into this session; never mutate shared MCP objects. */
export function applyAppToolPolicy<T extends Pick<Tool, 'appInfo' | 'isMcp' | 'mcpInfo'>>(tools: readonly T[], policy: AppToolPolicy): T[] {
  return tools.flatMap(tool => {
    const owner = tool.isMcp
      ? policy.mcpServers[tool.mcpInfo?.serverName || '']
      : tool.appInfo
    if (!owner) return [tool]
    if (!isToolSourceAvailable(owner, policy.appIds, policy.appServiceIds)) return []
    return [{ ...tool, alwaysLoad: isToolSourceSelected(owner, policy.appIds, policy.appServiceIds), deferLoading: true }]
  })
}
