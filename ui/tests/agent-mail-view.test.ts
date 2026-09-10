import { describe, expect, test } from 'bun:test'
import type { AgentMailMessage } from '../src/renderer-react/types'
import { groupAgentMailByDate } from '../src/renderer-react/components/agent-mail-view'

function message(messageId: string, createdAt: number): AgentMailMessage {
  return {
    messageId,
    orgId: 'org-1',
    fromUserId: 'alice',
    fromName: 'Alice',
    toUserId: 'bob',
    toName: 'Bob',
    subject: messageId,
    content: 'content',
    threadId: messageId,
    replyTo: null,
    hopCount: 0,
    status: 'completed',
    deliveryMode: 'auto',
    attempts: 1,
    error: null,
    createdAt,
    expiresAt: createdAt + 86_400_000,
    acceptedAt: createdAt,
    completedAt: createdAt,
  }
}

describe('collaborative mailbox date groups', () => {
  test('keeps server order and labels today and yesterday', () => {
    const now = new Date(2026, 8, 9, 12).getTime()
    const groups = groupAgentMailByDate([
      message('today-new', new Date(2026, 8, 9, 11).getTime()),
      message('today-old', new Date(2026, 8, 9, 9).getTime()),
      message('yesterday', new Date(2026, 8, 8, 18).getTime()),
      message('older', new Date(2026, 7, 31, 12).getTime()),
    ], now)

    expect(groups.map((group) => [
      group.label,
      group.messages.map((entry) => entry.messageId),
    ])).toEqual([
      ['今天', ['today-new', 'today-old']],
      ['昨天', ['yesterday']],
      ['8月31日', ['older']],
    ])
  })
})
