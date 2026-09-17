"use client";

import * as React from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock3,
  GitBranch,
  History,
  LoaderCircle,
  MessageSquareText,
  Network,
  RotateCcw,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AgentTeamRun,
  AgentTeamsSessionState,
  AgentTeamSnapshot,
  AgentTeamTask,
} from "../types";

const PHASE_LABELS: Record<string, string> = {
  forming: "编队中",
  ready: "待执行",
  executing: "执行中",
  blocked: "有阻塞",
  wrapping_up: "收尾中",
  completed: "已完成",
  interrupted: "已中断",
};

function formatElapsed(startedAt: number, endAt: number) {
  const seconds = Math.max(0, Math.floor((endAt - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map((value) => String(value).padStart(2, "0")).join(":");
}

function latestRun(state: AgentTeamsSessionState): AgentTeamRun | null {
  return state.teams.find((team) => team.status === "live") ?? state.teams[0] ?? null;
}

export function AgentTeamsStrip({
  state,
  onOpen,
}: {
  state: AgentTeamsSessionState;
  onOpen: () => void;
}) {
  const run = latestRun(state);
  const snapshot = run?.snapshots.at(-1);
  if (!run || !snapshot) return null;
  const counts = snapshot.taskCounts;
  const activeMembers = snapshot.team.members.filter((member) => member.agentId !== snapshot.team.leadAgentId && member.status === "running").length;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-h-12 shrink-0 items-center gap-3 border-b border-border/70 bg-muted/25 px-4 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      aria-label="打开 Agent Teams 共享任务图"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-primary">
        <Network className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
          <span className="truncate">Agent Teams · {run.teamName}</span>
          <span className={cn(
            "shrink-0 text-[10px]",
            run.status === "live" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
          )}>
            {run.status === "live" ? "实时" : "回看"}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {PHASE_LABELS[snapshot.phase] ?? snapshot.phase} · 完成 {counts.completed}/{counts.total} · 进行中 {counts.inProgress} · 待领 {counts.pending} · 阻塞 {counts.blocked}
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:flex">
        <Users className="h-3.5 w-3.5" />
        {run.status === "live" ? `跟随 ${activeMembers} 位成员` : `${snapshot.team.members.length} 位成员`}
      </span>
      <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </button>
  );
}

type PositionedTask = AgentTeamTask & { x: number; y: number };

function layoutTasks(tasks: AgentTeamTask[]) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const memo = new Map<string, number>();
  const depthOf = (task: AgentTeamTask, visiting = new Set<string>()): number => {
    if (memo.has(task.id)) return memo.get(task.id)!;
    if (visiting.has(task.id)) return 0;
    visiting.add(task.id);
    const dependencies = task.blockedBy.map((id) => byId.get(id)).filter(Boolean) as AgentTeamTask[];
    const depth = dependencies.length === 0
      ? 0
      : Math.max(...dependencies.map((dependency) => depthOf(dependency, new Set(visiting)))) + 1;
    memo.set(task.id, depth);
    return depth;
  };
  const rows = new Map<number, AgentTeamTask[]>();
  tasks.forEach((task) => {
    const depth = depthOf(task);
    rows.set(depth, [...(rows.get(depth) ?? []), task]);
  });
  const positioned: PositionedTask[] = [];
  for (const [depth, entries] of rows) {
    entries.forEach((task, row) => positioned.push({ ...task, x: 32 + depth * 272, y: 32 + row * 132 }));
  }
  const maxDepth = Math.max(0, ...positioned.map((task) => Math.round((task.x - 32) / 272)));
  const maxRows = Math.max(1, ...Array.from(rows.values()).map((entries) => entries.length));
  return {
    tasks: positioned,
    width: Math.max(720, 64 + (maxDepth + 1) * 272),
    height: Math.max(340, 64 + maxRows * 132),
  };
}

function TaskNode({ task, selected, onSelect }: { task: PositionedTask; selected: boolean; onSelect: () => void }) {
  const blocked = task.blocked;
  const statusLabel = task.status === "completed" ? "完成" : task.status === "in_progress" ? "进行中" : blocked ? "阻塞" : "待领";
  const ownerLabel = task.owner || (task.status === "completed" ? "团队任务" : "未领取");
  const StatusIcon = task.status === "completed" ? CheckCircle2 : task.status === "in_progress" ? LoaderCircle : Circle;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "absolute flex h-[100px] w-[224px] flex-col border bg-background p-3 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-primary" : "border-border/80 hover:border-primary/45",
      )}
      style={{ left: task.x, top: task.y }}
    >
      <span className="flex w-full items-start gap-2">
        <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">#{task.id}</span>
        <span className="line-clamp-2 min-w-0 flex-1 text-xs font-medium leading-4 text-foreground">{task.subject}</span>
        <StatusIcon className={cn(
          "h-3.5 w-3.5 shrink-0",
          task.status === "in_progress" && "animate-spin text-sky-500",
          task.status === "completed" && "text-emerald-500",
          blocked && "text-amber-500",
        )} />
      </span>
      <span className="mt-auto flex w-full items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="truncate">{ownerLabel}</span>
        <span className={cn(blocked && "text-amber-600 dark:text-amber-400")}>{statusLabel}</span>
      </span>
    </button>
  );
}

