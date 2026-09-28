import { describe, expect, it } from 'bun:test'
import { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk'
import type Anthropic from '@anthropic-ai/sdk'
import { returnValue } from '../../../utils/generators.js'
import type { ThinkingConfig } from '../../../utils/thinking.js'
import type { ThinkingFallbackState } from '../thinkingFallback.js'
import { CannotRetryError, type RetryContext, withRetry } from '../withRetry.js'

function rejection(message = 'thinking is not supported for this model'): APIError {
  return APIError.generate(
    400,
    { error: { type: 'invalid_request_error', message } },
    undefined,
    new Headers(),
  )
}

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

  it.each<ThinkingConfig>([
    { type: 'adaptive' },
    { type: 'enabled', budgetTokens: 16000 },
  ])('retries once with thinking disabled and preserves the configured mode: %j', async config => {
    const attempts: RetryContext[] = []
    const originalConfig = { ...config }
    const result = withRetry(
      async () => ({}) as Anthropic,
      async (_client, _attempt, context) => {
        attempts.push({ ...context })
        if (attempts.length === 1) throw rejection()
        return 'reply'
      },
      {
        maxRetries: 0,
        model: 'custom-model',
        thinkingConfig: config,
        thinkingFallback: {},
      },
    )

    // No user-facing error is emitted for a recovered compatibility failure.
    expect(await result.next()).toEqual({ done: true, value: 'reply' })
    expect(attempts.map(attempt => attempt.thinkingConfig)).toEqual([
      originalConfig, { type: 'disabled' },
    ])
    expect(attempts[1]?.omitThinking).toBe(false)
    expect(config).toEqual(originalConfig)
  })

  it('omits the thinking field if the endpoint rejects the field itself', async () => {
    let attempts = 0
    const result = await returnValue(withRetry(
      async () => ({}) as Anthropic,
      async (_client, _attempt, context) => {
        if (++attempts === 1) throw rejection("Unknown parameter: 'thinking'")
        return context
      },
      {
        maxRetries: 0, model: 'custom-model',
        thinkingConfig: { type: 'adaptive' }, thinkingFallback: {},
      },
    ))
    expect(attempts).toBe(2)
    expect(result.thinkingConfig).toEqual({ type: 'disabled' })
    expect(result.omitThinking).toBe(true)
  })

  it('surfaces a failed fallback without repeatedly changing thinking', async () => {
    let attempts = 0
    const error = rejection()
    error.headers?.set('x-should-retry', 'true')
    const result = returnValue(withRetry(
      async () => ({}) as Anthropic,
      async () => { attempts++; throw error },
      {
        maxRetries: 10, model: 'custom-model',
        thinkingConfig: { type: 'adaptive' }, thinkingFallback: {},
      },
    ))
    await expect(result).rejects.toMatchObject({ originalError: error })
    expect(attempts).toBe(2)
  })

  it.each([
    'Insufficient balance',
    'thinking.budget_tokens must be less than max_tokens',
    'Invalid signature in thinking block',
    'Unsupported parameter: temperature while thinking is enabled',
  ])('does not retry or disable thinking for %s', async message => {
    let attempts = 0
    const state: ThinkingFallbackState = {}
    const error = rejection(message)
    const result = returnValue(withRetry(
      async () => ({}) as Anthropic,
      async () => { attempts++; throw error },
      {
        maxRetries: 10, model: 'custom-model',
        thinkingConfig: { type: 'adaptive' }, thinkingFallback: state,
      },
    ))
    await expect(result).rejects.toMatchObject({ originalError: error })
    expect(attempts).toBe(1)
    expect(state.mode).toBeUndefined()
  })

  it('carries the downgrade into non-streaming recovery but not another query', async () => {
    const state: ThinkingFallbackState = {}
    const seen: (string | undefined)[] = []
    const run = (thinkingFallback: ThinkingFallbackState) => returnValue(withRetry(
      async () => ({}) as Anthropic,
      async (_client, _attempt, context) => {
        seen.push(context.omitThinking ? undefined : context.thinkingConfig.type)
        if (context.thinkingConfig.type === 'adaptive') {
          throw rejection("Unknown parameter: 'thinking'")
        }
        return 'reply'
      },
      {
        maxRetries: 0, model: 'custom-model',
        thinkingConfig: { type: 'adaptive' }, thinkingFallback,
      },
    ))
    await run(state)
    await run(state)
    await run({})
    expect(seen).toEqual(['adaptive', undefined, undefined, 'adaptive', undefined])
  })

  it('honors cancellation before dispatching the fallback request', async () => {
    const controller = new AbortController()
    let attempts = 0
    const result = returnValue(withRetry(
      async () => ({}) as Anthropic,
      async () => { attempts++; controller.abort(); throw rejection() },
      {
        maxRetries: 0, model: 'custom-model',
        thinkingConfig: { type: 'adaptive' }, thinkingFallback: {},
        signal: controller.signal,
      },
    ))
    await expect(result).rejects.toBeInstanceOf(APIUserAbortError)
    expect(attempts).toBe(1)
  })

  it('leaves a successful text-only response and subsequent requests unchanged', async () => {
    const state: ThinkingFallbackState = {}
    let attempts = 0
    const run = () => returnValue(withRetry(
      async () => ({}) as Anthropic,
      async (_client, _attempt, context) => {
        attempts++
        expect(context.thinkingConfig).toEqual({ type: 'adaptive' })
        return { content: [{ type: 'text', text: 'reply' }] }
      },
      {
        maxRetries: 0, model: 'custom-model',
        thinkingConfig: { type: 'adaptive' }, thinkingFallback: state,
      },
    ))
    await run()
    await run()
    expect(attempts).toBe(2)
    expect(state.mode).toBeUndefined()
  })

  it('does not retry a mode rejection when thinking is already disabled', async () => {
    let attempts = 0
    const result = returnValue(withRetry(
      async () => ({}) as Anthropic,
      async () => { attempts++; throw rejection() },
      {
        maxRetries: 0, model: 'custom-model',
        thinkingConfig: { type: 'disabled' }, thinkingFallback: {},
      },
    ))
    await expect(result).rejects.toBeInstanceOf(CannotRetryError)
    expect(attempts).toBe(1)
  })
})
