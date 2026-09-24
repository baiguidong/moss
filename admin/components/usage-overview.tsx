import * as React from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Database, Flame, Gauge } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UsageDailySummary, UsageOverview } from '@/lib/api/usage'

type ActivityMode = 'daily' | 'weekly' | 'cumulative'
type CalendarCell = UsageDailySummary & { date: Date; future: boolean; level: number }
const EMPTY_DAY: Omit<UsageDailySummary, "day"> = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  requestCount: 0,
};

const ACTIVITY_CELL_CLASSES = [
  "bg-muted/70",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
];

const ACTIVITY_MODES: Array<{ id: ActivityMode; label: string }> = [
  { id: "daily", label: "每日" },
  { id: "weekly", label: "每周" },
  { id: "cumulative", label: "累计" },
];

function formatLocalDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCompactTokens(value: number): string {
  const count = Math.max(0, Number(value) || 0);
  if (count < 1_000) return String(Math.round(count));
  if (count < 1_000_000) return `${trimDecimal(count / 1_000)}K`;
  if (count < 1_000_000_000) return `${trimDecimal(count / 1_000_000)}M`;
  return `${trimDecimal(count / 1_000_000_000)}B`;
}

function trimDecimal(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

function formatFullTokens(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(Math.max(0, Number(value) || 0));
}

function formatDay(day: string | null): string {
  if (!day) return "暂无记录";
  const [year, month, date] = day.split("-").map(Number);
  return `${year}年${month}月${date}日`;
}

function buildCalendarCells(data: UsageDailySummary[], now: number): CalendarCell[] {
  const byDay = new Map(data.map((row) => [row.day, row]));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay() - 52 * 7);

  const values = data.map((row) => row.totalTokens).filter((value) => value > 0);
  const max = Math.max(...values, 0);

  return Array.from({ length: 53 * 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const day = formatLocalDay(date);
    const row = byDay.get(day) ?? { day, ...EMPTY_DAY };
    const ratio = max > 0 && row.totalTokens > 0
      ? Math.log1p(row.totalTokens) / Math.log1p(max)
      : 0;
    return {
      ...row,
      date,
      future: date.getTime() > today.getTime(),
      level: ratio > 0 ? Math.max(1, Math.ceil(ratio * 4)) : 0,
    };
  });
}

function buildMonthLabels(cells: CalendarCell[]) {
  let previousMonth = -1;
  return Array.from({ length: 53 }, (_, week) => {
    const date = cells[week * 7]?.date;
    if (!date) return "";
    const month = date.getMonth();
    if (month === previousMonth) return "";
    previousMonth = month;
    return `${month + 1}月`;
  });
}

function aggregateWeeks(cells: CalendarCell[]) {
  return Array.from({ length: 53 }, (_, week) => {
    const weekCells = cells.slice(week * 7, week * 7 + 7);
    return weekCells.reduce((sum, cell) => sum + (cell.future ? 0 : cell.totalTokens), 0);
  });
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <section className="min-w-0 rounded-md border border-border/80 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground/75" aria-hidden="true" />
      </div>
      <p className="mt-4 min-h-9 truncate text-3xl font-semibold tabular-nums text-foreground" title={value}>
        {value}
      </p>
      <p className="mt-2 truncate text-xs text-muted-foreground" title={detail}>{detail}</p>
    </section>
  );
}