function TaskDag({ snapshot }: { snapshot: AgentTeamSnapshot }) {
  const layout = React.useMemo(() => layoutTasks(snapshot.tasks), [snapshot.tasks]);
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const selected = snapshot.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const byId = new Map(layout.tasks.map((task) => [task.id, task]));
  const updateZoom = (next: number | ((current: number) => number)) => {
    setZoom((current) => {
      const value = typeof next === "function" ? next(current) : next;
      return Math.min(1.6, Math.max(0.6, Math.round(value * 10) / 10));
    });
  };

  if (snapshot.tasks.length === 0) {
    return <div className="flex h-full min-h-72 items-center justify-center text-sm text-muted-foreground">团队已创建，等待共享任务</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 overflow-auto bg-muted/15">
        <div className="sticky right-3 top-3 z-20 ml-auto mr-3 flex h-8 w-fit items-center gap-0.5 rounded-md border border-border/70 bg-background/95 p-0.5 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() => updateZoom((current) => current - 0.1)}
            disabled={zoom <= 0.6}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35"
            aria-label="缩小任务图"
            title="缩小"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => updateZoom(1)}
            disabled={zoom === 1}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35"
            aria-label="重置任务图缩放"
            title="重置缩放"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center text-[10px] tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => updateZoom((current) => current + 0.1)}
            disabled={zoom >= 1.6}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35"
            aria-label="放大任务图"
            title="放大"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div
            className="relative origin-top-left"
            style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}
          >
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
              <defs>
                <marker id="agent-team-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground/60" />
                </marker>
              </defs>
              {layout.tasks.flatMap((task) => task.blockedBy.map((dependencyId) => {
                const dependency = byId.get(dependencyId);
                if (!dependency) return null;
                const x1 = dependency.x + 224;
                const y1 = dependency.y + 50;
                const x2 = task.x;
                const y2 = task.y + 50;
                return (
                  <path
                    key={`${dependencyId}-${task.id}`}
                    d={`M ${x1} ${y1} C ${x1 + 28} ${y1}, ${x2 - 28} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    className="stroke-muted-foreground/45"
                    strokeWidth="1.5"
                    markerEnd="url(#agent-team-arrow)"
                  />
                );
              }))}
            </svg>
            {layout.tasks.map((task) => (
              <TaskNode key={task.id} task={task} selected={selectedTaskId === task.id} onSelect={() => setSelectedTaskId(task.id)} />
            ))}
          </div>
        </div>
      </div>
      {selected ? (
        <div className="shrink-0 border-t border-border/70 bg-background px-4 py-3 text-xs">
          <div className="font-medium text-foreground">#{selected.id} {selected.subject}</div>
          <div className="mt-1 line-clamp-2 text-muted-foreground">{selected.description || selected.activeForm || "无任务说明"}</div>
        </div>
      ) : null}
    </div>
  );
}

export function AgentTeamsWorkbench({
  state,
  onClose,
}: {
  state: AgentTeamsSessionState;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = React.useState(() => latestRun(state)?.incarnationId ?? "");
  const run = state.teams.find((team) => team.incarnationId === selectedId) ?? latestRun(state);
  const [frame, setFrame] = React.useState(() => Math.max(0, (run?.snapshots.length ?? 1) - 1));
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    if (!run) return;
    setFrame(Math.max(0, run.snapshots.length - 1));
  }, [run?.incarnationId, run?.snapshots.length, run?.status]);

  React.useEffect(() => {
    if (run?.status !== "live") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run?.status]);

  if (!run) return null;
  const snapshot = run.snapshots[Math.min(frame, run.snapshots.length - 1)] ?? run.snapshots.at(-1);
  if (!snapshot) return null;
  const counts = snapshot.taskCounts;
  const endAt = run.status === "live" ? now : Date.parse(run.deletedAt || run.updatedAt) || now;
  const activeMembers = snapshot.team.members.filter((member) => member.agentId !== snapshot.team.leadAgentId && member.status === "running").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="shrink-0 border-b border-border/70 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted" title="返回会话">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold">Agent Teams · 共享任务图</h2>
              <span className={cn("text-[10px]", run.status === "live" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                {run.status === "live" ? "实时" : "历史"}
              </span>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">{snapshot.team.description || run.teamName}</p>
          </div>
          {state.teams.length > 1 ? (
            <select
              value={run.incarnationId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="h-8 max-w-56 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              aria-label="选择团队运行"
            >
              {state.teams.map((team) => (
                <option key={team.incarnationId} value={team.incarnationId}>
                  {team.teamName} · {team.status === "live" ? "进行中" : team.status === "completed" ? "已完成" : "已中断"}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">阶段 {PHASE_LABELS[snapshot.phase] ?? snapshot.phase}</span>
          <span>完成 <b className="font-medium text-emerald-600 dark:text-emerald-400">{counts.completed}/{counts.total}</b></span>
          <span>进行中 <b className="font-medium text-sky-600 dark:text-sky-400">{counts.inProgress}</b></span>
          <span>待领 <b className="font-medium text-foreground">{counts.pending}</b></span>
          <span>阻塞 <b className="font-medium text-amber-600 dark:text-amber-400">{counts.blocked}</b></span>
          <span className="ml-auto flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{formatElapsed(run.createdAt, endAt)}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-[360px] min-w-0 flex-1 flex-col border-b border-border/70 lg:border-b-0 lg:border-r">
          <TaskDag snapshot={snapshot} />
        </div>
        <aside className="flex max-h-64 w-full shrink-0 flex-col lg:max-h-none lg:w-64">
          <div className="border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-medium"><Users className="h-3.5 w-3.5" />成员</div>
            <div className="mt-2 space-y-1.5">
              {snapshot.team.members.map((member) => (
                <div key={member.agentId} className="flex items-center gap-2 text-[11px]">
                  <span className={cn("h-2 w-2 rounded-full", member.status === "running" ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                  <span className="min-w-0 flex-1 truncate text-foreground">{member.name}</span>
                  <span className="truncate text-muted-foreground">{member.agentType || "agent"}</span>
                </div>
              ))}
            </div>
            {run.status === "live" ? <div className="mt-2 text-[10px] text-muted-foreground">正在跟随 {activeMembers} 个成员的实时进度</div> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-medium"><MessageSquareText className="h-3.5 w-3.5" />协作消息</div>
            <div className="mt-2 space-y-3">
              {snapshot.messages.slice(-30).reverse().map((message) => (
                <div key={message.id} className="text-[11px] leading-4">
                  <div className="flex items-center gap-1 text-muted-foreground"><span className="text-foreground">{message.from}</span><span>→</span><span>{message.to}</span></div>
                  <p className="mt-0.5 break-words text-muted-foreground">{message.summary || message.text}</p>
                </div>
              ))}
              {snapshot.messages.length === 0 ? <p className="text-[11px] text-muted-foreground">暂无协作消息</p> : null}
            </div>
          </div>
        </aside>
      </div>

      {run.status !== "live" && run.snapshots.length > 1 ? (
        <div className="flex h-12 shrink-0 items-center gap-3 border-t border-border/70 px-4">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">回看历史</span>
          <input
            type="range"
            min={0}
            max={run.snapshots.length - 1}
            value={frame}
            onChange={(event) => setFrame(Number(event.target.value))}
            className="min-w-0 flex-1 accent-primary"
            aria-label="团队历史时间轴"
          />
          <span className="w-20 text-right text-[10px] tabular-nums text-muted-foreground">{new Date(snapshot.capturedAt).toLocaleTimeString()}</span>
        </div>
      ) : null}
    </div>
  );
}
