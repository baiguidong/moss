import { randomUUID } from 'crypto'
import { z } from 'zod/v4'
import {
  buildTool,
  getGlobalAppEventBridge,
  type MossAppEvent,
  type MossAppEventResult,
  type ToolDef,
  type ToolUseContext,
} from '../../Tool.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import type { PermissionUpdate } from '../../types/permissions.js'
import { getRuleByContentsForTool } from '../../utils/permissions/permissions.js'

const inputSchema = z.strictObject({
  action: z.enum(['search_recipients', 'list_outbox', 'send', 'reply']),
  query: z.string().optional().describe('Name, email, or exact user ID to search for.'),
  to_user_id: z.string().optional().describe('Authenticated Moss Server user ID returned by search_recipients. Required for send.'),
  subject: z.string().max(200).optional(),
  content: z.string().max(65_536).optional().describe('Plain text or Markdown message body.'),
  reply_to: z.string().optional().describe('Agent Mail message ID. Required for reply.'),
  limit: z.number().int().min(1).max(100).optional().describe('Maximum outbox messages to return. Defaults to 20.'),
})

type Input = z.infer<typeof inputSchema>

const outputSchema = z.object({
  ok: z.boolean(),
  recipients: z.array(z.unknown()).optional(),
  messages: z.array(z.unknown()).optional(),
  mail: z.unknown().optional(),
  duplicate: z.boolean().optional(),
  error: z.string().optional(),
})

type Output = z.infer<typeof outputSchema>

function permissionRuleContent(input: Input): string {
  return input.action === 'send'
    ? `recipient:${input.to_user_id || ''}`
    : `reply:${input.reply_to || ''}`
}

function permissionSuggestions(input: Input): PermissionUpdate[] | undefined {
  if (input.action !== 'send' || !input.to_user_id) return undefined
  return [{
    type: 'addRules',
    destination: 'userSettings',
    rules: [{ toolName: 'MossMail', ruleContent: permissionRuleContent(input) }],
    behavior: 'allow',
  }]
}

export const MossMailTool = buildTool({
  name: 'MossMail',
  requiresDesktop: true,
  searchHint: 'search Moss Server users and send authenticated Agent Mail',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Send and reply to authenticated internal Agent Mail through the connected Moss Server. Also searches recipients in the current organization.'
  },
  async prompt() {
    return `Use MossMail only for user-to-agent or agent-to-agent messages routed by Moss Server.

- Use search_recipients before send unless you already have an exact to_user_id from a previous MossMail result.
- Use list_outbox to inspect delivery and execution status for messages sent by the current authenticated user. It never reads inbox content.
- send requires to_user_id and content. subject is optional.
- reply requires reply_to and content. The server derives and verifies the recipient and thread; do not supply to_user_id.
- Recipient identity and sender identity come from Moss Server authentication. Never ask for or include credentials.
- Sending and replying are external side effects and require permission confirmation.
- A successful send means the server durably queued the message, not that the receiving agent completed it.`
  },
  get inputSchema() {
    return inputSchema
  },
  get outputSchema() {
    return outputSchema
  },
  userFacingName() {
    return 'Moss Mail'
  },
  isConcurrencySafe(input: Input) {
    return input.action === 'search_recipients' || input.action === 'list_outbox'
  },
  isReadOnly(input: Input) {
    return input.action === 'search_recipients' || input.action === 'list_outbox'
  },
  isDestructive(input: Input) {
    return input.action !== 'search_recipients'
  },
  async validateInput(input: Input) {
    if (input.action === 'search_recipients' || input.action === 'list_outbox') return { result: true as const }
    if (!input.content?.trim()) {
      return { result: false as const, message: 'content is required for Agent Mail.', errorCode: 9 }
    }
    if (input.action === 'send' && !input.to_user_id?.trim()) {
      return { result: false as const, message: 'to_user_id is required for send.', errorCode: 9 }
    }
    if (input.action === 'reply' && !input.reply_to?.trim()) {
      return { result: false as const, message: 'reply_to is required for reply.', errorCode: 9 }
    }
    return { result: true as const }
  },
  async checkPermissions(input: Input, context: ToolUseContext) {
    if (input.action === 'search_recipients' || input.action === 'list_outbox') {
      return { behavior: 'allow' as const, updatedInput: input }
    }
    const permissionContext = context.getAppState().toolPermissionContext
    const ruleContent = permissionRuleContent(input)
    const denyRule = getRuleByContentsForTool(permissionContext, MossMailTool, 'deny').get(ruleContent)
    if (denyRule) {
      return {
        behavior: 'deny' as const,
        message: `MossMail is denied for ${ruleContent}.`,
        decisionReason: { type: 'rule' as const, rule: denyRule },
      }
    }
    const askRule = getRuleByContentsForTool(permissionContext, MossMailTool, 'ask').get(ruleContent)
    if (askRule) {
      return {
        behavior: 'ask' as const,
        message: `Send Agent Mail to ${ruleContent}?`,
        decisionReason: { type: 'rule' as const, rule: askRule },
        suggestions: permissionSuggestions(input),
      }
    }
    const allowRule = getRuleByContentsForTool(permissionContext, MossMailTool, 'allow').get(ruleContent)
    if (allowRule) {
      return {
        behavior: 'allow' as const,
        updatedInput: input,
        decisionReason: { type: 'rule' as const, rule: allowRule },
      }
    }
    const target = input.action === 'reply'
      ? `message ${input.reply_to || ''}`
      : `Moss Server user ${input.to_user_id || ''}`
    return {
      behavior: 'ask' as const,
      message: `Send Agent Mail to ${target}?`,
      suggestions: permissionSuggestions(input),
    }
  },
  async call(input: Input, context: ToolUseContext): Promise<{ data: Output }> {
    const emitAppEvent = context.emitAppEvent ?? getGlobalAppEventBridge()
    if (!emitAppEvent) {
      return { data: { ok: false, error: 'MossMail is unavailable because its desktop/server bridge is not connected.' } }
    }

    let event: MossAppEvent
    if (input.action === 'search_recipients') {
      event = {
        type: 'agent_mail_search',
        input: { query: input.query?.trim() || '' },
      }
    } else if (input.action === 'list_outbox') {
      event = {
        type: 'agent_mail_list_outbox',
        input: { limit: input.limit ?? 20 },
      }
    } else {
      event = {
        type: 'agent_mail_send',
        input: {
          to_user_id: input.action === 'send' ? input.to_user_id?.trim() : undefined,
          subject: input.subject?.trim(),
          content: input.content?.trim() || '',
          reply_to: input.action === 'reply' ? input.reply_to?.trim() : undefined,
          client_message_id: `tool:${context.toolUseId || randomUUID()}`,
        },
      }
    }

    const result: MossAppEventResult = await emitAppEvent(event)
    return result.ok
      ? {
          data: {
            ok: true,
            recipients: result.recipients,
            messages: result.messages,
            mail: result.mail,
            duplicate: result.duplicate,
          },
        }
      : { data: { ok: false, error: result.error } }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID: string) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: jsonStringify(content),
    }
  },
} satisfies ToolDef<typeof inputSchema, Output>)
