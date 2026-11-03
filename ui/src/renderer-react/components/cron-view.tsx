"use client";

import * as React from "react";
import {
  AlarmClock,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CronTaskInfo } from '@/lib/desktop-api-types';

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

type CronViewProps = { onOpenSession?: (sessionId: string) => void; enterpriseEnabled?: boolean };

export function CronView({ onOpenSession }: CronViewProps) {
  const source = 'local';
  const [tasks, setTasks] = React.useState<CronTaskInfo[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [connectionNotice, setConnectionNotice] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [pendingRuns, setPendingRuns] = React.useState<Set<string>>(new Set());
  const [expandedTaskId, setExpandedTaskId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.agentDesktop.sessionCron.list(source);
      setTasks(Array.isArray(res?.tasks) ? res.tasks : []);
      setLoadError("");
      setConnectionNotice("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConnectionNotice("");
      setLoadError(`加载失败：${message}`);
    } finally {
      setLoading(false);
    }
  }, [source]);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh, source]);

  const flashNotice = React.useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((cur) => (cur === text ? "" : cur)), 3000);
  }, []);

  const handleToggle = async (task: CronTaskInfo) => {
    try {
      const res = await window.agentDesktop.sessionCron.toggle(source, { taskId: task.id, enabled: !task.enabled });
      if (!res?.ok) throw new Error(res?.error || "任务状态未更新");
      void refresh();
    } catch (error) {
      flashNotice(`操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleRemove = async (task: CronTaskInfo) => {
    try {
      const res = await window.agentDesktop.sessionCron.remove(source, { taskId: task.id });
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
      const res = await window.agentDesktop.sessionCron.runNow(source, { taskId: task.id });
      flashNotice(res?.ok ? "执行完成" : `执行失败：${res?.error || "未知错误"}`);
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
<div className="text-sm font-medium text-foreground">此电脑的定时任务</div>
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
          <div className="mb-3 text-xs text-muted-foreground">由当前电脑执行，请保持电脑上的 Moss 服务运行。</div>
          {loadError && <div role="alert" className="mb-3 text-sm text-destructive">{loadError}</div>}
          {connectionNotice && <div role="status" className="mb-3 rounded-xl border border-border/70 bg-card/60 p-4 text-sm text-muted-foreground">{connectionNotice}</div>}
          {tasks.length === 0 && !loadError && !connectionNotice ? (
            <div className="rounded-[24px] border border-dashed border-border/70 bg-card/50 px-5 py-10 text-center text-sm text-muted-foreground">
              {loading ? "加载中…" : (
                <>
                  暂无定时任务
                  <div className="mt-1 text-xs text-muted-foreground/70">
                    在当前电脑的会话里对 AI 说“每天早上九点总结新闻”即可创建
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
                    <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground" aria-label={`${expandedTaskId === task.id ? '收起' : '展开'}自动化详情`} onClick={() => setExpandedTaskId(current => current === task.id ? null : task.id)}>
                      {expandedTaskId === task.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
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
                    <span>{task.durable === false ? "本次桌面运行有效" : "重启后保留"}</span>
                    <span>执行电脑：{task.executionComputer || '当前电脑'}</span>
                    {task.projectName && <span>项目：{task.projectName}</span>}
                    {task.executionSessionId && onOpenSession ? (
                      <button
                        type="button"
                        className="text-primary underline-offset-2 transition-colors hover:underline"
                        onClick={() => onOpenSession(task.executionSessionId!)}
                      >
                        打开最近执行会话
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
                  {expandedTaskId === task.id && <div className="mt-3 ml-5 rounded-xl border border-border/60 bg-muted/20 p-3 text-xs">
                    <div className="grid gap-2 text-muted-foreground sm:grid-cols-2"><span>触发器：Cron · {task.cron}</span><span>时区：{task.timezone || '系统时区'}</span><span>关联项目：{task.projectName || '未关联项目'}</span><span>执行电脑：{task.executionComputer || '当前电脑'}</span></div>
                    <div className="mt-3 border-t border-border/50 pt-3"><p className="mb-2 font-medium text-foreground">最近运行</p>{task.runs?.length ? <div className="space-y-1.5">{task.runs.map(run => <div key={run.sessionId} className="flex flex-wrap items-center gap-2"><span className={cn('h-1.5 w-1.5 rounded-full', run.status === 'succeeded' ? 'bg-emerald-500' : run.status === 'failed' ? 'bg-destructive' : run.status === 'running' ? 'bg-primary' : 'bg-muted-foreground')} /><span className="text-foreground">{run.status === 'succeeded' ? '成功' : run.status === 'failed' ? '失败' : run.status === 'running' ? '运行中' : '结果未知'}</span><span>{formatCronTime(run.startedAt)}</span>{run.summary && <span className="min-w-0 flex-1 truncate" title={run.summary}>{run.summary}</span>}{onOpenSession && <button type="button" className="text-primary hover:underline" onClick={() => onOpenSession(run.sessionId)}>打开会话</button>}</div>)}</div> : <p className="text-muted-foreground">还没有运行记录。</p>}</div>
                  </div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
