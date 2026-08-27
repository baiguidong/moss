import type { Tool, Tools } from '../Tool.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '../tools/AskUserQuestionTool/prompt.js'
import { FILE_READ_TOOL_NAME } from '../tools/FileReadTool/prompt.js'
import { GLOB_TOOL_NAME } from '../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../tools/GrepTool/prompt.js'
import { LIST_MCP_RESOURCES_TOOL_NAME } from '../tools/ListMcpResourcesTool/prompt.js'
import { LSP_TOOL_NAME } from '../tools/LSPTool/prompt.js'
import { READ_MCP_RESOURCE_TOOL_NAME } from '../tools/ReadMcpResourceTool/prompt.js'
import { TOOL_SEARCH_TOOL_NAME } from '../tools/ToolSearchTool/constants.js'
import { WEB_FETCH_TOOL_NAME } from '../tools/WebFetchTool/prompt.js'
import { WEB_SEARCH_TOOL_NAME } from '../tools/WebSearchTool/prompt.js'

export type EmbeddedToolMode = 'all' | 'ask-only' | 'goal-readonly'

const GOAL_READ_ONLY_BUILTIN_TOOLS = new Set([
  ASK_USER_QUESTION_TOOL_NAME,
  FILE_READ_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  LIST_MCP_RESOURCES_TOOL_NAME,
  LSP_TOOL_NAME,
  READ_MCP_RESOURCE_TOOL_NAME,
  TOOL_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
])

export function isToolAllowedInMode(
  tool: Tool,
  mode: EmbeddedToolMode,
  input: Record<string, unknown> = {},
): boolean {
  if (mode === 'all') return true
  if (mode === 'ask-only') return tool.name === ASK_USER_QUESTION_TOOL_NAME

  const isAllowedBuiltin = GOAL_READ_ONLY_BUILTIN_TOOLS.has(tool.name)
  const isReadOnlyMcpTool = tool.isMcp === true
  if (!isAllowedBuiltin && !isReadOnlyMcpTool) return false

  return tool.isReadOnly(input) && !tool.isDestructive?.(input)
}

export function filterToolsForMode(tools: Tools, mode: EmbeddedToolMode): Tools {
  return tools.filter(tool => isToolAllowedInMode(tool, mode))
}
