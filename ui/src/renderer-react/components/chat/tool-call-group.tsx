"use client";

import * as React from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Database,
  FilePenLine,
  FileText,
  Globe2,
  LoaderCircle,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolCallBlock } from "@/components/chat/tool-call-block";
import { getToolKind, ToolKind } from "@/components/chat/tool-utils";
import type { ToolResultRenderMessage, ToolUseRenderMessage } from "@/lib/agent-transcript";

type Props = {
  toolCalls: ToolUseRenderMessage[];
  resultMap: Map<string, ToolResultRenderMessage>;
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>;
  isStreaming?: boolean;
  embedded?: boolean;
  focusedToolUseId?: string;
};

const kindLabels: Record<ToolKind, string> = {
  bash: "Bash",
  read: "Read",
  search: "Search",
  write: "Write",
  edit: "Edit",
  agent: "Agent",
  web: "Fetch",
  db: "Query",
  other: "Tool",
};

const kindOrder: ToolKind[] = [
  "bash",
  "read",
  "search",
  "write",
  "edit",
  "agent",
  "web",
  "db",
  "other",
];

const kindIcons: Record<ToolKind, LucideIcon> = {
  bash: Terminal,
  read: FileText,
  search: Search,
  write: FilePenLine,
  edit: FilePenLine,
  agent: Bot,
  web: Globe2,
  db: Database,
  other: Wrench,
};

const kindIconColors: Record<ToolKind, string> = {
  bash: "text-emerald-600 dark:text-emerald-400",
  read: "text-sky-600 dark:text-sky-400",
  search: "text-amber-600 dark:text-amber-400",
  write: "text-violet-600 dark:text-violet-400",
  edit: "text-fuchsia-600 dark:text-fuchsia-400",
  agent: "text-cyan-600 dark:text-cyan-400",
  web: "text-blue-600 dark:text-blue-400",
  db: "text-teal-600 dark:text-teal-400",
  other: "text-muted-foreground",
};

export type ToolKindGroup = {
  kind: ToolKind;
  toolCalls: ToolUseRenderMessage[];
};

export type ToolTimelineBatch = ToolKindGroup & {
  id: string;
  label: string;
};

export function groupToolCallsByKind(toolCalls: ToolUseRenderMessage[]): ToolKindGroup[] {
  const groups = new Map<ToolKind, ToolUseRenderMessage[]>();
  for (const toolCall of toolCalls) {
    const kind = getToolKind(toolCall.toolName, toolCall.input);
    const current = groups.get(kind);
    if (current) current.push(toolCall);
    else groups.set(kind, [toolCall]);
  }
  return kindOrder
    .filter((kind) => groups.has(kind))
    .map((kind) => ({ kind, toolCalls: groups.get(kind)! }));
}

function getTimelineLabel(toolCall: ToolUseRenderMessage, kind: ToolKind) {
  return kind === "other"
    ? toolCall.displayName || toolCall.toolName || kindLabels.other
    : kindLabels[kind];
}

export function groupConsecutiveToolCalls(toolCalls: ToolUseRenderMessage[]): ToolTimelineBatch[] {
  const batches: ToolTimelineBatch[] = [];
  for (const toolCall of toolCalls) {
    const kind = getToolKind(toolCall.toolName, toolCall.input);
    const label = getTimelineLabel(toolCall, kind);
    const groupKey = `${kind}:${label}`;
    const previous = batches[batches.length - 1];
    if (previous?.id.startsWith(`${groupKey}:`)) {
      previous.toolCalls.push(toolCall);
      continue;
    }
    batches.push({
      id: `${groupKey}:${toolCall.toolUseId}`,
      kind,
      label,
      toolCalls: [toolCall],
    });
  }
  return batches;
}

function summarizeGroup(toolCalls: ToolUseRenderMessage[]) {
  return groupToolCallsByKind(toolCalls)
    .map(({ kind, toolCalls: calls }) => `${calls.length}*${kindLabels[kind]}`)
    .join(" · ");
}

