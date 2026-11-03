"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  LayoutGrid,
  List,
  LoaderCircle,
} from "lucide-react";
import { GroupedVirtuoso, type GroupedVirtuosoHandle } from "react-virtuoso";
import { cn } from "@/lib/utils";
import { AgentBrowserControls } from "./agent-browser-controls";
import { AgentExecutionRecord } from "./agent-execution-record";
import { AgentTreeCanvas } from "./agent-tree-canvas";
import type { SessionSummary } from "../types";

export type CoordinatorWorkerStatus = "running" | "completed" | "failed";

const STATUS_LABELS: Record<CoordinatorWorkerStatus, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
};

const STATUS_PRIORITY: Record<CoordinatorWorkerStatus, number> = {
  running: 0,
  failed: 1,
  completed: 2,
};

export function getCoordinatorWorkerStatus(
  worker: SessionSummary,
): CoordinatorWorkerStatus {
  if (worker.subagentStatus === "running" || worker.busy) return "running";
  if (worker.subagentStatus === "failed") return "failed";
  return "completed";
}

function statusDotClass(status: CoordinatorWorkerStatus) {
  if (status === "running") return "bg-sky-500 motion-safe:animate-pulse";
  if (status === "failed") return "bg-destructive";
  return "bg-emerald-500";
}

function statusTextClass(status: CoordinatorWorkerStatus) {
  if (status === "running") return "text-sky-600 dark:text-sky-400";
  if (status === "failed") return "text-destructive";
  return "text-emerald-600 dark:text-emerald-400";
}

function sortWorkers(workers: SessionSummary[]) {
  return [...workers].sort((left, right) => {
    const statusDifference = STATUS_PRIORITY[getCoordinatorWorkerStatus(left)]
      - STATUS_PRIORITY[getCoordinatorWorkerStatus(right)];
    if (statusDifference !== 0) return statusDifference;
    return right.updatedAt - left.updatedAt;
  });
}

function workerIdentity(worker: SessionSummary) {
  const parts = [worker.workerName, worker.assistantName]
    .map((value) => value?.trim())
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  return parts.join(" · ") || "worker";
}

function workerPreview(worker: SessionSummary, status: CoordinatorWorkerStatus) {
  const preview = worker.preview?.trim();
  if (preview && preview !== worker.title.trim()) return preview;
  return status === "running" ? "点击查看正在执行的工具与最近输出" : "点击查看执行记录与结果";
}

function statusSummary(workers: SessionSummary[]) {
  const running = workers.filter((worker) => getCoordinatorWorkerStatus(worker) === "running").length;
  const failed = workers.filter((worker) => getCoordinatorWorkerStatus(worker) === "failed").length;
  if (running === 0 && failed === 0) return `${workers.length} 已完成`;
  return [running > 0 ? `${running} 运行` : "", failed > 0 ? `${failed} 失败` : ""]
    .filter(Boolean)
    .join(" · ");
}

