import { describe, expect, mock, test } from 'bun:test'
import { EMPTY_USAGE } from '../../services/api/emptyUsage.js'

mock.module('color-diff-napi', () => ({ ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}) }))
const { createAssistantMessage, createCompactBoundaryMessage, createUserMessage } = await import('../messages.js')
const { getContextUsageFromUsage, getCurrentUsage, getTokenCountFromUsage, tokenCountWithEstimation } = await import('../tokens.js')
const { roughTokenCountEstimationForMessages } = await import('../../services/tokenEstimation.js')

function assistant(id: string, input: number, output: number) {
  const message = createAssistantMessage({ content: 'response',
    usage: { ...EMPTY_USAGE, input_tokens: input, output_tokens: output } })
  message.message.id = id
  message.message.model = 'fixture'
  return message
}

describe('Claude-compatible context usage', () => {
  test('uses the final valid iteration instead of cumulative billed token counts', () => {
    const message = assistant('iterated', 500_000, 5000)
    message.message.usage.iterations = [
      { type: 'message', input_tokens: 1000, output_tokens: 20, cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 300 },
      { type: 'message', input_tokens: 500, output_tokens: 10, cache_read_input_tokens: 1500,
        cache_creation_input_tokens: 100 },
      { type: 'advisor_message', input_tokens: 9999, output_tokens: 9999 },
    ] as typeof message.message.usage.iterations
    expect(getContextUsageFromUsage(message.message.usage)).toMatchObject({ input_tokens: 500,
      output_tokens: 10, cache_read_input_tokens: 1500, cache_creation_input_tokens: 100 })
    expect(getCurrentUsage([message])?.input_tokens).toBe(500)
    expect(getTokenCountFromUsage(message.message.usage)).toBe(2110)
    expect(tokenCountWithEstimation([message])).toBe(2110)
  })

  test('does not anchor on a later output-only response', () => {
    const reported = assistant('reported', 1000, 100)
    const outputOnly = assistant('output-only', 0, 404)
    expect(tokenCountWithEstimation([reported, outputOnly])).toBe(
      1100 + roughTokenCountEstimationForMessages([outputOnly]),
    )
  })

  test('uses cache-only input as a valid anchor and does not sum earlier requests', () => {
    const cached = assistant('cached', 0, 1122)
    cached.message.usage.cache_read_input_tokens = 194_431
    expect(tokenCountWithEstimation([assistant('old', 500_000, 1000), cached])).toBe(195_553)
  })

  test('anchors before every interleaved result in a split response', () => {
    const first = assistant('parallel', 1000, 200)
    const second = assistant('parallel', 1000, 200)
    const firstResult = createUserMessage({ content: 'first tool result' })
    const secondResult = createUserMessage({ content: 'second tool result' })
    expect(tokenCountWithEstimation([first, firstResult, second, secondResult])).toBe(
      1200 + roughTokenCountEstimationForMessages([firstResult, second, secondResult]),
    )
  })

  test('does not recover usage before a compact boundary', () => {
    const after = [createUserMessage({ content: 'summary' }), assistant('empty', 0, 404)]
    expect(tokenCountWithEstimation([assistant('old', 500_000, 500),
      createCompactBoundaryMessage('auto', 500_000), ...after])).toBe(roughTokenCountEstimationForMessages(after))
    expect(tokenCountWithEstimation(after)).toBe(roughTokenCountEstimationForMessages(after))
  })
})
