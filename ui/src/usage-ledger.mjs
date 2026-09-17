function toTokenCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function toLocalDay(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayOrdinal(day) {
  const [year, month, date] = day.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / 86_400_000);
}

function calculateStreaks(activeDays, today) {
  let longest = 0;
  let run = 0;
  let previous = null;

  for (const day of activeDays) {
    const ordinal = dayOrdinal(day);
    run = previous !== null && ordinal === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = ordinal;
  }

  let current = 0;
  let expected = dayOrdinal(today);
  for (let index = activeDays.length - 1; index >= 0; index -= 1) {
    const ordinal = dayOrdinal(activeDays[index]);
    if (ordinal !== expected) break;
    current += 1;
    expected -= 1;
  }

  return { current, longest };
}

export function createUsageLedger(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      occurred_at INTEGER NOT NULL,
      day TEXT NOT NULL,
      session_id TEXT NOT NULL,
      project_id TEXT,
      request_id TEXT,
      model TEXT NOT NULL,
      query_source TEXT NOT NULL,
      agent_id TEXT,
      input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
      output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
      cache_read_tokens INTEGER NOT NULL CHECK (cache_read_tokens >= 0),
      cache_write_tokens INTEGER NOT NULL CHECK (cache_write_tokens >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_usage_events_day ON usage_events(day);
    CREATE INDEX IF NOT EXISTS idx_usage_events_session ON usage_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_usage_events_project ON usage_events(project_id) WHERE project_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS usage_daily (
      day TEXT PRIMARY KEY,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL,
      cache_write_tokens INTEGER NOT NULL,
      request_count INTEGER NOT NULL
    ) WITHOUT ROWID;

    CREATE TRIGGER IF NOT EXISTS usage_events_rollup
    AFTER INSERT ON usage_events
    BEGIN
      INSERT INTO usage_daily (
        day,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        request_count
      ) VALUES (
        NEW.day,
        NEW.input_tokens,
        NEW.output_tokens,
        NEW.cache_read_tokens,
        NEW.cache_write_tokens,
        1
      )
      ON CONFLICT(day) DO UPDATE SET
        input_tokens = input_tokens + NEW.input_tokens,
        output_tokens = output_tokens + NEW.output_tokens,
        cache_read_tokens = cache_read_tokens + NEW.cache_read_tokens,
        cache_write_tokens = cache_write_tokens + NEW.cache_write_tokens,
        request_count = request_count + 1;
    END;
  `);

  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO usage_events (
      event_id,
      occurred_at,
      day,
      session_id,
      project_id,
      request_id,
      model,
      query_source,
      agent_id,
      input_tokens,
      output_tokens,
      cache_read_tokens,
      cache_write_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectDaily = db.prepare(`
    SELECT
      day,
      input_tokens AS inputTokens,
      output_tokens AS outputTokens,
      cache_read_tokens AS cacheReadTokens,
      cache_write_tokens AS cacheWriteTokens,
      request_count AS requestCount
    FROM usage_daily
    ORDER BY day ASC
  `);

  return {
    record(event, context = {}) {
      const eventId = typeof event?.eventId === 'string' ? event.eventId.trim() : '';
      const sessionId = typeof context?.sessionId === 'string' ? context.sessionId.trim() : '';
      if (!eventId || !sessionId) return false;

      const occurredAt = Number.isFinite(event.occurredAt) ? Math.floor(event.occurredAt) : Date.now();
      const result = insertEvent.run(
        eventId,
        occurredAt,
        toLocalDay(occurredAt),
        sessionId,
        typeof context.projectId === 'string' && context.projectId ? context.projectId : null,
        typeof event.requestId === 'string' && event.requestId ? event.requestId : null,
        typeof event.model === 'string' && event.model ? event.model : 'unknown',
        typeof event.querySource === 'string' && event.querySource ? event.querySource : 'unknown',
        typeof event.agentId === 'string' && event.agentId ? event.agentId : null,
        toTokenCount(event.inputTokens),
        toTokenCount(event.outputTokens),
        toTokenCount(event.cacheReadTokens),
        toTokenCount(event.cacheWriteTokens),
      );
      return result.changes === 1;
    },

    getOverview(options = {}) {
      const now = Number.isFinite(options.now) ? options.now : Date.now();
      const today = toLocalDay(now);
      const daily = selectDaily.all().map((row) => {
        const inputTokens = Number(row.inputTokens);
        const outputTokens = Number(row.outputTokens);
        const cacheReadTokens = Number(row.cacheReadTokens);
        const cacheWriteTokens = Number(row.cacheWriteTokens);
        return {
          day: String(row.day),
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
          requestCount: Number(row.requestCount),
        };
      });

      const totals = daily.reduce((result, row) => ({
        inputTokens: result.inputTokens + row.inputTokens,
        outputTokens: result.outputTokens + row.outputTokens,
        cacheReadTokens: result.cacheReadTokens + row.cacheReadTokens,
        cacheWriteTokens: result.cacheWriteTokens + row.cacheWriteTokens,
        totalTokens: result.totalTokens + row.totalTokens,
        requestCount: result.requestCount + row.requestCount,
      }), {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        requestCount: 0,
      });
      const peak = daily.reduce(
        (result, row) => (row.totalTokens > result.totalTokens ? row : result),
        { day: null, totalTokens: 0 },
      );
      const activeDays = daily.filter((row) => row.totalTokens > 0).map((row) => row.day);
      const streaks = calculateStreaks(activeDays, today);
      const todayRow = daily.find((row) => row.day === today);

      return {
        generatedAt: now,
        totals: {
          ...totals,
          activeDays: activeDays.length,
          peakDay: peak.day,
          peakTokens: peak.totalTokens,
          currentStreak: streaks.current,
          longestStreak: streaks.longest,
          todayTokens: todayRow?.totalTokens ?? 0,
        },
        daily,
      };
    },
  };
}
