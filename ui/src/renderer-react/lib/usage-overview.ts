import type { UsageDailySummary } from '../types';

export function mergeUsageDaily(...sources: ReadonlyArray<ReadonlyArray<UsageDailySummary>>): UsageDailySummary[] {
  const days = new Map<string, UsageDailySummary>();
  for (const source of sources) {
    for (const row of source) {
      const previous = days.get(row.day);
      days.set(row.day, previous ? {
        day: row.day,
        inputTokens: previous.inputTokens + row.inputTokens,
        outputTokens: previous.outputTokens + row.outputTokens,
        cacheReadTokens: previous.cacheReadTokens + row.cacheReadTokens,
        cacheWriteTokens: previous.cacheWriteTokens + row.cacheWriteTokens,
        totalTokens: previous.totalTokens + row.totalTokens,
        requestCount: previous.requestCount + row.requestCount,
      } : { ...row });
    }
  }
  return [...days.values()].sort((left, right) => left.day.localeCompare(right.day));
}
