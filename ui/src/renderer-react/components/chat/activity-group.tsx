"use client";

import * as React from "react";
import { CircleX, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { ToolCallBlock, formatToolDuration } from "@/components/chat/tool-call-block";
import { ToolCallGroup } from "@/components/chat/tool-call-group";
import { getToolKind } from "@/components/chat/tool-utils";
import { useToolDisplaySettings } from "@/components/chat/tool-display-settings";
import type {
  ThinkingRenderMessage,
  ToolResultRenderMessage,
  ToolUseRenderMessage,
} from "@/lib/agent-transcript";

export type ActivityStep =
  | { kind: "thinking"; message: ThinkingRenderMessage }
  | { kind: "tool"; toolCall: ToolUseRenderMessage };

type Props = {
  steps: ActivityStep[];
  toolCalls: ToolUseRenderMessage[];
  mergeable: boolean;
  resultMap: Map<string, ToolResultRenderMessage>;
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>;
  focusedToolUseId?: string;
  isLive?: boolean;
};

type SummaryBucket = {
  key: string;
  count: number;
  label: (count: number) => string;
};

function activityBucket(step: ActivityStep): Omit<SummaryBucket, "count"> {
  if (step.kind === "thinking") {
    return { key: "thinking", label: (count) => count === 1 ? "思考" : `思考 ${count} 次` };
  }

  const { toolCall } = step;
  const kind = getToolKind(toolCall.toolName, toolCall.input);
  const normalized = toolCall.toolName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (kind === "read") {
    return { key: "read", label: (count) => count === 1 ? "读取了一个文件" : `读取了 ${count} 个文件` };
  }
  if (kind === "write") {
    return { key: "write", label: (count) => count === 1 ? "创建了一个文件" : `创建了 ${count} 个文件` };
  }
  if (kind === "edit") {
    return { key: "edit", label: (count) => count === 1 ? "编辑了一个文件" : `编辑了 ${count} 个文件` };
  }
  if (kind === "bash") {
    return { key: "bash", label: (count) => count === 1 ? "执行了一条命令" : `执行了 ${count} 条命令` };
  }
  if (kind === "agent") {
    return { key: "agent", label: (count) => count === 1 ? "派遣了一个 Agent" : `派遣了 ${count} 个 Agent` };
  }
  if (kind === "web") {
    return { key: "web", label: (count) => count === 1 ? "访问了网页" : `访问了 ${count} 个网页` };
  }
  if (kind === "db") {
    return { key: "db", label: (count) => count === 1 ? "查询了数据库" : `查询了数据库 ${count} 次` };
  }
  if (kind === "search") {
    if (normalized.includes("glob") || normalized.includes("filesearch")) {
      return { key: "glob", label: () => "查找到文件" };
    }
    return { key: "search", label: (count) => count === 1 ? "搜索了代码" : `搜索了 ${count} 个模式` };
  }

  const name = toolCall.displayName || toolCall.toolName || "工具";
  return {
    key: `tool:${name}`,
    label: (count) => count === 1 ? name : `${name} (${count})`,
  };
}

export function buildActivitySummary(steps: ActivityStep[]) {
  const buckets = new Map<string, SummaryBucket>();
  for (const step of steps) {
    const bucket = activityBucket(step);
    const existing = buckets.get(bucket.key);
    if (existing) existing.count += 1;
    else buckets.set(bucket.key, { ...bucket, count: 1 });
  }
  return Array.from(buckets.values(), (bucket) => bucket.label(bucket.count)).join("，");
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

function countFailedTools(
  toolCalls: ToolUseRenderMessage[],
  resultMap: Map<string, ToolResultRenderMessage>,
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>,
): number {
  let count = 0;
  for (const toolCall of toolCalls) {
    if (toolCall.status === "error" || resultMap.get(toolCall.toolUseId)?.isError) count += 1;
    count += countFailedTools(
      childToolCallsByParent.get(toolCall.toolUseId) || [],
      resultMap,
      childToolCallsByParent,
    );
  }
  return count;
}

function getActivityDuration(
  steps: ActivityStep[],
  resultMap: Map<string, ToolResultRenderMessage>,
) {
  const timestamps = steps.flatMap((step) => {
    if (step.kind === "thinking") return [];
    const result = resultMap.get(step.toolCall.toolUseId);
    const started = step.toolCall.timestamp.getTime();
    const durationEnd = typeof step.toolCall.duration === "number"
      ? started + step.toolCall.duration
      : Number.NaN;
    return [started, result?.timestamp.getTime(), durationEnd].filter(Number.isFinite) as number[];
  });
  if (timestamps.length < 2) return "";
  const duration = Math.max(...timestamps) - Math.min(...timestamps);
  return duration > 0 ? formatToolDuration(duration) : "";
}

function MergedToolTree({
  toolCall,
  resultMap,
  childToolCallsByParent,
  focusedToolUseId,
}: {
  toolCall: ToolUseRenderMessage;
  resultMap: Map<string, ToolResultRenderMessage>;
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>;
  focusedToolUseId?: string;
}) {
  const children = childToolCallsByParent.get(toolCall.toolUseId) || [];
  const containsFocusedTool = Boolean(
    focusedToolUseId && toolTreeHasUseId(toolCall, focusedToolUseId, childToolCallsByParent),
  );
  return (
    <div>
      <ToolCallBlock
        chrome="row"
        toolCall={toolCall}
        result={resultMap.get(toolCall.toolUseId)}
        focused={toolCall.toolUseId === focusedToolUseId}
        expandForFocus={containsFocusedTool}
        defaultCollapsed
      />
      {children.length > 0 ? (
        <div className="ml-2 border-l border-border/70 pl-3">
          {children.map((child) => (
            <MergedToolTree
              key={child.id}
              toolCall={child}
              resultMap={resultMap}
              childToolCallsByParent={childToolCallsByParent}
              focusedToolUseId={focusedToolUseId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ExpandedActivitySteps({
  steps,
  resultMap,
  childToolCallsByParent,
  focusedToolUseId,
}: Omit<Props, "toolCalls" | "mergeable" | "isLive">) {
  const rows: React.ReactNode[] = [];
  let pendingTools: ToolUseRenderMessage[] = [];
  const flushTools = () => {
    if (pendingTools.length === 0) return;
    const toolCalls = pendingTools;
    pendingTools = [];
    rows.push(
      <ToolCallGroup
        key={`tools-${toolCalls[0]!.id}`}
        toolCalls={toolCalls}
        resultMap={resultMap}
        childToolCallsByParent={childToolCallsByParent}
        embedded
        focusedToolUseId={focusedToolUseId}
      />,
    );
  };

  for (const step of steps) {
    if (step.kind === "tool") {
      pendingTools.push(step.toolCall);
      continue;
    }
    flushTools();
    rows.push(
      <ThinkingBlock
        key={step.message.id}
        content={step.message.content}
        isActive={Boolean(step.message.streaming)}
      />,
    );
  }
  flushTools();
  return <div className="min-w-0 space-y-1.5">{rows}</div>;
}

export function ActivityGroup({
  steps,
  toolCalls,
  mergeable,
  resultMap,
  childToolCallsByParent,
  focusedToolUseId,
  isLive = false,
}: Props) {
  const { toolDisplayMode } = useToolDisplaySettings();
  const [pinnedExpanded, setPinnedExpanded] = React.useState<boolean | null>(null);
  const containsFocusedTool = Boolean(
    focusedToolUseId
    && toolCalls.some((toolCall) => (
      toolTreeHasUseId(toolCall, focusedToolUseId, childToolCallsByParent)
    )),
  );

  if (toolDisplayMode !== "merged" || !mergeable) {
    return (
      <ExpandedActivitySteps
        steps={steps}
        resultMap={resultMap}
        childToolCallsByParent={childToolCallsByParent}
        focusedToolUseId={focusedToolUseId}
      />
    );
  }

  if (steps.length === 1 && steps[0]?.kind === "thinking") {
    return (
      <ThinkingBlock
        content={steps[0].message.content}
        isActive={Boolean(steps[0].message.streaming)}
      />
    );
  }

  if (steps.length === 1 && steps[0]?.kind === "tool") {
    return (
      <MergedToolTree
        toolCall={steps[0].toolCall}
        resultMap={resultMap}
        childToolCallsByParent={childToolCallsByParent}
        focusedToolUseId={focusedToolUseId}
      />
    );
  }

  const expanded = containsFocusedTool || (pinnedExpanded ?? isLive);
  const failedCount = countFailedTools(toolCalls, resultMap, childToolCallsByParent);
  const summary = buildActivitySummary(steps);
  const duration = isLive ? "" : getActivityDuration(steps, resultMap);

  return (
    <div
      data-activity-group="true"
      data-expanded={expanded ? "true" : "false"}
      data-live={isLive ? "true" : "false"}
      className="flex min-w-0 items-start gap-2"
    >
      <div
        data-activity-icon="true"
        className="flex h-7 w-7 shrink-0 self-start items-center justify-center rounded-sm border border-[color:var(--color-repl-border)] bg-[var(--color-repl-header-bg)] text-[color:var(--color-repl-muted)]"
        title="工具调用"
        role="img"
        aria-label="工具调用"
      >
        <Wrench className="h-3.5 w-3.5" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setPinnedExpanded(!expanded)}
          aria-expanded={expanded}
          title={summary}
          className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] leading-[1.6] text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1 truncate">{summary}</span>
          <span className="flex shrink-0 items-center gap-2">
            {failedCount > 0 ? (
              <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-destructive">
                <CircleX aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
                {failedCount} 项失败
              </span>
            ) : null}
            {duration ? (
              <span className="whitespace-nowrap font-mono tabular-nums">{duration}</span>
            ) : null}
            <span aria-hidden="true" className={cn("w-3 text-center text-[8px]", expanded && "rotate-90")}>▸</span>
          </span>
        </button>

        {expanded ? (
          <div className="ml-[3px] flex flex-col border-l border-border/70 pl-3">
            {steps.map((step) => step.kind === "thinking" ? (
              <ThinkingBlock
                key={step.message.id}
                content={step.message.content}
                isActive={Boolean(step.message.streaming)}
              />
            ) : (
              <MergedToolTree
                key={step.toolCall.id}
                toolCall={step.toolCall}
                resultMap={resultMap}
                childToolCallsByParent={childToolCallsByParent}
                focusedToolUseId={focusedToolUseId}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
