import { expect, test } from 'bun:test'
import { APIError, APIUserAbortError } from '@anthropic-ai/sdk'
import { RetryBudget, RetryBudgetExceededError } from '../retryBudget'
import { withRetry, getRetryDelay } from '../withRetry'
import { returnValue } from '../../../utils/generators'
import { runWithSessionIdContext } from '../../../utils/sessionIdContext'
import { asSessionId } from '../../../types/ids'

const failure = (status = 503, after = '0') => APIError.generate(status, { error: { message: 'fixture failure' } }, undefined, new Headers({ 'retry-after': after }))
const defaults = { model: 'fixture', querySource: 'sdk' as const, thinkingConfig: { type: 'disabled' as const } }
test('one logical request shares attempt and monotonic wait accounting across retry loops', async () => {
  let now = 0
  const budget = new RetryBudget({ maxAttempts: 2, maxWaitMs: 100 }, () => now)
  budget.acquireAttempt(); const start = budget.now(); now = 70; budget.recordWait(start)
  expect(budget.snapshot().remainingWaitMs).toBe(30)
  expect(() => budget.checkWait(31)).toThrow(RetryBudgetExceededError)
  let calls = 0
  const run = () => returnValue(withRetry(async () => ({} as any), async () => ++calls, { ...defaults, retryBudget: budget }))
  expect(await run()).toBe(1)
  await expect(run()).rejects.toMatchObject({ originalError: { reason: 'attempts' } })
  expect(calls).toBe(1)
})
test('long Retry-After ends immediately instead of sleeping or retrying earlier than requested', async () => {
  let attempts = 0
  await expect(returnValue(withRetry(async () => ({} as any), async () => { attempts++; throw failure(429, '121') }, defaults)))
    .rejects.toMatchObject({ originalError: { name: 'RetryBudgetExceededError', reason: 'wait' } })
  expect(attempts).toBe(1)
  expect(getRetryDelay(1, '0.125')).toBe(125)
  const date = new Date(Date.now() + 300_000).toUTCString()
  expect(getRetryDelay(1, date)).toBeGreaterThan(298_000)
  expect(getRetryDelay(1, '-1')).toBeGreaterThanOrEqual(500)
})
test('unattended persistent retry remains bounded and reports its actual attempts and allowance', async () => {
  const budget = new RetryBudget({ unattended: true, maxAttempts: 3 })
  let attempts = 0; const events: any[] = []
  await runWithSessionIdContext(asSessionId('fixture'), null, async () => {
    const generator = withRetry(async () => ({} as any), async () => { attempts++; throw failure(429) }, { ...defaults, maxRetries: 0, retryBudget: budget })
    await expect((async () => { for await (const event of generator) events.push(event) })()).rejects.toMatchObject({ originalError: { reason: 'attempts' } })
  }, undefined, undefined, { executionEnvironment: 'desktop', unattended: true })
  expect(attempts).toBe(3)
  // Zero-delay retries may emit no heartbeat, but they still consume attempts.
  expect(budget.snapshot().maxWaitMs).toBe(600_000)
})
test('retry events contain bounded wait facts and cancellation prevents the next attempt', async () => {
  const controller = new AbortController(); let attempts = 0
  const generator = withRetry(async () => ({} as any), async () => { attempts++; throw failure(503, '1') }, { ...defaults, signal: controller.signal })
  const event = await generator.next()
  expect((event.value as any).retryBudget).toMatchObject({ attempts: 1, maxWaitMs: 120_000, waitedMs: 0 })
  controller.abort()
  await expect(generator.next()).rejects.toBeInstanceOf(APIUserAbortError)
  expect(attempts).toBe(1)
})
test('thinking compatibility retry consumes the same hard attempt limit', async () => {
  let attempts = 0
  const error = APIError.generate(400, { error: { message: 'thinking is not supported for this model' } }, undefined, new Headers())
  await expect(returnValue(withRetry(async () => ({} as any), async () => { attempts++; throw error }, {
    ...defaults, thinkingConfig: { type: 'adaptive' }, thinkingFallback: {}, retryBudget: new RetryBudget({ maxAttempts: 1 }),
  }))).rejects.toMatchObject({ originalError: { reason: 'attempts' } })
  expect(attempts).toBe(1)
})
