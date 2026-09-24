import { authClient } from './client'
import type { AuthUser } from './types'

export type UsageDailySummary = {
  day: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  requestCount: number
}

export type UsageOverview = {
  user: AuthUser
  generatedAt: number
  timezone: string
  today: string
  historyIncomplete: boolean
  totals: Omit<UsageDailySummary, 'day'> & {
    activeDays: number
    peakDay: string | null
    peakTokens: number
  }
  daily: UsageDailySummary[]
}

export function getUserUsage(userId?: string): Promise<UsageOverview> {
  return authClient.get(userId ? `/api/v1/users/${encodeURIComponent(userId)}/usage` : '/api/v1/usage')
}
