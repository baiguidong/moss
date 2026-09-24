import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mergeUsageDaily } from '../src/renderer-react/lib/usage-overview';
import { UsageOverviewContent } from '../src/renderer-react/components/overview-view';
import type { CloudUsageOverview, UsageDailySummary, UsageOverview } from '../src/renderer-react/types';

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
const cloud: CloudUsageOverview = {
  generatedAt, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, today: cloudDay.day,
  historyIncomplete: false,
  totals: { ...cloudDay, activeDays: 1, peakDay: cloudDay.day, peakTokens: 72 },
  daily: [cloudDay],
};
const loaded = <T,>(data: T) => ({ data, loading: false, error: '' });

describe('local and cloud usage overview', () => {
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

  test('keeps separate local and cloud cards while the activity chart shows their sum', () => {
    const html = renderToStaticMarkup(<UsageOverviewContent local={loaded(local)} cloud={loaded(cloud)} onRefresh={() => {}} />);
    const cloudStart = html.indexOf('aria-label="云端用量"');
    expect(html.slice(0, cloudStart)).toContain('本机累计 Token');
    expect(html.slice(0, cloudStart)).toContain('>175<');
    expect(html.slice(cloudStart)).toContain('云端累计 Token');
    expect(html.slice(cloudStart)).toContain('>72<');
    expect(html).toContain('本机 + 云端');
    expect(html).toContain('2026年9月24日 · 247 Token · 3 次请求');
    expect(html.match(/aria-label="每日 Token 活动热力图"/g)).toHaveLength(1);
  });

  test('keeps local activity usable when cloud is loading, disconnected or unavailable', () => {
    for (const state of [
      { data: null, loading: true, error: '' },
      { data: null, loading: false, error: '' },
      { data: null, loading: false, error: 'offline' },
    ]) {
      const html = renderToStaticMarkup(<UsageOverviewContent local={loaded(local)} cloud={state} onRefresh={() => {}} />);
      expect(html).toContain('2026年9月24日 · 175 Token · 1 次请求');
      expect(html).not.toContain('本机 + 云端');
      if (state.loading) expect(html).toContain('正在加载云端用量');
      else {
        expect(html).toContain(state.error ? '云端用量暂时不可用' : '连接 Moss Server 后查看');
        expect(html.slice(html.indexOf('云端累计 Token'))).toContain('>—<');
      }
    }
  });

  test('shows available cloud activity and incomplete history even when local usage fails', () => {
    const html = renderToStaticMarkup(<UsageOverviewContent
      local={{ data: null, loading: false, error: 'Database unavailable' }}
      cloud={loaded({ ...cloud, historyIncomplete: true })}
      onRefresh={() => {}}
    />);
    expect(html).toContain('本地电脑用量暂时不可用');
    expect(html).toContain('部分云端历史记录无法读取');
    expect(html).toContain('2026年9月24日 · 72 Token · 2 次请求');
  });
});
