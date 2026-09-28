import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { buildAPIThinkingParam } from '../thinking.js'

const ORIGINAL_ENV = {
  MOSS_MODEL_BASE_URL: process.env.MOSS_MODEL_BASE_URL,
  ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
  ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES:
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES,
  CLAUDE_CODE_DISABLE_THINKING: process.env.CLAUDE_CODE_DISABLE_THINKING,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
}

function restoreEnvVar(
  key: keyof typeof ORIGINAL_ENV,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function resetEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    restoreEnvVar(key as keyof typeof ORIGINAL_ENV, value)
  }
}

beforeEach(() => {
  resetEnv()
  process.env.MOSS_MODEL_BASE_URL = 'https://model.example.test'
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_DISABLE_THINKING
})

afterEach(resetEnv)

describe('thinking configuration forwarding', () => {
  it.each([
    'gpt-5.5',
    'deepseek-reasoner',
    'Qwen3',
    'MiniMax-M2.7',
    'my-custom-model',
    'claude-3-7-sonnet',
    'claude-haiku-4-5',
    'claude-sonnet-4-0',
    'claude-opus-4-6',
  ])('preserves all three configured modes for %s', model => {
    expect(buildAPIThinkingParam(model, { type: 'adaptive' }, 32000))
      .toEqual({ hasThinking: true, thinking: { type: 'adaptive' } })
    expect(buildAPIThinkingParam(model, { type: 'enabled', budgetTokens: 16000 }, 32000))
      .toEqual({
        hasThinking: true,
        thinking: { type: 'enabled', budget_tokens: 16000 },
      })
    expect(buildAPIThinkingParam(model, { type: 'disabled' }, 32000))
      .toEqual({ hasThinking: false, thinking: { type: 'disabled' } })
  })

  it.each([
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_VERTEX',
  ])('does not suppress configured adaptive thinking with %s', providerFlag => {
    process.env[providerFlag] = '1'
    expect(buildAPIThinkingParam('my-custom-model', { type: 'adaptive' }, 32000))
      .toEqual({ hasThinking: true, thinking: { type: 'adaptive' } })
  })

  it('does not let a model capability list override the selected mode', () => {
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'my-custom-model'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES = 'effort'

    expect(buildAPIThinkingParam('my-custom-model', { type: 'adaptive' }, 32000))
      .toEqual({ hasThinking: true, thinking: { type: 'adaptive' } })
  })

  it('caps an explicitly enabled budget below the output limit', () => {
    process.env.MOSS_MODEL_BASE_URL = 'https://model.example.test'

    expect(buildAPIThinkingParam('gpt-5.5', { type: 'enabled', budgetTokens: 16000 }, 8000))
      .toEqual({
        hasThinking: true,
        thinking: { type: 'enabled', budget_tokens: 7999 },
      })
  })

  it('retains the global thinking disable setting', () => {
    process.env.MOSS_MODEL_BASE_URL = 'https://model.example.test'
    process.env.CLAUDE_CODE_DISABLE_THINKING = '1'

    for (const config of [{ type: 'adaptive' }, { type: 'enabled', budgetTokens: 16000 }] as const) {
      expect(buildAPIThinkingParam('gpt-5.5', config, 32000))
        .toEqual({ hasThinking: false, thinking: { type: 'disabled' } })
    }
  })
})
