import { describe, expect, test } from 'bun:test';
import { appendSessionRuntimeEvent } from '../src/shared/assistant-usage-reconcile.mjs';
import { deriveContextUsage } from '../src/renderer-react/lib/context-usage';
import { buildSessionInfo } from '../src/renderer-react/lib/session-info';

const start = (id: string, extra = {}) => ({ type: 'stream_event',
  event: { type: 'message_start', message: { id } }, ...extra });
const assistant = (id: string, extra = {}) => ({ type: 'assistant',
  message: { id, model: 'gpt-6-sol', usage: { input_tokens: 221_624, output_tokens: 0 },
    stop_reason: null, content: [] }, ...extra });
const usage = { input_tokens: 3, output_tokens: 1122, cache_read_input_tokens: 191_863,
  cache_creation_input_tokens: 2565 };
const delta = (extra = {}) => ({ type: 'stream_event',
  event: { type: 'message_delta', usage, delta: { stop_reason: 'tool_use' } }, ...extra });

describe('final assistant usage reconciliation', () => {
  test('updates every split block without duplicating the request or mutating previous state', () => {
    const before = [start('request-a'), assistant('request-a'),
      { type: 'user', message: { content: 'tool result' } }, assistant('request-a')];
    const history = appendSessionRuntimeEvent(before, delta());
    const blocks = history.filter(event => event.type === 'assistant');
    expect(blocks).toHaveLength(2);
    for (const block of blocks) expect(block.message).toMatchObject({ usage, stop_reason: 'tool_use' });
    expect(before[1].message?.usage.output_tokens).toBe(0);
    expect(deriveContextUsage(history, null)).toMatchObject({ used: 195_553, outputTokens: 1122 });
    expect(buildSessionInfo(history).historyUsage?.totals).toMatchObject({
      totalTokens: 195_553, outputTokens: 1122, requestCount: 1,
    });
  });

  test('does not overwrite another response or a subagent with the same response ID', () => {
    const other = assistant('older');
    const worker = assistant('request-a', { parent_tool_use_id: 'worker' });
    const history = appendSessionRuntimeEvent([other, start('request-a'), assistant('request-a'), worker], delta());
    expect(history[0]).toBe(other);
    expect(history[3]).toBe(worker);
    const workerHistory = appendSessionRuntimeEvent(history, delta({ parent_tool_use_id: 'worker' }));
    expect(workerHistory[2]).toBe(history[2]);
    expect(workerHistory[3].message.usage).toEqual(usage);
  });

  test('does not apply a delta to an earlier response when the new request has no blocks', () => {
    const previous = assistant('older');
    const history = appendSessionRuntimeEvent([previous, start('empty-new')], delta());
    expect(history[0]).toBe(previous);
  });

  test('keeps fully cached final input zero and ignores pre-compaction context', () => {
    const event = delta();
    event.event.usage = { ...usage, input_tokens: 0, cache_read_input_tokens: 194_428,
      cache_creation_input_tokens: 0 };
    const history = appendSessionRuntimeEvent([start('cached'), assistant('cached')], event);
    expect(deriveContextUsage(history, null)).toMatchObject({ inputTokens: 0, used: 195_550 });
    expect(deriveContextUsage([...history, { type: 'system', subtype: 'compact_boundary' }], null)).toBeNull();
  });

  test('does not apply provider usage to a synthetic error emitted before the final delta', () => {
    const synthetic = { type: 'assistant', isApiErrorMessage: true,
      message: { id: 'synthetic', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } };
    const history = appendSessionRuntimeEvent([start('request-a'), assistant('request-a'), synthetic], delta());
    expect(history[1].message.usage).toEqual(usage);
    expect(history[2]).toBe(synthetic);
  });
});
