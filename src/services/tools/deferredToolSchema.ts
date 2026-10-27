import type { Tool } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import {
  extractDiscoveredToolNames,
  isToolSearchToolAvailable,
} from '../../utils/toolSearch.js'
import { isDeferredTool, TOOL_SEARCH_TOOL_NAME } from '../../tools/ToolSearchTool/prompt.js'

export const DEFERRED_TOOL_SCHEMA_ERROR = 'DeferredToolSchemaNotLoadedError'

export type DeferredToolPlaceholder = {
  type: 'deferred_tool_placeholder'
  name: string
  description: string
  schemaLoaded: false
}

export function createDeferredToolPlaceholder(
  tool: Pick<Tool, 'name'> & { description?: string },
): DeferredToolPlaceholder {
  return {
    type: 'deferred_tool_placeholder',
    name: tool.name,
    description: tool.description ?? 'Schema is loaded by ToolSearch before invocation.',
    schemaLoaded: false,
  }
}

export function isDeferredToolSchemaLoaded(
  tool: Pick<Tool, 'name'> & { deferLoading?: boolean; isMcp?: boolean; alwaysLoad?: boolean },
  messages: readonly Message[],
): boolean {
  if (tool.name === TOOL_SEARCH_TOOL_NAME || !isDeferredTool(tool as Tool)) return true
  return extractDiscoveredToolNames([...messages]).has(tool.name)
}

export function getDeferredToolSchemaHint(
  tool: Pick<Tool, 'name'> & { deferLoading?: boolean; isMcp?: boolean; alwaysLoad?: boolean },
  messages: readonly Message[],
  tools: readonly { name: string }[],
): string | null {
  if (isDeferredToolSchemaLoaded(tool, messages)) return null
  const searchAvailable = isToolSearchToolAvailable(tools)
  if (!searchAvailable) {
    return `\n\n${DEFERRED_TOOL_SCHEMA_ERROR}: the schema for "${tool.name}" is not loaded and ToolSearch is unavailable. The host must load the tool schema before retrying.`
  }
  return `\n\n${DEFERRED_TOOL_SCHEMA_ERROR}: the schema for "${tool.name}" was not loaded. Call ${TOOL_SEARCH_TOOL_NAME} with query "select:${tool.name}", wait for the next model turn, then retry.`
}
