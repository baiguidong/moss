import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'

const inputSchema = z.strictObject({
  action: z.enum(['read', 'list', 'search', 'note']),
  sourceId: z.string().optional().describe('A session ID returned by list/search; omit to read the project overview and pending corrections.'),
  kind: z.enum(['fact', 'agreement']).optional().describe('For note: facts are retrieved on demand. Agreements are explicit standing user instructions for future project turns.'),
  agreementId: z.string().optional().describe('For note with kind=agreement: use an existing ID from read to replace or revoke it. Omit for a new agreement.'),
  revoke: z.boolean().optional().describe('Withdraw the specified agreement.'),
  query: z.string().optional(),
  text: z.string().max(12000).optional().describe('Explicit user request to remember, correct, or forget project knowledge.'),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).optional(),
})
export type ProjectMemoryInput = z.infer<typeof inputSchema>
export type ProjectMemoryProvider = (input: ProjectMemoryInput) => Promise<unknown>

export function createProjectMemoryTool(provider: ProjectMemoryProvider) {
  return buildTool({
    name: 'ProjectMemory',
    requiresInteractiveMainSession: true,
    searchHint: 'read search project memory and record user corrections',
    maxResultSizeChars: 100_000,
    inputSchema,
    async description() { return 'Retrieve this project’s persistent knowledge and its session sources, or append an explicit user correction.' },
    async prompt() {
      return 'Use note(kind=agreement) when the user establishes a continuing project rule, e.g. “以后给甲方的报价都含税”. Keep its exact scope. Read active agreements and reuse the agreementId when changing a rule, or set revoke=true to cancel it. A one-off exception applies to this task only. Use note(kind=fact) for an explicit historical memory such as “上次给甲方报过12万”. Read without a sourceId returns active agreements, overview and pending corrections. list/search return source IDs.'
    },
    userFacingName() { return '项目记忆' },
    isReadOnly(input) { return input.action !== 'note' },
    isConcurrencySafe(input) { return input.action !== 'note' },
    async validateInput(input) {
      if ((input.revoke || input.agreementId || input.kind) && input.action !== 'note') return { result: false as const, message: 'Agreement changes require action=note.', errorCode: 1 }
      if ((input.revoke || input.agreementId) && input.kind !== 'agreement') return { result: false as const, message: 'Specify kind=agreement.', errorCode: 1 }
      if (input.revoke && !input.agreementId) return { result: false as const, message: 'Specify the agreementId to revoke.', errorCode: 1 }
      if (input.action === 'note' && !input.revoke && !input.text?.trim()) return { result: false as const, message: 'text is required.', errorCode: 1 }
      return { result: true as const }
    },
    async checkPermissions(input) {
      return input.action === 'note'
        ? { behavior: 'ask' as const, message: '保存这条项目记忆修正？' }
        : { behavior: 'allow' as const, updatedInput: input }
    },
    renderToolUseMessage() { return null },
    async call(input, context) {
      if (context.agentId) throw new Error('Project memory belongs to the main conversation')
      return { data: JSON.stringify(await provider(input)) }
    },
    mapToolResultToToolResultBlockParam(data, toolUseID) {
      return { type: 'tool_result' as const, tool_use_id: toolUseID, content: data }
    },
  } satisfies ToolDef<typeof inputSchema, string>)
}


const resultSchema = z.strictObject({
  action: z.enum(['list', 'register']),
  path: z.string().optional().describe('A file inside the current session workspace.'),
  name: z.string().max(256).optional(),
  description: z.string().max(2000).optional(),
})
export type ProjectResultProvider = (input: z.infer<typeof resultSchema>) => Promise<unknown>
export function createProjectResultTool(provider: ProjectResultProvider) {
  return buildTool({
    name: 'ProjectResult', inputSchema: resultSchema, maxResultSizeChars: 50000,
    requiresInteractiveMainSession: true,
    searchHint: 'list project deliverables register a completed output file',
    async description() { return 'List project results or register a deliverable from this session, retaining the original file.' },
    async prompt() { return 'list returns registered project files. register takes the path of an existing workspace file and records it with its source session.' },
    userFacingName() { return '项目成果' },
    isReadOnly(input) { return input.action === 'list' },
    isConcurrencySafe(input) { return input.action === 'list' },
    async validateInput(input) {
      return input.action === 'register' && !input.path?.trim()
        ? { result: false as const, message: 'path is required.', errorCode: 1 }
        : { result: true as const }
    },
    async checkPermissions(input) {
      return input.action === 'list' ? { behavior: 'allow' as const, updatedInput: input }
        : { behavior: 'ask' as const, message: '将此文件登记为项目成果？' }
    },
    renderToolUseMessage() { return null },
    async call(input, context) {
      if (context.agentId) throw new Error('Project result registration belongs to the main conversation')
      return { data: JSON.stringify(await provider(input)) }
    },
    mapToolResultToToolResultBlockParam(data, toolUseID) {
      return { type: 'tool_result' as const, tool_use_id: toolUseID, content: data }
    },
  } satisfies ToolDef<typeof resultSchema, string>)
}
