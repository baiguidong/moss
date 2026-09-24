import { describe, expect, mock, spyOn, test } from 'bun:test'
import { getEventListeners } from 'node:events'
import type { ForkedAgentParams, runForkedAgent } from '../../utils/forkedAgent.js'

mock.module('color-diff-napi', () => ({
  ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}),
}))

const { runMemoryUpdate, SESSION_MEMORY_MAX_TURNS, SESSION_MEMORY_TIMEOUT_MS } = await import('./runMemoryUpdate.js')
const { createUserMessage, createAssistantAPIErrorMessage } = await import('../../utils/messages.js')
const { createAttachmentMessage } = await import('../../utils/attachments.js')
const params = (controller = new AbortController()) => ({
  promptMessages: [],
  cacheSafeParams: { toolUseContext: { abortController: controller } },
  canUseTool: async () => ({ behavior: 'allow' }),
  forkLabel: 'session_memory',
}) as unknown as Parameters<typeof runMemoryUpdate>[0]
const fake = (callback: (params: ForkedAgentParams) => void | Promise<void>) =>
  (async input => { await callback(input); return { messages: [], totalUsage: {} } }) as typeof runForkedAgent

describe('bounded session memory execution', () => {
  test('uses an independent turn cap and removes abort listeners after success', async () => {
    const parent = new AbortController()
    const count = getEventListeners(parent.signal, 'abort').length
    await runMemoryUpdate(params(parent), fake(async input => {
      expect(input.maxTurns).toBe(SESSION_MEMORY_MAX_TURNS)
      expect(input.querySource).toBe('session_memory')
      expect(input.overrides?.abortController?.signal.aborted).toBe(false)
    }))
    expect(parent.signal.aborted).toBe(false)
    expect(getEventListeners(parent.signal, 'abort')).toHaveLength(count)
  })

  test('stops immediately on a failed edit instead of issuing another model request', async () => {
    let requests = 0
    const parent = new AbortController()
    await expect(runMemoryUpdate(params(parent), fake(async input => {
      const controller = input.overrides!.abortController!
      while (!controller.signal.aborted && requests < 10) {
        requests++
        input.onMessage!(createUserMessage({ content: [{
          type: 'tool_result', tool_use_id: 'edit', is_error: true,
          content: 'File has been modified since read. Read it again before attempting to write it.',
        }] }))
      }
    }))).rejects.toThrow('Session memory tool failed')
    expect(requests).toBe(1)
    expect(parent.signal.aborted).toBe(false)
  })

  test('reports a turn limit or API failure instead of completing the summary checkpoint', async () => {
    for (const [message, error] of [
      [createAttachmentMessage({ type: 'max_turns_reached', maxTurns: 3, turnCount: 4 }), 'turn limit'],
      [createAssistantAPIErrorMessage({ content: 'API failed', error: 'invalid_request' }), 'model request failed'],
    ] as const) {
      await expect(runMemoryUpdate(params(), fake(input => {
        input.onMessage!(message)
      }))).rejects.toThrow(error)
    }
  })

  test('propagates parent cancellation and does not start an already cancelled update', async () => {
    const parent = new AbortController()
    const reason = new Error('session stopped')
    await expect(runMemoryUpdate(params(parent), fake(input => {
      parent.abort(reason)
      expect(input.overrides!.abortController!.signal.reason).toBe(reason)
    }))).rejects.toThrow('session stopped')
    let started = false
    await expect(runMemoryUpdate(params(parent), fake(() => { started = true }))).rejects.toThrow('session stopped')
    expect(started).toBe(false)
  })

  test('aborts an update that never completes before its deadline', async () => {
    const realSetTimeout = globalThis.setTimeout
    const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((callback, ms, ...args) =>
      realSetTimeout(callback, ms === SESSION_MEMORY_TIMEOUT_MS ? 1 : ms, ...args)
    ) as typeof setTimeout)
    try {
      await expect(runMemoryUpdate(params(), fake(async input => {
        const signal = input.overrides!.abortController!.signal
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      }))).rejects.toThrow('timed out')
    } finally {
      timer.mockRestore()
    }
  })
})
