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
const { getTokenCountFromUsage, tokenCountWithEstimation } = await import('../../../utils/tokens.js')
const { createAssistantMessage, createUserMessage } = await import('../../../utils/messages.js')
const { calculateTokenWarningState } = await import('../../compact/autoCompact.js')

function gatewayUsage(total = 91_134, cached = 86_144) {
  return {
    ...EMPTY_USAGE,
    input_tokens: total,
    output_tokens: 104,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
    billing_usage: {
      source: 'oai_chat',
      semantic: 'openai',
      openai_usage: {
        prompt_tokens: total,
        prompt_tokens_details: { cached_tokens: cached },
        input_tokens: 0,
        input_tokens_details: null,
      },
    },
  }
}

describe('usage compatibility', () => {
  it('counts cached OpenAI gateway input once, matching the original provider total', () => {
    const usage = updateUsage(EMPTY_USAGE, gatewayUsage())

    expect(usage).toMatchObject({
      input_tokens: 4_990,
      cache_read_input_tokens: 86_144,
      output_tokens: 104,
    })
    expect(getTokenCountFromUsage(usage)).toBe(91_238)
    // Normalized usage must remain stable when accumulated or updated again.
    expect(accumulateUsage(EMPTY_USAGE, usage)).toEqual(usage)
    expect(updateUsage(usage, { ...EMPTY_USAGE, output_tokens: 105 })).toMatchObject({
      input_tokens: 4_990,
      cache_read_input_tokens: 86_144,
      output_tokens: 105,
    })

    const assistant = createAssistantMessage({ content: 'Inspect the screenshot.', usage })
    assistant.message.model = 'gpt-5.5'
    const screenshot = createUserMessage({ content: [{
      type: 'tool_result', tool_use_id: 'screenshot-read', content: [{
        type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
      }],
    }] })
    const tokens = tokenCountWithEstimation([assistant, screenshot])
    expect(tokens).toBe(93_238)
    expect(calculateTokenWarningState(tokens, 'gpt-5.5')).toMatchObject({
      isAboveAutoCompactThreshold: false,
      isAtBlockingLimit: false,
    })
  })

  it('replaces provisional input with zero when authoritative usage is fully cached', () => {
    const initial = updateUsage(EMPTY_USAGE, { ...EMPTY_USAGE, input_tokens: 80_000 })
    const usage = updateUsage(initial, gatewayUsage(90_000, 90_000))

    expect(usage.input_tokens).toBe(0)
    expect(getTokenCountFromUsage(usage)).toBe(90_104)
  })

  it('normalizes Responses usage even when the gateway includes zero-valued Chat fields', () => {
    const raw = gatewayUsage()
    const usage = updateUsage(EMPTY_USAGE, {
      ...raw,
      billing_usage: {
        semantic: 'openai',
        openai_usage: {
          prompt_tokens: 0,
          input_tokens: 91_134,
          input_tokens_details: { cached_tokens: 86_144 },
        },
      },
    } as Parameters<typeof updateUsage>[1])

    expect(usage.input_tokens).toBe(4_990)
    expect(getTokenCountFromUsage(usage)).toBe(91_238)
  })

  it('normalizes raw gateway usage before accumulation', () => {
    const usage = accumulateUsage(EMPTY_USAGE, gatewayUsage() as NonNullableUsage)
    expect(getTokenCountFromUsage(usage)).toBe(91_238)
  })

  it('preserves native Anthropic cache accounting and zero-valued streaming deltas', () => {
    const initial = updateUsage(EMPTY_USAGE, {
      ...EMPTY_USAGE,
      input_tokens: 4_990,
      cache_read_input_tokens: 86_144,
      cache_creation_input_tokens: 500,
      output_tokens: 104,
    })
    const usage = updateUsage(initial, {
      ...EMPTY_USAGE,
      input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 105,
    })
    expect(getTokenCountFromUsage(usage)).toBe(91_739)
  })

  it('does not infer inclusive accounting without valid explicit provider metadata', () => {
    const raw = gatewayUsage()
    for (const billing_usage of [undefined, { semantic: 'anthropic' }, {
      semantic: 'openai', openai_usage: { prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 20 } },
    }]) {
      const event = { ...raw, billing_usage }
      const usage = updateUsage(EMPTY_USAGE, event)
      expect(usage.input_tokens).toBe(91_134)
      expect(usage.cache_read_input_tokens).toBe(86_144)
    }
  })

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
