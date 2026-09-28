import * as React from 'react';
import { chartSegments, formatCpu, formatMemory, linePath, type ChartPoint, type ResourceMetric } from '@/lib/resource-monitor';
import type { ResourceAlert } from '@/lib/resource-monitor-types';

const WIDTH = 960;
const HEIGHT = 240;
const LEFT = 60;
const RIGHT = WIDTH - 12;
const TOP = 12;
const BOTTOM = HEIGHT - 30;
const timeLabel = (time: number) => new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function niceStep(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, .001)));
  const fraction = value / magnitude;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
}

export function ResourceChart({ points, selectedPoints, selectedName, metric, end, minutes, events = [] }: {
  points: ChartPoint[];
  selectedPoints?: ChartPoint[];
  selectedName?: string;
  metric: ResourceMetric;
  end: number;
  minutes: number;
  events?: ResourceAlert[];
}) {
  const gradient = `resource-${React.useId().replace(/:/g, '')}`;
  const [hover, setHover] = React.useState<number | null>(null);
  const start = end - minutes * 60_000;
  const visible = points.filter(point => point.timestamp >= start && point.timestamp <= end);
  const selected = selectedPoints?.filter(point => point.timestamp >= start && point.timestamp <= end);
  const peak = Math.max(0, ...visible.map(p => p.value ?? 0), ...(selected || []).map(p => p.value ?? 0));
  const unit = metric === 'cpuPercent' ? 1 : peak >= 1024 ** 3 ? 1024 ** 3 : 1024 ** 2;
  const target = metric === 'cpuPercent' ? Math.max(100, peak) : Math.max(64 * 1024 ** 2, peak * 1.1) / unit;
  const step = metric === 'cpuPercent' && target <= 100 ? 25 : niceStep(target / 4);
  const max = Math.ceil(target / step) * step * unit;
  const ticks = Array.from({ length: Math.round(max / unit / step) + 1 }, (_, index) => index * step * unit);
  const x = (time: number) => LEFT + (time - start) / (end - start) * (RIGHT - LEFT);
  const y = (value: number) => BOTTOM - Math.min(value / max, 1) * (BOTTOM - TOP);
  const totalSegments = chartSegments(visible, x, y);
  const selectedSegments = chartSegments(selected || [], x, y);
  const format = metric === 'cpuPercent' ? formatCpu : formatMemory;
  const hovered = hover === null ? null : visible.reduce<ChartPoint | null>((nearest, point) =>
    !nearest || Math.abs(point.timestamp - hover) < Math.abs(nearest.timestamp - hover) ? point : nearest, null);
  const hoveredSelected = selected?.find(point => point.timestamp === hovered?.timestamp);
  const hasData = visible.some(point => point.value !== null) || selected?.some(point => point.value !== null);

  return (
    <div className="relative mt-5">
      <div className="mb-3 flex min-h-5 flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2"><span className="h-1.5 w-5 rounded-full bg-primary" />Moss 总占用</span>
        {selectedName && <span className="inline-flex items-center gap-2"><span className="h-1.5 w-5 rounded-full bg-amber-500" />{selectedName}</span>}
        {hovered && <span className="ml-auto tabular-nums">{timeLabel(hovered.timestamp)} · 总计 {format(hovered.value)}{selectedName ? ` · 所选 ${format(hoveredSelected?.value)}` : ''}</span>}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-[230px] w-full overflow-visible sm:h-[260px]"
        preserveAspectRatio="none" role="img" aria-label={`${metric === 'cpuPercent' ? 'CPU' : '内存'}趋势，最近 ${minutes} 分钟；缺失采样显示断点`}
        onPointerMove={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          const position = (event.clientX - rect.left) / rect.width * WIDTH;
          setHover(start + Math.max(0, Math.min(1, (position - LEFT) / (RIGHT - LEFT))) * (end - start));
        }} onPointerLeave={() => setHover(null)}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity=".28" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity=".015" />
        </linearGradient></defs>
        {ticks.map(value => <g key={value}>
          <line x1={LEFT} x2={RIGHT} y1={y(value)} y2={y(value)} stroke="currentColor" className="text-border" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          <text x={LEFT - 10} y={y(value) + 4} textAnchor="end" fill="currentColor" className="text-[10px] text-muted-foreground">{metric === 'cpuPercent' ? `${Math.round(value)}%` : `${Number((value / unit).toFixed(2))} ${unit === 1024 ** 3 ? 'GiB' : 'MiB'}`}</text>
        </g>)}
        {metric === 'cpuPercent' && events.filter(event => event.kind === 'cpu' && (event.endedAt || end) > start && event.startedAt <= end).map(event => <rect
          key={event.id} x={x(Math.max(start, event.startedAt))} y={TOP}
          width={Math.max(1, x(Math.min(end, event.endedAt || end)) - x(Math.max(start, event.startedAt)))} height={BOTTOM - TOP}
          fill="currentColor" className="text-amber-500/10"><title>{event.name}：{event.message}</title></rect>)}
        {totalSegments.map((segment, i) => <g key={i}>
          <path d={`${linePath(segment)} L${segment.at(-1)![0]},${BOTTOM} L${segment[0][0]},${BOTTOM} Z`} fill={`url(#${gradient})`} />
          <path d={linePath(segment)} fill="none" stroke="currentColor" className="text-primary" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {segment.length === 1 && <circle cx={segment[0][0]} cy={segment[0][1]} r="2" fill="currentColor" className="text-primary" />}
        </g>)}
        {selectedSegments.map((segment, i) => <g key={i}>
          <path d={linePath(segment)} fill="none" stroke="currentColor" className="text-amber-500" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {segment.length === 1 && <circle cx={segment[0][0]} cy={segment[0][1]} r="2" fill="currentColor" className="text-amber-500" />}
        </g>)}
        {[0, .25, .5, .75, 1].map(ratio => <text key={ratio} x={x(start + ratio * (end - start))} y={HEIGHT - 5}
          textAnchor={ratio === 0 ? 'start' : ratio === 1 ? 'end' : 'middle'} fill="currentColor" className="text-[10px] text-muted-foreground">
          {timeLabel(start + ratio * (end - start)).slice(0, 5)}
        </text>)}
        {hovered && <g pointerEvents="none">
          <line x1={x(hovered.timestamp)} x2={x(hovered.timestamp)} y1={TOP} y2={BOTTOM} stroke="currentColor" className="text-muted-foreground/50" strokeDasharray="4 4" />
          {hovered.value !== null && <circle cx={x(hovered.timestamp)} cy={y(hovered.value)} r="3.5" fill="var(--primary)" stroke="var(--background)" strokeWidth="2" />}
          {hoveredSelected?.value != null && <circle cx={x(hoveredSelected.timestamp)} cy={y(hoveredSelected.value)} r="3.5" fill="#f59e0b" stroke="var(--background)" strokeWidth="2" />}
        </g>}
      </svg>
      {!hasData && <div className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-muted-foreground">{metric === 'cpuPercent' ? '等待有效采样，CPU 需要两次采样计算' : '等待有效内存采样'}</div>}
    </div>
  );
}

export function ResourceSparkline({ points, metric }: { points: ChartPoint[]; metric: ResourceMetric }) {
  const end = points.at(-1)?.timestamp || 0;
  const visible = points.filter(point => point.timestamp >= end - 120_000);
  const max = Math.max(metric === 'cpuPercent' ? 100 : 1, ...visible.map(point => point.value ?? 0));
  const segments = chartSegments(visible, time => (time - (end - 120_000)) / 120_000 * 90 + 2, value => 25 - value / max * 22);
  return <svg viewBox="0 0 96 28" className="h-7 w-24 text-primary/80" role="img" aria-label="最近两分钟趋势">
    {segments.map((segment, i) => <path key={i} d={linePath(segment)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />)}
  </svg>;
}
