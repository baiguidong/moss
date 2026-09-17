import { describe, expect, test } from 'bun:test'
import type { MossAppEvent, ToolUseContext } from '../../Tool.js'
import { MossTool } from './MossTool.js'

function contextWith(handler: (event: MossAppEvent) => Promise<any>): ToolUseContext {
  return { emitAppEvent: handler } as unknown as ToolUseContext
}

describe('MossTool browser automation', () => {
  test('requests permission for page inspection and forwards a session-scoped snapshot', async () => {
    let emitted: MossAppEvent | null = null
    const input = { action: 'browser_snapshot' as const, tab_id: 'tab-1', full_page: true }
    expect((await MossTool.checkPermissions(input)).behavior).toBe('ask')

    const result = await MossTool.call(input, contextWith(async event => {
      emitted = event
      return {
        ok: true,
        browser: { snapshotId: 'snapshot-1', elements: [{ ref: 'e1' }] },
        imageBase64: 'cG5n',
        imageMediaType: 'image/png',
      }
    }))

    expect(emitted).toEqual({
      type: 'browser_snapshot',
      input: { tab_id: 'tab-1', full_page: true },
    })
    expect(result.data.browser).toEqual({ snapshotId: 'snapshot-1', elements: [{ ref: 'e1' }] })
    expect(JSON.stringify(result.data)).not.toContain('cG5n')
    const block = MossTool.mapToolResultToToolResultBlockParam(result.data, 'tool-1')
    expect(Array.isArray(block.content)).toBe(true)
    expect(block.content).toContainEqual(expect.objectContaining({ type: 'image' }))
  })

  test('requires snapshot references for element actions', async () => {
    const result = await MossTool.call(
      { action: 'browser_click' },
      contextWith(async () => ({ ok: true })),
    )
    expect(result.data).toEqual({ ok: false, error: 'snapshot_id and ref are required for browser_click' })
  })
})
