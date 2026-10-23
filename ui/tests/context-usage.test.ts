import { describe, expect, test } from 'bun:test';
import { contextUsagePresentation, deriveContextUsage, getRemoteModelContext } from '../src/renderer-react/lib/context-usage';

const assistant = {
  type: 'assistant', message: { model: 'gpt-5.5', usage: { input_tokens: 67_200 } },
};
const million = { model: 'gpt-5.5', contextWindow: 1_000_000, isDefault: false };

describe('composer context usage', () => {
  test('shows the provider capacity and 7% for the reported 67.2K context', () => {
    const usage = deriveContextUsage([assistant], million)!;
    expect(contextUsagePresentation(usage)).toEqual({
      pct: 0.0672,
      summary: '上下文已用 67.2K / 1.0M（7%）',
      details: '输入 67.2K · 缓存读 0 · 缓存写 0 · 输出 0',
    });
  });

  test('updates percentage with model limits without treating the runtime default as a known capacity', () => {
    const smaller = { model: 'smaller-model', contextWindow: 128_000, isDefault: false };
    expect(contextUsagePresentation(deriveContextUsage([assistant], smaller)!).summary)
      .toBe('上下文已用 67.2K / 128.0K（53%）');
    const fallback = { model: 'unknown', contextWindow: 200_000, isDefault: true };
    expect(contextUsagePresentation(deriveContextUsage([assistant], fallback)!).summary)
      .toBe('上下文已用 67.2K / 容量未知');
  });

  test('does not show a full context warning when reported usage exceeds the default capacity', () => {
    const fallback = { model: 'gpt-6-sol', contextWindow: 200_000, isDefault: true };
    const event = { type: 'assistant', message: { usage: { input_tokens: 221_624 } } };
    expect(contextUsagePresentation(deriveContextUsage([event], fallback)!)).toEqual({
      pct: null,
      summary: '上下文已用 221.6K / 容量未知',
      details: '输入 221.6K · 缓存读 0 · 缓存写 0 · 输出 0',
    });
  });

  test('does not invent a limit or percentage while loading or after IPC fails', () => {
    expect(contextUsagePresentation(deriveContextUsage([assistant], null, true)!)).toMatchObject({
      pct: null, summary: '上下文已用 67.2K / 容量读取中',
    });
    expect(contextUsagePresentation(deriveContextUsage([assistant], null)!)).toMatchObject({
      pct: null, summary: '上下文已用 67.2K / 容量未知',
    });
  });

  test('counts cache and output once and excludes subagent and cumulative result usage', () => {
    const history = [
      assistant,
      { type: 'assistant', message: { usage: {
        input_tokens: 1000, cache_read_input_tokens: 50_000,
        cache_creation_input_tokens: 2000, output_tokens: 500,
      } } },
      { ...assistant, parent_tool_use_id: 'worker' },
      { type: 'result', usage: { input_tokens: 999_999 }, modelUsage: { 'gpt-5.5': million } },
    ];
    expect(deriveContextUsage(history, million)).toMatchObject({ used: 53_500, inputTokens: 1000 });
    expect(deriveContextUsage([], million)).toBeNull();
  });

  test('remote capacity comes from the main model reported by the server', () => {
    const history = [
      { type: 'system', subtype: 'init', model: 'gpt-5.5' },
      assistant,
      { type: 'result', modelUsage: {
        'gpt-5.5': { contextWindow: 1_000_000 },
        'fast-model': { contextWindow: 128_000 },
      } },
      { type: 'result', parent_tool_use_id: 'worker', modelUsage: { 'gpt-5.5': { contextWindow: 200_000 } } },
    ];
    expect(getRemoteModelContext(history)).toEqual(million);
    expect(getRemoteModelContext([...history, { type: 'system', subtype: 'init', model: 'new-model' }])).toBeNull();
    expect(getRemoteModelContext([assistant])).toBeNull();
    expect(getRemoteModelContext([...history, { type: 'result', modelUsage: {
      'gpt-5.5': { contextWindow: 0 },
    } }])).toBeNull();
  });

  test('bounds the ring and rejects invalid limits', () => {
    const usage = deriveContextUsage([assistant], { ...million, contextWindow: 32_000 })!;
    expect(contextUsagePresentation(usage).pct).toBe(1);
    expect(contextUsagePresentation({ ...usage, modelContext: { ...million, contextWindow: 0 } }).pct).toBeNull();
  });

  test('uses the final iteration for current context instead of cumulative billed usage', () => {
    const event = { type: 'assistant', message: { usage: { input_tokens: 500_000, output_tokens: 5000,
      iterations: [{ type: 'message', input_tokens: 3, output_tokens: 1122,
        cache_read_input_tokens: 191_863, cache_creation_input_tokens: 2565 }] } } };
    expect(deriveContextUsage([event], million)).toMatchObject({ used: 195_553,
      inputTokens: 3, outputTokens: 1122 });
  });

  test('uses a newly finalized response in an existing session without inheriting corrupted historical usage', () => {
    const history = [
      { type: 'assistant', message: { id: 'historical', stop_reason: 'end_turn', usage: {
        input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 147,
      } } },
      { type: 'assistant', message: { id: 'new-request', stop_reason: 'end_turn', usage: {
        input_tokens: 3, cache_read_input_tokens: 22_777, cache_creation_input_tokens: 687, output_tokens: 13,
      } } },
    ];
    const usage = deriveContextUsage(history, null)!;
    expect(usage.used).toBe(23_480);
    expect(contextUsagePresentation(usage)).toEqual({
      pct: null,
      summary: '上下文已用 23.5K / 容量未知',
      details: '输入 3 · 缓存读 22.8K · 缓存写 687 · 输出 13',
    });
  });
});
