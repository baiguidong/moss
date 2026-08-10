"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, FilePen, FilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolCallBlock } from "@/components/chat/tool-call-block";
import { getToolFilePath, getToolKind, ToolKind } from "@/components/chat/tool-utils";
import { useWorkspacePath } from "@/components/workspace-path-context";
import type { ToolResultRenderMessage, ToolUseRenderMessage } from "@/lib/agent-transcript";

type Props = {
  toolCalls: ToolUseRenderMessage[];
  resultMap: Map<string, ToolResultRenderMessage>;
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>;
  isStreaming?: boolean;
  embedded?: boolean;
};

const kindLabels: Record<ToolKind, string> = {
  bash: "运行命令(Bash)",
  read: "读取文件(Read)",
  search: "搜索内容(Search)",
  write: "写入文件(Write)",
  edit: "修改文件(Edit)",
  agent: "调用助手(Agent)",
  web: "访问网页(Fetch)",
  db: "查询数据(Query)",
  other: "执行工具(Tool)",
};

export function collectFileChanges(
  toolCalls: ToolUseRenderMessage[],
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>,
): Array<{ path: string; kind: "write" | "edit" }> {
  const seen = new Map<string, "write" | "edit">();
  const visit = (toolCall: ToolUseRenderMessage) => {
    const kind = getToolKind(toolCall.toolName, toolCall.input);
    if (kind === "write" || kind === "edit") {
      const filePath = getToolFilePath(toolCall);
      if (filePath && !seen.has(filePath)) {
        seen.set(filePath, kind);
      }
    }
    for (const child of childToolCallsByParent.get(toolCall.toolUseId) ?? []) {
      visit(child);
    }
  };
  for (const toolCall of toolCalls) visit(toolCall);
  return [...seen.entries()].map(([path, kind]) => ({ path, kind }));
}

export function FileChangeChips({
  changes,
}: {
  changes: Array<{ path: string; kind: "write" | "edit" }>;
}) {
  const workspace = useWorkspacePath();
  if (changes.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {changes.map(({ path, kind }) => {
        const baseName = path.split("/").pop() || path;
        const absolutePath = path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)
          ? path
          : workspace
            ? `${workspace}/${path}`
            : path;
        return (
          <button
            key={path}
            type="button"
            title={`${kind === "write" ? "新建/写入" : "修改"}：${path}（点击打开）`}
            className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            onClick={() => {
              void window.agentDesktop.shell.openFile(absolutePath);
            }}
          >
            {kind === "write" ? (
              <FilePlus className="h-3 w-3 shrink-0 text-emerald-500" />
            ) : (
              <FilePen className="h-3 w-3 shrink-0 text-sky-500" />
            )}
            <span className="min-w-0 truncate font-mono">{baseName}</span>
          </button>
        );
      })}
    </div>
  );
}

function summarizeGroup(toolCalls: ToolUseRenderMessage[]) {
  const counts = new Map<ToolKind, number>();
  for (const toolCall of toolCalls) {
    const kind = getToolKind(toolCall.toolName, toolCall.input);
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => (count > 1 ? `${kindLabels[kind]} x${count}` : kindLabels[kind]))
    .join(" · ");
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

function summarizeOutcomeText({
  success,
  failed,
  running,
}: {
  success: number;
  failed: number;
  running: number;
}) {
  const parts = [];
  if (success > 0) parts.push(`${success} 个成功`);
  if (failed > 0) parts.push(`${failed} 个失败`);
  if (running > 0) parts.push(`${running} 个运行中`);
  return parts.join("，");
}

function summarizeKindRows(
  toolCalls: ToolUseRenderMessage[],
  resultMap: Map<string, ToolResultRenderMessage>,
) {
  const rows = new Map<ToolKind, { total: number; success: number; failed: number; running: number }>();
  for (const toolCall of toolCalls) {
    const kind = getToolKind(toolCall.toolName, toolCall.input);
    const row = rows.get(kind) || { total: 0, success: 0, failed: 0, running: 0 };
    row.total += 1;
    if (toolFailed(toolCall, resultMap)) {
      row.failed += 1;
    } else if (toolCompleted(toolCall, resultMap)) {
      row.success += 1;
    } else {
      row.running += 1;
    }
    rows.set(kind, row);
  }
  return [...rows.entries()];
}

function formatDuration(seconds?: number): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function summarizeStatus({
  allCompleted,
  completedCount,
  totalCount,
  duration,
}: {
  allCompleted: boolean;
  completedCount: number;
  totalCount: number;
  duration: string | null;
}) {
  if (allCompleted) return duration ? `已完成 ${duration}` : "已完成";
  return `运行中 ${completedCount}/${totalCount}`;
}

function ToolCallTree({
  toolCall,
  resultMap,
  childToolCallsByParent,
  compact = false,
}: {
  toolCall: ToolUseRenderMessage;
  resultMap: Map<string, ToolResultRenderMessage>;
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>;
  compact?: boolean;
}) {
  const result = resultMap.get(toolCall.toolUseId);
  const children = childToolCallsByParent.get(toolCall.toolUseId) || [];

  return (
    <ToolCallBlock
      toolCall={toolCall}
      result={result}
      compact={compact}
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
              />
            ))}
          </div>
        </div>
      ) : null}
    </ToolCallBlock>
  );
}

