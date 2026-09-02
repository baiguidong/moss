import { describe, expect, test } from 'bun:test'
import { getEventListeners } from 'node:events'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../Tool.js'
import { createAbortController } from '../../utils/abortController.js'
import { StreamingToolExecutor } from './StreamingToolExecutor.js'

function createExecutor(parent: AbortController) {
  return new StreamingToolExecutor(
    [],
    (async () => ({ behavior: 'allow' })) as CanUseToolFn,
    { abortController: parent } as ToolUseContext,
  )
}

describe('StreamingToolExecutor abort lifecycle', () => {
  test('releases its parent abort listener after normal completion', async () => {
    const parent = createAbortController()
    const executor = createExecutor(parent)
    expect(getEventListeners(parent.signal, 'abort')).toHaveLength(1)

    for await (const _ of executor.getRemainingResults()) {
      // No tools were queued.
    }

    expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0)
    expect(parent.signal.aborted).toBe(false)
  })

  test('releases its parent abort listener when discarded', () => {
    const parent = createAbortController()
    const executor = createExecutor(parent)
    expect(getEventListeners(parent.signal, 'abort')).toHaveLength(1)

    executor.discard()

    expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0)
    expect(parent.signal.aborted).toBe(false)
  })
})