function ActivityChart({ data, now }: { data: UsageDailySummary[]; now: number }) {
  const [mode, setMode] = React.useState<ActivityMode>("daily");
  const cells = React.useMemo(() => buildCalendarCells(data, now), [data, now]);
  const monthLabels = React.useMemo(() => buildMonthLabels(cells), [cells]);
  const weekly = React.useMemo(() => aggregateWeeks(cells), [cells]);
  const values = mode === "cumulative"
    ? weekly.reduce<number[]>((result, value) => {
        result.push(value + (result.at(-1) ?? 0));
        return result;
      }, [])
    : weekly;
  const chartMax = Math.max(...values, 0);

  return (
    <section className="mt-8 border-t border-border/70 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Token 活动</h2>
          <p className="mt-1 text-xs text-muted-foreground">最近 53 周</p>
        </div>
        <div className="inline-flex rounded-md bg-muted p-1" role="tablist" aria-label="Token 活动统计方式">
          {ACTIVITY_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              className={cn(
                "h-7 rounded-sm px-3 text-xs font-medium text-muted-foreground transition-colors",
                mode === item.id && "bg-background text-foreground shadow-sm",
              )}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 overflow-x-auto pb-2">
        <div className="min-w-[774px]">
          <div
            className="ml-8 grid h-5 gap-[3px] text-[10px] text-muted-foreground"
            style={{ gridTemplateColumns: "repeat(53, 11px)" }}
            aria-hidden="true"
          >
            {monthLabels.map((label, index) => (
              <span key={`${label}-${index}`} className="whitespace-nowrap">{label}</span>
            ))}
          </div>

          {mode === "daily" ? (
            <div className="flex gap-2">
              <div className="grid h-[95px] w-6 shrink-0 grid-rows-7 gap-[3px] text-[10px] leading-[11px] text-muted-foreground" aria-hidden="true">
                <span />
                <span>一</span>
                <span />
                <span>三</span>
                <span />
                <span>五</span>
                <span />
              </div>
              <div
                className="grid grid-flow-col grid-rows-7 gap-[3px]"
                style={{ gridAutoColumns: "11px" }}
                aria-label="每日 Token 活动热力图"
              >
                {cells.map((cell) => (
                  <span
                    key={cell.day}
                    className={cn(
                      "h-[11px] w-[11px] rounded-[2px]",
                      cell.future ? "invisible" : ACTIVITY_CELL_CLASSES[cell.level],
                    )}
                    title={`${formatDay(cell.day)} · ${formatFullTokens(cell.totalTokens)} Token · ${cell.requestCount} 次请求`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div
              className="ml-8 grid h-[95px] items-end gap-[3px] border-b border-border/70"
              style={{ gridTemplateColumns: "repeat(53, 11px)" }}
              aria-label={mode === "weekly" ? "每周 Token 活动" : "累计 Token 活动"}
            >
              {values.map((value, index) => (
                <span
                  key={index}
                  className="w-[11px] rounded-t-[2px] bg-primary/75"
                  style={{ height: value > 0 && chartMax > 0 ? `${Math.max(4, (value / chartMax) * 95)}px` : 0 }}
                  title={`${formatCompactTokens(value)} Token`}
                />
              ))}
            </div>
          )}

          {mode === "daily" && (
            <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
              <span>少</span>
              {ACTIVITY_CELL_CLASSES.map((className, index) => (
                <span key={index} className={cn("h-[11px] w-[11px] rounded-[2px]", className)} />
              ))}
              <span>多</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function UsageOverviewPanel({ overview, compact = false }: { overview: UsageOverview; compact?: boolean }) {
  const totals = overview.totals;
  const cacheTokens = (totals?.cacheReadTokens ?? 0) + (totals?.cacheWriteTokens ?? 0);
  const cards = totals ? [
    {
      label: "个人累计 Token",
      value: formatCompactTokens(totals.totalTokens),
      detail: `${totals.activeDays} 个活跃日 · ${totals.requestCount} 次请求`,
      icon: Gauge,
    },
    {
      label: "单日峰值",
      value: formatCompactTokens(totals.peakTokens),
      detail: formatDay(totals.peakDay),
      icon: Flame,
    },
    {
      label: "输入 Token",
      value: formatCompactTokens(totals.inputTokens),
      detail: `${formatFullTokens(totals.inputTokens)} Token`,
      icon: ArrowDownToLine,
    },
    {
      label: "输出 Token",
      value: formatCompactTokens(totals.outputTokens),
      detail: `${formatFullTokens(totals.outputTokens)} Token`,
      icon: ArrowUpFromLine,
    },
    {
      label: "缓存 Token",
      value: formatCompactTokens(cacheTokens),
      detail: `读取 ${formatCompactTokens(totals.cacheReadTokens)} · 写入 ${formatCompactTokens(totals.cacheWriteTokens)}`,
      icon: Database,
    },
  ] : [];

  return (
    <div>
      {overview.historyIncomplete && <p className="mb-4 text-sm text-muted-foreground" role="status">
        部分历史会话记录无法读取，当前累计值可能不完整。
      </p>}
      <div className={cn('grid gap-3 sm:grid-cols-2', !compact && 'md:grid-cols-3 xl:grid-cols-5')}>
        {cards.map(card => <StatCard key={card.label} {...card} />)}
      </div>
      {!compact && <ActivityChart data={overview.daily} now={Date.parse(`${overview.today}T12:00:00`)} />}
    </div>
  )
}
