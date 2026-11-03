"use client";

import * as React from "react";
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileText,
  ListChecks,
  LoaderCircle,
  Package,
  PlugZap,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildWorkerRenderMessagesFromSubagentEvents } from "@/lib/agent-transcript";
import { AgentExecutionRecord } from "./agent-execution-record";
import type { AgentEvent, SessionDetail, SessionSummary } from "../types";

type ResourceKind = "tools" | "skills" | "apps" | "mcp" | "tasks" | "workspace";

type ResourceDefinition = {
  kind: ResourceKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: string[];
  hint: string;
  tone: string;
};

const RESOURCE_META: Record<ResourceKind, Omit<ResourceDefinition, "kind" | "items">> = {
  tools: { label: "工具", icon: Wrench, hint: "实际调用与结果", tone: "text-sky-600 dark:text-sky-400" },
  skills: { label: "Skill", icon: Sparkles, hint: "注入的技能能力", tone: "text-violet-600 dark:text-violet-400" },
  apps: { label: "App", icon: Package, hint: "已连接的应用能力", tone: "text-amber-600 dark:text-amber-400" },
  mcp: { label: "MCP", icon: PlugZap, hint: "外部工具服务", tone: "text-emerald-600 dark:text-emerald-400" },
  tasks: { label: "执行记录", icon: ListChecks, hint: "任务、输出与状态", tone: "text-primary" },
  workspace: { label: "工作区", icon: FileText, hint: "会话文件与产物", tone: "text-muted-foreground" },
};

const ROOT_NODE_WIDTH = 236;
const ROOT_NODE_HEIGHT = 112;
const AGENT_NODE_WIDTH = 284;
const RESOURCE_NODE_WIDTH = 228;
const GRAPH_LEFT = 48;
const GRAPH_GAP = 112;

function curvePath(startX: number, startY: number, endX: number, endY: number) {
  const bend = startX + Math.max(48, (endX - startX) * 0.46);
  return `M ${startX} ${startY} C ${bend} ${startY}, ${bend} ${endY}, ${endX} ${endY}`;
}

function GraphRoot({ count }: { count: number }) {
  return <div className="flex h-full w-full items-center gap-3 border-2 border-primary/70 bg-primary px-4 text-primary-foreground shadow-sm">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-foreground/15"><Bot className="h-5 w-5" /></span>
    <span className="min-w-0"><span className="block text-sm font-semibold">主 Agent</span><span className="mt-1 block text-[11px] opacity-80">{count} 个子 Agent</span></span>
  </div>;
}

function statusLabel(worker: SessionSummary) {
  if (worker.subagentStatus === "running" || worker.busy) return "运行中";
  if (worker.subagentStatus === "failed") return "失败";
  return "已完成";
}

function statusTone(worker: SessionSummary) {
  if (worker.subagentStatus === "running" || worker.busy) return "text-sky-600 dark:text-sky-400";
  if (worker.subagentStatus === "failed") return "text-destructive";
  return "text-emerald-600 dark:text-emerald-400";
}

function toolNames(detail: SessionDetail | null) {
  if (!detail?.history) return [];
  const messages = buildWorkerRenderMessagesFromSubagentEvents(detail.history as AgentEvent[]);
  return [...new Set(messages.filter(message => message.type === "tool_use").map(message => message.displayName || message.toolName).filter(Boolean))].slice(0, 16) as string[];
}

function resourcesFor(worker: SessionSummary, detail: SessionDetail | null): ResourceDefinition[] {
  const tools = toolNames(detail);
  const resources: ResourceDefinition[] = [
    { kind: "tools", ...RESOURCE_META.tools, items: tools, hint: tools.length ? `${tools.length} 种工具已调用` : RESOURCE_META.tools.hint },
    { kind: "skills", ...RESOURCE_META.skills, items: (worker.skillIds ?? []).map(String) },
    { kind: "apps", ...RESOURCE_META.apps, items: (worker.appIds ?? []).map(String) },
    { kind: "mcp", ...RESOURCE_META.mcp, items: (worker.connectorIds ?? []).map(String) },
    { kind: "tasks", ...RESOURCE_META.tasks, items: [worker.preview || "执行任务", "输出与状态"] },
    { kind: "workspace", ...RESOURCE_META.workspace, items: worker.workspace ? [worker.workspace] : [] },
  ];
  return resources.filter(resource => resource.kind === "tools" || resource.items.length > 0);
}

