import { describe, expect, test } from 'bun:test'
import type { Message } from '../../types/message.js'
import { getAgentExecutionFailure } from './agentExecutionStatus.js'

describe('agent execution status', () => {
  test('classifies prompt-too-long API messages as failures', () => {
    const message = {
      type: 'assistant',
      isApiErrorMessage: true,
      error: 'invalid_request',
      message: {
        content: [{ type: 'text', text: 'Prompt is too long' }],
      },
    } as unknown as Message
    expect(getAgentExecutionFailure(message)).toEqual({
      code: 'prompt_too_long',
      message: 'Prompt is too long',
    })
  })

  test('classifies prompt-too-long messages that include token details', () => {
    const message = {
      type: 'assistant',
      isApiErrorMessage: true,
      message: {
        content: [{ type: 'text', text: 'Prompt is too long: 210000 tokens > 200000 maximum' }],
      },
    } as unknown as Message
    const failure = getAgentExecutionFailure(message)

    expect(failure?.code).toBe('prompt_too_long')
  })

  test('keeps normal assistant output successful', () => {
    const message = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'done' }] },
    } as unknown as Message
    expect(getAgentExecutionFailure(message)).toBeNull()
  })

  test('classifies other API errors with their structured code', () => {
    const message = {
      type: 'assistant',
      isApiErrorMessage: true,
      apiError: 'authentication_failed',
      message: { content: [{ type: 'text', text: 'Authentication failed' }] },
    } as unknown as Message
    expect(getAgentExecutionFailure(message)).toEqual({
      code: 'authentication_failed',
      message: 'Authentication failed',
    })
  })
})
