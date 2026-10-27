import { CONTEXT_1M_BETA_HEADER } from '../constants/betas.js'
import { getGlobalConfig } from './config.js'
import { isEnvTruthy } from './envUtils.js'
import { getCanonicalName } from './model/model.js'
import { getModelCapability } from './model/modelCapabilities.js'

// Fallback when the configured provider does not publish a context window.
export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000

/**
 * Static context-window values used only when the provider does not publish
 * model metadata. These are deliberately conservative, high-confidence
 * families rather than an exhaustive model list. Provider metadata always
 * wins, so a model upgrade can take effect without a Moss release.
 *
 * Values are based on public model specifications reviewed 2026-10-26. Keep
 * the date here so refreshing this table is an explicit maintenance task.
 */
export const MODEL_CONTEXT_WINDOW_FALLBACKS = {
  claude: 200_000,
  gpt41: 1_047_576,
  gpt4o: 128_000,
  openaiReasoning: 200_000,
  gemini: 1_048_576,
  deepseek: 128_000,
  mistralLarge: 128_000,
  llama3: 128_000,
} as const

type ContextWindowFallbackRule = {
  readonly pattern: RegExp
  readonly contextWindow: number
}

// Match model families across common provider prefixes (for example
// "openai/gpt-4.1" and "us.anthropic.claude-sonnet-4-5-v1:0"). Do not add a
// generic provider prefix here: custom gateways may expose a different limit
// for the same-looking name, and their metadata should be authoritative.
const MODEL_CONTEXT_WINDOW_FALLBACK_RULES: readonly ContextWindowFallbackRule[] = [
  {
    pattern: /\bclaude-(?:3(?:-\d+)?|(?:opus|sonnet|haiku)-4)(?:[-_.:]|$)/i,
    contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.claude,
  },
  {
    pattern: /\bgpt-4\.1(?:[-_.:]|$)/i,
    contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.gpt41,
  },
  {
    pattern: /\bgpt-4o(?:[-_.:]|$)/i,
    contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.gpt4o,
  },
  {
    pattern: /\bo[134](?:[-_.:]|$)/i,
    contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.openaiReasoning,
  },
  {
    pattern: /\bgemini-(?:1\.5|2(?:\.\d+)?|3)(?:[-_.:]|$)/i,
    contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.gemini,
  },
  {
    pattern: /\bdeepseek-(?:chat|reasoner|v3|r1)(?:[-_.:]|$)/i,
    contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.deepseek,
  },
  {
    pattern: /\bmistral-large(?:[-_.:]|$)/i,
    contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.mistralLarge,
  },
  {
    pattern: /\bllama-3(?:\.\d+)?(?:[-_.:]|$)/i,
    contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.llama3,
  },
]

function normalizeModelForContextLookup(model: string): string {
  return model.replace(/\[1m\]$/i, '').trim().toLowerCase()
}

/** Return a curated static value, if the model belongs to a known family. */
export function getKnownModelContextWindow(model: string): number | undefined {
  const normalized = normalizeModelForContextLookup(model)
  if (!normalized) return undefined
  return MODEL_CONTEXT_WINDOW_FALLBACK_RULES.find(rule =>
    rule.pattern.test(normalized),
  )?.contextWindow
}

// Maximum output tokens for compact operations
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000

// Default max output tokens
const MAX_OUTPUT_TOKENS_DEFAULT = 32_000
const MAX_OUTPUT_TOKENS_UPPER_LIMIT = 64_000

// Capped default for slot-reservation optimization. BQ p99 output = 4,911
// tokens, so 32k/64k defaults over-reserve 8-16× slot capacity. With the cap
// enabled, <1% of requests hit the limit; those get one clean retry at 64k
// (see query.ts max_output_tokens_escalate). Cap is applied in
// claude.ts:getMaxOutputTokensForModel to avoid the featureFlags→betas→context
// import cycle.
export const CAPPED_DEFAULT_MAX_TOKENS = 8_000
export const ESCALATED_MAX_TOKENS = 64_000

/**
 * Check if 1M context is disabled via environment variable.
 * Used by C4E admins to disable 1M context for HIPAA compliance.
 */
export function is1mContextDisabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT)
}

export function has1mContext(model: string): boolean {
  if (is1mContextDisabled()) {
    return false
  }
  return /\[1m\]/i.test(model)
}

// @[MODEL LAUNCH]: Update this pattern if the new model supports 1M context
export function modelSupports1M(model: string): boolean {
  if (is1mContextDisabled()) {
    return false
  }
  const canonical = getCanonicalName(model)
  return canonical.includes('claude-sonnet-4') || canonical.includes('opus-4-6')
}

export function getContextWindowForModel(
  model: string,
  betas?: string[],
): number {
  return resolveContextWindowForModel(model, betas).contextWindow
}

