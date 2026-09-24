"use client";

import * as React from "react";
import {
  AlarmClock,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

type CronTaskInfo = {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  createdAt: number | null;
  lastFiredAt: number | null;
  enabled: boolean;
  orphaned: boolean;
  ownerSessionId: string | null;
  ownerSessionTitle: string | null;
  executionSessionId: string | null;
  executionSessionTitle: string | null;
  nextRunAt: number | null;
  durable?: boolean;
  status?: 'idle' | 'running' | 'failed';
  lastError?: string | null;
  lastCompletedAt?: number | null;
  timezone?: string;
};

function formatCronTime(ms: number | null, timezone?: string) {
  if (!ms) return "—";
  if (timezone) return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return `今天 ${hm}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return sameYear ? `${md} ${hm}` : `${d.getFullYear()}/${md} ${hm}`;
}

type CronViewProps = { onOpenSession?: (sessionId: string) => void; remoteEnabled?: boolean };

export function CronView(props: CronViewProps) {
  const [source, setSource] = React.useState<'local' | 'cloud'>('local');
  return <div className="flex h-full min-h-0 flex-col">
    <div role="tablist" aria-label="定时任务位置" className="flex shrink-0 gap-2 border-b px-4 py-2 sm:px-6">
      {([['local', '本地'], ['cloud', '云端']] as const).map(([value, label]) =>
        <Button key={value} role="tab" aria-selected={source === value} variant={source === value ? 'secondary' : 'ghost'} size="sm" onClick={() => setSource(value)}>{label}</Button>)}
    </div>
    <div role="tabpanel" className="min-h-0 flex-1">
      <CronTaskList key={source} source={source} {...props} />
    </div>
  </div>;
}

function CronTaskList({ onOpenSession, remoteEnabled = false, source }: CronViewProps & { source: 'local' | 'cloud' }) {
  const channel = source === 'cloud' ? 'cloud-cron' : 'cron';
  const request = React.useCallback((action: string, payload?: unknown) => window.agentDesktop.ipcInvoke(`agent:${channel}-${action}`, payload), [channel]);
  const [tasks, setTasks] = React.useState<CronTaskInfo[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [pendingRuns, setPendingRuns] = React.useState<Set<string>>(new Set());

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      if (source === 'cloud' && !remoteEnabled) throw new Error('请先在设置中启用云端连接。');
      const res = await request('list') as { tasks?: CronTaskInfo[] } | undefined;
      setTasks(Array.isArray(res?.tasks) ? res.tasks : []);
      setLoadError("");
    } catch (error) {
      setLoadError(`加载失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [request, source, remoteEnabled]);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), source === 'cloud' ? 5_000 : 30_000);
    return () => window.clearInterval(timer);
  }, [refresh, source]);

  const flashNotice = React.useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((cur) => (cur === text ? "" : cur)), 3000);
  }, []);

  const handleToggle = async (task: CronTaskInfo) => {
    try {
      const res = await request('toggle', { taskId: task.id, enabled: !task.enabled }) as { ok?: boolean; error?: string } | undefined;
      if (!res?.ok) throw new Error(res?.error || "任务状态未更新");
      void refresh();
    } catch (error) {
      flashNotice(`操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleRemove = async (task: CronTaskInfo) => {
    try {
      const res = await request('remove', { taskId: task.id }) as { ok?: boolean; error?: string } | undefined;
      if (!res?.ok) throw new Error(res?.error || "任务未删除");
      flashNotice("任务已删除");
      void refresh();
    } catch (error) {
      flashNotice(`删除失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleRunNow = async (task: CronTaskInfo) => {
    setPendingRuns(current => new Set(current).add(task.id));
    try {
      const res = await request('run-now', { taskId: task.id }) as { ok?: boolean; error?: string; sessionId?: string } | undefined;
      flashNotice(res?.ok ? (source === 'cloud' ? "已提交执行" : "执行完成") : `执行失败：${res?.error || "未知错误"}`);
      if (res?.ok && res.sessionId) onOpenSession?.(res.sessionId);
    } catch (error) {
      flashNotice(`执行失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPendingRuns(current => { const next = new Set(current); next.delete(task.id); return next; });
      void refresh();
    }
  };

  const orphanCount = tasks.filter((t) => t.orphaned).length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(58,191,129,0.08),transparent_22%),var(--background)]">
      <div className="shrink-0 border-b border-border/70 bg-background/88 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[980px] items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-cyan-600 text-white">
            <AlarmClock className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
<div className="text-sm font-medium text-foreground">{source === 'cloud' ? '云端定时任务' : '本地定时任务'}</div>
            <div className="truncate text-xs text-muted-foreground">
              {tasks.length} 个任务
              {orphanCount > 0 ? ` · ${orphanCount} 个已孤立` : ""}
              {notice ? ` · ${notice}` : ""}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-full px-3 text-xs"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            <span className="ml-1">刷新</span>
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[980px] px-4 py-4 sm:px-6">
          <div className="mb-3 text-xs text-muted-foreground">{source === 'cloud' ? '由 Moss Server 执行，关闭桌面不影响运行。' : '由本机执行，需要保持桌面应用运行。'}</div>
          {loadError && <div role="alert" className="mb-3 text-sm text-destructive">{loadError}</div>}
          {tasks.length === 0 && !loadError ? (
            <div className="rounded-[24px] border border-dashed border-border/70 bg-card/50 px-5 py-10 text-center text-sm text-muted-foreground">
              {loading ? "加载中…" : (
                <>
                  暂无定时任务
                  <div className="mt-1 text-xs text-muted-foreground/70">
                    在{source === 'cloud' ? '云端' : '本地'}会话里对 AI 说“每天早上九点总结新闻”即可创建
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-[20px] border border-border/70 bg-card/80 px-4 py-3 shadow-[0_14px_40px_-34px_rgba(0,0,0,0.5)]"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
                        task.orphaned || task.status === 'failed' ? "bg-destructive" : task.enabled ? "bg-emerald-500" : "bg-muted-foreground/50",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={task.prompt}>
                      {task.prompt}
                    </span>
                    <span className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {task.cron}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                        task.orphaned || task.status === 'failed'
                          ? "bg-destructive/10 text-destructive"
                          : task.enabled
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-muted/60 text-muted-foreground",
                      )}
                    >
                      {task.orphaned ? "已孤立" : task.status === 'running' || pendingRuns.has(task.id) ? "运行中" : task.status === 'failed' ? "执行失败" : task.enabled ? "待执行" : "已暂停"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-5 text-xs text-muted-foreground">
                    <span>
                      归属：
                      {task.orphaned ? (
                        "归属会话不可用"
                      ) : task.ownerSessionId && onOpenSession ? (
                        <button
                          type="button"
                          className="text-primary underline-offset-2 transition-colors hover:underline"
                          onClick={() => onOpenSession(task.ownerSessionId!)}
                        >
                          {task.ownerSessionTitle || task.ownerSessionId}
                        </button>
                      ) : (
                        task.ownerSessionTitle || task.ownerSessionId || "—"
                      )}
                    </span>
                    <span>{task.recurring ? "循环任务" : "一次性任务"}</span>
                    <span>{source === 'cloud' ? "云端持久任务" : task.durable === false ? "本次桌面运行有效" : "重启后保留"}</span>
                    {task.executionSessionId && onOpenSession ? (
                      <button
                        type="button"
                        className="text-primary underline-offset-2 transition-colors hover:underline"
                        onClick={() => onOpenSession(task.executionSessionId!)}
                      >
                        打开执行会话
                      </button>
                    ) : null}
                    {task.timezone && <span>计划时区：{task.timezone}</span>}
                    <span>下次运行：{task.enabled ? formatCronTime(task.nextRunAt, task.timezone) : "—"}</span>
                    <span>上次开始：{formatCronTime(task.lastFiredAt, task.timezone)}</span>
                    <span>上次完成：{formatCronTime(task.lastCompletedAt ?? null, task.timezone)}</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      <button
                        type="button"
                        className="rounded-md p-1.5 transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        title="立即执行"
                        disabled={task.orphaned || task.status === 'running' || pendingRuns.has(task.id)}
                        onClick={() => void handleRunNow(task)}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded-md p-1.5 transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        title={task.enabled ? "暂停" : "启用"}
                        disabled={task.orphaned}
                        onClick={() => void handleToggle(task)}
                      >
                        {task.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 text-emerald-500" />}
                      </button>
                      <button
                        type="button"
                        className="rounded-md p-1.5 transition-colors hover:bg-muted/60 hover:text-destructive"
                        title="删除任务"
                        onClick={() => void handleRemove(task)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                  {task.lastError && <div role="alert" className="mt-2 pl-5 text-xs text-destructive">{task.lastError}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
