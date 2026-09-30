import * as React from 'react';
import { Activity, AlertTriangle, ArrowDownWideNarrow, Cpu, MemoryStick, RefreshCw, SquareTerminal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResourceChart, ResourceSparkline } from '@/components/resource-chart';
import { cn } from '@/lib/utils';
import { formatCpu, formatDuration, formatMemory, mergeResourceHistory, resourceSeries, type ResourceMetric } from '@/lib/resource-monitor';
import type { ResourceMonitorSnapshot, ResourceProcess } from '@/lib/resource-monitor-types';

const kindLabels = { main: '主进程', app: 'App 后端', renderer: '界面', child: '子进程', helper: '系统辅助' };
const stateLabels: Record<string, string> = { running: '运行中', starting: '启动中', stopping: '停止中', stopped: '已停止', error: '运行异常', 'crash-loop': '反复崩溃' };
type Selection = { id: string; name: string };
type LogPanel = { name: string; entries: Array<{ timestamp?: number; level?: string; message?: unknown }> };

function MetricCard({ icon: Icon, label, value, detail, warning = false }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; detail: string; warning?: boolean;
}) {
  return <section className={cn('min-w-0 rounded-xl border border-border/70 bg-card px-5 py-4', warning && 'border-amber-500/30 bg-amber-500/[.04]')}>
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{label}</span><Icon className={cn('h-4 w-4', warning && 'text-amber-500')} /></div>
    <p className={cn('mt-3 truncate text-2xl font-semibold tracking-tight tabular-nums', warning && 'text-amber-600 dark:text-amber-400')}>{value}</p>
    <p className="mt-2 truncate text-[11px] text-muted-foreground" title={detail}>{detail}</p>
  </section>;
}

