type SpanLike = {
  setAttribute?: (name: string, value: string | number | boolean) => void
  setAttributes?: (attributes: Record<string, string | number | boolean>) => void
}

export interface LLMRequestNewContext {
  systemPrompt?: string
  querySource?: string
  tools?: string
}

export function clearBetaTracingState(): void {
  return
}

export function isBetaTracingEnabled(): boolean {
  return false
}

export function truncateContent(content: string): {
  content: string
  truncated: boolean
} {
  return { content, truncated: false }
}

export function addBetaInteractionAttributes(
  _span: SpanLike,
  _userPrompt: string,
): void {
  return
}

export function addBetaLLMRequestAttributes(
  _span: SpanLike,
  _newContext?: LLMRequestNewContext,
  _messagesForAPI?: unknown[],
): void {
  return
}

export function addBetaLLMResponseAttributes(
  _endAttributes: Record<string, string | number | boolean>,
  _metadata?: {
    modelOutput?: string
    thinkingOutput?: string
  },
): void {
  return
}

export function addBetaToolInputAttributes(
  _span: SpanLike,
  _toolName: string,
  _toolInput: string,
): void {
  return
}

export function addBetaToolResultAttributes(
  _endAttributes: Record<string, string | number | boolean>,
  _toolName: string | number | boolean,
  _toolResult: string,
): void {
  return
}
