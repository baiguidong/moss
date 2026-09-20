"use client";

import * as React from "react";
import {
  ArrowLeft,
  Braces,
  CheckCircle2,
  Clock3,
  Download,
  FileOutput,
  GitFork,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Route,
  Square,
} from "lucide-react";
import {
  WorkflowCanvas,
  WORKFLOW_NODE_TYPE_LABELS,
} from "@/components/workflow-canvas";
import { cn } from "@/lib/utils";
import { workflowPreviewTask } from "@/lib/workflow-library";
import type {
  BackgroundTaskInfo,
  WorkflowCatalogDetail,
  WorkflowDefinition,
  WorkflowDefinitionNode,
  WorkflowEdgeEvent,
  WorkflowGraph,
  WorkflowNodeEvent,
  WorkflowProgressEvent,
} from "../types";

type View = "diagram" | "activity" | "result" | "source";

const VIEW_OPTIONS: Array<{ id: View; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "diagram", label: "流程图", icon: Route },
  { id: "activity", label: "执行详情", icon: ListChecks },
  { id: "result", label: "最终结果", icon: FileOutput },
  { id: "source", label: "Definition", icon: Braces },
];

const WORKFLOW_STATUS_LABELS: Record<BackgroundTaskInfo["status"], string> = {
  pending: "等待中",
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  killed: "已停止",
};

function isWorkflowActive(task: BackgroundTaskInfo) {
  return task.status === "pending" || task.status === "running";
}

export function selectLatestWorkflow(tasks: BackgroundTaskInfo[]): BackgroundTaskInfo | null {
  const workflows = tasks.filter((task) => task.kind === "workflow");
  return [...workflows].reverse().find(isWorkflowActive) ?? workflows.at(-1) ?? null;
}

export function summarizeWorkflowProgress(task: BackgroundTaskInfo) {
  const latestByInstance = new Map<string, WorkflowNodeEvent>();
  for (const event of task.nodeEvents ?? []) {
    const previous = latestByInstance.get(event.instanceId);
    if (!previous || event.sequence > previous.sequence) {
      latestByInstance.set(event.instanceId, event);
    }
  }
  if (latestByInstance.size > 0) {
    const executions = [...latestByInstance.values()].filter((event) => event.state !== "skipped");
    const active = isWorkflowActive(task)
      ? executions.filter((event) => ["ready", "queued", "running", "waiting_children"].includes(event.state))
      : [];
    const completed = executions.filter((event) => event.state === "completed").length;
    const failed = executions.filter((event) => event.state === "failed" || event.state === "blocked").length;
    const graphLabels = new Map(
      (task.graph?.nodes ?? []).map((node) => [node.workflowNodeId, node.label]),
    );
    return {
      total: executions.length,
      completed,
      failed,
      latestPhase: null,
      activeLabels: active.map((event) => graphLabels.get(event.nodeId) ?? event.nodeId),
    };
  }

  // Compatibility fallback for older persisted runs that only recorded
  // Agent/phase progress and have no authoritative node timeline.
  const agents = (task.progress ?? []).filter((event) => event.type === "workflow_agent");
  const phases = (task.progress ?? [])
    .filter((event) => event.type === "workflow_phase");
  const running = isWorkflowActive(task)
    ? agents.filter((agent) => agent.state === "start" || agent.state === "progress")
    : [];
  const completed = agents.filter((agent) => agent.state === "done").length;
  const failed = agents.filter((agent) => agent.state === "error").length;
  const latestPhase = phases.at(-1)?.title ?? running.at(-1)?.phaseTitle ?? null;
  const activeLabels = running.map((agent) => agent.label);
  return { total: Math.max(task.agentCount ?? 0, agents.length), completed, failed, latestPhase, activeLabels };
}

