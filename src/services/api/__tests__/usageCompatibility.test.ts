import { describe, expect, it, mock } from 'bun:test'
import type { NonNullableUsage } from '../../../entrypoints/sdk/sdkUtilityTypes.js'
import { EMPTY_USAGE } from '../emptyUsage.js'

// The vendored color-diff-napi stub has no named exports, which breaks the
// transitive import chain from claude.ts under bun test.
mock.module('color-diff-napi', () => ({
  ColorDiff: {},
  ColorFile: {},
  getSyntaxTheme: () => ({}),
}))

const { accumulateUsage, updateUsage } = await import('../claude.js')

describe('usage compatibility', () => {
  it('normalizes incomplete usage objects before updating streaming usage', () => {
    const incompleteUsage = {
      input_tokens: 5,
      output_tokens: 7,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as unknown as NonNullableUsage

    const usage = updateUsage(incompleteUsage, {
      output_tokens: 9,
    } as Parameters<typeof updateUsage>[1])

    expect(usage).toMatchObject({
      input_tokens: 5,
      output_tokens: 9,
      server_tool_use: {
        web_search_requests: 0,
        web_fetch_requests: 0,
      },
      cache_creation: {
        ephemeral_1h_input_tokens: 0,
        ephemeral_5m_input_tokens: 0,
      },
      service_tier: 'standard',
      inference_geo: '',
      iterations: [],
      speed: 'standard',
    })
  })

  it('normalizes incomplete message usage before accumulating totals', () => {
    const messageUsage = {
      input_tokens: 3,
      output_tokens: 4,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as unknown as NonNullableUsage

    const usage = accumulateUsage(EMPTY_USAGE, messageUsage)

    expect(usage).toMatchObject({
      input_tokens: 3,
      output_tokens: 4,
      server_tool_use: {
        web_search_requests: 0,
        web_fetch_requests: 0,
      },
      cache_creation: {
        ephemeral_1h_input_tokens: 0,
        ephemeral_5m_input_tokens: 0,
      },
      service_tier: 'standard',
      inference_geo: '',
      iterations: [],
      speed: 'standard',
    })
  })
})
