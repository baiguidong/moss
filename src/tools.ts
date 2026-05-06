export const REPL_TOOL_NAME = 'REPL'

export const ALL_AGENT_DISALLOWED_TOOLS = new Set<string>()

export function getToolsForDefaultPreset(): unknown[] {
  return []
}

export function parseToolPreset(_preset: string): unknown {
  return null
}

export function getTools(): unknown[] {
  return []
}