function AgentNode({ worker, selected, onSelect }: { worker: SessionSummary; selected: boolean; onSelect: () => void }) {
  const status = statusLabel(worker);
  return <button
    type="button"
    onClick={onSelect}
    className={cn(
      "group relative flex min-h-[112px] min-w-0 flex-col rounded-md border-2 bg-background p-3 text-left shadow-sm transition-all hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      selected ? "border-emerald-500 bg-emerald-500/[0.06] ring-2 ring-emerald-500/15" : "border-border/80",
    )}
    aria-label={`进入子 Agent ${worker.title}`}
    aria-pressed={selected}
  >
    <span className="flex min-w-0 items-start gap-2">
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", status === "运行中" ? "bg-sky-500/12 text-sky-600 dark:text-sky-400" : status === "失败" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400")}>
        <Bot className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-semibold" title={worker.title}>{worker.title}</span>
          {status === "运行中" ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" /> : <CircleDot className={cn("h-3.5 w-3.5 shrink-0", statusTone(worker))} />}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{[worker.workerName, worker.assistantName].filter(Boolean).join(" · ") || "子 Agent"}</span>
      </span>
      <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5" />
    </span>
    <span className="mt-3 line-clamp-2 min-h-8 text-[11px] leading-4 text-muted-foreground">{worker.preview || "点击进入 Agent 画布"}</span>
    <span className={cn("mt-auto pt-2 text-[10px] font-medium", statusTone(worker))}>{status}</span>
  </button>;
}

function ResourceNode({ resource, expanded, onSelect }: { resource: ResourceDefinition; expanded: boolean; onSelect: () => void }) {
  const Icon = resource.icon;
  return <button
    type="button"
    onClick={onSelect}
    className={cn("group relative flex min-h-[82px] min-w-0 flex-col rounded-md border-2 bg-background p-2.5 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", expanded ? "border-emerald-500 bg-emerald-500/[0.06]" : "border-border/80")}
    aria-expanded={expanded}
  >
    <span className="flex items-center gap-2"><span className={cn("flex h-6 w-6 items-center justify-center rounded-md bg-muted/60", resource.tone)}><Icon className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1 truncate text-xs font-medium">{resource.label}</span><ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} /></span>
    <span className="mt-2 truncate text-[10px] text-muted-foreground">{resource.items.length ? `${resource.items.length} 项 · ${resource.hint}` : resource.hint}</span>
  </button>;
}

