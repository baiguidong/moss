export type Span = {
  setAttribute(name: string, value: string | number | boolean): void
  setAttributes(attributes: Record<string, string | number | boolean>): void
  addEvent(
    eventName: string,
    attributes?: Record<string, string | number | boolean>,
  ): void
  recordException(error: unknown): void
  end(): void
  spanContext(): { spanId: string }
}

export interface LLMRequestNewContext {
  systemPrompt?: string
  querySource?: string
  tools?: string
}

const noopSpan: Span = {
  setAttribute() {},
  setAttributes() {},
  addEvent() {},
  recordException() {},
  end() {},
  spanContext() {
    return { spanId: 'noop' }
  },
}

export function isBetaTracingEnabled(): boolean {
  return false
}

export function isEnhancedTelemetryEnabled(): boolean {
  return false
}

export function startInteractionSpan(_userPrompt: string): Span {
  return noopSpan
}

export function endInteractionSpan(): void {
  return
}

export function startLLMRequestSpan(
  _model: string,
  _newContext?: LLMRequestNewContext,
  _messagesForAPI?: unknown[],
  _fastMode?: boolean,
): Span {
  return noopSpan
}

export function endLLMRequestSpan(
  _span?: Span,
  _metadata?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    success?: boolean
    statusCode?: number
    error?: string
    attempt?: number
    modelResponse?: string
    modelOutput?: string
    thinkingOutput?: string
    hasToolCall?: boolean
    ttftMs?: number
    requestSetupMs?: number
    attemptStartTimes?: number[]
  },
): void {
  return
}

export function startToolSpan(
  _toolName: string,
  _toolAttributes?: Record<string, string | number | boolean>,
): Span {
  return noopSpan
}

export function startToolBlockedOnUserSpan(): Span {
  return noopSpan
}

export function endToolBlockedOnUserSpan(
  _decision?: string,
  _source?: string,
): void {
  return
}

export function startToolExecutionSpan(): Span {
  return noopSpan
}

export function endToolExecutionSpan(_metadata?: {
  success?: boolean
  error?: string
}): void {
  return
}

export function endToolSpan(
  _toolResult?: string,
  _resultTokens?: number,
): void {
  return
}

export function addToolContentEvent(
  _eventName: string,
  _attributes: Record<string, string | number | boolean>,
): void {
  return
}

export function getCurrentSpan(): Span | null {
  return null
}

export async function executeInSpan<T>(
  _spanName: string,
  fn: (span: Span) => Promise<T>,
  _attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return fn(noopSpan)
}

export function startHookSpan(
  _hookEvent: string,
  _hookName: string,
  _numHooks: number,
  _hookDefinitions: string,
): Span {
  return noopSpan
}

export function endHookSpan(
  _span: Span,
  _metadata?: {
    numSuccess?: number
    numBlocking?: number
    numNonBlockingError?: number
    numCancelled?: number
  },
): void {
  return
}
