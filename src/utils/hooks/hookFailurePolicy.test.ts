import { describe, expect, test } from 'bun:test'
import { HookCommandSchema } from '../../schemas/hooks.js'
import { shouldBlockHookFailure } from '../hooks.js'

describe('hook failure policy', () => {
  test('accepts onFailure on command hooks', () => {
    const parsed = HookCommandSchema().safeParse({
      type: 'command',
      command: 'echo hook',
      onFailure: 'block',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.onFailure).toBe('block')
  })

  test('blocks only configured non-blocking failures', () => {
    expect(
      shouldBlockHookFailure(
        { type: 'command', onFailure: 'block' },
        'non_blocking_error',
      ),
    ).toBe(true)
    expect(
      shouldBlockHookFailure(
        { type: 'command', onFailure: 'ignore' },
        'non_blocking_error',
      ),
    ).toBe(false)
    expect(
      shouldBlockHookFailure(
        { type: 'command', onFailure: 'block' },
        'success',
      ),
    ).toBe(false)
    expect(
      shouldBlockHookFailure(
        { type: 'command', onFailure: 'block' },
        'blocking',
      ),
    ).toBe(false)
  })
})
