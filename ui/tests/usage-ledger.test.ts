import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

const ledgerUrl = new URL('../src/usage-ledger.mjs', import.meta.url).href;

function runScenario(source: string) {
  const script = `
    import { DatabaseSync } from 'node:sqlite';
    import { createUsageLedger } from ${JSON.stringify(ledgerUrl)};
    const db = new DatabaseSync(':memory:');
    const ledger = createUsageLedger(db);
    try { ${source} } finally { db.close(); }
  `;
  const result = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe('usage ledger', () => {
  test('deduplicates provider events and rolls up usage in the insert transaction', () => {
    const result = runScenario(`
      const start = new Date(2026, 8, 14, 12).getTime();
      const first = ledger.record({
        eventId: 'request-1', occurredAt: start, requestId: 'request-1', model: 'model-a', querySource: 'sdk',
        inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 5,
      }, { sessionId: 'original-session', projectId: 'project-1' });
      const duplicateFromFork = ledger.record({
        eventId: 'request-1', occurredAt: start, requestId: 'request-1', model: 'model-a', querySource: 'sdk',
        inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 5,
      }, { sessionId: 'forked-session' });
      ledger.record({
        eventId: 'request-2', occurredAt: start + 86400000, model: 'model-a', querySource: 'agent:worker',
        inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0,
      }, { sessionId: 'original-session' });
      ledger.record({
        eventId: 'request-3', occurredAt: start + 2 * 86400000, model: 'model-b', querySource: 'sdk',
        inputTokens: 0, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0,
      }, { sessionId: 'original-session' });
      const overview = ledger.getOverview({ now: start + 2 * 86400000 });
      const eventCount = db.prepare('SELECT COUNT(*) AS count FROM usage_events').get().count;
      const dailyCount = db.prepare('SELECT COUNT(*) AS count FROM usage_daily').get().count;
      console.log(JSON.stringify({ first, duplicateFromFork, eventCount, dailyCount, overview }));
    `);

    expect(result.first).toBe(true);
    expect(result.duplicateFromFork).toBe(false);
    expect(result.eventCount).toBe(3);
    expect(result.dailyCount).toBe(3);
    expect(result.overview.totals).toMatchObject({
      inputTokens: 110,
      outputTokens: 62,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      totalTokens: 197,
      requestCount: 3,
      activeDays: 3,
      peakTokens: 175,
      currentStreak: 3,
      longestStreak: 3,
      todayTokens: 7,
    });
  });
});
