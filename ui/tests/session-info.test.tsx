import { describe, expect, it } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSessionInfo } from '../src/renderer-react/lib/session-info';
import { SessionInfoContent } from '../src/renderer-react/components/session-info';
import type { SessionDetail } from '../src/renderer-react/types';

const assistant = (id: string, usage: Record<string, number>, extra = {}) => ({
  type: 'assistant', message: { id, model: 'model-a', usage, content: [] }, ...extra,
});

describe('session information', () => {
  it('counts provider requests once across split assistant events and ignores cumulative result snapshots', () => {
    const info = buildSessionInfo([
      assistant('request-a', { input_tokens: 100, output_tokens: 2, cache_read_input_tokens: 50 }),
      assistant('request-a', { input_tokens: 0, output_tokens: 20, cache_creation_input_tokens: 10 }),
      assistant('request-b', { input_tokens: 40, output_tokens: 5 }),
      { type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 999 } } },
      { type: 'result', usage: { input_tokens: 9999, output_tokens: 9999 }, duration_ms: 3000 },
      { type: 'result', usage: { input_tokens: 9999, output_tokens: 9999 }, duration_ms: 500 },
      assistant('synthetic', { input_tokens: 999 }, { message: { model: '<synthetic>', usage: { input_tokens: 999 } } }),
    ]);
    expect(info.historyUsage?.totals).toEqual({ inputTokens: 140, outputTokens: 25, cacheReadTokens: 50, cacheWriteTokens: 10, totalTokens: 225, requestCount: 2 });
    expect(info.latestContext?.totalTokens).toBe(45);
    expect(info.lastTurnDurationMs).toBe(500);
  });

  it('does not use subagent usage or a pre-compaction snapshot as current context', () => {
    const main = assistant('main', { input_tokens: 100, output_tokens: 10 });
    const worker = assistant('worker', { input_tokens: 500, output_tokens: 50 }, { parent_tool_use_id: 'agent-1' });
    expect(buildSessionInfo([main, worker]).latestContext?.totalTokens).toBe(110);
    const compact = { type: 'system', subtype: 'compact_boundary', uuid: 'compact-1' };
    const info = buildSessionInfo([main, worker, compact, compact]);
    expect(info.compactionCount).toBe(1);
    expect(info.latestContext).toBeNull();
    expect(info.historyUsage?.totals.totalTokens).toBe(660);
  });

  it('deduplicates streamed tool calls, includes hidden tools, and measures only recorded completed calls', () => {
    const start = { type: 'tool_use', id: 'read-1', name: 'Read' };
    const info = buildSessionInfo([
      { type: 'stream_event', timestamp: 1000, event: { type: 'content_block_start', content_block: start } },
      { type: 'assistant', timestamp: 1200, message: { content: [start, { type: 'tool_use', id: 'question-1', name: 'AskUserQuestion' }] } },
      { type: 'user', timestamp: 3000, message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', is_error: false }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'read-2', name: 'Read' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read-2', is_error: true }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'agent-1', name: 'Agent' }] } },
    ]);
    expect(info.tools).toMatchObject({ total: 4, success: 1, error: 1, unknown: 2, durationMs: 2000, timedCount: 1 });
    expect(info.tools.rows[0]).toMatchObject({ name: 'Read', total: 2, error: 1, durationMs: 2000, timedCount: 1 });
  });

  it('replaces provisional usage with the final response instead of combining component maxima', () => {
    const provisional = assistant('request-a', { input_tokens: 221_624, output_tokens: 0 });
    const finalized = { ...assistant('request-a', { input_tokens: 3, output_tokens: 1122,
      cache_read_input_tokens: 191_863, cache_creation_input_tokens: 2565 }),
      message: { id: 'request-a', model: 'model-a', content: [], stop_reason: 'tool_use',
        usage: { input_tokens: 3, output_tokens: 1122, cache_read_input_tokens: 191_863,
          cache_creation_input_tokens: 2565 } } };
    const info = buildSessionInfo([provisional, finalized, provisional]);
    expect(info.latestContext?.totalTokens).toBe(195_553);
    expect(info.historyUsage?.totals).toMatchObject({ inputTokens: 3, outputTokens: 1122,
      cacheReadTokens: 191_863, cacheWriteTokens: 2565, totalTokens: 195_553, requestCount: 1 });
  });

  it('does not infer missing historical billing when a new response arrives in the same session', () => {
    const historical = assistant('historical', { input_tokens: 0, output_tokens: 147 }, {
      message: { id: 'historical', model: 'model-a', stop_reason: 'end_turn', content: [],
        usage: { input_tokens: 0, output_tokens: 147 } },
    });
    const current = assistant('current', { input_tokens: 3, output_tokens: 13,
      cache_read_input_tokens: 22_777, cache_creation_input_tokens: 687 }, {
      message: { id: 'current', model: 'model-a', stop_reason: 'end_turn', content: [],
        usage: { input_tokens: 3, output_tokens: 13, cache_read_input_tokens: 22_777,
          cache_creation_input_tokens: 687 } },
    });
    const info = buildSessionInfo([historical, current, current]);
    expect(info.latestContext?.totalTokens).toBe(23_480);
    expect(info.historyUsage?.totals).toEqual({ inputTokens: 3, outputTokens: 160,
      cacheReadTokens: 22_777, cacheWriteTokens: 687, totalTokens: 23_627, requestCount: 2 });
  });

  it('distinguishes unavailable usage from measured zero and rejects invalid token values', () => {
    expect(buildSessionInfo([]).historyUsage).toBeNull();
    expect(buildSessionInfo([{ type: 'result', usage: { input_tokens: 123 } }]).historyUsage).toBeNull();
    const info = buildSessionInfo([assistant('zero', { input_tokens: 0, output_tokens: Number.NaN, cache_read_input_tokens: -100, cache_creation_input_tokens: Infinity })]);
    expect(info.historyUsage?.totals.totalTokens).toBe(0);
    expect(info.historyUsage?.totals.requestCount).toBe(1);
  });

  it('uses final iterations only for context, keeping cumulative billed request usage separate', () => {
    const event = { type: 'assistant', message: { id: 'iterated', model: 'model-a', stop_reason: 'end_turn',
      usage: { input_tokens: 500_000, output_tokens: 5000,
        iterations: [{ type: 'message', input_tokens: 3, output_tokens: 1122,
          cache_read_input_tokens: 191_863, cache_creation_input_tokens: 2565 }] } } };
    const info = buildSessionInfo([event]);
    expect(info.latestContext?.totalTokens).toBe(195_553);
    expect(info.historyUsage?.totals.totalTokens).toBe(505_000);
  });

  it('keeps an unavailable context distinct from zero when rendering ledger-backed totals', () => {
    const session: SessionDetail = {
      id: 'desktop-session', title: '检查项目', permissionMode: 'default', workspace: '/work/project',
      createdAt: 1000, updatedAt: 2000, busy: false, messageCount: 3, sessionId: 'engine-session', preview: '',
      history: [], workerSummariesJson: null,
    };
    const totals = { inputTokens: 1000, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 1020, requestCount: 2 };
    const html = renderToStaticMarkup(<SessionInfoContent session={session} messages={[]} recordedUsage={{ totals, models: [{ ...totals, model: 'model-a' }], firstRecordedAt: 1000, lastRecordedAt: 2000 }} />);
    expect(html).toContain('1,020');
    expect(html).toContain('本会话用量账本');
    expect(html).toContain('暂无工具调用');
    expect(html).toContain('最近上下文');
    expect(html).toContain('暂无记录');
    expect(html).not.toContain('200,000');
    expect(html).toContain('engine-session');
  });
});