/** The UI and request/compaction paths must agree on both capacity and provenance. */
export function resolveContextWindowForModel(
  model: string,
  betas?: string[],
): { contextWindow: number; isDefault: boolean } {
  // A display suffix must not override the actual provider's advertised limit.
  const baseModel = model.replace(/\[1m\]$/i, '').trim()
  const cap = getModelCapability(model) ?? getModelCapability(baseModel)
  const inputLimit = cap?.max_input_tokens
  if (typeof inputLimit === 'number' && Number.isSafeInteger(inputLimit) && inputLimit > 0) {
    return {
      contextWindow: is1mContextDisabled()
        ? Math.min(inputLimit, MODEL_CONTEXT_WINDOW_DEFAULT)
        : inputLimit,
      isDefault: false,
    }
  }

  // Keep the known Claude opt-in when metadata is unavailable, but don't infer
  // 1M support for arbitrary gateway models from a suffix or beta header.
  if (modelSupports1M(model) && (
    has1mContext(model) || betas?.includes(CONTEXT_1M_BETA_HEADER) ||
    getSonnet1mExpTreatmentEnabled(model)
  )) {
    return { contextWindow: 1_000_000, isDefault: false }
  }

  const knownContextWindow = getKnownModelContextWindow(model)
  if (knownContextWindow !== undefined) {
    return {
      contextWindow: is1mContextDisabled()
        ? Math.min(knownContextWindow, MODEL_CONTEXT_WINDOW_DEFAULT)
        : knownContextWindow,
      isDefault: false,
    }
  }

  return { contextWindow: MODEL_CONTEXT_WINDOW_DEFAULT, isDefault: true }
}

export function getSonnet1mExpTreatmentEnabled(model: string): boolean {
  if (is1mContextDisabled()) {
    return false
  }
  // Only applies to sonnet 4.6 without an explicit [1m] suffix
  if (has1mContext(model)) {
    return false
  }
  if (!getCanonicalName(model).includes('sonnet-4-6')) {
    return false
  }
  return getGlobalConfig().clientDataCache?.['coral_reef_sonnet'] === 'true'
}

/**
 * Calculate context window usage percentage from token usage data.
 * Returns used and remaining percentages, or null values if no usage data.
 */
export function calculateContextPercentages(
  currentUsage: {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null,
  contextWindowSize: number,
): { used: number | null; remaining: number | null } {
  if (!currentUsage) {
    return { used: null, remaining: null }
  }

  const totalInputTokens =
    currentUsage.input_tokens +
    currentUsage.cache_creation_input_tokens +
    currentUsage.cache_read_input_tokens

  const usedPercentage = Math.round(
    (totalInputTokens / contextWindowSize) * 100,
  )
  const clampedUsed = Math.min(100, Math.max(0, usedPercentage))

  return {
    used: clampedUsed,
    remaining: 100 - clampedUsed,
  }
}

/**
 * Returns the model's default and upper limit for max output tokens.
 */
export function getModelMaxOutputTokens(model: string): {
  default: number
  upperLimit: number
} {
  let defaultTokens: number
  let upperLimit: number

  const m = getCanonicalName(model)

  if (m.includes('opus-4-6')) {
    defaultTokens = 64_000
    upperLimit = 128_000
  } else if (m.includes('sonnet-4-6')) {
    defaultTokens = 32_000
    upperLimit = 128_000
  } else if (
    m.includes('opus-4-5') ||
    m.includes('sonnet-4') ||
    m.includes('haiku-4')
  ) {
    defaultTokens = 32_000
    upperLimit = 64_000
  } else if (m.includes('opus-4-1') || m.includes('opus-4')) {
    defaultTokens = 32_000
    upperLimit = 32_000
  } else if (m.includes('claude-3-opus')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else if (m.includes('claude-3-sonnet')) {
    defaultTokens = 8_192
    upperLimit = 8_192
  } else if (m.includes('claude-3-haiku')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else if (m.includes('3-5-sonnet') || m.includes('3-5-haiku')) {
    defaultTokens = 8_192
    upperLimit = 8_192
  } else if (m.includes('3-7-sonnet')) {
    defaultTokens = 32_000
    upperLimit = 64_000
  } else {
    defaultTokens = MAX_OUTPUT_TOKENS_DEFAULT
    upperLimit = MAX_OUTPUT_TOKENS_UPPER_LIMIT
  }

  const cap = getModelCapability(model) ?? getModelCapability(model.replace(/\[1m\]$/i, '').trim())
  if (cap?.max_tokens && Number.isSafeInteger(cap.max_tokens) && cap.max_tokens > 0) {
    upperLimit = cap.max_tokens
    defaultTokens = Math.min(defaultTokens, upperLimit)
  }

  return { default: defaultTokens, upperLimit }
}

/**
 * Returns the max thinking budget tokens for a given model. The max
 * thinking tokens should be strictly less than the max output tokens.
 *
 * Deprecated since newer models use adaptive thinking rather than a
 * strict thinking token budget.
 */
export function getMaxThinkingTokensForModel(model: string): number {
  return getModelMaxOutputTokens(model).upperLimit - 1
}
