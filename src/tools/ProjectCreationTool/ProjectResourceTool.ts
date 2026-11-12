import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'

const inputSchema = z.strictObject({
  action: z.enum(['list_installed', 'search', 'inspect']),
  kind: z.enum(['skill', 'expert', 'app']),
  query: z.string().trim().max(200).optional(),
  id: z.string().trim().max(300).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(10).default(6),
})

export type ProjectResourceInput = z.infer<typeof inputSchema>
export type ProjectResourceProvider = (input: ProjectResourceInput) => Promise<unknown>

/**
 * Host backed discovery for the dedicated project creation conversation.
 * Keeping discovery separate from ProjectPlan lets the model compare
 * candidates and ask the user before installing or associating anything.
 */
export function createProjectResourceTool(provider: ProjectResourceProvider) {
  return buildTool({
    name: 'ProjectResource',
    requiresInteractiveMainSession: true,
    inputSchema,
    maxResultSizeChars: 50000,
    async description() {
      return 'List, search, or inspect skills, experts, and Apps for the project being designed.'
    },
    async prompt() {
      return [
        'Use only in the dedicated project-creation conversation.',
        'This tool is optional. Do not call it merely to inspect what is installed; call it only when the user asks to choose or add a skill, expert, or App.',
        'When several candidates match, show their names and descriptions and ask the user to choose.',
        'Inspect exact IDs and App services before proposing a plan. Installation happens only after the host UI confirmation.',
        'Use the returned IDs in ProjectPlan and never invent resource IDs.',
      ].join(' ')
    },
    userFacingName() { return '查找项目资源' },
    isReadOnly() { return true },
    isConcurrencySafe() { return true },
    async checkPermissions() { return { behavior: 'allow' as const } },
    async validateInput(input) {
      if (input.action === 'inspect' && !input.id) {
        return { result: false as const, message: '查看资源时必须提供资源 ID。', errorCode: 1 }
      }
      if (input.action === 'search' && !input.query) {
        return { result: false as const, message: '搜索资源时必须提供关键词。', errorCode: 1 }
      }
      return { result: true as const }
    },
    renderToolUseMessage() { return null },
    async call(input) {
      return { data: JSON.stringify(await provider(input)) }
    },
    mapToolResultToToolResultBlockParam(data, toolUseID) {
      return { type: 'tool_result' as const, tool_use_id: toolUseID, content: data }
    },
  } satisfies ToolDef<typeof inputSchema, string>)
}
