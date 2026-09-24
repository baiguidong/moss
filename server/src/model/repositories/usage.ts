import { createHash } from 'node:crypto'
import type { Database } from '../database.js'
import { usageDay, type ModelUsageEvent, type UsageDailySummary, type UsageOverview, type UsageOwner } from '../../usageTypes.js'

const count = (value: unknown) => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

export class UsageRepository {
  private metadata: Promise<{ historyBefore: number; timezone: string }> | undefined
  constructor(readonly db: Database) {}

  getMetadata() {
    return this.metadata ??= this.db.prepare('SELECT * FROM usage_metadata WHERE id=1').get().then(row => {
      if (!row) throw new Error('Usage database is not initialized')
      return { historyBefore: Number(row.history_before), timezone: String(row.timezone) }
    }).catch(error => {
      this.metadata = undefined
      throw error
    })
  }

  async record(owner: UsageOwner, sessionId: string, event: ModelUsageEvent): Promise<void> {
    if (!event.eventId || !Number.isFinite(event.occurredAt) || event.occurredAt <= 0) return
    const tokens = [event.inputTokens, event.outputTokens, event.cacheReadTokens, event.cacheWriteTokens].map(count)
    if (!tokens.some(value => value > 0)) return
    const { timezone } = await this.getMetadata()
    const eventKey = createHash('sha256').update(event.eventId).digest('hex')
    // Count a provider response once, retaining the final counters if history
    // was initially incomplete. Replays never add to the same request twice.
    const fields = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']
    await this.db.prepare(this.db.sql(
      `INSERT INTO usage_events
        (org_id,event_key,user_id,session_id,occurred_at,day,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(org_id,event_key) DO UPDATE SET
        ${fields.map(field => `${field}=MAX(usage_events.${field},excluded.${field})`).join(',')},
        day=CASE WHEN excluded.occurred_at>usage_events.occurred_at THEN excluded.day ELSE usage_events.day END,
        occurred_at=MAX(usage_events.occurred_at,excluded.occurred_at)
        WHERE usage_events.user_id=excluded.user_id`,
      `INSERT INTO usage_events
        (org_id,event_key,user_id,session_id,occurred_at,day,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
        ${fields.map(field => `${field}=IF(user_id=VALUES(user_id),GREATEST(${field},VALUES(${field})),${field})`).join(',')},
        day=IF(user_id=VALUES(user_id) AND VALUES(occurred_at)>occurred_at,VALUES(day),day),
        occurred_at=IF(user_id=VALUES(user_id),GREATEST(occurred_at,VALUES(occurred_at)),occurred_at)`,
    )).run(owner.orgId, eventKey, owner.userId, sessionId, Math.floor(event.occurredAt), usageDay(event.occurredAt, timezone), ...tokens)
  }

  async hasImported(owner: UsageOwner): Promise<boolean> {
    return Boolean(await this.db.prepare('SELECT user_id FROM usage_imports WHERE org_id=? AND user_id=?').get(owner.orgId, owner.userId))
  }

  async markImported(owner: UsageOwner): Promise<void> {
    await this.db.prepare(this.db.sql(
      'INSERT OR IGNORE INTO usage_imports (org_id,user_id,completed_at) VALUES (?,?,?)',
      'INSERT INTO usage_imports (org_id,user_id,completed_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE completed_at=completed_at',
    )).run(owner.orgId, owner.userId, Date.now())
  }

  async getOverview(owner: UsageOwner, historyIncomplete = false, now = Date.now()): Promise<UsageOverview> {
    const { timezone } = await this.getMetadata()
    const rows = await this.db.prepare(`SELECT day,
      SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
      SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens,
      COUNT(*) AS request_count FROM usage_events WHERE org_id=? AND user_id=? GROUP BY day ORDER BY day
    `).all(owner.orgId, owner.userId)
    const daily: UsageDailySummary[] = rows.map(row => {
      const inputTokens = Number(row.input_tokens)
      const outputTokens = Number(row.output_tokens)
      const cacheReadTokens = Number(row.cache_read_tokens)
      const cacheWriteTokens = Number(row.cache_write_tokens)
      return { day: String(row.day), inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
        totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens, requestCount: Number(row.request_count) }
    })
    const totals: UsageOverview['totals'] = {
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      totalTokens: 0, requestCount: 0, activeDays: 0, peakDay: null, peakTokens: 0,
    }
    for (const row of daily) {
      for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens', 'requestCount'] as const) {
        totals[key] += row[key]
      }
      if (row.totalTokens > 0) totals.activeDays++
      if (row.totalTokens > totals.peakTokens) {
        totals.peakTokens = row.totalTokens
        totals.peakDay = row.day
      }
    }
    return { generatedAt: now, timezone, today: usageDay(now, timezone), historyIncomplete, totals, daily }
  }
}
