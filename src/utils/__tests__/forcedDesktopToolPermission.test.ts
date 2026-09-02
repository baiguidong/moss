import { describe, expect, test } from 'bun:test'

import { shouldForceDesktopToolPermission } from '../permissions/forcedDesktopToolPermission.js'

describe('shouldForceDesktopToolPermission', () => {
  test('preserves the existing path when the optional callback is omitted', async () => {
    expect(await shouldForceDesktopToolPermission(undefined, 'Read', {}, { readOnly: true })).toBe(false)
  })

  test('passes tool metadata to an async room policy', async () => {
    const calls: unknown[] = []
    const forced = await shouldForceDesktopToolPermission(async (tool, input, metadata) => {
      calls.push({ tool, input, metadata })
      return !metadata.readOnly
    }, 'mcp__mail__send', { to: 'person' }, { readOnly: false })

    expect(forced).toBe(true)
    expect(calls).toEqual([{
      tool: 'mcp__mail__send',
      input: { to: 'person' },
      metadata: { readOnly: false },
    }])
  })
})
