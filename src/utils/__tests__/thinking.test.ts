import { beforeEach, describe, expect, it } from 'bun:test'
import { get3PModelCapabilityOverride } from '../model/modelSupportOverrides.js'
import {
  buildAPIThinkingParam,
  modelSupportsAdaptiveThinking,
  modelSupportsThinking,
} from '../thinking.js'

const ORIGINAL_ENV = {
  MOSS_MODEL_BASE_URL: process.env.MOSS_MODEL_BASE_URL,
  ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
  ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES:
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES,
  CLAUDE_CODE_DISABLE_THINKING: process.env.CLAUDE_CODE_DISABLE_THINKING,
  CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING:
    process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING,
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
  get3PModelCapabilityOverride.cache.clear?.()
}

beforeEach(() => {
  resetEnv()
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_DISABLE_THINKING
  delete process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING
  get3PModelCapabilityOverride.cache.clear?.()
})

describe('thinking support on custom third-party model endpoints', () => {
  it('does not assume unknown custom-base-url models support thinking by default', () => {
    process.env.MOSS_MODEL_BASE_URL = 'https://api.minimaxi.com/v1'

    expect(modelSupportsThinking('MiniMax-M2.7')).toBe(false)
    expect(modelSupportsAdaptiveThinking('MiniMax-M2.7')).toBe(false)
  })

  it('still sends an explicit disabled thinking param when the user turns thinking off', () => {
    process.env.MOSS_MODEL_BASE_URL = 'https://api.minimaxi.com/v1'

    expect(
      buildAPIThinkingParam('MiniMax-M2.7', { type: 'disabled' }, 8000),
    ).toEqual({
      hasThinking: false,
      thinking: { type: 'disabled' },
    })
  })

  it('honors explicit capability overrides for custom compatible endpoints', () => {
    process.env.MOSS_MODEL_BASE_URL = 'https://api.minimaxi.com/v1'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'MiniMax-M2.7'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES =
      'thinking, adaptive_thinking'
    get3PModelCapabilityOverride.cache.clear?.()

    expect(get3PModelCapabilityOverride('MiniMax-M2.7', 'thinking')).toBe(true)
    expect(get3PModelCapabilityOverride('MiniMax-M2.7', 'adaptive_thinking')).toBe(
      true,
    )
    expect(modelSupportsThinking('MiniMax-M2.7')).toBe(true)
    expect(modelSupportsAdaptiveThinking('MiniMax-M2.7')).toBe(true)
  })
})
