import { findToolByName, type Tool, type Tools } from '../Tool.js'
import type { ToolSource } from '../../shared/tool-source.mjs'
import { getSessionRuntimeContext } from './sessionIdContext.js'

export function getToolSource(tool: Tool): ToolSource {
  if (tool.appInfo) return {
    kind: 'app', appId: tool.appInfo.appId, appName: tool.appInfo.appDisplayName,
    contributionId: tool.appInfo.contributionId,
  }
  if (tool.mcpInfo) return {
    kind: 'mcp', appId: tool.mcpInfo.appId,
    appName: tool.mcpInfo.appDisplayName || getSessionRuntimeContext()?.appToolPolicy?.mcpServers[tool.mcpInfo.serverName]?.appDisplayName,
    serverName: tool.mcpInfo.serverName,
  }
  return { kind: 'builtin' }
}

/** Attach before persistence; never put ownership inside API content blocks. */
export function attachToolSources(message: any, tools: Tools): void {
  if (message.type !== 'assistant' && message.type !== 'stream_event') return
  const blocks = message.type === 'assistant' ? message.message?.content
    : message.event?.type === 'content_block_start' ? [message.event.content_block] : []
  if (!Array.isArray(blocks)) return
  const sources: Record<string, ToolSource> = {}
  for (const block of blocks) {
    if (block?.type !== 'tool_use' || typeof block.id !== 'string') continue
    const tool = findToolByName(tools, block.name)
    if (tool) sources[block.id] = getToolSource(tool)
  }
  if (Object.keys(sources).length) message.tool_sources = sources
}