/** Keep labels safe if a producer supplied raw Mermaid punctuation. */
export function normalizeWorkflowMermaid(mermaid: string): string {
  return mermaid.replace(/`/g, "&#96;");
}

function latestNodeEvents(events: WorkflowNodeEvent[]) {
  const latestByInstance = new Map<string, WorkflowNodeEvent>();
  const iterations = new Map<string, number>();
  for (const event of events) {
    latestByInstance.set(event.instanceId, event);
    if (event.iteration != null) {
      iterations.set(event.nodeId, Math.max(iterations.get(event.nodeId) ?? 0, event.iteration));
    }
  }
  const byNode = new Map<string, WorkflowNodeEvent[]>();
  for (const event of latestByInstance.values()) {
    const rows = byNode.get(event.nodeId) ?? [];
    rows.push(event);
    byNode.set(event.nodeId, rows);
  }
  return { byNode, iterations };
}

function escapeMermaidLabel(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/`/g, "&#96;")
    .replace(/\|/g, "&#124;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, " ");
}

function selectedBranchLabel(
  graph: WorkflowGraph,
  nodeId: string,
  branch: string | undefined,
) {
  if (!branch) return undefined;
  const edge = graph.edges.find((candidate) => (
    candidate.source === nodeId && (
      candidate.branchKey === branch ||
      (branch === "true" && candidate.type === "true") ||
      (branch === "false" && candidate.type === "false")
    )
  ));
  if (edge?.label) return edge.label;
  if (branch === "true") return "是";
  if (branch === "false") return "否";
  return branch;
}

function addRuntimeNodeLabels(
  mermaid: string,
  graph: WorkflowGraph,
  byNode: Map<string, WorkflowNodeEvent[]>,
  iterations: Map<string, number>,
) {
  const displayById = new Map<string, string>();
  for (const node of graph.nodes) {
    const nodeEvents = byNode.get(node.workflowNodeId) ?? [];
    const event = [...nodeEvents].sort((left, right) => right.sequence - left.sequence)[0];
    let label = node.label;
    const active = event && ["ready", "queued", "running", "waiting_children"].includes(event.state);
    if (node.type === "condition" && event?.branch) {
      label += ` · 结果：${selectedBranchLabel(graph, node.id, event.branch)}`;
    }
    if (active && node.type !== "start") {
      label += iterations.has(node.workflowNodeId)
        ? ` · 第 ${iterations.get(node.workflowNodeId)} 次进行中`
        : " · 进行中";
    } else if (event?.state === "blocked") {
      label += iterations.has(node.workflowNodeId)
        ? ` · 已执行 ${iterations.get(node.workflowNodeId)} 次 · 已阻塞`
        : " · 已阻塞";
    } else if (iterations.has(node.workflowNodeId)) {
      label += ` · 已执行 ${iterations.get(node.workflowNodeId)} 次`;
    } else if (event?.state === "failed") {
      label += " · 失败";
    } else if (event?.state === "cancelled") {
      label += " · 已取消";
    } else if (event?.state === "interrupted") {
      label += " · 已中断";
    }
    if (label !== node.label) displayById.set(node.id, label);
  }
  if (displayById.size === 0) return mermaid;

  return mermaid.split("\n").map((line) => {
    const nodeId = line.match(/^\s*(n\d+)[\[({]/)?.[1];
    if (!nodeId) return line;
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    const display = displayById.get(nodeId);
    if (!node || !display) return line;
    return line.replace(
      escapeMermaidLabel(node.label),
      escapeMermaidLabel(display),
    );
  }).join("\n");
}

/** Add authoritative runtime status to the graph compiled from Definition. */
export function decorateWorkflowMermaid(
  mermaid: string,
  graph: WorkflowGraph | null | undefined,
  events: WorkflowNodeEvent[] = [],
): string {
  const normalizedMermaid = normalizeWorkflowMermaid(mermaid);
  if (!normalizedMermaid || !graph) return normalizedMermaid;
  const { byNode, iterations } = latestNodeEvents(events);
  const byStatus: Record<"unvisited" | "running" | "completed" | "blocked" | "skipped" | "stopped" | "error", string[]> = {
    unvisited: [],
    running: [],
    completed: [],
    blocked: [],
    skipped: [],
    stopped: [],
    error: [],
  };
  const workflowNodeIdByGraphNode = new Map<string, string>();
  const statusByGraphNode = new Map<string, keyof typeof byStatus>();
  for (const node of graph.nodes) {
    workflowNodeIdByGraphNode.set(node.id, node.workflowNodeId);
    const instanceEvents = byNode.get(node.workflowNodeId) ?? [];
    const states = instanceEvents.map(event => event.state);
    const status = states.some(state => state === "blocked")
      ? "blocked"
      : states.some(state => state === "failed")
      ? "error"
      : states.some(state => state === "cancelled" || state === "interrupted")
        ? "stopped"
      : states.some(state => ["ready", "queued", "running", "waiting_children"].includes(state))
        ? "running"
        : states.some(state => state === "completed")
          ? "completed"
          : states.some(state => state === "skipped")
            ? "skipped"
            : "unvisited";
    byStatus[status].push(node.id);
    statusByGraphNode.set(node.id, status);
  }

  const lines = [addRuntimeNodeLabels(
    normalizedMermaid,
    graph,
    byNode,
    iterations,
  ).trimEnd()];
  lines.push("  classDef wfUnvisited fill:#f4f4f5,stroke:#a1a1aa,color:#52525b,stroke-dasharray:4 3");
  lines.push("  classDef wfRunning fill:#fef3c7,stroke:#f59e0b,color:#78350f,stroke-width:3px");
  lines.push("  classDef wfCompleted fill:#dcfce7,stroke:#22c55e,color:#14532d,stroke-width:2px");
  lines.push("  classDef wfBlocked fill:#ffedd5,stroke:#f97316,color:#9a3412,stroke-width:3px");
  lines.push("  classDef wfSkipped fill:#f4f4f5,stroke:#a1a1aa,color:#71717a,stroke-dasharray:2 3");
  lines.push("  classDef wfStopped fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-dasharray:4 3");
  lines.push("  classDef wfError fill:#fee2e2,stroke:#ef4444,color:#7f1d1d,stroke-width:3px");
  for (const [status, ids] of Object.entries(byStatus)) {
    if (ids.length > 0) lines.push(`  class ${ids.join(",")} wf${status[0]!.toUpperCase()}${status.slice(1)}`);
  }

  graph.edges.forEach((edge, index) => {
    const workflowNodeId = workflowNodeIdByGraphNode.get(edge.source);
    const selected = workflowNodeId
      ? [...(byNode.get(workflowNodeId) ?? [])].sort((left, right) => right.sequence - left.sequence)[0]?.branch
      : undefined;
    const branchMatches = Boolean(selected && edge.branchKey === selected);
    const loopWasTraversed = edge.type === "loop-back"
      && (byNode.get(workflowNodeIdByGraphNode.get(edge.target) ?? "")?.length ?? 0) > 1;
    const isActive = statusByGraphNode.get(edge.target) === "running"
      || (statusByGraphNode.get(edge.source) === "running" && branchMatches);
    if (isActive) {
      lines.push(`  linkStyle ${index} stroke:#f59e0b,stroke-width:3px,stroke-dasharray:8 6`);
      return;
    }
    if (loopWasTraversed) {
      lines.push(`  linkStyle ${index} stroke:#22c55e,stroke-width:3px,stroke-dasharray:7 5`);
      return;
    }
    if (!selected || !edge.label) return;
    lines.push(branchMatches
      ? `  linkStyle ${index} stroke:#22c55e,stroke-width:3px`
      : `  linkStyle ${index} stroke:#a1a1aa,stroke-width:1px,opacity:0.35`);
  });
  return lines.join("\n");
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workflow";
}

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Download className="h-3 w-3" />
      {label}
    </button>
  );
}

function ActivityView({
  progress,
  result,
  error,
}: {
  progress: WorkflowProgressEvent[];
  result: unknown;
  error?: string | null;
}) {
  const phases = progress.filter((event) => event.type === "workflow_phase");
  const agents = progress.filter((event) => event.type === "workflow_agent");
  const logs = progress.filter((event) => event.type === "workflow_log");
  return (
    <div className="space-y-3 p-3">
      {phases.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {phases.map((phase) => (
            <span key={`${phase.index}-${phase.title}`} className="rounded-full bg-primary/10 px-2 py-1 text-[11px] text-primary">
              {phase.index}. {phase.title}
            </span>
          ))}
        </div>
      )}
      <div className="space-y-1">
        {agents.map((agent) => (
          <div key={agent.index} className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-2.5 py-2 text-[11px]">
            <span className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              agent.state === "done" && "bg-green-500",
              agent.state === "error" && "bg-red-500",
              agent.state === "progress" && "animate-pulse bg-amber-500",
              agent.state === "start" && "bg-zinc-400",
            )} />
            <span className="min-w-0 flex-1 truncate text-foreground">{agent.label}</span>
            {agent.phaseTitle && <span className="truncate text-muted-foreground">{agent.phaseTitle}</span>}
            {agent.cached && <span className="text-emerald-600">cached</span>}
            {agent.error && <span className="max-w-56 truncate text-destructive">{agent.error}</span>}
          </div>
        ))}
        {agents.length === 0 && <div className="py-5 text-center text-xs text-muted-foreground">等待 workflow 节点开始执行…</div>}
      </div>
      {logs.length > 0 && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
          {logs.slice(-20).map((entry) => entry.message).join("\n")}
        </pre>
      )}
      {error && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
          {error}
        </pre>
      )}
      {result !== undefined && (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
          {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ResultView({ task }: { task: BackgroundTaskInfo }) {
  if (isWorkflowActive(task)) {
    return (
      <div className="flex min-h-52 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
        Workflow 尚未结束，结果将在这里实时出现
      </div>
    );
  }
  if (task.error) {
    return (
      <div className="p-4">
        <div className="mb-2 text-xs font-medium text-destructive">Workflow 执行失败</div>
        <pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-destructive/10 p-3 font-mono text-xs text-destructive">
          {task.error}
        </pre>
      </div>
    );
  }
  return (
    <div className="p-4">
      <div className="mb-2 text-xs font-medium text-foreground">结构化返回结果</div>
      <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground">
        {task.result === undefined
          ? "Workflow 已结束，但没有返回结果。"
          : typeof task.result === "string"
            ? task.result
            : JSON.stringify(task.result, null, 2)}
      </pre>
    </div>
  );
}

function findDefinitionNode(
  definition: WorkflowDefinition | null | undefined,
  nodeId: string,
): WorkflowDefinitionNode | null {
  if (!definition) return null;
  const visit = (value: unknown): WorkflowDefinitionNode | null => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = visit(entry);
        if (found) return found;
      }
      return null;
    }
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (record.id === nodeId && typeof record.type === "string" && typeof record.title === "string") {
      return record as WorkflowDefinitionNode;
    }
    if (record.body && typeof record.body === "object") {
      const found = visit((record.body as { nodes?: unknown }).nodes);
      if (found) return found;
    }
    return null;
  };
  return visit(definition.graph.nodes);
}

