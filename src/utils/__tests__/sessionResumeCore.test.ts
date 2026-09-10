import { describe, expect, it, mock } from 'bun:test'
import type { Message } from '../../types/message.js'

// The vendored color-diff-napi stub has no named exports, which breaks the
// transitive import chain from messages.ts under bun test.
mock.module('color-diff-napi', () => ({
  ColorDiff: {},
  ColorFile: {},
  getSyntaxTheme: () => ({}),
}))

const {
  sanitizeMessagesAfterApiFailure,
  sanitizeMessagesForResume,
} = await import('../sessionResumeSanitizer.js')

describe('sanitizeMessagesForResume', () => {
  it('drops resume-unsafe Moss image preview payloads and synthetic API errors', () => {
    const mossImageResult = {
      ok: true,
      fileKind: 'image',
      filePath: '/tmp/generated.png',
      previewUrl: 'moss-image:///tmp/generated.png',
      previewMarkdown: '![generated image](moss-image:///tmp/generated.png)',
      mediaType: 'image/png',
    }
    const toolResultContent = JSON.stringify(mossImageResult)
    const toolResultMessage = {
      type: 'user',
      uuid: 'user-123',
      timestamp: '2026-07-24T00:00:00.000Z',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_123',
            content: toolResultContent,
          },
        ],
      },
      toolUseResult: mossImageResult,
    } as Message
    const apiErrorMessage = {
      type: 'assistant',
      uuid: 'assistant-123',
      timestamp: '2026-07-24T00:00:01.000Z',
      isApiErrorMessage: true,
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: "Cannot read properties of undefined (reading 'content')",
          },
        ],
      },
    } as Message

    const result = sanitizeMessagesForResume([
      toolResultMessage,
      apiErrorMessage,
    ])
    const messages = result.messages

    expect(result.removedApiError).toBe(true)
    expect(messages).toHaveLength(2)
    const [message] = messages
    expect(message?.type).toBe('user')
    expect((message as { toolUseResult?: unknown }).toolUseResult).toBeUndefined()
    expect((message as typeof toolResultMessage).message.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_123',
        content: toolResultContent,
      },
    ])
    expect(messages[1]?.type).toBe('assistant')
    expect((messages[1] as { message: { content: unknown } }).message.content).toEqual([
      { type: 'text', text: 'No response requested.' },
    ])
  })

  it('drops signed thinking state after an API failure while preserving visible progress', () => {
    const thinkingMessage = {
      type: 'assistant',
      uuid: 'assistant-thinking',
      timestamp: '2026-09-10T00:00:00.000Z',
      message: {
        id: 'message-1',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '', signature: 'opaque-provider-state' }],
      },
    } as Message
    const progressMessage = {
      type: 'assistant',
      uuid: 'assistant-progress',
      timestamp: '2026-09-10T00:00:01.000Z',
      message: {
        id: 'message-1',
        role: 'assistant',
        content: [{ type: 'text', text: '已清点根目录。' }],
      },
    } as Message
    const userMessage = {
      type: 'user',
      uuid: 'user-continue',
      timestamp: '2026-09-10T00:00:02.000Z',
      message: { role: 'user', content: '继续' },
    } as Message
    const timeoutMessage = {
      type: 'assistant',
      uuid: 'assistant-timeout',
      timestamp: '2026-09-10T00:00:03.000Z',
      isApiErrorMessage: true,
      message: {
        id: 'synthetic-error',
        model: '<synthetic>',
        role: 'assistant',
        content: [{ type: 'text', text: 'Request timed out' }],
      },
    } as Message

    const result = sanitizeMessagesAfterApiFailure([
      thinkingMessage,
      progressMessage,
      userMessage,
      timeoutMessage,
    ])

    expect(result.removedApiError).toBe(true)
    expect(result.messages).toEqual([progressMessage, userMessage])
  })

  it('preserves signed thinking state when the previous turn did not fail', () => {
    const thinkingMessage = {
      type: 'assistant',
      uuid: 'assistant-thinking',
      timestamp: '2026-09-10T00:00:00.000Z',
      message: {
        id: 'message-1',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '', signature: 'opaque-provider-state' }],
      },
    } as Message

    const result = sanitizeMessagesAfterApiFailure([thinkingMessage])

    expect(result.removedApiError).toBe(false)
    expect(result.messages).toEqual([thinkingMessage])
  })
})
