import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceMonitorContent } from '../src/renderer-react/components/resource-monitor-view';
import { chartSegments, mergeResourceHistory, resourceSeries } from '../src/renderer-react/lib/resource-monitor';
import type { ResourceMonitorSnapshot } from '../src/renderer-react/lib/resource-monitor-types';

const time = 1_000_000;
const snapshot: ResourceMonitorSnapshot = {
  sampledAt: time, lastSuccessAt: time, cpuPercent: 140, memoryBytes: 1024 ** 3, cpuCount: 8, processCount: 1,
  loopDelayMs: 0, collectionMs: 5, error: '', alerts: [], events: [],
  processes: [{ id: '100:first', pid: 100, name: 'Example App · 后端', kind: 'app', state: 'running', appName: 'Example App',
    appId: 'example', instanceId: 'default', cpuPercent: 140, memoryBytes: 1024 ** 3, cpuHighSince: null,
    canManage: true, canRestart: true, lifecycle: 'persistent' }],
  history: [{ timestamp: time, cpuPercent: 140, memoryBytes: 1024 ** 3, processes: [{ id: '100:first', cpuPercent: 140, memoryBytes: 1024 ** 3 }] }],
};

describe('resource monitor display', () => {
  test('shows real metrics, CPU units, App controls and charts without disk UI', () => {
    const html = renderToStaticMarkup(<ResourceMonitorContent snapshot={snapshot} now={time} />);
    expect(html).toContain('140.0%');
    expect(html).toContain('1.00 GiB');
    expect(html).toContain('100% 表示占满一个逻辑核');
    expect(html).toContain('查看 Example App 日志');
    expect(html).toContain('重启 Example App');
    expect(html).toContain('CPU趋势，最近 5 分钟');
    expect(html).not.toContain('磁盘');
  });
  test('does not present stale metrics as current healthy data', () => {
    const html = renderToStaticMarkup(<ResourceMonitorContent snapshot={snapshot} now={time + 20_000} />);
    expect(html).toContain('采样已过期');
    expect(html).not.toContain('>140.0%<');
    expect(html).toContain('待采集');
  });
  test('renders selected memory trend and gracefully handles an empty anomaly filter', () => {
    const html = renderToStaticMarkup(<ResourceMonitorContent snapshot={snapshot} now={time} metric="memoryBytes" filter="alerts"
      selection={{ id: '100:first', name: 'Example App' }} />);
    expect(html).toContain('内存变化');
    expect(html).toContain('当前没有异常进程');
    expect(html).toContain('所选进程');
  });
  test('merges incremental history without losing old process identities', () => {
    const next = { ...snapshot.history[0], timestamp: time + 5000, processes: [{ id: '100:second', cpuPercent: null, memoryBytes: 1024 }] };
    const frames = mergeResourceHistory(snapshot.history, [next, next]);
    expect(frames).toHaveLength(2);
    expect(resourceSeries(frames, 'cpuPercent', '100:first').map(point => point.value)).toEqual([140, null]);
    expect(resourceSeries(frames, 'cpuPercent', '100:second').map(point => point.value)).toEqual([null, null]);
  });
  test('breaks paths at missing points and long gaps rather than drawing misleading lines', () => {
    const points = [{ timestamp: 1000, value: 100 }, { timestamp: 3000, value: null }, { timestamp: 5000, value: 0 }, { timestamp: 50_000, value: 10 }];
    expect(chartSegments(points, value => value, value => value)).toEqual([[[1000, 100]], [[5000, 0]], [[50_000, 10]]]);
  });
});
