import { getMcpPrefix } from '../services/mcp/mcpStringUtils.js'
import type { Tool } from '../Tool.js'

type NamedTool = Pick<Tool, 'name' | 'appInfo' | 'mcpInfo'>
function owner(tool: NamedTool) {
  if (tool.appInfo) return `App ${tool.appInfo.contributionId || `${tool.appInfo.appId}/${tool.name}`}`
  if (tool.mcpInfo) return `MCP ${tool.mcpInfo.serverName}/${tool.mcpInfo.toolName}`
  return `Core ${tool.name}`
}

/** Run after availability filtering and before name-based deduplication. */
export function assertUniqueAppToolNames(tools: readonly NamedTool[]) {
  const seen = new Map<string, NamedTool>()
  for (const tool of tools) {
    const appOwned = Boolean(tool.appInfo || tool.mcpInfo?.appId)
    if (appOwned && !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) throw new Error(`Invalid App tool name: ${tool.name}`)
    const previous = seen.get(tool.name)
    if (previous && (appOwned || previous.appInfo || previous.mcpInfo?.appId) && owner(previous) !== owner(tool)) {
      throw new Error(`工具名称冲突：${tool.name}（${owner(previous)}；${owner(tool)}）。请为工具使用不同名称，或取消选择其中一个 App。`)
    }
    seen.set(tool.name, tool)
  }
}


/** Saved allowlists can use old names without registering those names again. */
export function matchesToolSelector(tool: NamedTool & Pick<Tool, 'aliases'>, selectors: readonly string[]) {
  const names = [tool.name, ...(tool.aliases || [])]
  if (tool.appInfo) {
    const normalize = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, '_')
    const localId = tool.appInfo.contributionId?.split('/').at(-1) || tool.name
    names.push(`app__${normalize(tool.appInfo.appId)}__${normalize(localId)}`.slice(0, 64))
  }
  if (tool.mcpInfo?.appId) names.push(getMcpPrefix(tool.mcpInfo.serverName, tool.mcpInfo.appId) + tool.mcpInfo.toolName.replace(/[^a-zA-Z0-9_-]/g, '_'))
  return names.some(name => selectors.some(selector => selector === name || (selector.endsWith('*') && name.startsWith(selector.slice(0, -1)))))
}
