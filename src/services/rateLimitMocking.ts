export function shouldProcessRateLimits(): boolean {
  return false
}

export function withRetry(): unknown {
  return null
}

export const rateLimitHeaders = {}
export type RateLimitInfo = Record<string, unknown>

export function processRateLimitHeaders(): void {}
export function checkMockRateLimitError(): boolean {
  return false
}
export function isMockRateLimitError(): boolean {
  return false
}