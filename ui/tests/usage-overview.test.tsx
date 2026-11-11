import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mergeUsageDaily } from '../src/renderer-react/lib/usage-overview';
import { UsageOverviewContent } from '../src/renderer-react/components/overview-view';
import type { UsageDailySummary, UsageOverview } from '../src/renderer-react/types';

const localDay: UsageDailySummary = {
  day: '2026-09-24', inputTokens: 100, outputTokens: 40, cacheReadTokens: 30,
  cacheWriteTokens: 5, totalTokens: 175, requestCount: 1,
};
const cloudDay: UsageDailySummary = {
  day: '2026-09-24', inputTokens: 50, outputTokens: 12, cacheReadTokens: 8,
  cacheWriteTokens: 2, totalTokens: 72, requestCount: 2,
};
const generatedAt = new Date(2026, 8, 24, 12).getTime();
const local: UsageOverview = {
  generatedAt,
  totals: { ...localDay, activeDays: 1, peakDay: localDay.day, peakTokens: 175,
    currentStreak: 1, longestStreak: 1, todayTokens: 175 },
  daily: [localDay],
};
const loaded = <T,>(data: T) => ({ data, loading: false, error: '' });

describe('local usage overview', () => {
  test('shows only local usage cards and activity', () => {
    const html = renderToStaticMarkup(<UsageOverviewContent local={loaded(local)} onRefresh={() => {}} />);
    expect(html).toContain('本机累计 Token');
    expect(html).not.toContain('云端');
    expect(html).toContain('aria-label="本地电脑用量"');
    expect(html).toContain('>175<');
    expect(html.match(/aria-label="每日 Token 活动热力图"/g)).toHaveLength(1);
    expect(html).not.toContain('连接 Moss Server 后查看');
    expect(html).toContain('2026年9月24日 · 175 Token · 1 次请求');
    expect(html).not.toContain('247 Token');
  });

  test('adds every counter on overlapping dates and retains dates present on only one side', () => {
    const earlier = { ...localDay, day: '2026-09-22' };
    const later = { ...cloudDay, day: '2026-09-25' };
    const localRows = Object.freeze([Object.freeze(localDay), Object.freeze(earlier)]);
    const cloudRows = Object.freeze([Object.freeze(later), Object.freeze(cloudDay)]);
    const expected = [earlier, {
      day: '2026-09-24', inputTokens: 150, outputTokens: 52, cacheReadTokens: 38,
      cacheWriteTokens: 7, totalTokens: 247, requestCount: 3,
    }, later];

    expect(mergeUsageDaily(localRows, cloudRows)).toEqual(expected);
    // Refreshing uses fresh sums rather than accumulating into the source snapshots.
    expect(mergeUsageDaily(localRows, cloudRows)).toEqual(expected);
    expect(mergeUsageDaily([], cloudRows)).toEqual([cloudDay, later]);
    expect(mergeUsageDaily([], [])).toEqual([]);
  });

  test('handles loading, empty and unavailable local usage without showing a chart', () => {
    for (const state of [
      { data: null, loading: true, error: '' },
      { data: null, loading: false, error: '' },
      { data: null, loading: false, error: 'Database unavailable' },
    ]) {
      const html = renderToStaticMarkup(<UsageOverviewContent local={state} onRefresh={() => {}} />);
      expect(html).not.toContain('云端');
      expect(html).not.toContain('每日 Token 活动热力图');
      if (state.loading) expect(html).toContain('正在加载本地电脑用量');
      else {
        expect(html).toContain('本机累计 Token');
        expect(html).toContain('>—<');
        if (state.error) {
          expect(html).toContain('本地电脑用量暂时不可用');
          expect(html).toContain('重试');
        }
      }
    }
  });
});
