import { isToolSourceAvailable, isToolSourceSelected, type ToolSource } from '../../packages/app-sdk/src/tool-services.mjs'
import type { Tool } from '../Tool.js'

export type AppToolPolicy = {
  appIds: string[]
  /** An App-owned assistant admits only this App's native tools and Core tools. */
  isolatedAppId?: string
  appServiceIds?: string[]
  mcpServers: Record<string, ToolSource & { mcpIdleTimeoutMs?: number; appDisplayName?: string }>
}

/** Project cached tools into this session; never mutate shared MCP objects. */
export function applyAppToolPolicy<T extends Pick<Tool, 'appInfo' | 'isMcp' | 'mcpInfo'>>(tools: readonly T[], policy: AppToolPolicy): T[] {
  return tools.flatMap(tool => {
    if (policy.isolatedAppId && (tool.isMcp || (tool.appInfo && tool.appInfo.appId !== policy.isolatedAppId))) return []
    const owner = tool.isMcp
      ? policy.mcpServers[tool.mcpInfo?.serverName || '']
      : tool.appInfo
    if (!owner) return [tool]
    if (!isToolSourceAvailable(owner, policy.appIds, policy.appServiceIds)) return []
    return [{ ...tool, alwaysLoad: owner.toolLoading === 'always' || isToolSourceSelected(owner, policy.appIds, policy.appServiceIds), deferLoading: true }]
  })
}