export function ToolCallGroup({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  isStreaming = false,
  embedded = false,
}: Props) {
  const hasError = toolCalls.some((toolCall) => {
    return toolFailed(toolCall, resultMap);
  });
  const allCompleted = toolCalls.every((toolCall) => {
    return toolCompleted(toolCall, resultMap);
  });
  const outcome = React.useMemo(() => summarizeOutcome(toolCalls, resultMap), [toolCalls, resultMap]);
  const totalDuration = React.useMemo(() => {
    const values = toolCalls
      .map((toolCall) => toolCall.duration)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
    if (values.length === 0) return null;
    return formatDuration(values.reduce((sum, value) => sum + value, 0));
  }, [toolCalls]);
  const statusText = summarizeStatus({
    allCompleted,
    completedCount: outcome.success + outcome.failed,
    totalCount: toolCalls.length,
    duration: totalDuration,
  });
  const outcomeText = summarizeOutcomeText(outcome);
  const summaryLabel = outcomeText ? `${outcomeText} · ${summarizeGroup(toolCalls)}` : summarizeGroup(toolCalls);

  const [expanded, setExpanded] = React.useState(isStreaming);
  // Force-expand while streaming; auto-collapse when the group finishes,
  // unless the user has manually toggled it (their choice wins).
  const userToggledRef = React.useRef(false);
  const prevStreamingRef = React.useRef(isStreaming);

  React.useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
    } else if (prevStreamingRef.current && !userToggledRef.current) {
      setExpanded(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const fileChanges = React.useMemo(
    () => collectFileChanges(toolCalls, childToolCallsByParent),
    [toolCalls, childToolCallsByParent],
  );

  if (!expanded) {
    return (
      <div className={cn(embedded ? "w-full max-w-full" : "ml-9 max-w-[760px]")}>
        <button
          type="button"
          onClick={() => {
            userToggledRef.current = true;
            setExpanded(true);
          }}
          className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-[13px] transition-colors hover:bg-muted/50 select-none"
        >
          {allCompleted ? null : hasError ? (
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-destructive" />
          ) : (
            <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
          )}
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {statusText}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("min-w-0 flex-1 truncate", allCompleted && !hasError && "text-muted-foreground")}>
            {summaryLabel}
          </span>
        </button>
        <FileChangeChips changes={fileChanges} />
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border border-border/60", embedded ? "w-full max-w-full" : "ml-9 max-w-[760px]")}>
      <button
        type="button"
        onClick={() => {
          userToggledRef.current = true;
          setExpanded(false);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left select-none hover:bg-muted/30 transition-colors rounded-t-xl"
      >
        {allCompleted ? null : hasError ? (
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-destructive" />
        ) : (
          <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
        )}
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {statusText}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground rotate-180" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {summaryLabel}
        </span>
      </button>

      <div className="space-y-0.5 px-3 pb-3">
        {toolCalls.map((toolCall) => (
          <ToolCallTree
            key={toolCall.id}
            toolCall={toolCall}
            resultMap={resultMap}
            childToolCallsByParent={childToolCallsByParent}
            compact
          />
        ))}
        <FileChangeChips changes={fileChanges} />
      </div>
    </div>
  );
}
