import { APIError } from '@anthropic-ai/sdk'
import { formatAPIError } from './errorUtils.js'
import {
  type ThinkingCacheEntry,
  writeThinkingCache,
} from './thinkingCompatibilityCache.js'

export type ThinkingFallbackMode = 'disabled' | 'omit'

// Shared by attempts for one query, including its non-streaming fallback.
// Only confirmed successful fallbacks become cached parameter compatibility.
export interface ThinkingFallbackState {
  mode?: ThinkingFallbackMode
  cacheEntry?: ThinkingCacheEntry
  cacheChecked?: boolean
  pendingCacheWrite?: boolean
}

export async function confirmThinkingFallback(
  state: ThinkingFallbackState,
): Promise<void> {
  if (state.pendingCacheWrite && state.cacheEntry && state.mode) {
    state.pendingCacheWrite = false
    await writeThinkingCache(state.cacheEntry, state.mode)
  }
}

export function getThinkingFallbackMode(
  error: unknown,
): ThinkingFallbackMode | undefined {
  if (
    !(error instanceof APIError) ||
    (error.status !== 400 && error.status !== 422)
  ) {
    return undefined
  }

  const body = error.error as {
    error?: { param?: string; code?: string }
    param?: string
    code?: string
  } | undefined
  const details = body?.error ?? body
  if (
    details?.param === 'thinking' &&
    /^(unsupported|unknown|unrecognized)_parameter$/.test(details.code ?? '')
  ) {
    return 'omit'
  }
  if (
    (details?.param === 'thinking' || details?.param === 'thinking.type') &&
    details.code === 'unsupported_value'
  ) {
    return 'disabled'
  }

  const message = formatAPIError(error).toLowerCase()
  if (/\b(?:thinking|redacted_thinking)[ _]blocks?\b/.test(message)) {
    return undefined
  }
  // Match the rejected field itself, not unrelated errors that happen to
  // mention thinking somewhere in a request dump or validation explanation.
  if (
    /\b(?:unknown|unrecognized|unexpected|unsupported)\s+(?:request\s+)?(?:parameter|field|argument)(?:\s+supplied)?\s*[:=]?\s*['"`]?thinking['"`]?(?![\w.])/i.test(message) ||
    /\bthinking['"`]?\s+(?:parameter|field|argument)\s+(?:is\s+)?(?:not supported|unknown|unrecognized)\b/i.test(message) ||
    /\bextraneous key\s*\[thinking\]\s*is not permitted\b/i.test(message) ||
    /\bthinking['"`]?\s*:\s*extra inputs are not permitted\b/i.test(message) ||
    /additional properties are not allowed\s*\(['"]thinking['"] was unexpected\)/i.test(message)
  ) {
    // Even { type: 'disabled' } would still send the rejected field.
    return 'omit'
  }

  if (
    /\b(?:adaptive\s+|extended\s+)?thinking(?:\s+mode)?['"`]?\s+(?:is\s+|are\s+)?(?:not supported|unsupported)\b/i.test(message) ||
    /\b(?:does not|doesn't|do not|cannot)\s+support\s+(?:the\s+)?(?:adaptive\s+|extended\s+)?thinking\b/i.test(message) ||
    /\bunsupported\s+(?:adaptive\s+|extended\s+)?thinking(?:\s+mode)?\b/i.test(message) ||
    /\bthinking\.type['"`]?\s*:\s*(?:unsupported|not supported)\b/i.test(message)
  ) {
    return 'disabled'
  }

  return undefined
}
