import { APIError } from '@anthropic-ai/sdk'
import { describe, expect, it } from 'bun:test'
import { getThinkingFallbackMode } from '../thinkingFallback.js'

function apiError(status: number | undefined, message: string, details = {}): APIError {
  return APIError.generate(
    status,
    { error: { type: 'invalid_request_error', message, ...details } },
    undefined,
    new Headers(),
  )
}

describe('thinking compatibility errors', () => {
  it.each([
    'thinking is not supported for this model',
    'This model does not support thinking',
    'Adaptive thinking is not supported by this model',
    'Unsupported thinking mode: adaptive',
    'thinking.type: unsupported value adaptive',
  ])('disables thinking for an explicit mode rejection: %s', message => {
    expect(getThinkingFallbackMode(apiError(400, message))).toBe('disabled')
  })

  it.each([
    "Unknown parameter: 'thinking'",
    "Unsupported parameter: 'thinking' is not supported with this model.",
    'Unrecognized request argument supplied: thinking',
    "The 'thinking' parameter is not supported by this endpoint",
    'Malformed input request: #: extraneous key [thinking] is not permitted',
    'thinking: Extra inputs are not permitted',
    "Additional properties are not allowed ('thinking' was unexpected)",
  ])('omits a rejected thinking field: %s', message => {
    expect(getThinkingFallbackMode(apiError(422, message))).toBe('omit')
  })

  it('recognizes a structured error identifying the rejected field or mode', () => {
    expect(getThinkingFallbackMode(apiError(400, 'Not supported', {
      param: 'thinking', code: 'unsupported_parameter',
    }))).toBe('omit')
    expect(getThinkingFallbackMode(apiError(400, 'Unsupported value: adaptive', {
      param: 'thinking.type', code: 'unsupported_value',
    }))).toBe('disabled')
  })

  it.each([
    'Invalid request',
    'Insufficient balance for this API key',
    'thinking.budget_tokens must be less than max_tokens',
    'thinking: budget_tokens must be at least 1024',
    'Invalid signature in thinking block',
    'thinking blocks cannot be modified',
    'This model does not support thinking blocks in messages',
    'thinking is unavailable: insufficient credits',
    'thinking is enabled; this model does not support tools',
    'Unknown parameter: thinking_budget',
    'Unsupported parameter: thinking.budget_tokens',
    'Unsupported parameter: temperature while thinking is enabled',
  ])('does not downgrade unrelated or invalid requests: %s', message => {
    expect(getThinkingFallbackMode(apiError(400, message))).toBeUndefined()
  })

  it.each([401, 403, 404, 408, 429, 500, 529])(
    'does not downgrade HTTP %s even if it mentions thinking', status => {
      expect(getThinkingFallbackMode(apiError(
        status, 'thinking is not supported for this model',
      ))).toBeUndefined()
    },
  )

  it('does not treat a local or streaming error as an HTTP parameter rejection', () => {
    expect(getThinkingFallbackMode(new Error('thinking is not supported')))
      .toBeUndefined()
    expect(getThinkingFallbackMode(apiError(
      undefined, 'thinking is not supported',
    ))).toBeUndefined()
  })
})
