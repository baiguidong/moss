import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isSessionMemoryEnabled } from '../../services/SessionMemory/config.js'
import {
  MAX_SESSION_SUMMARY_CHARS,
  saveSessionSummary,
} from '../../services/SessionMemory/sessionMemory.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { SAVE_SESSION_SUMMARY_TOOL_NAME } from './constants.js'
import { SAVE_SESSION_SUMMARY_PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    summary: z.string().min(1).max(MAX_SESSION_SUMMARY_CHARS)
      .refine(value => value.trim().length > 0, 'Summary must not be blank.')
      .describe('Concise current session summary, replacing any previous summary.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Output = { saved: true }

export const SaveSessionSummaryTool = buildTool({
  name: SAVE_SESSION_SUMMARY_TOOL_NAME,
  searchHint: 'save optional notes about current session progress',
  maxResultSizeChars: 100,
  async description() {
    return 'Save the current session summary'
  },
  async prompt() {
    return SAVE_SESSION_SUMMARY_PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  isEnabled() {
    return isSessionMemoryEnabled()
  },
  // A write to session-owned storage. Keep it serialized with other tool calls.
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  renderToolUseMessage() {
    return null
  },
  async call(input, context) {
    if (context.agentId) {
      throw new Error('Only the main conversation can save its session summary.')
    }
    const { summary } = inputSchema().parse(input)
    await saveSessionSummary(summary, context.abortController.signal)
    return { data: { saved: true as const } }
  },
  mapToolResultToToolResultBlockParam(_content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: 'Session summary saved.',
    }
  },
} satisfies ToolDef<InputSchema, Output>)