export function ResourceMonitorView() {
  const [snapshot, setSnapshot] = React.useState<ResourceMonitorSnapshot | null>(null);
  const [error, setError] = React.useState('');
  const [clock, setClock] = React.useState(Date.now);
  const [metric, setMetric] = React.useState<ResourceMetric>('cpuPercent');
  const [minutes, setMinutes] = React.useState(5);
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [filter, setFilter] = React.useState<'all' | 'apps' | 'alerts'>('all');
  const [showStopped, setShowStopped] = React.useState(false);
  const [busyAction, setBusyAction] = React.useState('');
  const [actionError, setActionError] = React.useState('');
  const [logs, setLogs] = React.useState<LogPanel | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let pending = false;
    let since = 0;
    const poll = async () => {
      setClock(Date.now());
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const next = await window.agentDesktop.resourceMonitor.getSnapshot({ since });
        if (disposed) return;
        since = next.sampledAt;
        setSnapshot(previous => ({ ...next, history: mergeResourceHistory(previous?.history || [], next.history) }));
        setError('');
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      } finally { pending = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    document.addEventListener('visibilitychange', poll);
    return () => { disposed = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, []);

  const runAction = async (row: ResourceProcess, action: 'logs' | 'restart') => {
    if (!row.appId || !row.instanceId) return;
    if (action === 'restart' && !window.confirm(`重启“${row.appName || row.name}”？正在执行的 App 操作会中断。`)) return;
    setBusyAction(`${row.id}:${action}`);
    setActionError('');
    try {
      const payload = { appId: row.appId, instanceId: row.instanceId };
      if (action === 'restart') await window.agentDesktop.restartAppInstance(payload);
      else setLogs({ name: row.name, entries: await window.agentDesktop.getAppInstanceLogs({ ...payload, limit: 200 }) });
    } catch (err) { setActionError(err instanceof Error ? err.message : String(err)); }
    finally { setBusyAction(''); }
  };

  return <ResourceMonitorContent snapshot={snapshot} error={error} now={clock} metric={metric} onMetricChange={setMetric}
    minutes={minutes} onMinutesChange={setMinutes} selection={selection} onSelect={setSelection}
    filter={filter} onFilterChange={setFilter} showStopped={showStopped} onShowStoppedChange={setShowStopped}
    busyAction={busyAction} actionError={actionError} onAction={runAction} logs={logs} onCloseLogs={() => setLogs(null)} />;
}

export function ResourceMonitorContent({ snapshot, error = '', now, metric = 'cpuPercent', onMetricChange = () => {},
  minutes = 5, onMinutesChange = () => {}, selection = null, onSelect = () => {}, filter = 'all', onFilterChange = () => {},
  showStopped = false, onShowStoppedChange = () => {}, busyAction = '', actionError = '', onAction = () => {}, logs = null, onCloseLogs = () => {},
}: {
  snapshot: ResourceMonitorSnapshot | null; error?: string; now: number; metric?: ResourceMetric;
  onMetricChange?: (metric: ResourceMetric) => void; minutes?: number; onMinutesChange?: (minutes: number) => void;
  selection?: Selection | null; onSelect?: (selection: Selection | null) => void;
  filter?: 'all' | 'apps' | 'alerts'; onFilterChange?: (filter: 'all' | 'apps' | 'alerts') => void;
  showStopped?: boolean; onShowStoppedChange?: (show: boolean) => void;
  busyAction?: string; actionError?: string; onAction?: (row: ResourceProcess, action: 'logs' | 'restart') => void;
  logs?: LogPanel | null; onCloseLogs?: () => void;
}) {
  const frames = snapshot?.history || [];
  const sparkFrames = frames.filter(frame => frame.timestamp >= now - 120_000);
  const alerts = snapshot?.alerts || [];
  const alertIds = new Set(alerts.map(alert => alert.processId));
  const stale = Boolean(snapshot && (!snapshot.lastSuccessAt || now - snapshot.lastSuccessAt > 15_000));
  const unavailable = !snapshot || stale || Boolean(error || snapshot.error);
  const observedAt = unavailable ? snapshot?.lastSuccessAt || now : now;
  const rows = (snapshot?.processes || []).filter(row => {
    if (!showStopped && row.state === 'stopped' && !alertIds.has(row.id)) return false;
    if (filter === 'apps') return Boolean(row.appId);
    if (filter === 'alerts') return alertIds.has(row.id);
    return true;
  }).sort((a, b) => Number(alertIds.has(b.id)) - Number(alertIds.has(a.id)) || (b[metric] ?? -1) - (a[metric] ?? -1) || a.name.localeCompare(b.name));
  const total = resourceSeries(frames, metric);
  const selected = selection ? resourceSeries(frames, metric, selection.id) : undefined;
  const displaySeries = selected || total;
  const values = displaySeries.filter(point => point.timestamp >= now - minutes * 60_000 && point.value !== null).map(point => point.value!);
  const currentValue = displaySeries.at(-1)?.value;
  const memoryDelta = metric === 'memoryBytes' && currentValue != null && values.length > 1 ? currentValue - values[0] : null;
  const lagging = !unavailable && (snapshot?.loopDelayMs || 0) >= 200;
  const format = metric === 'cpuPercent' ? formatCpu : formatMemory;
  const notice = error || snapshot?.error || (stale ? '采样已过期，正在等待采集恢复。' : '');

  return <div className="pb-8 pt-6">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">本机 Moss 及其进程 · CPU 100% 表示占满一个逻辑核</p>
      <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className={cn('h-1.5 w-1.5 rounded-full', !snapshot ? 'bg-muted-foreground' : unavailable ? 'bg-amber-500' : 'bg-emerald-500')} />
        {!snapshot ? '正在采集' : unavailable ? '等待恢复' : '每 2 秒刷新'}
        {snapshot?.lastSuccessAt ? ` · ${new Date(snapshot.lastSuccessAt).toLocaleTimeString('zh-CN', { hour12: false })}` : ''}
      </span>
    </div>
    {notice && <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4 shrink-0" />{notice}</div>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <MetricCard icon={Cpu} label="Moss CPU" value={formatCpu(unavailable ? null : snapshot?.cpuPercent)} detail={`${snapshot?.cpuCount || '—'} 个逻辑核 · 可超过 100%`} />
      <MetricCard icon={MemoryStick} label="进程内存合计" value={formatMemory(unavailable ? null : snapshot?.memoryBytes)} detail="RSS / 工作集估算，含共享内存" />
      <MetricCard icon={Activity} label="运行进程" value={!unavailable ? `${snapshot.processCount}` : '—'} detail="主进程、App、界面及子进程" />
      <MetricCard icon={AlertTriangle} label="当前异常" value={unavailable ? '待采集' : `${alertIds.size} 个进程`} warning={alertIds.size > 0 || lagging}
        detail={unavailable ? '等待有效采样' : lagging ? `主线程出现 ${Math.round(snapshot!.loopDelayMs!)} ms 卡顿` : alertIds.size ? '下方可查看原因与持续时间' : '未检测到持续高负载或运行异常'} />
    </div>

    <section className="mt-5 overflow-hidden rounded-xl border border-border/70 bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">{metric === 'cpuPercent' ? 'CPU 实时趋势' : '内存变化'}</h2>
            {selection && <button type="button" onClick={() => onSelect(null)} className="inline-flex max-w-[230px] items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400" title="取消进程选择">
              <span className="truncate">{selection.name}</span><X className="h-3 w-3 shrink-0" />
            </button>}
          </div>
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            {metric === 'cpuPercent' ? `窗口峰值 ${values.length ? format(Math.max(...values)) : '—'}`
              : `窗口变化 ${memoryDelta === null ? '—' : `${memoryDelta >= 0 ? '+' : '−'}${formatMemory(Math.abs(memoryDelta))}`}`}
            <span className="mx-2 text-border">/</span>{selection ? '所选进程' : 'Moss 总占用'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-md bg-muted/70 p-1" role="group" aria-label="监控指标">
            {([['cpuPercent', 'CPU'], ['memoryBytes', '内存']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={metric === key}
              onClick={() => onMetricChange(key)} className={cn('rounded px-3 py-1 text-xs text-muted-foreground', metric === key && 'bg-background text-foreground shadow-sm')}>{label}</button>)}
          </div>
          <div className="flex rounded-md bg-muted/70 p-1" role="group" aria-label="趋势时间范围">
            {[5, 15].map(value => <button key={value} type="button" aria-pressed={minutes === value} onClick={() => onMinutesChange(value)}
              className={cn('rounded px-3 py-1 text-xs text-muted-foreground', minutes === value && 'bg-background text-foreground shadow-sm')}>{value} 分钟</button>)}
          </div>
        </div>
      </div>
      <ResourceChart points={total} selectedPoints={selected} selectedName={selection?.name} metric={metric} end={Math.max(now, snapshot?.sampledAt || 0)} minutes={minutes} events={snapshot?.events} />
      <p className="mt-3 text-[11px] text-muted-foreground">点击进程名称叠加曲线 · 后台保留最近 15 分钟 · 重启、休眠及缺失采样显示断点</p>
    </section>

    {(alerts.length > 0 || lagging) && <div className="mt-4 space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/[.04] p-4">
      {unavailable && <p className="text-xs text-muted-foreground">以下为上次有效采样的异常，当前状态待确认。</p>}
      {alerts.map(alert => <button type="button" key={alert.id} onClick={() => onSelect({ id: alert.processId, name: alert.name })} className="flex w-full items-start gap-2 text-left text-xs">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span><span className="font-medium">{alert.name}</span><span className="text-muted-foreground"> · {alert.message} · 已持续 {formatDuration(observedAt - alert.startedAt)}</span></span>
      </button>)}
      {lagging && <p className="text-xs text-amber-700 dark:text-amber-400">主线程出现 {Math.round(snapshot!.loopDelayMs!)} ms 卡顿，可能影响界面操作和消息处理。</p>}
    </div>}

    <section className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">进程<span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">{rows.length}</span></h2>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground"><input type="checkbox" checked={showStopped} onChange={event => onShowStoppedChange(event.target.checked)} className="accent-primary" />显示已停止 App</label>
          <div className="flex gap-1" role="group" aria-label="进程筛选">
            {([['all', '全部'], ['apps', 'App'], ['alerts', '异常']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => onFilterChange(key)}
              className={cn('rounded-md px-2.5 py-1 text-xs text-muted-foreground', filter === key && 'bg-muted text-foreground')}>{label}</button>)}
          </div>
        </div>
      </div>
      {actionError && <p role="alert" className="mb-3 text-xs text-destructive">{actionError}</p>}
      <div className="overflow-x-auto rounded-xl border border-border/70">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-b border-border/70 bg-muted/35 text-[11px] text-muted-foreground"><tr>
            <th className="px-4 py-3 font-medium">进程</th><th className="px-3 py-3 font-medium">状态</th>
            <th className="px-3 py-3 text-right font-medium"><button type="button" onClick={() => onMetricChange('cpuPercent')} className="inline-flex items-center gap-1">CPU {metric === 'cpuPercent' && <ArrowDownWideNarrow className="h-3 w-3" />}</button></th>
            <th className="px-3 py-3 text-right font-medium"><button type="button" onClick={() => onMetricChange('memoryBytes')} className="inline-flex items-center gap-1">内存 {metric === 'memoryBytes' && <ArrowDownWideNarrow className="h-3 w-3" />}</button></th>
            <th className="px-3 py-3 font-medium">{metric === 'cpuPercent' ? 'CPU' : '内存'}趋势</th><th className="px-3 py-3 font-medium">运行时间</th><th className="px-3 py-3 text-right font-medium">操作</th>
          </tr></thead>
          <tbody className="divide-y divide-border/50">{rows.map(row => <tr key={row.id} className={cn('transition-colors hover:bg-muted/30', selection?.id === row.id && 'bg-primary/[.045]')}>
            <td className="max-w-[300px] px-4 py-3"><button type="button" onClick={() => onSelect({ id: row.id, name: row.name })} className="block max-w-full truncate text-left font-medium hover:text-primary" title={`${row.name} · 点击查看趋势`}>{row.name}</button>
              <p className="mt-1 truncate text-[10px] text-muted-foreground" title={row.appName || row.parentName}>{kindLabels[row.kind]}{row.lifecycle === 'persistent' ? ' · 常驻' : row.lifecycle === 'on-demand' ? ' · 按需' : ''}{row.appName && row.kind === 'child' ? ` · ${row.appName}` : ''} · PID {row.pid ?? '—'}</p>
            </td>
            <td className="whitespace-nowrap px-3 py-3"><span className={cn('inline-flex items-center gap-1.5', alertIds.has(row.id) ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', unavailable ? 'bg-muted-foreground/40' : alertIds.has(row.id) ? 'bg-amber-500' : row.state === 'running' ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />{unavailable ? '待采集' : row.cpuHighSince != null ? '持续高负载' : row.orphaned ? '父进程已退出' : stateLabels[row.state] || row.state}</span>
              {!!row.recentCrashCount && <p className="mt-1 text-[10px] text-muted-foreground">5 分钟内异常退出 {row.recentCrashCount} 次</p>}
            </td>
            <td className={cn('whitespace-nowrap px-3 py-3 text-right tabular-nums', row.cpuHighSince != null && 'font-medium text-amber-600 dark:text-amber-400')}>{formatCpu(unavailable ? null : row.cpuPercent)}</td>
            <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatMemory(unavailable ? null : row.memoryBytes)}</td>
            <td className="px-3 py-3"><ResourceSparkline points={resourceSeries(sparkFrames, metric, row.id)} metric={metric} /></td>
            <td className="whitespace-nowrap px-3 py-3 text-[11px] tabular-nums text-muted-foreground">{row.pid && row.startedAt ? formatDuration(now - row.startedAt) : '—'}</td>
            <td className="px-3 py-3"><div className="flex justify-end gap-1">{row.canManage && <>
              <Button variant="ghost" size="icon-sm" title={`查看 ${row.appName || row.name} 日志`} aria-label={`查看 ${row.appName || row.name} 日志`} disabled={Boolean(busyAction)} onClick={() => onAction(row, 'logs')}><SquareTerminal className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon-sm" title={`重启 ${row.appName || row.name}`} aria-label={`重启 ${row.appName || row.name}`} disabled={Boolean(busyAction) || !row.canRestart} onClick={() => onAction(row, 'restart')}><RefreshCw className={cn('h-3.5 w-3.5', busyAction === `${row.id}:restart` && 'animate-spin')} /></Button>
            </>}</div></td>
          </tr>)}</tbody>
        </table>
        {!rows.length && <p className="p-8 text-center text-xs text-muted-foreground">{!snapshot ? '正在获取进程…' : filter === 'alerts' ? '当前没有异常进程' : '没有符合条件的进程'}</p>}
      </div>
    </section>

    {logs && <section className="mt-4 rounded-xl border border-border/70 bg-card p-4">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-medium">{logs.name} · 最近日志</h2><Button variant="ghost" size="icon-sm" aria-label="关闭日志" onClick={onCloseLogs}><X className="h-4 w-4" /></Button></div>
      <div className="max-h-72 overflow-auto rounded-lg bg-muted/40 p-3 font-mono text-[11px] leading-5">
        {logs.entries.length ? logs.entries.map((entry, index) => <div key={index} className="whitespace-pre-wrap break-all"><span className="text-muted-foreground">{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''} {entry.level || ''} </span>{typeof entry.message === 'string' ? entry.message : JSON.stringify(entry.message)}</div>) : <p className="text-muted-foreground">暂无日志</p>}
      </div>
    </section>}
    {!!snapshot?.events.length && <details className="mt-5 rounded-xl border border-border/70 px-4 py-3">
      <summary className="cursor-pointer text-xs text-muted-foreground">最近 15 分钟的异常记录（{snapshot.events.length}）</summary>
      <div className="mt-3 space-y-3">{[...snapshot.events].reverse().map(event => <button key={event.id} type="button" onClick={() => onSelect({ id: event.processId, name: event.name })} className="block w-full text-left text-xs">
        <span className="mr-2 tabular-nums text-muted-foreground">{new Date(event.startedAt).toLocaleTimeString()}</span><span className="font-medium">{event.name}</span>
        <p className="mt-1 text-muted-foreground">{event.message} · {event.endedAt ? event.endReason || '已结束' : unavailable ? '待确认' : '持续中'} · {formatDuration((event.endedAt || observedAt) - event.startedAt)}{event.kind === 'cpu' ? ` · 峰值 ${formatCpu(event.peakCpu)}` : ''}</p>
      </button>)}</div>
    </details>}
  </div>;
}
