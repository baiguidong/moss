import { describe, expect, test } from 'bun:test'
import type { MossAppEvent, ToolUseContext } from '../../Tool.js'
import { MossMailTool } from './MossMailTool.js'

function contextWith(
  handler: (event: MossAppEvent) => Promise<{ ok: true; [key: string]: unknown }>,
  alwaysAllowRules: Record<string, string[]> = {},
): ToolUseContext {
  return {
    toolUseId: 'call-123',
    emitAppEvent: handler,
    getAppState: () => ({
      toolPermissionContext: {
        alwaysAllowRules,
        alwaysAskRules: {},
        alwaysDenyRules: {},
      },
    }),
  } as unknown as ToolUseContext
}

describe('MossMailTool', () => {
  test('search is read-only and forwards only the query', async () => {
    let emitted: MossAppEvent | null = null
    const result = await MossMailTool.call(
      { action: 'search_recipients', query: 'Alice' },
      contextWith(async event => {
        emitted = event
        return { ok: true, recipients: [{ userId: 'alice' }] }
      }),
    )

    expect(MossMailTool.isReadOnly({ action: 'search_recipients' })).toBe(true)
    expect(emitted).toEqual({ type: 'agent_mail_search', input: { query: 'Alice' } })
    expect(result.data.recipients).toEqual([{ userId: 'alice' }])
  })

  test('lists only the authenticated sender outbox as a read-only action', async () => {
    let emitted: MossAppEvent | null = null
    const result = await MossMailTool.call(
      { action: 'list_outbox', limit: 5 },
      contextWith(async event => {
        emitted = event
        return { ok: true, messages: [{ messageId: 'mail-1', status: 'completed' }] }
      }),
    )
    expect(MossMailTool.isReadOnly({ action: 'list_outbox' })).toBe(true)
    expect(emitted).toEqual({ type: 'agent_mail_list_outbox', input: { limit: 5 } })
    expect(result.data.messages).toEqual([{ messageId: 'mail-1', status: 'completed' }])
  })

  test('send requires permission and creates a host-owned idempotency key', async () => {
    let emitted: MossAppEvent | null = null
    const input = {
      action: 'send' as const,
      to_user_id: 'bob',
      subject: 'Build',
      content: 'Please inspect it.',
    }

    const context = contextWith(async event => {
      emitted = event
      return { ok: true, mail: { messageId: 'mail-1' }, duplicate: false }
    })
    const permission = await MossMailTool.checkPermissions(input, context)
    expect(permission.behavior).toBe('ask')
    expect(permission.suggestions).toMatchObject([{
      behavior: 'allow',
      destination: 'userSettings',
      rules: [{ toolName: 'MossMail', ruleContent: 'recipient:bob' }],
    }])
    const result = await MossMailTool.call(input, context)

    expect(emitted).toEqual({
      type: 'agent_mail_send',
      input: {
        to_user_id: 'bob',
        subject: 'Build',
        content: 'Please inspect it.',
        reply_to: undefined,
        client_message_id: 'tool:call-123',
      },
    })
    expect(result.data).toEqual({ ok: true, mail: { messageId: 'mail-1' }, duplicate: false })
  })

  test('reply omits a model-supplied recipient', async () => {
    let emitted: MossAppEvent | null = null
    await MossMailTool.call(
      { action: 'reply', reply_to: 'mail-1', to_user_id: 'mallory', content: 'Done.' },
      contextWith(async event => {
        emitted = event
        return { ok: true }
      }),
    )
    expect(emitted?.type).toBe('agent_mail_send')
    if (emitted?.type === 'agent_mail_send') {
      expect(emitted.input.to_user_id).toBeUndefined()
      expect(emitted.input.reply_to).toBe('mail-1')
    }
  })

  test('honors a remembered recipient-specific permission without allowing other recipients', async () => {
    const context = contextWith(async () => ({ ok: true }), {
      userSettings: ['MossMail(recipient:bob)'],
    })
    expect((await MossMailTool.checkPermissions({
      action: 'send', to_user_id: 'bob', content: 'Allowed',
    }, context)).behavior).toBe('allow')
    expect((await MossMailTool.checkPermissions({
      action: 'send', to_user_id: 'alice', content: 'Ask again',
    }, context)).behavior).toBe('ask')
  })
})
