import { describe, expect, test } from 'bun:test'
import {
  AgentMailApiError,
  searchAgentMailRecipients,
  sendAgentMail,
} from '../src/agent-mail-client.mjs'

describe('Agent Mail API client', () => {
  test('keeps the bearer token in the host request and serializes send fields', async () => {
    let request: { url: string; init: RequestInit } | null = null
    const fetchImpl = async (url: string, init: RequestInit) => {
      request = { url, init }
      return new Response(JSON.stringify({ message: { messageId: 'mail-1' }, duplicate: false }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    }
    const result = await sendAgentMail({ serverUrl: 'https://moss.test/', authToken: 'host-secret' }, {
      toUserId: 'bob',
      subject: 'Build',
      content: 'Inspect it.',
      clientMessageId: 'tool:123',
    }, { fetchImpl })

    expect(request?.url).toBe('https://moss.test/api/v1/agent-mail/messages')
    expect((request?.init.headers as Record<string, string>).authorization).toBe('Bearer host-secret')
    expect(JSON.parse(String(request?.init.body))).toEqual({
      to_user_id: 'bob',
      subject: 'Build',
      content: 'Inspect it.',
      client_message_id: 'tool:123',
    })
    expect(result.message.messageId).toBe('mail-1')
  })

  test('encodes recipient search and returns structured API failures', async () => {
    let url = ''
    await searchAgentMailRecipients({ serverUrl: 'https://moss.test', authToken: 'token' }, 'Alice & Bob', {
      fetchImpl: async (nextUrl: string) => {
        url = nextUrl
        return new Response(JSON.stringify({ recipients: [] }), { status: 200 })
      },
    })
    expect(url).toContain('query=Alice+%26+Bob')

    await expect(sendAgentMail({ serverUrl: 'https://moss.test', authToken: 'token' }, {
      toUserId: 'bob', content: 'x', clientMessageId: 'id',
    }, {
      fetchImpl: async () => new Response(JSON.stringify({
        code: 'AGENT_MAIL_SENDER_BLOCKED',
        error: 'blocked',
      }), { status: 403 }),
    })).rejects.toMatchObject<Partial<AgentMailApiError>>({
      statusCode: 403,
      code: 'AGENT_MAIL_SENDER_BLOCKED',
      message: 'blocked',
    })
  })
})
