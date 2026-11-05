// Used when neither provider metadata nor a user declaration supplies a limit.
export const UNKNOWN_MODEL_CONTEXT_WINDOW = 1_050_000
// Reserve the published 128,000 maximum output budget from a 1,050,000 window.
export const UNKNOWN_MODEL_MAX_INPUT_TOKENS = 922_000

export const MODEL_CONTEXT_WINDOW_FALLBACKS = {
  claude: 200_000,
  gpt41: 1_047_576,
  gpt4o: 128_000,
  gpt6: 1_050_000,
  openaiReasoning: 200_000,
  gemini: 1_048_576,
  deepseek: 128_000,
  mistralLarge: 128_000,
  llama3: 128_000,
} as const

type ModelRule = { pattern: RegExp; contextWindow: number; maxInputTokens?: number }

const RULES: readonly ModelRule[] = [
  { pattern: /\bclaude-(?:3(?:-\d+)?|(?:opus|sonnet|haiku)-4)(?:[-_.:]|$)/i, contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.claude },
  { pattern: /\bgpt-4\.1(?:[-_.:]|$)/i, contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.gpt41 },
  { pattern: /\bgpt-4o(?:[-_.:]|$)/i, contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.gpt4o },
  // GPT-6/GPT-6.1 API pages publish 1,050,000 context and 128,000 max output.
  { pattern: /(?:^|\/)(?:gpt-6-(?:astra|sol|luna)|gpt-6\.1-(?:sol|terra))$/i, contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.gpt6, maxInputTokens: UNKNOWN_MODEL_MAX_INPUT_TOKENS },
  { pattern: /\bo[134](?:[-_.:]|$)/i, contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.openaiReasoning },
  { pattern: /\bgemini-(?:1\.5|2(?:\.\d+)?|3)(?:[-_.:]|$)/i, contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.gemini },
  { pattern: /\bdeepseek-(?:chat|reasoner|v3|r1)(?:[-_.:]|$)/i, contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.deepseek },
  { pattern: /\bmistral-large(?:[-_.:]|$)/i, contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.mistralLarge },
  { pattern: /\bllama-3(?:\.\d+)?(?:[-_.:]|$)/i, contextWindow: MODEL_CONTEXT_WINDOW_FALLBACKS.llama3 },
]

function findRule(model: string): ModelRule | undefined {
  const normalized = model.replace(/\[1m\]$/i, '').trim()
  return normalized ? RULES.find(rule => rule.pattern.test(normalized)) : undefined
}

export function getKnownModelContextWindow(model: string): number | undefined {
  return findRule(model)?.contextWindow
}

export function getKnownModelMaxInputTokens(model: string): number | undefined {
  return findRule(model)?.maxInputTokens
}