function ResourceItemNode({ item, resource, selected, onSelect }: { item: string; resource: ResourceDefinition; selected: boolean; onSelect: () => void }) {
  const Icon = resource.icon;
  return <button
    type="button"
    onClick={onSelect}
    className={cn("flex min-h-[54px] min-w-0 items-center gap-2 rounded-md border-2 bg-background px-2.5 py-2 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected ? "border-primary bg-primary/[0.04]" : "border-border/80")}
    title={item}
  >
    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted/60", resource.tone)}><Icon className="h-3.5 w-3.5" /></span>
    <span className="min-w-0 truncate text-[11px] font-medium">{item}</span>
  </button>;
}

function ResourceDetails({ resource, worker, detail, onOpen }: { resource: ResourceDefinition; worker: SessionSummary; detail: SessionDetail | null; onOpen: () => void }) {
  const Icon = resource.icon;
  const showExecution = resource.kind === "tools" || resource.kind === "tasks";
  const [selectedItem, setSelectedItem] = React.useState<string | null>(null);
  React.useEffect(() => setSelectedItem(null), [resource.kind]);
  return <div className="col-span-full rounded-xl border border-primary/20 bg-primary/[0.025] p-3 sm:p-4">
    <div className="flex items-start gap-2">
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background", resource.tone)}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h4 className="text-xs font-semibold">{resource.label}</h4><span className="text-[10px] text-muted-foreground">{resource.items.length} 项</span></div><p className="mt-1 text-[10px] text-muted-foreground">{resource.hint}</p></div>
      <button type="button" onClick={onOpen} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label={`收起${resource.label}`}><X className="h-3.5 w-3.5" /></button>
    </div>
    {resource.items.length ? <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">{resource.items.map(item => <button key={item} type="button" onClick={() => setSelectedItem(item)} className={cn("min-w-0 truncate rounded-md border bg-background px-2.5 py-2 text-left text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground", selectedItem === item ? "border-primary text-foreground" : "border-border/60")} title={item}>{item}</button>)}</div> : <p className="mt-3 rounded-lg border border-dashed border-border/70 p-3 text-[11px] text-muted-foreground">尚未记录具体资源</p>}
    {selectedItem ? <div className="mt-2 rounded-lg bg-background px-3 py-2 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">{selectedItem}</span><span className="ml-2">已挂载到 {worker.title}</span></div> : null}
    {showExecution ? <div className="mt-3 border-t border-border/60 pt-3"><AgentExecutionRecord requestKey={`${worker.id}:${resource.kind}`} load={async () => detail ?? await window.agentDesktop.getSession({ sessionId: worker.id })} live={worker.busy || worker.subagentStatus === "running"} /></div> : null}
  </div>;
}

export function AgentTreeCanvas({ workers, selectedWorkerId, onSelectWorker, onOpenWorker }: { workers: SessionSummary[]; selectedWorkerId: string | null; onSelectWorker: (workerId: string | null) => void; onOpenWorker: (workerId: string) => void }) {
  const [focusedWorkerId, setFocusedWorkerId] = React.useState<string | null>(selectedWorkerId);
  const [expandedResource, setExpandedResource] = React.useState<ResourceKind | null>(null);
  const [selectedItem, setSelectedItem] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<SessionDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const focusedWorker = workers.find(worker => worker.id === focusedWorkerId) ?? null;

  React.useEffect(() => {
    setFocusedWorkerId(selectedWorkerId);
    setExpandedResource(null);
    setDetail(null);
  }, [selectedWorkerId]);

  React.useEffect(() => {
    if (!focusedWorker) return;
    let cancelled = false;
    setLoading(true);
    void window.agentDesktop.getSession({ sessionId: focusedWorker.id }).then(value => { if (!cancelled) setDetail(value); }).catch(() => { if (!cancelled) setDetail(null); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [focusedWorker?.id]);

  const enterWorker = (id: string) => { setFocusedWorkerId(id); setExpandedResource(null); setSelectedItem(null); setDetail(null); onSelectWorker(id); };
  const leaveWorker = () => { setFocusedWorkerId(null); setExpandedResource(null); setSelectedItem(null); setDetail(null); onSelectWorker(null); };
  const resources = React.useMemo(() => focusedWorker ? resourcesFor(focusedWorker, detail) : [], [focusedWorker, detail]);
  const focusedResource = resources.find(resource => resource.kind === expandedResource) ?? null;

  return <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 p-4 sm:p-6">
    <div className="mx-auto max-w-6xl">
      {focusedWorker ? <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <button type="button" onClick={leaveWorker} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />团队</button>
        <ChevronRight className="h-3.5 w-3.5" /><span className="font-medium text-foreground">{focusedWorker.title}</span>
        <span className={cn("ml-auto", statusTone(focusedWorker))}>{statusLabel(focusedWorker)}</span>
        <button type="button" onClick={() => onOpenWorker(focusedWorker.id)} className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[10px] hover:bg-muted"><ExternalLink className="h-3 w-3" />打开完整会话</button>
      </div> : null}

      <div className="overflow-auto rounded-xl border border-border/70 bg-muted/20 p-4 sm:p-6">
        {!focusedWorker ? <>
          {workers.length ? (() => {
            const rowGap = 18;
            const graphHeight = Math.max(460, workers.length * 132 + 96);
            const rootX = GRAPH_LEFT;
            const rootY = (graphHeight - ROOT_NODE_HEIGHT) / 2;
            const workerX = rootX + ROOT_NODE_WIDTH + GRAPH_GAP;
            const graphWidth = Math.max(980, workerX + AGENT_NODE_WIDTH + 80);
            return <div className="relative" style={{ width: graphWidth, height: graphHeight }}>
              <svg className="pointer-events-none absolute inset-0 h-full w-full text-muted-foreground/60" aria-hidden="true">
                {workers.map((worker, index) => {
                  const workerY = 48 + index * (112 + rowGap);
                  return <path key={worker.id} d={curvePath(rootX + ROOT_NODE_WIDTH, rootY + ROOT_NODE_HEIGHT / 2, workerX, workerY + 56)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
                })}
              </svg>
              <div className="absolute" style={{ left: rootX, top: rootY, width: ROOT_NODE_WIDTH, height: ROOT_NODE_HEIGHT }}><GraphRoot count={workers.length} /></div>
              {workers.map((worker, index) => <div key={worker.id} className="absolute" style={{ left: workerX, top: 48 + index * (112 + rowGap), width: AGENT_NODE_WIDTH }}><AgentNode worker={worker} selected={false} onSelect={() => enterWorker(worker.id)} /></div>)}
            </div>;
          })() : <div className="flex min-h-72 items-center justify-center text-xs text-muted-foreground">暂无子 Agent</div>}
        </> : <>
          {(() => {
            const rowGap = 18;
            const expandedItems = focusedResource?.items ?? [];
            const graphHeight = Math.max(410, resources.length * 100 + 96, expandedItems.length * 72 + 96);
            const workerX = GRAPH_LEFT;
            const workerY = (graphHeight - ROOT_NODE_HEIGHT) / 2;
            const resourceX = workerX + ROOT_NODE_WIDTH + GRAPH_GAP;
            const graphWidth = Math.max(980, resourceX + RESOURCE_NODE_WIDTH + GRAPH_GAP + (focusedResource?.items.length ? RESOURCE_NODE_WIDTH : 0) + 80);
            return <div className="relative" style={{ width: graphWidth, minHeight: graphHeight + (focusedResource ? 360 : 0) }}>
              <svg className="pointer-events-none absolute inset-0 h-full w-full text-muted-foreground/60" aria-hidden="true">
                {resources.map((resource, index) => {
                  const resourceY = 40 + index * (82 + rowGap);
                  const resourcePath = <path key={`${resource.kind}:resource`} d={curvePath(workerX + ROOT_NODE_WIDTH, workerY + ROOT_NODE_HEIGHT / 2, resourceX, resourceY + 41)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
                  if (resource.kind !== expandedResource || !resource.items.length) return resourcePath;
                  const itemX = resourceX + RESOURCE_NODE_WIDTH + GRAPH_GAP;
                  return <React.Fragment key={resource.kind}>
                    {resourcePath}
                    {resource.items.map((_, itemIndex) => <path key={`${resource.kind}:${itemIndex}`} d={curvePath(resourceX + RESOURCE_NODE_WIDTH, resourceY + 41, itemX, 40 + itemIndex * 72 + 27)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
                  </React.Fragment>;
                })}
              </svg>
              <div className="absolute" style={{ left: workerX, top: workerY, width: ROOT_NODE_WIDTH, height: ROOT_NODE_HEIGHT }}><AgentNode worker={focusedWorker} selected onSelect={() => {}} /></div>
              {resources.map((resource, index) => <div key={resource.kind} className="absolute" style={{ left: resourceX, top: 40 + index * (82 + rowGap), width: RESOURCE_NODE_WIDTH }}><ResourceNode resource={resource} expanded={expandedResource === resource.kind} onSelect={() => { setExpandedResource(current => current === resource.kind ? null : resource.kind); setSelectedItem(null); }} /></div>)}
              {focusedResource?.items.length ? <div className="absolute" style={{ left: resourceX + RESOURCE_NODE_WIDTH + GRAPH_GAP, top: 40, width: RESOURCE_NODE_WIDTH }}><div className="space-y-[18px]">{focusedResource.items.map(item => <ResourceItemNode key={item} item={item} resource={focusedResource} selected={selectedItem === item} onSelect={() => setSelectedItem(item)} />)}</div></div> : null}
              {focusedResource ? <div className="absolute left-0 right-0" style={{ top: graphHeight + 20 }}><ResourceDetails resource={focusedResource} worker={focusedWorker} detail={detail} onOpen={() => { setExpandedResource(null); setSelectedItem(null); }} /></div> : null}
            </div>;
          })()}
          {loading ? <div className="mt-3 flex items-center justify-center gap-2 text-[10px] text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />正在读取资源与执行记录</div> : null}
        </>}
      </div>
    </div>
  </div>;
}