const NODE_STATE_LABELS: Record<WorkflowNodeEvent["state"], string> = {
  ready: "准备执行",
  queued: "排队中",
  running: "运行中",
  waiting_children: "等待子节点",
  completed: "已完成",
  blocked: "已阻塞",
  failed: "失败",
  skipped: "已跳过",
  cancelled: "已取消",
  interrupted: "已中断",
};

function NodeInspector({
  graph,
  graphNodeId,
  definition,
  events,
  onClose,
}: {
  graph: WorkflowGraph;
  graphNodeId: string;
  definition: WorkflowDefinition | null | undefined;
  events: WorkflowNodeEvent[];
  onClose: () => void;
}) {
  const graphNode = graph.nodes.find((node) => node.id === graphNodeId);
  if (!graphNode) return null;
  const definitionNode = findDefinitionNode(definition, graphNode.workflowNodeId);
  const nodeEvents = events
    .filter((event) => event.nodeId === graphNode.workflowNodeId)
    .sort((left, right) => right.sequence - left.sequence);
  const latest = nodeEvents[0];
  const instanceCount = new Set(nodeEvents.map((event) => event.instanceId)).size;
  const executableSource = definitionNode?.script;
  const routes = graph.edges.filter((edge) => edge.source === graphNode.id && edge.branchKey);
  const defaultConfig = definitionNode?.default;
  const defaultPort = defaultConfig && typeof defaultConfig === "object" && "port" in defaultConfig
    ? String(defaultConfig.port)
    : undefined;

  return (
    <aside className="absolute bottom-3 right-3 top-3 z-10 flex w-[min(22rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-border/80 bg-background/95 shadow-xl backdrop-blur">
      <div className="flex items-start gap-2 border-b border-border/60 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{graphNode.label}</div>
          <div className="mt-0.5 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            <span>{WORKFLOW_NODE_TYPE_LABELS[graphNode.type]}</span>
            <span>{latest ? NODE_STATE_LABELS[latest.state] : "未访问"}</span>
            {instanceCount > 1 ? <span>{instanceCount} 次执行</span> : null}
            {graphNode.type === "agent" && instanceCount > 1 ? <span>同一 Agent 会话</span> : null}
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="关闭节点详情">
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-xs">
        {(definitionNode?.description || graphNode.detail) ? (
          <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{definitionNode?.description || graphNode.detail}</p>
        ) : null}
        {latest?.branch ? <div><span className="text-muted-foreground">实际分支：</span>{selectedBranchLabel(graph, graphNode.id, latest.branch)}</div> : null}
        {routes.length > 0 ? (
          <section>
            <div className="mb-1 font-medium text-foreground">可选分支（{routes.length}）</div>
            <div className="space-y-1">
              {routes.map((route) => {
                const target = graph.nodes.find((node) => node.id === route.target);
                const selected = route.branchKey === latest?.branch;
                return (
                  <div key={route.id} className={cn(
                    "flex items-center gap-2 rounded-md border border-border/50 px-2 py-1.5",
                    selected && "border-emerald-500/50 bg-emerald-500/10",
                  )}>
                    <span className="font-medium text-foreground">{route.label ?? route.branchKey}</span>
                    {route.branchKey === defaultPort ? <span className="text-[10px] text-muted-foreground">默认 / Else</span> : null}
                    <span className="ml-auto text-muted-foreground">→ {target?.label ?? route.target}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
        {latest?.iteration != null ? <div><span className="text-muted-foreground">实际循环：</span>{latest.iteration} 次</div> : null}
        {latest?.error ? <pre className="whitespace-pre-wrap rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">{latest.error}</pre> : null}
        {definitionNode?.prompt ? (
          <section>
            <div className="mb-1 font-medium text-foreground">Agent 任务</div>
            <pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-2 font-sans text-[11px] leading-relaxed text-muted-foreground">{String(definitionNode.prompt)}</pre>
          </section>
        ) : null}
        {typeof executableSource === "string" ? (
          <details>
            <summary className="cursor-pointer font-medium text-foreground">节点 JavaScript</summary>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">{executableSource}</pre>
          </details>
        ) : null}
        {definitionNode ? (
          <details>
            <summary className="cursor-pointer font-medium text-foreground">完整节点定义</summary>
            <pre className="mt-1 overflow-auto whitespace-pre rounded-md bg-muted/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(definitionNode, null, 2)}</pre>
          </details>
        ) : null}
      </div>
    </aside>
  );
}

export function WorkflowGraphPanel({
  task,
  workbench = false,
  previewOnly = false,
}: {
  task: BackgroundTaskInfo;
  workbench?: boolean;
  previewOnly?: boolean;
}) {
  const [view, setView] = React.useState<View>("diagram");
  const [selectedGraphNodeId, setSelectedGraphNodeId] = React.useState<string | null>(null);
  const graph = task.graph ?? null;
  const nodeEvents = task.nodeEvents ?? [];
  const progress = task.progress ?? [];
  const edgeEvents = progress.filter((event): event is WorkflowEdgeEvent => event.type === "workflow_edge");
  const exportMermaid = React.useMemo(
    () => normalizeWorkflowMermaid(task.mermaid ?? ""),
    [task.mermaid],
  );
  const filename = safeName(task.workflowName || task.id);
  const runExport = {
    version: 3,
    taskId: task.id,
    workflowRunId: task.workflowRunId,
    workflowName: task.workflowName,
    workflowId: task.workflowId,
    workflowRevision: task.workflowRevision,
    runMode: task.runMode,
    status: task.status,
    startTime: task.startTime,
    endTime: task.endTime,
    args: task.args,
    definition: task.definition,
    graph,
    mermaid: exportMermaid,
    nodeEvents,
    progress,
    result: task.result,
    error: task.error,
  };

  return (
    <div className={cn(
      "overflow-hidden rounded-xl border border-border/60 bg-background/60",
      workbench && "flex min-h-0 flex-1 flex-col rounded-none border-0",
    )}>
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-border/50 px-3 py-1.5">
        <div className="flex shrink-0 rounded-lg bg-muted/60 p-0.5">
          {VIEW_OPTIONS.filter((option) => !previewOnly || option.id === "diagram" || option.id === "source").map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setView(option.id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors",
                  view === option.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3 w-3" />
                {option.label}
              </button>
            );
          })}
        </div>
        {view === "diagram" ? (
          <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
            {[
              ["bg-zinc-400", "未访问"],
              ["bg-amber-500", "运行中"],
              ["bg-green-500", "已完成"],
              ["bg-orange-500", "已阻塞"],
              ["bg-zinc-300", "已跳过"],
              ["bg-amber-700", "已停止"],
              ["bg-red-500", "失败"],
            ].map(([color, label]) => (
              <span key={label} className="inline-flex items-center gap-1">
                <span className={cn("h-1.5 w-1.5 rounded-full", color)} />{label}
              </span>
            ))}
            {graph?.warnings.includes("truncated") ? (
              <span className="text-amber-600">图已截断</span>
            ) : null}
          </div>
        ) : null}
        <div className="ml-auto flex shrink-0 gap-1.5">
          <ExportButton label="Mermaid" onClick={() => downloadText(`${filename}.workflow.mmd`, exportMermaid, "text/plain")} />
          <ExportButton label="Definition" onClick={() => downloadText(`${filename}.workflow.json`, JSON.stringify(task.definition, null, 2), "application/json")} />
          <ExportButton label="Graph JSON" onClick={() => downloadText(`${filename}.graph.json`, JSON.stringify(graph, null, 2), "application/json")} />
          {!previewOnly ? <ExportButton label="Run JSON" onClick={() => downloadText(`${filename}.${task.workflowRunId ?? "run"}.json`, JSON.stringify(runExport, null, 2), "application/json")} /> : null}
        </div>
      </div>

      {view === "diagram" && (
        graph
          ? <div className={cn("relative px-3", workbench && "min-h-0 flex-1 overflow-hidden px-5 pb-5 pt-4")}>
              <div className={cn("h-[34rem] min-h-80 overflow-hidden rounded-lg", workbench && "h-full")}>
                <WorkflowCanvas
                  graph={graph}
                  nodeEvents={nodeEvents}
                  edgeEvents={edgeEvents}
                  onNodeClick={setSelectedGraphNodeId}
                />
              </div>
              {graph && selectedGraphNodeId ? (
                <NodeInspector
                  graph={graph}
                  graphNodeId={selectedGraphNodeId}
                  definition={task.definition}
                  events={nodeEvents}
                  onClose={() => setSelectedGraphNodeId(null)}
                />
              ) : null}
            </div>
          : <div className="p-5 text-center text-xs text-muted-foreground">{task.graphError || "暂时无法从 Definition 生成流程图"}</div>
      )}
      {view === "activity" && (
        <div className={cn(workbench && "min-h-0 flex-1 overflow-auto")}>
          <ActivityView progress={progress} result={task.result} error={task.error} />
        </div>
      )}
      {view === "result" && (
        <div className={cn(workbench && "min-h-0 flex-1 overflow-auto")}>
          <ResultView task={task} />
        </div>
      )}
      {view === "source" && (
        <pre className={cn(
          "max-h-[28rem] overflow-auto whitespace-pre p-3 font-mono text-[11px] leading-relaxed text-muted-foreground",
          workbench && "min-h-0 max-h-none flex-1 p-5",
        )}>
          {task.definition ? JSON.stringify(task.definition, null, 2) : "（没有可用 Definition）"}
        </pre>
      )}
    </div>
  );
}

function formatElapsed(startTime: number | null, endTime: number | null, now: number) {
  if (!startTime) return "00:00";
  const seconds = Math.max(0, Math.floor(((endTime ?? now) - startTime) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function WorkflowStrip({
  tasks,
  onOpen,
}: {
  tasks: BackgroundTaskInfo[];
  onOpen: (taskId: string) => void;
}) {
  const task = selectLatestWorkflow(tasks);
  if (!task) return null;
  const summary = summarizeWorkflowProgress(task);
  const current = summary.activeLabels.length > 0
    ? summary.activeLabels.join("、")
    : summary.latestPhase ?? WORKFLOW_STATUS_LABELS[task.status];

  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className="group flex h-10 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-border/70 bg-violet-500/5 px-4 text-left transition-colors hover:bg-violet-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      aria-label="打开 Workflow 实时流程图"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-violet-500/25 bg-background text-violet-600 dark:text-violet-400">
        <GitFork className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">Workflow · {task.workflowName || task.description || task.id}</span>
      <span className={cn(
        "shrink-0 text-[10px]",
        isWorkflowActive(task) ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
      )}>
        {isWorkflowActive(task) ? "实时" : "回看"}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{WORKFLOW_STATUS_LABELS[task.status]}</span>
      {isWorkflowActive(task) ? <span className="max-w-48 truncate text-[11px] text-muted-foreground">当前 {current}</span> : null}
      <span className="shrink-0 text-[11px] text-muted-foreground">完成 {summary.completed}/{summary.total}</span>
      {isWorkflowActive(task) ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-violet-500" /> : <Route className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />}
    </button>
  );
}

export function WorkflowDraftStrip({
  drafts,
  onOpen,
}: {
  drafts: WorkflowCatalogDetail[];
  onOpen: (workflowId: string) => void;
}) {
  const draft = drafts[0];
  if (!draft) return null;

  return (
    <button
      type="button"
      onClick={() => onOpen(draft.record.id)}
      className="group flex h-10 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-border/70 bg-amber-500/5 px-4 text-left transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      aria-label="打开会话中的 Workflow 草稿"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-amber-500/25 bg-background text-amber-600 dark:text-amber-400">
        <GitFork className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">Workflow 草稿 · {draft.record.title}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">r{draft.record.currentRevision}</span>
      <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">待确认</span>
      {drafts.length > 1 ? <span className="shrink-0 text-[10px] text-muted-foreground">本会话 {drafts.length} 个</span> : null}
      <Route className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </button>
  );
}

export function WorkflowSessionStrip({
  drafts,
  tasks,
  onOpenDraft,
  onOpenTask,
}: {
  drafts: WorkflowCatalogDetail[];
  tasks: BackgroundTaskInfo[];
  onOpenDraft: (workflowId: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const task = selectLatestWorkflow(tasks);
  const draft = (task?.workflowId
    ? drafts.find((entry) => entry.record.id === task.workflowId)
    : undefined) ?? drafts[0];
  if (!draft && !task) return null;

  const summary = task ? summarizeWorkflowProgress(task) : null;
  const title = draft?.record.title || task?.workflowName || task?.description || task?.id;
  const sameWorkflow = Boolean(draft && task && task.workflowId === draft.record.id);
  const openPrimary = () => {
    if (task && isWorkflowActive(task)) onOpenTask(task.id);
    else if (draft) onOpenDraft(draft.record.id);
    else if (task) onOpenTask(task.id);
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-border/70 bg-violet-500/5 px-4">
      <button
        type="button"
        onClick={openPrimary}
        className="group flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="打开 Workflow"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-violet-500/25 bg-background text-violet-600 dark:text-violet-400">
          <GitFork className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 truncate text-xs font-medium text-foreground">Workflow · {title}</span>
      </button>
      {draft ? (
        <button
          type="button"
          onClick={() => onOpenDraft(draft.record.id)}
          className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
        >
          草稿 r{draft.record.currentRevision} · 待确认
        </button>
      ) : null}
      {task && summary ? (
        <button
          type="button"
          onClick={() => onOpenTask(task.id)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
            isWorkflowActive(task)
              ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
              : "bg-muted text-muted-foreground hover:bg-muted/80",
          )}
          title={!sameWorkflow ? task.workflowName || task.description : undefined}
        >
          {isWorkflowActive(task) ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Route className="h-3 w-3" />}
          {!sameWorkflow && task.workflowName ? `${task.workflowName} · ` : ""}{WORKFLOW_STATUS_LABELS[task.status]}
          {summary.total > 0 ? ` · ${summary.completed}/${summary.total}` : ""}
        </button>
      ) : null}
      {drafts.length > 1 ? <span className="shrink-0 text-[10px] text-muted-foreground">{drafts.length} 个草稿</span> : null}
    </div>
  );
}

export function WorkflowDraftWorkbench({
  drafts,
  initialWorkflowId,
  onClose,
  onContinueEdit,
  onPublish,
}: {
  drafts: WorkflowCatalogDetail[];
  initialWorkflowId?: string | null;
  onClose: () => void;
  onContinueEdit: (workflow: WorkflowCatalogDetail) => void;
  onPublish: (workflow: WorkflowCatalogDetail) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = React.useState(initialWorkflowId || drafts[0]?.record.id || "");
  const [publishing, setPublishing] = React.useState(false);
  const [error, setError] = React.useState("");
  const draft = drafts.find((entry) => entry.record.id === selectedId) ?? drafts[0];

  React.useEffect(() => {
    if (draft && drafts.some((entry) => entry.record.id === selectedId)) return;
    setSelectedId(drafts[0]?.record.id ?? "");
  }, [draft, drafts, selectedId]);

  if (!draft) return null;

  const publish = async () => {
    setPublishing(true);
    setError("");
    try {
      await onPublish(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap border-b border-border/70 px-4 text-[11px] text-muted-foreground sm:px-6">
        <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted" title="返回会话">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="min-w-40 max-w-[34rem] flex-1 truncate text-sm font-semibold text-foreground">Workflow 草稿 · {draft.record.title}</h2>
        <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">待确认</span>
        <span className="shrink-0">Revision {draft.record.currentRevision}</span>
        {drafts.length > 1 ? (
          <select
            value={draft.record.id}
            onChange={(event) => setSelectedId(event.target.value)}
            className="h-7 max-w-56 shrink-0 rounded-md border border-input bg-background px-2 text-[11px] outline-none focus:ring-2 focus:ring-ring"
            aria-label="选择 Workflow 草稿"
          >
            {drafts.map((entry) => (
              <option key={entry.record.id} value={entry.record.id}>{entry.record.title} · r{entry.record.currentRevision}</option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={() => onContinueEdit(draft)}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-foreground hover:bg-muted"
        >
          <MessageSquareText className="h-3 w-3" />继续对话修改
        </button>
        <button
          type="button"
          disabled={publishing}
          onClick={() => void publish()}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {publishing ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          确认发布
        </button>
      </div>
      {error ? <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-5 py-2 text-xs text-destructive">{error}</div> : null}
      <WorkflowGraphPanel key={`${draft.record.id}:${draft.revision.revision}`} task={workflowPreviewTask(draft)} workbench previewOnly />
    </div>
  );
}

export function WorkflowWorkbench({
  tasks,
  initialTaskId,
  onClose,
  onStop,
}: {
  tasks: BackgroundTaskInfo[];
  initialTaskId?: string | null;
  onClose: () => void;
  onStop?: (taskId: string) => void;
}) {
  const workflows = tasks.filter((task) => task.kind === "workflow");
  const fallback = selectLatestWorkflow(workflows);
  const [selectedId, setSelectedId] = React.useState(initialTaskId || fallback?.id || "");
  const task = workflows.find((entry) => entry.id === selectedId) ?? fallback;
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    if (task && workflows.some((entry) => entry.id === selectedId)) return;
    setSelectedId(fallback?.id ?? "");
  }, [fallback?.id, selectedId, task, workflows]);

  React.useEffect(() => {
    if (!task || !isWorkflowActive(task)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status]);

  if (!task) return null;
  const summary = summarizeWorkflowProgress(task);
  const current = summary.activeLabels.length > 0
    ? summary.activeLabels.join("、")
    : summary.latestPhase ?? WORKFLOW_STATUS_LABELS[task.status];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap border-b border-border/70 px-4 text-[11px] text-muted-foreground sm:px-6">
        <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted" title="返回会话">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="min-w-40 max-w-[34rem] flex-1 truncate text-sm font-semibold text-foreground">Workflow · {task.workflowName || task.description || task.id}</h2>
        {task.runMode === "test" ? <span className="shrink-0 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-600 dark:text-sky-400">测试运行</span> : null}
        <span className={cn("shrink-0 text-[10px]", isWorkflowActive(task) ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
          {isWorkflowActive(task) ? "实时" : "历史"}
        </span>
        <span className="shrink-0 font-medium text-foreground">{WORKFLOW_STATUS_LABELS[task.status]}</span>
        <span className="shrink-0">完成 <b className="font-medium text-emerald-600 dark:text-emerald-400">{summary.completed}/{summary.total}</b></span>
        <span className="shrink-0">运行中 <b className="font-medium text-sky-600 dark:text-sky-400">{summary.activeLabels.length}</b></span>
        <span className="shrink-0">失败 <b className={cn("font-medium", summary.failed > 0 ? "text-destructive" : "text-foreground")}>{summary.failed}</b></span>
        {isWorkflowActive(task) ? <span className="max-w-48 shrink truncate">当前 {current}</span> : null}
        {isWorkflowActive(task) && onStop ? (
          <button
            type="button"
            onClick={() => onStop(task.id)}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-destructive/30 px-2 text-destructive hover:bg-destructive/10"
            title="停止 Workflow"
          >
            <Square className="h-3 w-3 fill-current" />停止
          </button>
        ) : null}
        {workflows.length > 1 ? (
          <select
            value={task.id}
            onChange={(event) => setSelectedId(event.target.value)}
            className="h-7 max-w-56 shrink-0 rounded-md border border-input bg-background px-2 text-[11px] outline-none focus:ring-2 focus:ring-ring"
            aria-label="选择 Workflow 运行"
          >
            {[...workflows].reverse().map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.workflowName || entry.description || entry.id} · {WORKFLOW_STATUS_LABELS[entry.status]}
              </option>
            ))}
          </select>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{formatElapsed(task.startTime, task.endTime, now)}</span>
      </div>
      <WorkflowGraphPanel key={task.id} task={task} workbench />
    </div>
  );
}
