import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { PROJECT_ICON_NAMES, PROJECT_ICON_COLOR_IDS, normalizeProjectIcon } from '../../../shared/project-icon.mjs'

export type ProjectCreationInput = z.infer<typeof inputSchema>
export type ProjectCreationProvider = (
  input: ProjectCreationInput,
) => Promise<unknown>

const inputSchema = z.strictObject({
  action: z.enum(['get', 'preview']),
  version: z.number().int().positive().optional().describe('Current draft version returned by get; required when revising a draft.'),
  name: z.string().trim().min(1).max(80).optional(),
  icon: z.strictObject({
    kind: z.enum(['builtin', 'generated']),
    name: z.enum(PROJECT_ICON_NAMES).optional().describe('Required for builtin icons.'),
    color: z.enum(PROJECT_ICON_COLOR_IDS).default('green'),
    paths: z.array(z.string().trim().min(1).max(1200)).min(1).max(8).optional()
      .describe('Required for generated icons: SVG path d strings only, in a 24x24 viewBox, inset 2px. Rendered with no fill and a 1.8px rounded stroke. Use simple recognizable shapes; no markup or URLs.'),
  }).superRefine((icon, ctx) => {
    try { normalizeProjectIcon(icon, { strict: true }) }
    catch { ctx.addIssue({ code: 'custom', message: '图标无效：请选择内置图标，或提供有效的 SVG path 数据。' }) }
  }).optional().describe('Design an icon matching the project goal. It is previewed for user confirmation with the plan.'),
  instructions: z.string().max(20000).default(''),
  workspace: z.string().trim().optional(),
  workspaces: z.array(z.string().trim()).max(8).optional(),
  skillIds: z.array(z.string().trim()).max(50).default([]),
  expertIds: z.array(z.string().trim()).max(10).default([]),
  appIds: z.array(z.string().trim()).max(50).default([]),
  appServiceIds: z.array(z.string().trim()).max(100).default([]),
  assistantName: z.string().trim().optional(),
  mode: z.enum(['chat', 'boss']).default('boss'),
  permissionMode: z.enum(['plan', 'acceptEdits', 'default', 'dontAsk', 'bypassPermissions']).default('default'),
  agentTeamsEnabled: z.boolean().default(true),
  firstTask: z.string().max(12000).optional(),
})

export function createProjectCreationTool(provider: ProjectCreationProvider) {
  return buildTool({
    name: 'ProjectPlan',
    requiresInteractiveMainSession: true,
    inputSchema,
    maxResultSizeChars: 50000,
    async description() {
      return 'Read or preview an editable Moss project plan. Only the host UI confirmation installs resources and creates the project.'
    },
    async prompt() {
      return [
        'Use this only in the dedicated project-creation conversation.',
        'First collect the project goal, constraints, working directory and requested resources.',
        'Automatically design a simple custom vector icon using icon.kind=generated, paths and color. Include it in preview for user confirmation. Use builtin when requested; missing icons receive the default folder.',
        'Read the current draft with get before revising it, then submit the full plan with its current version.',
        'Keep the current icon when revising other fields. Redesign it only when the user asks.',
        'Call preview when ready to show an editable confirmation card. Do not ask for a separate chat confirmation.',
        'This tool never installs resources or creates projects. Only the host UI confirmation can do that.',
        'Use exact IDs returned by ProjectResource. Missing selected resources will be installed after confirmation.',
      ].join(' ')
    },
    userFacingName() { return '项目创建方案' },
    isReadOnly() { return false },
    isConcurrencySafe() { return false },
    async checkPermissions() { return { behavior: 'allow' as const } },
    async validateInput(input) {
      if (input.action === 'preview' && !input.name) return { result: false as const, message: '预览项目方案时必须提供名称。', errorCode: 1 }
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
