export type ToolUseContext = Record<string, unknown>
export type ToolPermissionContext = Record<string, unknown>
export type AnyObject = Record<string, unknown>
export type Progress = Record<string, unknown>
export type MossAppEvent = Record<string, unknown>
export type MossAppEventResult = Record<string, unknown>
export type SetToolJSXFn = (...args: unknown[]) => unknown
export type CanUseToolFn = (...args: unknown[]) => unknown
export type QueryChainTracking = Record<string, unknown>
export type ValidationResult = Record<string, unknown>
export type ToolUseConfirm = Record<string, unknown>

export interface Tool {
  name: string
  description?: string
}

export type Tools = Record<string, Tool>

export function findToolByName(_tools: Tools, _name: string): Tool | undefined {
  return undefined
}

export function toolMatchesName(_tool: Tool, _name: string): boolean {
  return false
}

export function getEmptyToolPermissionContext(): ToolPermissionContext {
  return {}
}

export class BashTool {}
export class ExitPlanModeV2Tool {}
export class FileEditTool {}
export class FileReadTool {}
export class FileWriteTool {}
export class GlobTool {}
export class GrepTool {}
export class ToolSearchTool {}
export class SyntheticOutputTool {}
export const SYNTHETIC_OUTPUT_TOOL_NAME = 'synthetic_output'

export type Input = Record<string, unknown>