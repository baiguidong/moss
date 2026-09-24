export type ModelUsageEvent = {
  eventId: string
  occurredAt: number
  requestId?: string
  model: string
  querySource: string
  agentId?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type UsageOwner = { orgId: string; userId: string }
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

export function usageDay(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp)
  const value = (type: string) => parts.find(part => part.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}