function relativeUpdatedAt(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "刚刚更新";
  if (seconds < 60) return `${seconds} 秒前更新`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前更新`;
  return `${Math.floor(minutes / 60)} 小时前更新`;
}

function WorkerStatusIcon({ status }: { status: CoordinatorWorkerStatus }) {
  if (status === "running") return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-sky-500" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
}

export function CoordinatorWorkersSummary({
  workers,
  onOpen,
}: {
  workers: SessionSummary[];
  onOpen: () => void;
}) {
  if (workers.length === 0) return null;
  const summary = statusSummary(workers);
  const status = workers.some((worker) => getCoordinatorWorkerStatus(worker) === "failed") ? "failed"
    : workers.some((worker) => getCoordinatorWorkerStatus(worker) === "running") ? "running" : "completed";

  return (
    <button
      type="button"
      className="inline-flex h-7 max-w-[240px] shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/25 px-2 text-[11px] transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
      aria-label={`打开子 Agent 列表，${workers.length} 个子 Agent，${summary}`}
      title={`${workers.length} 个子 Agent · ${summary}`}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDotClass(status))} aria-hidden="true" />
      <span className="shrink-0 whitespace-nowrap font-medium tabular-nums">Agents {workers.length}</span>
      <span className="hidden min-w-0 truncate text-muted-foreground @[800px]/session-header:inline">{summary}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function WorkerRow({
  worker,
  selected,
  rowRef,
  onOpen,
}: {
  worker: SessionSummary;
  selected: boolean;
  rowRef?: React.Ref<HTMLButtonElement>;
  onOpen: () => void;
}) {
  const status = getCoordinatorWorkerStatus(worker);
  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-16 w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6",
        selected && "bg-muted/55",
      )}
      aria-label={`查看子 Agent：${worker.title}，${STATUS_LABELS[status]}`}
      aria-current={selected ? "true" : undefined}
      data-worker-id={worker.id}
    >
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", statusDotClass(status))} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground" title={worker.title}>
          {worker.title}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="max-w-[35%] shrink truncate">{workerIdentity(worker)}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{workerPreview(worker, status)}</span>
        </span>
      </span>
      <span className={cn("shrink-0 text-[11px] font-medium", statusTextClass(status))}>
        {STATUS_LABELS[status]}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function WorkerSection({
  label,
  workers,
  selectedWorkerId,
  selectedRowRef,
  onOpenWorker,
}: {
  label: string;
  workers: SessionSummary[];
  selectedWorkerId: string | null;
  selectedRowRef: React.RefObject<HTMLButtonElement | null>;
  onOpenWorker: (workerId: string) => void;
}) {
  if (workers.length === 0) return null;
  return (
    <section>
      <div className="flex h-9 items-center justify-between border-b border-border/60 bg-muted/20 px-4 text-[11px] font-medium text-muted-foreground sm:px-6">
        <span>{label}</span>
        <span className="tabular-nums">{workers.length}</span>
      </div>
      {workers.map((worker) => (
        <WorkerRow
          key={worker.id}
          worker={worker}
          selected={worker.id === selectedWorkerId}
          rowRef={worker.id === selectedWorkerId ? selectedRowRef : undefined}
          onOpen={() => onOpenWorker(worker.id)}
        />
      ))}
    </section>
  );
}

export function CoordinatorWorkersView({
  workers,
  selectedWorkerId: initialSelectedWorkerId,
  onClose,
  onOpenWorker,
}: {
  workers: SessionSummary[];
  selectedWorkerId: string | null;
  onClose: () => void;
  onOpenWorker: (workerId: string) => void;
}) {
  const [selectedWorkerId, setSelectedWorkerId] = React.useState(initialSelectedWorkerId);
  React.useEffect(() => setSelectedWorkerId(initialSelectedWorkerId), [initialSelectedWorkerId]);
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [collapsed, setCollapsed] = React.useState(false);
  const selected = workers.find(worker => worker.id === selectedWorkerId) ?? null;
  const completedCount = workers.filter(worker => getCoordinatorWorkerStatus(worker) === "completed").length;
  const [viewMode, setViewMode] = React.useState<"topology" | "list">(() => workers.length > 40 ? "list" : "topology");
  const selectedRowRef = React.useRef<HTMLButtonElement | null>(null);
  const virtualListRef = React.useRef<GroupedVirtuosoHandle>(null);
  const sorted = React.useMemo(() => sortWorkers(workers).filter(worker => {
    const workerStatus = getCoordinatorWorkerStatus(worker);
    const matchesQuery = [worker.title, worker.preview, worker.workerName, worker.assistantName].some(value => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return matchesQuery && (status === "all" || workerStatus === status)
      && !(collapsed && status === "all" && !query.trim() && workerStatus === "completed");
  }), [workers, query, status, collapsed]);
  const running = sorted.filter((worker) => getCoordinatorWorkerStatus(worker) === "running");
  const failed = sorted.filter((worker) => getCoordinatorWorkerStatus(worker) === "failed");
  const completed = sorted.filter((worker) => getCoordinatorWorkerStatus(worker) === "completed");
  const virtual = sorted.length > 100;
  const selectedIndex = sorted.findIndex(worker => worker.id === selectedWorkerId);
  const selectedExists = selectedIndex >= 0;
  const previousSelectionRef = React.useRef({ id: selectedWorkerId, virtual, exists: selectedExists });
  React.useEffect(() => {
    const previous = previousSelectionRef.current;
    previousSelectionRef.current = { id: selectedWorkerId, virtual, exists: selectedExists };
    if (!selectedWorkerId || !selectedExists) return;
    if (virtual) {
      // Let Virtuoso measure a fresh list before applying imperative scrolls;
      // initialTopMostItemIndex handles selection when the list mounts.
      if (previous.virtual && (previous.id !== selectedWorkerId || !previous.exists)) {
        virtualListRef.current?.scrollToIndex({ index: selectedIndex, align: "center" });
      }
    } else selectedRowRef.current?.scrollIntoView({ block: "nearest" });
    // Keep the user's scroll position during status updates. Scroll again only
    // for an explicit selection, a newly arrived worker, or a layout change.
  }, [selectedWorkerId, selectedExists, virtual]);
  const groups = [
    { label: "进行中", count: running.length },
    { label: "需要关注", count: failed.length },
    { label: "历史", count: completed.length },
  ].filter(group => group.count > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-border/70 px-4 py-2 sm:px-6">
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="返回会话"
          title="返回会话"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Agent 协作</h2>
        </div>
        <span className="ml-auto text-[11px] text-muted-foreground">
          全部 {workers.length}
          {running.length > 0 ? ` · 运行 ${running.length}` : ""}
          {failed.length > 0 ? ` · 失败 ${failed.length}` : ""}
        </span>
        <AgentBrowserControls dense query={query} onQuery={setQuery} status={status} onStatus={setStatus} options={[{ value: "all", label: "全部状态" }, { value: "running", label: "运行中" }, { value: "failed", label: "失败" }, { value: "completed", label: "已完成" }]} count={sorted.length} completedCount={completedCount} collapsed={collapsed} onCollapse={() => setCollapsed(value => !value)} />
        <div className="flex items-center rounded-lg border border-border/70 bg-muted/25 p-0.5" role="tablist" aria-label="Agent 展示方式">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "topology"}
            onClick={() => setViewMode("topology")}
            className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-[10px] transition-colors", viewMode === "topology" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            <LayoutGrid className="h-3.5 w-3.5" />协作图
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "list"}
            onClick={() => setViewMode("list")}
            className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-[10px] transition-colors", viewMode === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            <List className="h-3.5 w-3.5" />列表
          </button>
        </div>
      </div>
      <div className="@container/workers-workspace relative flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {sorted.length === 0 ? <div className="p-8 text-center text-xs text-muted-foreground">{collapsed && status === "all" && !query.trim() ? "已完成 Agent 已收起，可在上方展开" : "没有匹配的 Agent"}</div> : viewMode === "topology" ? <AgentTreeCanvas key={`${query}:${status}:${collapsed}`} workers={sorted} selectedWorkerId={selectedWorkerId} onSelectWorker={setSelectedWorkerId} onOpenWorker={onOpenWorker} /> : virtual ? <GroupedVirtuoso
        ref={virtualListRef}
        className="min-h-0 flex-1"
        initialTopMostItemIndex={Math.max(0, selectedIndex)}
        groupCounts={groups.map(group => group.count)}
        increaseViewportBy={200}
        groupContent={index => groups[index] ? <div className="flex h-9 items-center justify-between border-b border-border/60 bg-background px-4 text-[11px] font-medium text-muted-foreground sm:px-6">
          <span>{groups[index].label}</span><span className="tabular-nums">{groups[index].count}</span>
        </div> : null}
        itemContent={index => {
          const worker = sorted[index];
          return worker ? <WorkerRow key={worker.id} worker={worker}
            selected={worker.id === selectedWorkerId} onOpen={() => setSelectedWorkerId(worker.id)} /> : null;
        }}
      /> : <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkerSection label="进行中" workers={running} selectedWorkerId={selectedWorkerId} selectedRowRef={selectedRowRef} onOpenWorker={setSelectedWorkerId} />
        <WorkerSection label="需要关注" workers={failed} selectedWorkerId={selectedWorkerId} selectedRowRef={selectedRowRef} onOpenWorker={setSelectedWorkerId} />
        <WorkerSection label="历史" workers={completed} selectedWorkerId={selectedWorkerId} selectedRowRef={selectedRowRef} onOpenWorker={setSelectedWorkerId} />
      </div>}
      {selected && viewMode === "list" ? <div className="shrink-0 border-t border-border/70 bg-background p-4 sm:p-6"><div className="mx-auto max-w-4xl"><div className="mb-3 flex items-center justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{selected.title}</h3><p className="mt-1 text-[10px] text-muted-foreground">{[selected.workerName, selected.assistantName].filter(Boolean).join(" · ") || "子 Agent"}</p></div><button type="button" onClick={() => onOpenWorker(selected.id)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 py-1.5 text-[10px] hover:bg-muted">打开完整会话 <ChevronRight className="h-3 w-3" /></button></div><AgentExecutionRecord requestKey={selected.id} load={() => window.agentDesktop.getSession({ sessionId: selected.id })} live={selected.busy || selected.subagentStatus === "running"} /></div></div> : null}
      </div>
      </div>
    </div>
  );
}
