"use client";

import * as React from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Circle,
  Clock3,
  History,
  LoaderCircle,
  List,
  LayoutGrid,
  MessageSquareText,
  Network,
  Pause,
  Play,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getTeamMembersAtFrame, MEMBER_ACTIVITY_LABELS, tasksForMember, messagesForMember, memberMatchesQuery, type TeamMemberView } from "@/lib/agent-team-members";
import { AgentBrowserControls } from "./agent-browser-controls";
import { AgentTeamInspector } from "./agent-team-inspector";
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

export function AgentTeamsStatus({
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
  const unclaimedCount = snapshot.tasks.filter((task) => task.status === "pending" && !task.owner).length;
  const members = getTeamMembersAtFrame(run);
  const activeMembers = members.filter((member) => member.agentId !== snapshot.team.leadAgentId && member.activity === "working").length;
  const live = run.status === "live";
  const phaseLabel = PHASE_LABELS[snapshot.phase] ?? snapshot.phase;
  const statusLabel = live ? "运行中" : run.status === "completed" ? "已完成" : "已中断";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group inline-flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/25 px-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Agent Teams ${statusLabel}，${phaseLabel}，完成 ${counts.completed}/${counts.total}`}
      title={`Agent Teams · ${statusLabel} · ${phaseLabel} · 完成 ${counts.completed}/${counts.total} · 进行中 ${counts.inProgress} · 待领 ${unclaimedCount} · ${live ? `跟随 ${activeMembers} 位成员` : `${members.length} 位成员`}`}
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center text-primary">
        <Network className="h-3.5 w-3.5" />
        <span className={cn(
          "absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full",
          live ? "bg-emerald-500" : run.status === "completed" ? "bg-muted-foreground/60" : "bg-amber-500",
          live && "animate-pulse",
        )} />
      </span>
      <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-foreground">Team {members.length}</span>
      <span className="hidden truncate text-[10px] text-muted-foreground @[640px]/session-header:inline">{statusLabel} · {counts.completed}/{counts.total}</span>
    </button>
  );
}

/** @deprecated Use the compact header status; the full task graph opens on click. */
export const AgentTeamsStrip = AgentTeamsStatus;

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
  const statusLabel = task.status === "completed" ? "完成" : task.status === "in_progress" ? "进行中" : blocked ? "阻塞" : task.owner ? "已分配" : "待领";
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

function TeamMemberCard({ member, snapshot, selected, onSelect }: {
  member: TeamMemberView; snapshot: AgentTeamSnapshot; selected: boolean; onSelect: () => void;
}) {
  const tasks = tasksForMember(snapshot.tasks, member);
  const task = tasks.find(item => item.status === "in_progress") ?? tasks.find(item => item.status === "pending") ?? tasks.at(-1);
  const completed = tasks.filter(item => item.status === "completed").length;
  const recent = messagesForMember(snapshot.messages, member).filter(message => message.from === member.name || message.from === member.agentId).at(-1);
  const working = member.activity === "working";
  const color = working ? "text-sky-600 dark:text-sky-400" : member.activity === "completed" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground";
  return <button type="button" onClick={onSelect} aria-label={`查看成员 ${member.name}，${MEMBER_ACTIVITY_LABELS[member.activity]}`} aria-pressed={selected}
    className={cn("flex min-h-40 min-w-0 flex-col rounded-xl border bg-background p-3.5 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected ? "border-primary ring-2 ring-primary/10" : "border-border/70")}>
    <span className="flex w-full min-w-0 items-center gap-2"><span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60", color)}><Bot className="h-4 w-4" /></span><span className="min-w-0 flex-1 truncate text-xs font-semibold" title={member.name}>{member.name}</span><span className={cn("shrink-0 text-[10px]", color)}>{MEMBER_ACTIVITY_LABELS[member.activity]}</span></span>
    <span className="mt-3 line-clamp-2 min-h-8 text-xs font-medium leading-4">{task ? task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject : "暂无已分配任务"}</span>
    <span className="mt-2 line-clamp-2 min-h-8 text-[11px] leading-4 text-muted-foreground">{recent ? `最近回复 · ${recent.summary || recent.text}` : task?.description || (member.present ? "等待任务分配" : "已退出团队")}</span>
    <span className="mt-auto flex w-full items-center justify-between gap-2 border-t border-border/40 pt-2 text-[10px] text-muted-foreground"><span>{completed}/{tasks.length} 任务完成</span><span>{recent ? `最近 ${new Date(recent.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : member.joinedAt ? `加入 ${new Date(member.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : member.agentType || "Agent"}</span></span>
  </button>;
}

function TeamTopology({ snapshot, members, selectedId, onSelect }: {
  snapshot: AgentTeamSnapshot; members: TeamMemberView[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [collapsed, setCollapsed] = React.useState(false);
  const [limit, setLimit] = React.useState(24);
  React.useEffect(() => setLimit(24), [query, status, collapsed]);
  const lead = members.find(member => member.agentId === snapshot.team.leadAgentId);
  const workers = members.filter(member => member.agentId !== snapshot.team.leadAgentId);
  const completed = workers.filter(member => member.activity === "completed").length;
  const active = members.filter(member => member.activity === "working").length;
  const filtered = workers.filter(member => memberMatchesQuery(member, snapshot, query)
    && (status === "all" || (status === "attention" ? ["departed", "interrupted"].includes(member.activity) : member.activity === status))
    && !(collapsed && status === "all" && !query.trim() && member.activity === "completed"));
  return <div className="flex min-h-0 flex-1 flex-col">
    <AgentBrowserControls query={query} onQuery={setQuery} status={status} onStatus={setStatus} options={[{ value: "all", label: "全部状态" }, { value: "working", label: "工作中" }, { value: "completed", label: "任务完成" }, { value: "idle", label: "空闲" }, { value: "attention", label: "中断 / 退出" }]} count={filtered.length} completedCount={completed} collapsed={collapsed} onCollapse={() => setCollapsed(value => !value)} />
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 p-4">
      <div className="mx-auto max-w-6xl">
        {lead ? <button type="button" onClick={() => onSelect(lead.agentId)} aria-label="查看 Team Lead" className={cn("mb-4 flex w-full items-center gap-3 rounded-xl border bg-primary/5 p-3 text-left hover:border-primary/50", selectedId === lead.agentId ? "border-primary" : "border-primary/20")}><Bot className="h-5 w-5 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{lead.name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">Team Lead · 协调 {workers.length} 位成员</span></span><span className="text-[10px] text-muted-foreground">{active} 个正在工作</span></button> : null}
        <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground"><span>团队成员 · 点击查看任务与执行记录</span><span>任务分配 {snapshot.tasks.filter(task => task.owner).length}/{snapshot.tasks.length}</span></div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,230px),1fr))] gap-3">
          {filtered.slice(0, limit).map(member => <TeamMemberCard key={member.agentId} member={member} snapshot={snapshot} selected={selectedId === member.agentId} onSelect={() => onSelect(member.agentId)} />)}
        </div>
        {filtered.length > limit ? <button type="button" onClick={() => setLimit(value => value + 24)} className="mt-4 w-full rounded-lg border py-2 text-xs hover:bg-muted">再显示 {Math.min(24, filtered.length - limit)} 位成员（剩余 {filtered.length - limit} 位）</button> : null}
        {filtered.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-xs text-muted-foreground">{collapsed && completed > 0 && !query && status === "all" ? "已完成成员已收起，可在上方展开" : workers.length === 0 ? "此时尚无子 Agent 加入团队" : "没有匹配的 Agent"}</div> : null}
      </div>
    </div>
  </div>;
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
  const [selectedMember, setSelectedMember] = React.useState<{ runId: string; id: string | null } | null>(null);
  const [teamView, setTeamView] = React.useState<"topology" | "tasks">("topology");
  const run = state.teams.find((team) => team.incarnationId === selectedId) ?? latestRun(state);
  const [frame, setFrame] = React.useState(() => Math.max(0, (run?.snapshots.length ?? 1) - 1));
  const [playing, setPlaying] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    if (!run) return;
    setPlaying(false);
    setFrame(Math.max(0, run.snapshots.length - 1));
  }, [run?.incarnationId, run?.snapshots.length, run?.status]);

  React.useEffect(() => {
    if (!playing || !run || run.status === "live" || run.snapshots.length < 2) return;
    const lastFrame = run.snapshots.length - 1;
    if (frame >= lastFrame) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setFrame((current) => Math.min(current + 1, lastFrame));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [frame, playing, run?.incarnationId, run?.snapshots.length, run?.status]);

  React.useEffect(() => {
    if (run?.status !== "live") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run?.status]);

  if (!run) return null;
  const snapshot = run.snapshots[Math.min(frame, run.snapshots.length - 1)] ?? run.snapshots.at(-1);
  if (!snapshot) return null;
  const counts = snapshot.taskCounts;
  const unclaimedCount = snapshot.tasks.filter((task) => task.status === "pending" && !task.owner).length;
  const endAt = run.status === "live" ? now : Date.parse(run.deletedAt || run.updatedAt) || now;
  const members = getTeamMembersAtFrame(run, frame);
  const selected = selectedMember?.runId === run.incarnationId ? members.find(member => member.agentId === selectedMember.id) ?? null : null;
  const panelOpen = selectedMember?.runId === run.incarnationId && (selectedMember.id === null || Boolean(selected));
  const selectMember = (id: string | null) => setSelectedMember({ runId: run.incarnationId, id });
  const activeMembers = members.filter((member) => member.agentId !== snapshot.team.leadAgentId && member.activity === "working").length;

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
          </div>
          <div className="flex items-center rounded-lg border border-border/70 bg-muted/25 p-0.5" role="tablist" aria-label="Agent Teams 展示方式">
            <button
              type="button"
              role="tab"
              aria-selected={teamView === "topology"}
              onClick={() => setTeamView("topology")}
              className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-[10px] transition-colors", teamView === "topology" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />成员拓扑
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={teamView === "tasks"}
              onClick={() => setTeamView("tasks")}
              className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-[10px] transition-colors", teamView === "tasks" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              <List className="h-3.5 w-3.5" />任务依赖
            </button>
          </div>
          <button type="button" onClick={() => selectMember(null)} className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted" aria-label="查看团队协作消息"><MessageSquareText className="h-3.5 w-3.5" />协作消息</button>
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
          <span>待领 <b className="font-medium text-foreground">{unclaimedCount}</b></span>
          <span>阻塞 <b className="font-medium text-amber-600 dark:text-amber-400">{counts.blocked}</b></span>
          <span className="ml-auto flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{formatElapsed(run.createdAt, endAt)}</span>
        </div>
      </div>

      <div className="@container/agent-workspace relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {teamView === "topology" ? <TeamTopology key={run.incarnationId} snapshot={snapshot} members={members} selectedId={selected?.agentId ?? null} onSelect={selectMember} /> : <TaskDag snapshot={snapshot} />}
          {run.status !== "live" && run.snapshots.length > 1 ? (
            <div className="flex h-11 shrink-0 items-center border-t border-border/70 px-3">
              <div className="flex w-full items-center gap-2 lg:w-1/2 lg:max-w-[560px]">
                <History className="h-4 w-4 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => {
                    if (playing) {
                      setPlaying(false);
                      return;
                    }
                    setFrame(0);
                    setPlaying(true);
                  }}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={playing ? "暂停团队历史播放" : "从头播放团队历史"}
                  title={playing ? "暂停" : "从头播放"}
                >
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={run.snapshots.length - 1}
                  value={frame}
                  onChange={(event) => {
                    setPlaying(false);
                    setFrame(Number(event.target.value));
                  }}
                  className="min-w-0 flex-1 accent-primary"
                  aria-label="团队历史时间轴"
                />
                <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{frame + 1}/{run.snapshots.length}</span>
                <span className="hidden w-16 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground xl:block">{new Date(snapshot.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
          ) : null}
        </div>
        {panelOpen ? <AgentTeamInspector key={`${run.incarnationId}:${selected?.agentId ?? "team"}`} sessionId={state.sessionId} run={run} snapshot={snapshot} frame={Math.min(frame, run.snapshots.length - 1)} member={selected} members={members} onSelect={selectMember} onClose={() => setSelectedMember(null)} /> : null}
      </div>

    </div>
  );
}
