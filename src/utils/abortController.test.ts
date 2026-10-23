import { expect, test } from 'bun:test'
import { getEventListeners } from 'node:events'
import { createBackgroundTaskAbortController, createChildAbortController, TOOL_EXECUTION_COMPLETED, TOOL_EXECUTION_DISCARDED } from './abortController'

test('successful streaming tool cleanup preserves background work and subsequent Stop still cancels it', () => {
  const query = new AbortController()
  const tool = createChildAbortController(query)
  const worker = createBackgroundTaskAbortController(query, tool)
  tool.abort(TOOL_EXECUTION_COMPLETED)
  expect(worker.signal.aborted).toBe(false)
  query.abort('stop')
  expect(worker.signal.reason).toBe('stop')
  expect(getEventListeners(query.signal, 'abort')).toHaveLength(0)
})

for (const reason of [TOOL_EXECUTION_DISCARDED, 'sibling_error', 'interrupt']) {
  test(`abandoned tool work is cancelled: ${String(reason)}`, () => {
    const query = new AbortController()
    const tool = createChildAbortController(query)
    const worker = createBackgroundTaskAbortController(query, tool)
    tool.abort(reason)
    expect(worker.signal.reason).toBe(reason)
    expect(query.signal.aborted).toBe(false)
    expect(getEventListeners(query.signal, 'abort')).toHaveLength(0)
  })
}

test('registration after Stop remains cancelled and worker cancellation releases both listeners', () => {
  const query = new AbortController()
  const tool = new AbortController()
  const worker = createBackgroundTaskAbortController(query, tool)
  worker.abort()
  expect(getEventListeners(query.signal, 'abort')).toHaveLength(0)
  expect(getEventListeners(tool.signal, 'abort')).toHaveLength(0)
  query.abort('stop')
  expect(createBackgroundTaskAbortController(query, tool).signal.reason).toBe('stop')
})
