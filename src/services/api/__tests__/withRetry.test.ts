import { describe, expect, it } from 'bun:test'
import { APIConnectionError } from '@anthropic-ai/sdk'
import type Anthropic from '@anthropic-ai/sdk'
import { CannotRetryError, withRetry } from '../withRetry.js'

describe('withRetry', () => {
  it('fails immediately for an invalid local Undici request', async () => {
    const cause = Object.assign(new Error('invalid onRequestStart method'), {
      code: 'UND_ERR_INVALID_ARG',
    })
    const error = new APIConnectionError({ cause })
    let attempts = 0
    let caught: unknown

    try {
      const result = withRetry(
        async () => ({}) as Anthropic,
        async () => {
          attempts += 1
          throw error
        },
        {
          maxRetries: 10,
          model: 'test-model',
          thinkingConfig: { type: 'disabled' },
        },
      )
      for await (const _event of result) {
        // A non-retryable transport configuration error emits no retry event.
      }
    } catch (thrown) {
      caught = thrown
    }

    expect(attempts).toBe(1)
    expect(caught).toBeInstanceOf(CannotRetryError)
  })
})
