"use client";

import * as React from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clock3,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ToolStatus = "pending" | "running" | "success" | "error";

interface ToolStep {
  id: string;
  name: string;
  type: "exec" | "search" | "code" | "api" | "db" | "other";
  status: ToolStatus;
  duration?: number;
  result?: string;
  inputSummary?: string;
  statusText?: string;
}

interface ToolStepsProps {
  steps: ToolStep[];
  isComplete?: boolean;
  className?: string;
}

const ITEM_ROW_HEIGHT = 84;
const MAX_VISIBLE_ITEMS = 8;

function StatusIndicator({ status }: { status: ToolStatus }) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
  }
  if (status === "success") {
    return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />;
  }
  if (status === "error") {
    return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  }
  return <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
}

function getActionVerb(step: ToolStep): string {
  if (step.type === "exec") {
    if (step.status === "running") return "正在执行";
    if (step.status === "error") return "执行失败";
    return "已执行";
  }
  if (step.type === "search") {
    if (step.status === "running") return "正在读取";
    if (step.status === "error") return "读取失败";
    return "已读取";
  }
  if (step.type === "code") {
    if (step.status === "running") return "正在修改";
    if (step.status === "error") return "修改失败";
    return "已修改";
  }
  if (step.type === "api") {
    if (step.status === "running") return "正在请求";
    if (step.status === "error") return "请求失败";
    return "已请求";
  }
  if (step.type === "db") {
    if (step.status === "running") return "正在查询";
    if (step.status === "error") return "查询失败";
    return "已查询";
  }
  if (step.status === "running") return "正在处理";
  if (step.status === "error") return "处理失败";
  return "已处理";
}

function buildHeadline(step: ToolStep): string {
  const summary = step.inputSummary?.trim();
  if (!summary) return `${getActionVerb(step)} ${step.name}`;
  return `${getActionVerb(step)} ${summary}`;
}

function extractOutputText(result?: string): string {
  if (!result) return "";
  const outputIdx = result.indexOf("Output\n");
  if (outputIdx >= 0) {
    return result.slice(outputIdx + "Output\n".length).trim();
  }
  const inputIdx = result.indexOf("Input\n");
  if (inputIdx >= 0) {
    return result.slice(inputIdx + "Input\n".length).trim();
  }
  return result.trim();
}

function getResultSubtitle(step: ToolStep): string | undefined {
  const text = extractOutputText(step.result);
  if (text) {
    const firstLine = text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    return firstLine ? firstLine.slice(0, 140) : undefined;
  }
  // For pending/running state, show inputSummary as subtitle if no result yet
  if ((step.status === "pending" || step.status === "running") && step.inputSummary?.trim()) {
    return step.inputSummary.trim().slice(0, 140);
  }
  return undefined;
}

function SingleToolStep({ step, isComplete }: { step: ToolStep; isComplete?: boolean }) {
  const detail = step.result?.trim() || "";
  const subtitle = getResultSubtitle(step);
  const canExpand = Boolean(detail);
  // When isComplete is true (tools done), default to collapsed
  const [expanded, setExpanded] = React.useState(
    (step.status === "running" || step.status === "error") && !isComplete
  );

  const MAX_RESULT_LINES = 10;
  const lines = detail.split("\n");
  const truncatedDetail = lines.length > MAX_RESULT_LINES
    ? lines.slice(0, MAX_RESULT_LINES).join("\n") + "\n... (truncated)"
    : detail;

  // Auto-collapse when tools complete
  React.useEffect(() => {
    if (isComplete && expanded) {
      setExpanded(false);
    }
  }, [isComplete]);

  React.useEffect(() => {
    if (step.status === "running" && !isComplete) {
      setExpanded(true);
    }
  }, [step.status, isComplete]);

  // When collapsed, show compact single line
  const isCollapsed = !expanded;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card/40",
        step.status === "running"
          ? "border-primary/45"
          : step.status === "error"
            ? "border-destructive/40"
            : "border-border/70",
      )}
    >
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => canExpand && setExpanded((value) => !value)}
        className={cn(
          "w-full text-left",
          isCollapsed ? "px-3 py-2" : "px-3 py-2",
          canExpand ? "cursor-pointer" : "cursor-default",
        )}
      >
        <div className="flex items-center gap-2">
          <StatusIndicator status={step.status} />
          <span className="truncate font-mono text-[12px] text-foreground">
            {buildHeadline(step)}
          </span>
          {subtitle && (
            <span className="shrink-0 truncate text-[11px] text-muted-foreground">
              · {subtitle}
            </span>
          )}
          {canExpand && (
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
          )}
        </div>
      </button>

      {canExpand && expanded && (
        <div className="border-t border-border/60 bg-background/55 px-3 py-2">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground/90">
            {truncatedDetail}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ToolSteps({
  steps,
  isComplete = false,
  className,
}: ToolStepsProps) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const runningCount = steps.filter((step) => step.status === "running").length;
  const errorCount = steps.filter((step) => step.status === "error").length;
  const hasMore = steps.length > MAX_VISIBLE_ITEMS;

  React.useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [steps]);

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">执行步骤</span>
        <span>{steps.length} 项</span>
        <span>
          {errorCount > 0
            ? `${errorCount} 项失败`
            : runningCount > 0
              ? `${runningCount} 项进行中`
              : isComplete
                ? "全部完成"
                : "等待中"}
        </span>
      </div>
      <div
        ref={listRef}
        className="space-y-1 overflow-y-auto pr-1"
        style={{ maxHeight: `${ITEM_ROW_HEIGHT * MAX_VISIBLE_ITEMS}px` }}
      >
        {steps.map((step) => (
          <SingleToolStep key={step.id} step={step} isComplete={isComplete} />
        ))}
      </div>
      {hasMore && <div className="text-[11px] text-muted-foreground">已自动滚动到最新步骤</div>}
    </div>
  );
}
