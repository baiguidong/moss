import { expect, test } from 'bun:test';
import { formatApiRetry } from '../src/renderer-react/lib/api-retry';
import { buildMainChatRenderMessagesFromHistory } from '../src/renderer-react/lib/agent-transcript';

test('retry display includes protocol facts, and missing legacy fields stay unknown', () => {
  const event = { type: 'system', subtype: 'api_retry', attempt: 2, retry_delay_ms: 500, error_status: 503,
    retry_budget: { waitedMs: 300, maxWaitMs: 120000, maxAttempts: 12 } };
  expect(formatApiRetry(event)).toContain('累计等待 0.3 / 120 秒');
  expect(formatApiRetry(event)).toContain('HTTP 503');
  expect(formatApiRetry({ attempt: 1 })).not.toContain('累计等待');
  expect(formatApiRetry({ attempt: NaN, retry_delay_ms: Infinity })).not.toContain('NaN');
  const messages = buildMainChatRenderMessagesFromHistory([event, { ...event, attempt: 3 }]);
  const records = messages.filter(message => message.type === 'system');
  expect(records).toHaveLength(1);
  expect(records[0]?.content).toContain('已尝试 3 次');
});