export function summarizeToolCalls(toolCalls: ToolUseRenderMessage[]) {
  return `调用 ${toolCalls.length} 个工具 · ${summarizeGroup(toolCalls)}`;
}

function toolFailed(toolCall: ToolUseRenderMessage, resultMap: Map<string, ToolResultRenderMessage>) {
  const result = resultMap.get(toolCall.toolUseId);
  return toolCall.status === "error" || Boolean(result?.isError);
}

function toolCompleted(toolCall: ToolUseRenderMessage, resultMap: Map<string, ToolResultRenderMessage>) {
  const result = resultMap.get(toolCall.toolUseId);
  return (toolCall.status === "success" || Boolean(result)) && toolCall.status !== "running" && toolCall.status !== "pending";
}

function summarizeOutcome(toolCalls: ToolUseRenderMessage[], resultMap: Map<string, ToolResultRenderMessage>) {
  let success = 0;
  let failed = 0;
  let running = 0;
  for (const toolCall of toolCalls) {
    if (toolFailed(toolCall, resultMap)) {
      failed += 1;
    } else if (toolCompleted(toolCall, resultMap)) {
      success += 1;
    } else {
      running += 1;
    }
  }
  return { success, failed, running };
}

function summarizeStatus({
  allCompleted,
  completedCount,
  totalCount,
}: {
  allCompleted: boolean;
  completedCount: number;
  totalCount: number;
}) {
  if (allCompleted) return "已完成";
  return `运行中 ${completedCount}/${totalCount}`;
}

function toolTreeHasUseId(
  toolCall: ToolUseRenderMessage,
  toolUseId: string,
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>,
) {
  if (toolCall.toolUseId === toolUseId) return true;
  const pending = [...(childToolCallsByParent.get(toolCall.toolUseId) || [])];
  while (pending.length > 0) {
    const child = pending.shift()!;
    if (child.toolUseId === toolUseId) return true;
    pending.push(...(childToolCallsByParent.get(child.toolUseId) || []));
  }
  return false;
}

function ToolCallTree({
  toolCall,
  resultMap,
  childToolCallsByParent,
  compact = false,
  focusedToolUseId,
}: {
  toolCall: ToolUseRenderMessage;
  resultMap: Map<string, ToolResultRenderMessage>;
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>;
  compact?: boolean;
  focusedToolUseId?: string;
}) {
  const result = resultMap.get(toolCall.toolUseId);
  const children = childToolCallsByParent.get(toolCall.toolUseId) || [];
  const containsFocusedTool = Boolean(
    focusedToolUseId && toolTreeHasUseId(toolCall, focusedToolUseId, childToolCallsByParent),
  );

  return (
    <ToolCallBlock
      toolCall={toolCall}
      result={result}
      compact={compact}
      focused={toolCall.toolUseId === focusedToolUseId}
      expandForFocus={containsFocusedTool}
    >
      {children.length > 0 ? (
        <div className="ml-2 border-l border-border/50 pl-2">
          <div className="space-y-0.5">
            {children.map((child) => (
              <ToolCallTree
                key={child.id}
                toolCall={child}
                resultMap={resultMap}
                childToolCallsByParent={childToolCallsByParent}
                compact
                focusedToolUseId={focusedToolUseId}
              />
            ))}
          </div>
        </div>
      ) : null}
    </ToolCallBlock>
  );
}

