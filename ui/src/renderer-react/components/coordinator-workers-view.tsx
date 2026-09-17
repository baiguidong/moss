"use client";

import * as React from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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
  return STATUS_LABELS[status];
}

function statusSummary(workers: SessionSummary[]) {
  const running = workers.filter((worker) => getCoordinatorWorkerStatus(worker) === "running").length;
  const failed = workers.filter((worker) => getCoordinatorWorkerStatus(worker) === "failed").length;
  if (running === 0 && failed === 0) return `${workers.length} 已完成`;
  return [running > 0 ? `${running} 运行` : "", failed > 0 ? `${failed} 失败` : ""]
    .filter(Boolean)
    .join(" · ");
}

export function CoordinatorWorkersSummary({
  workers,
  onOpen,
  onSelect,
}: {
  workers: SessionSummary[];
  onOpen: () => void;
  onSelect: (workerId: string) => void;
}) {
  const sorted = React.useMemo(() => sortWorkers(workers), [workers]);
  if (sorted.length === 0) return null;

  const visible = sorted.slice(0, 8);
  const compactHiddenCount = Math.max(0, sorted.length - 4);
  const wideHiddenCount = sorted.length - visible.length;
  const summary = statusSummary(sorted);

  return (
    <div className="flex min-w-0 shrink-0 items-center justify-center gap-2">
      <div
        className="flex min-w-0 items-center gap-1"
        role="group"
        aria-label={`${workers.length} 个子 Agent`}
      >
        {visible.map((worker, index) => {
          const status = getCoordinatorWorkerStatus(worker);
          return (
            <Tooltip key={worker.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    index < 4 ? "flex" : "hidden sm:flex",
                  )}
                  aria-label={`打开子 Agent：${worker.title}，${STATUS_LABELS[status]}`}
                  onClick={() => onSelect(worker.id)}
                >
                  <span className={cn("h-2.5 w-2.5 rounded-full", statusDotClass(status))} aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{worker.title} · {STATUS_LABELS[status]}</TooltipContent>
            </Tooltip>
          );
        })}
        {compactHiddenCount > 0 ? (
          <button
            type="button"
            className="flex h-6 shrink-0 items-center rounded-full px-1.5 text-[10px] tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
            onClick={onOpen}
            aria-label={`查看另外 ${compactHiddenCount} 个子 Agent`}
          >
            +{compactHiddenCount}
          </button>
        ) : null}
        {wideHiddenCount > 0 ? (
          <button
            type="button"
            className="hidden h-6 shrink-0 items-center rounded-full px-1.5 text-[10px] tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
            onClick={onOpen}
            aria-label={`查看另外 ${wideHiddenCount} 个子 Agent`}
          >
            +{wideHiddenCount}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="hidden shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
        onClick={onOpen}
        aria-label={`打开子 Agent 列表，${summary}`}
      >
        <span>{summary}</span>
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
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
        "flex min-h-16 w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6",
        selected && "bg-muted/55",
      )}
      aria-label={`打开子 Agent：${worker.title}，${STATUS_LABELS[status]}`}
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
  selectedWorkerId,
  onClose,
  onOpenWorker,
}: {
  workers: SessionSummary[];
  selectedWorkerId: string | null;
  onClose: () => void;
  onOpenWorker: (workerId: string) => void;
}) {
  const selectedRowRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!selectedWorkerId) return;
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedWorkerId]);

  const sorted = React.useMemo(() => sortWorkers(workers), [workers]);
  const running = sorted.filter((worker) => getCoordinatorWorkerStatus(worker) === "running");
  const failed = sorted.filter((worker) => getCoordinatorWorkerStatus(worker) === "failed");
  const completed = sorted.filter((worker) => getCoordinatorWorkerStatus(worker) === "completed");

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border/70 px-4 sm:px-6">
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="返回会话"
          title="返回会话"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-sm font-semibold text-foreground">子 Agent</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          全部 {workers.length}
          {running.length > 0 ? ` · 运行 ${running.length}` : ""}
          {failed.length > 0 ? ` · 失败 ${failed.length}` : ""}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkerSection label="进行中" workers={running} selectedWorkerId={selectedWorkerId} selectedRowRef={selectedRowRef} onOpenWorker={onOpenWorker} />
        <WorkerSection label="需要关注" workers={failed} selectedWorkerId={selectedWorkerId} selectedRowRef={selectedRowRef} onOpenWorker={onOpenWorker} />
        <WorkerSection label="历史" workers={completed} selectedWorkerId={selectedWorkerId} selectedRowRef={selectedRowRef} onOpenWorker={onOpenWorker} />
      </div>
    </div>
  );
}
