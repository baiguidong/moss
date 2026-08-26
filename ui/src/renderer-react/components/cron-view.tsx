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
};

function formatCronTime(ms: number | null) {
  if (!ms) return "—";
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return `今天 ${hm}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return sameYear ? `${md} ${hm}` : `${d.getFullYear()}/${md} ${hm}`;
}

export function CronView({
  onOpenSession,
}: {
  onOpenSession?: (sessionId: string) => void;
}) {
  const [tasks, setTasks] = React.useState<CronTaskInfo[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState("");

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.agentDesktop.ipcInvoke("agent:cron-list") as { tasks?: CronTaskInfo[] } | undefined;
      setTasks(Array.isArray(res?.tasks) ? res.tasks : []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const flashNotice = React.useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((cur) => (cur === text ? "" : cur)), 3000);
  }, []);

  const handleToggle = async (task: CronTaskInfo) => {
    await window.agentDesktop.ipcInvoke("agent:cron-toggle", { taskId: task.id, enabled: !task.enabled });
    void refresh();
  };

  const handleRemove = async (task: CronTaskInfo) => {
    await window.agentDesktop.ipcInvoke("agent:cron-remove", { taskId: task.id });
    flashNotice("任务已删除");
    void refresh();
  };

  const handleRunNow = async (task: CronTaskInfo) => {
    const res = await window.agentDesktop.ipcInvoke("agent:cron-run-now", { taskId: task.id }) as { ok?: boolean; error?: string; sessionId?: string } | undefined;
    flashNotice(res?.ok ? "已触发，请到定时任务会话查看" : `触发失败：${res?.error || "未知错误"}`);
    if (res?.ok && res.sessionId) {
      onOpenSession?.(res.sessionId);
    }
    void refresh();
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
            <div className="text-sm font-medium text-foreground">定时任务</div>
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
          {tasks.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-border/70 bg-card/50 px-5 py-10 text-center text-sm text-muted-foreground">
              {loading ? "加载中…" : (
                <>
                  暂无定时任务
                  <div className="mt-1 text-xs text-muted-foreground/70">
                    在会话里对 AI 说"每分钟报一次时间"、"每天早上九点总结新闻"即可创建
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
                        task.orphaned ? "bg-destructive" : task.enabled ? "bg-emerald-500" : "bg-muted-foreground/50",
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
                        task.orphaned
                          ? "bg-destructive/10 text-destructive"
                          : task.enabled
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-muted/60 text-muted-foreground",
                      )}
                    >
                      {task.orphaned ? "已孤立" : task.enabled ? "运行中" : "已暂停"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-5 text-xs text-muted-foreground">
                    <span>
                      归属：
                      {task.orphaned ? (
                        "归属会话已删除"
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
                    {task.executionSessionId && onOpenSession ? (
                      <button
                        type="button"
                        className="text-primary underline-offset-2 transition-colors hover:underline"
                        onClick={() => onOpenSession(task.executionSessionId!)}
                      >
                        打开执行会话
                      </button>
                    ) : null}
                    <span>下次运行：{task.enabled ? formatCronTime(task.nextRunAt) : "—"}</span>
                    <span>上次运行：{formatCronTime(task.lastFiredAt)}</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      <button
                        type="button"
                        className="rounded-md p-1.5 transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        title="立即执行"
                        disabled={task.orphaned}
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
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