function ToolTimelineRow({
  batch,
  resultMap,
  childToolCallsByParent,
  expanded,
  onToggle,
  focusedToolUseId,
}: {
  batch: ToolTimelineBatch;
  resultMap: Map<string, ToolResultRenderMessage>;
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>;
  expanded: boolean;
  onToggle: () => void;
  focusedToolUseId?: string;
}) {
  const Icon = kindIcons[batch.kind];
  const outcome = summarizeOutcome(batch.toolCalls, resultMap);
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex min-h-9 w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] transition-colors select-none",
          expanded ? "bg-muted/45" : "hover:bg-muted/30",
        )}
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", kindIconColors[batch.kind])} />
        <span className="min-w-0 flex-1 font-medium text-foreground">
          {batch.label}
        </span>
        {outcome.failed > 0 ? (
          <span className="shrink-0 text-[11px] tabular-nums text-destructive">
            {outcome.failed} 失败
          </span>
        ) : null}
        {outcome.running > 0 ? (
          <span className="shrink-0 text-[11px] tabular-nums text-primary">
            {outcome.running} 运行中
          </span>
        ) : null}
        <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {batch.toolCalls.length} 次
        </span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded ? (
        <div className="space-y-0.5 border-t border-border/40 bg-muted/10 px-2 py-1.5">
          {batch.toolCalls.map((toolCall) => (
            <ToolCallTree
              key={toolCall.id}
              toolCall={toolCall}
              resultMap={resultMap}
              childToolCallsByParent={childToolCallsByParent}
              compact
              focusedToolUseId={focusedToolUseId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ToolCallGroup({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  isStreaming = false,
  embedded = false,
  focusedToolUseId,
}: Props) {
  const hasError = toolCalls.some((toolCall) => {
    return toolFailed(toolCall, resultMap);
  });
  const outcome = React.useMemo(() => summarizeOutcome(toolCalls, resultMap), [toolCalls, resultMap]);
  const allCompleted = outcome.running === 0;
  const statusText = summarizeStatus({
    allCompleted,
    completedCount: outcome.success + outcome.failed,
    totalCount: toolCalls.length,
  });
  const summaryLabel = summarizeToolCalls(toolCalls);

  const [expanded, setExpanded] = React.useState(false);
  const [expandedBatches, setExpandedBatches] = React.useState<Set<string>>(() => new Set());
  const timelineBatches = React.useMemo(
    () => groupConsecutiveToolCalls(toolCalls),
    [toolCalls],
  );

  React.useEffect(() => {
    if (!focusedToolUseId) return;
    const focusedBatch = timelineBatches.find((batch) => batch.toolCalls.some(
      (toolCall) => toolTreeHasUseId(toolCall, focusedToolUseId, childToolCallsByParent),
    ));
    if (!focusedBatch) return;
    setExpanded(true);
    setExpandedBatches((current) => {
      if (current.has(focusedBatch.id)) return current;
      const next = new Set(current);
      next.add(focusedBatch.id);
      return next;
    });
  }, [childToolCallsByParent, focusedToolUseId, timelineBatches]);

  const StatusIcon = allCompleted
    ? hasError
      ? CircleAlert
      : CheckCircle2
    : LoaderCircle;
  const statusIconClass = allCompleted
    ? hasError
      ? "text-destructive"
      : "text-emerald-600 dark:text-emerald-400"
    : "animate-spin text-primary";

  if (!expanded) {
    return (
      <div className={cn(embedded ? "w-full max-w-full" : "ml-9 max-w-[760px]")}>
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
          }}
          className="flex min-h-8 w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-left text-[13px] transition-colors hover:border-border/60 hover:bg-muted/30 select-none"
        >
          <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusIconClass)} />
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {statusText}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">
            {summaryLabel}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border/60 bg-card/55", embedded ? "w-full max-w-full" : "ml-9 max-w-[760px]")}>
      <button
        type="button"
        onClick={() => {
          setExpanded(false);
        }}
        className="flex min-h-9 w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/30 select-none"
      >
        <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusIconClass)} />
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {statusText}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 rotate-180 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {summaryLabel}
        </span>
      </button>

      <div className="max-h-[28rem] divide-y divide-border/45 overflow-y-auto border-t border-border/50">
        {timelineBatches.map((batch) => (
          <ToolTimelineRow
            key={batch.id}
            batch={batch}
            resultMap={resultMap}
            childToolCallsByParent={childToolCallsByParent}
            focusedToolUseId={focusedToolUseId}
            expanded={expandedBatches.has(batch.id)}
            onToggle={() => {
              setExpandedBatches((current) => {
                const next = new Set(current);
                if (next.has(batch.id)) next.delete(batch.id);
                else next.add(batch.id);
                return next;
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}
