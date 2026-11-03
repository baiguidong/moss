import { createHash } from 'node:crypto'
import type { Database } from '../database.js'
import { usageDay, type ModelUsageEvent, type UsageDailySummary, type UsageOverview, type UsageOwner } from '../../usageTypes.js'

const count = (value: unknown) => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

export class UsageRepository {
  private metadata: Promise<{ timezone: string }> | undefined
  constructor(readonly db: Database) {}

  getMetadata() {
    return this.metadata ??= this.db.prepare('SELECT timezone FROM usage_metadata WHERE id=1').get().then(row => {
      if (!row) throw new Error('Usage database is not initialized')
      return { timezone: String(row.timezone) }
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

  async getOverview(owner: UsageOwner, now = Date.now(), hostIds?: readonly string[]): Promise<UsageOverview> {
    const { timezone } = await this.getMetadata()
    // Host reports prefix the session id with the reporting host id. A scoped
    // overview must use those records only; otherwise a user's Desktop usage
    // is mixed into the cloud computer card and old Server sessions can leak
    // into the result.
    const prefixes = (hostIds || []).map(hostId => `${hostId}:`)
    const hostFilter = hostIds === undefined
      ? ''
      : prefixes.length > 0
        ? ` AND (${prefixes.map(() => 'substr(session_id, 1, ?) = ?').join(' OR ')})`
        : ' AND 1=0'
    const params = [owner.orgId, owner.userId, ...prefixes.flatMap(prefix => [prefix.length, prefix])]
    const rows = await this.db.prepare(`SELECT day,
      SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
      SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens,
      COUNT(*) AS request_count FROM usage_events WHERE org_id=? AND user_id=?${hostFilter} GROUP BY day ORDER BY day
    `).all(...params)
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
    return { generatedAt: now, timezone, today: usageDay(now, timezone), totals, daily }
  }
}
