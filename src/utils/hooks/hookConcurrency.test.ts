import { describe, expect, test } from 'bun:test'
import {
  getHookConcurrencyLimit,
  HookConcurrencyLimiter,
  withHookConcurrency,
} from './hookConcurrency.js'

describe('hook concurrency limiter', () => {
  test('keeps active hooks within the configured limit', async () => {
    const limiter = new HookConcurrencyLimiter(1)
    let releaseFirst!: () => void
    const first = withHookConcurrency(
      limiter,
      () =>
        new Promise<string>(resolve => {
          releaseFirst = () => resolve('first')
        }),
    )
    await Promise.resolve()
    expect(limiter.activeCount).toBe(1)
    const second = withHookConcurrency(limiter, async () => 'second')
    await Promise.resolve()
    expect(limiter.queuedCount).toBe(1)
    releaseFirst()
    expect(await first).toBe('first')
    expect(await second).toBe('second')
    expect(limiter.activeCount).toBe(0)
  })

  test('reads a positive environment override', () => {
    expect(getHookConcurrencyLimit({ MOSS_HOOK_MAX_CONCURRENT: '3' })).toBe(3)
    expect(getHookConcurrencyLimit({ MOSS_HOOK_MAX_CONCURRENT: '0' })).toBe(16)
    expect(getHookConcurrencyLimit({ MOSS_HOOK_MAX_CONCURRENT: 'bad' })).toBe(16)
  })
})
