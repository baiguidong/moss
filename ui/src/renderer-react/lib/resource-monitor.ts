import type { ResourceFrame } from './resource-monitor-types';

export type ResourceMetric = 'cpuPercent' | 'memoryBytes';
export type ChartPoint = { timestamp: number; value: number | null };

export function mergeResourceHistory(previous: ResourceFrame[], incoming: ResourceFrame[]) {
  if (!incoming.length) return previous;
  const latest = incoming.at(-1)!.timestamp;
  const source = latest < (previous.at(-1)?.timestamp || 0) ? [] : previous;
  const frames = new Map([...source, ...incoming].map(frame => [frame.timestamp, frame]));
  return [...frames.values()].filter(frame => frame.timestamp > latest - 15 * 60_000)
    .sort((a, b) => a.timestamp - b.timestamp).slice(-460);
}

export function resourceSeries(frames: ResourceFrame[], metric: ResourceMetric, processId?: string): ChartPoint[] {
  return frames.map(frame => ({
    timestamp: frame.timestamp,
    value: processId ? frame.processes.find(row => row.id === processId)?.[metric] ?? null : frame[metric],
  }));
}

export function chartSegments(points: ChartPoint[], x: (time: number) => number, y: (value: number) => number) {
  const segments: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  let lastTime = 0;
  for (const point of points) {
    if (point.value === null || !Number.isFinite(point.value) || point.timestamp - lastTime > 15_000) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (point.value !== null && Number.isFinite(point.value)) current.push([x(point.timestamp), y(point.value)]);
    lastTime = point.timestamp;
  }
  if (current.length) segments.push(current);
  return segments;
}

export function linePath(segment: Array<[number, number]>) {
  return segment.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

export function formatMemory(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

export function formatCpu(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;
}

export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
}
