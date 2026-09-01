import { getMaxThinkingTokensForModel } from './context.js'
import { isEnvTruthy } from './envUtils.js'
import { getCanonicalName } from './model/model.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import {
  getAPIProvider,
  isFirstPartyModelBaseUrl,
} from './model/providers.js'
import { getSettingsWithErrors } from './settings/settings.js'

export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }

export type APIThinkingParam =
  | { type: 'adaptive' }
  | { type: 'enabled'; budget_tokens: number }
  | { type: 'disabled' }

// TODO(inigo): add support for probing unknown models via API error detection
// Provider-aware thinking support detection (aligns with modelSupportsISP in betas.ts)
export function modelSupportsThinking(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'thinking')
  if (supported3P !== undefined) {
    return supported3P
  }
  // IMPORTANT: Do not change thinking support without notifying the model
  // launch DRI and research. This can greatly affect model quality and bashing.
  const canonical = getCanonicalName(model)
  const provider = getAPIProvider()
  const isNativeFirstParty =
    provider === 'firstParty' && isFirstPartyModelBaseUrl()
  // 1P and Foundry: all Claude 4+ models (including Haiku 4.5)
  if (provider === 'foundry' || isNativeFirstParty) {
    return !canonical.includes('claude-3-')
  }
  // 3P (Bedrock/Vertex): only Opus 4+ and Sonnet 4+
  return canonical.includes('sonnet-4') || canonical.includes('opus-4')
}

// @[MODEL LAUNCH]: Add the new model to the allowlist if it supports adaptive thinking.
export function modelSupportsAdaptiveThinking(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'adaptive_thinking')
  if (supported3P !== undefined) {
    return supported3P
  }
  const canonical = getCanonicalName(model)
  // Supported by a subset of Claude 4 models
  if (canonical.includes('opus-4-6') || canonical.includes('sonnet-4-6')) {
    return true
  }
  // Exclude any other known legacy models (allowlist above catches 4-6 variants first)
  if (
    canonical.includes('opus') ||
    canonical.includes('sonnet') ||
    canonical.includes('haiku')
  ) {
    return false
  }
  // IMPORTANT: Do not change adaptive thinking support without notifying the
  // model launch DRI and research. This can greatly affect model quality and
  // bashing.

  // Newer models (4.6+) are all trained on adaptive thinking and MUST have it
  // enabled for model testing. DO NOT default to false for first party, otherwise
  // we may silently degrade model quality.

  // Default to true for unknown model strings on 1P and Foundry (because Foundry
  // is a proxy). Do not default to true for other 3P as they have different formats
  // for their model strings.
  const provider = getAPIProvider()
  return (
    provider === 'foundry' ||
    (provider === 'firstParty' && isFirstPartyModelBaseUrl())
  )
}

function modelRejectsDisabledThinking(model: string): boolean {
  return false
}

export function buildAPIThinkingParam(
  model: string,
  thinkingConfig: ThinkingConfig,
  maxOutputTokens: number,
): {
  hasThinking: boolean
  thinking: APIThinkingParam | undefined
} {
  const thinkingDisabled =
    thinkingConfig.type === 'disabled' ||
    isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_THINKING)

  if (thinkingDisabled) {
    return {
      hasThinking: false,
      thinking: modelRejectsDisabledThinking(model)
        ? undefined
        : { type: 'disabled' },
    }
  }

  if (!modelSupportsThinking(model)) {
    return {
      hasThinking: false,
      thinking: undefined,
    }
  }

  if (
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING) &&
    modelSupportsAdaptiveThinking(model)
  ) {
    return {
      hasThinking: true,
      thinking: { type: 'adaptive' },
    }
  }

  let thinkingBudget = getMaxThinkingTokensForModel(model)
  if (
    thinkingConfig.type === 'enabled' &&
    thinkingConfig.budgetTokens !== undefined
  ) {
    thinkingBudget = thinkingConfig.budgetTokens
  }
  thinkingBudget = Math.min(maxOutputTokens - 1, thinkingBudget)

  return {
    hasThinking: true,
    thinking: {
      budget_tokens: thinkingBudget,
      type: 'enabled',
    },
  }
}

export function shouldEnableThinkingByDefault(): boolean {
  if (process.env.MAX_THINKING_TOKENS) {
    return parseInt(process.env.MAX_THINKING_TOKENS, 10) > 0
  }

  const { settings } = getSettingsWithErrors()
  if (settings.thinkingMode === 'disabled') return false
  if (settings.thinkingMode === 'enabled' || settings.thinkingMode === 'adaptive') return true
  if (settings.alwaysThinkingEnabled === false) {
    return false
  }

  // IMPORTANT: Do not change default thinking enabled value without notifying
  // the model launch DRI and research. This can greatly affect model quality and
  // bashing.

  // Enable thinking by default unless explicitly disabled.
  return true
}
