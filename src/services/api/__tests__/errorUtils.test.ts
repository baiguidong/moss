import {
  APIConnectionError,
  APIError,
} from '@anthropic-ai/sdk'
import { describe, expect, test } from 'bun:test'
import { getAssistantMessageFromError } from '../errors.js'
import { formatAPIError } from '../errorUtils.js'

function providerError(status: number, message: string): APIError {
  return APIError.generate(
    status,
    { error: { message, type: 'invalid_request_error' } },
    undefined,
    new Headers(),
  )
}

function assistantText(message: ReturnType<typeof getAssistantMessageFromError>): string {
  const block = message.message.content[0]
  if (!block || block.type !== 'text') throw new Error('Expected a text block')
  return block.text
}

describe('model API error formatting', () => {
  test('shows the underlying transport reason for connection errors', () => {
    const cause = Object.assign(new Error('invalid request path'), {
      code: 'UND_ERR_INVALID_ARG',
    })
    const error = new APIConnectionError({ cause })

    expect(formatAPIError(error)).toBe(
      'No response received from model API. Transport error: invalid request path (UND_ERR_INVALID_ARG). Check the configured model API URL and proxy settings.',
    )
  })

  test('extracts the original provider message from a nested response', () => {
    const error = providerError(
      429,
      'Insufficient balance for this API key',
    )

    expect(formatAPIError(error)).toBe(
      '429 Insufficient balance for this API key',
    )
    expect(assistantText(getAssistantMessageFromError(error, 'configured-model'))).toBe(
      'API Error: 429 Insufficient balance for this API key',
    )
  })

  test('keeps an upstream 404 visible when suggesting URL or model changes', () => {
    const message = getAssistantMessageFromError(
      providerError(404, 'Invalid URL (POST /v1/v1/messages)'),
      'configured-model',
    )

    expect(assistantText(message)).toContain(
      'API Error: 404 Invalid URL (POST /v1/v1/messages)',
    )
    expect(assistantText(message)).toContain(
      'Check the configured API URL and model name.',
    )
  })
})
