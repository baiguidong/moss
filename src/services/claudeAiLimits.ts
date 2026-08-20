export type QuotaStatus = 'allowed' | 'allowed_warning' | 'rejected'

export type RateLimitType =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet'
  | 'overage'

export type OverageDisabledReason =
  | 'user'
  | 'workspace'
  | 'org'
  | 'no_payment_method'
  | 'unsupported'

export type ClaudeAILimits = {
  status: QuotaStatus
  unifiedRateLimitFallbackAvailable: boolean
  resetsAt?: number
  rateLimitType?: RateLimitType
  utilization?: number
  overageStatus?: QuotaStatus
  overageResetsAt?: number
  overageDisabledReason?: OverageDisabledReason
  isUsingOverage?: boolean
  surpassedThreshold?: number
}

const defaultLimits: ClaudeAILimits = {
  status: 'allowed',
  unifiedRateLimitFallbackAvailable: false,
  isUsingOverage: false,
}

export let currentLimits: ClaudeAILimits = { ...defaultLimits }

type RawWindowUtilization = {
  utilization: number
  resets_at: number
}

type RawUtilization = {
  five_hour?: RawWindowUtilization
  seven_day?: RawWindowUtilization
}

let rawUtilization: RawUtilization = {}

export function getRawUtilization(): RawUtilization {
  return rawUtilization
}

type StatusChangeListener = (limits: ClaudeAILimits) => void

export const statusListeners: Set<StatusChangeListener> = new Set()

export function emitStatusChange(limits: ClaudeAILimits): void {
  currentLimits = limits
  statusListeners.forEach(listener => listener(limits))
}

export function extractQuotaStatusFromHeaders(
  _headers: globalThis.Headers,
): void {
  rawUtilization = {}
  if (currentLimits.status !== 'allowed' || currentLimits.resetsAt) {
    emitStatusChange({ ...defaultLimits })
  }
}

export function extractQuotaStatusFromError(_error: unknown): void {
  return
}

export {
  getRateLimitErrorMessage,
  getRateLimitWarning,
  getUsingOverageText,
} from './rateLimitMessages.js'
