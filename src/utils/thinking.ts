import { getMaxThinkingTokensForModel } from './context.js'
import { isEnvTruthy } from './envUtils.js'
import { getSettingsWithErrors } from './settings/settings.js'

export type ThinkingConfig =
  | { type: 'auto' }
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }

export type APIThinkingParam =
  | { type: 'adaptive' }
  | { type: 'enabled'; budget_tokens: number }
  | { type: 'disabled' }

export function buildAPIThinkingParam(
  model: string,
  thinkingConfig: ThinkingConfig | undefined,
  maxOutputTokens: number,
  disableThinking = isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_THINKING),
): {
  hasThinking: boolean
  thinking: APIThinkingParam | undefined
} {
  const thinkingDisabled =
    thinkingConfig?.type === 'disabled' ||
    disableThinking

  if (thinkingDisabled) {
    return {
      hasThinking: false,
      thinking: { type: 'disabled' },
    }
  }

  // Unspecified means the endpoint chooses its default. It is not a request
  // to disable reasoning, and must not be serialized as disabled or none.
  if (!thinkingConfig || thinkingConfig.type === 'auto') {
    return { hasThinking: false, thinking: undefined }
  }

  // Forward the selected mode for every model. The configured endpoint decides
  // whether it accepts the mode and whether to return visible thinking content.
  if (thinkingConfig.type === 'adaptive') {
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
