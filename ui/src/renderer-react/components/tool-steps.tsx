"use client";

import * as React from "react";
import { Loader2, Check, AlertCircle, Clock } from "lucide-react";
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
}

interface ToolStepsProps {
  steps: ToolStep[];
  isComplete?: boolean;
  className?: string;
}

const ITEM_ROW_HEIGHT = 56; // approximate px per item
const MAX_VISIBLE_ITEMS = 8;

function StatusIndicator({ status }: { status: ToolStatus }) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />;
  }
  if (status === "success") {
    return <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
  }
  if (status === "error") {
    return <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
  }
  return <Clock className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />;
}

function getResultSubtitle(result?: string): string | undefined {
  if (!result) return undefined;
  let text = result;
  // Strip "Input\n..." section, keep only after "Output\n"
  if (text.startsWith("Input\n")) {
    const outputIdx = text.indexOf("\n\nOutput\n");
    if (outputIdx >= 0) {
      text = text.slice(outputIdx + 9);
    } else {
      return undefined;
    }
  } else if (text.startsWith("Output\n")) {
    text = text.slice(7);
  }
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return line ? line.slice(0, 120) : undefined;
}

function SingleToolStep({ step }: { step: ToolStep }) {
  const subtitle =
    step.status === "success" ? getResultSubtitle(step.result) : undefined;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card/30 font-mono text-xs overflow-hidden",
        step.status === "running" ? "border-primary/40" : "border-border"
      )}
    >
      {/* Title row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <StatusIndicator status={step.status} />
        <span
          className={cn(
            "font-semibold shrink-0",
            step.status === "running"
              ? "text-primary"
              : step.status === "success"
              ? "text-foreground"
              : step.status === "error"
              ? "text-destructive"
              : "text-muted-foreground"
          )}
        >
          {step.name}
        </span>
        {step.inputSummary && (
          <span className="text-muted-foreground truncate">
            {step.inputSummary}
          </span>
        )}
      </div>

      {/* Subtitle row */}
      {subtitle && (
        <>
          <div className="h-px" />
          <div className="px-3 pb-2 text-muted-foreground/70 truncate">
            {subtitle}
          </div>
        </>
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
  const hasMore = steps.length > MAX_VISIBLE_ITEMS;

  React.useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [steps.length]);

  return (
    <div className={cn("space-y-0.5", className)}>
      <div
        ref={listRef}
        className="space-y-1 overflow-y-auto"
        style={{ maxHeight: `${ITEM_ROW_HEIGHT * MAX_VISIBLE_ITEMS}px` }}
      >
        {steps.map((step) => (
          <SingleToolStep key={step.id} step={step} />
        ))}
      </div>
      {hasMore && <div className="border-t border-border mt-1" />}
    </div>
  );
}

// Demo component
export function ToolStepsDemo() {
  const [steps, setSteps] = React.useState<ToolStep[]>([
    {
      id: "1",
      name: "Read File",
      type: "search",
      status: "success",
      duration: 234,
      inputSummary: "src/gateway/server-http.ts",
      result: "Output\nRead lines 210-260 of 1119 from src/gateway/server-http.ts",
    },
    {
      id: "2",
      name: "Bash",
      type: "exec",
      status: "success",
      duration: 156,
      inputSummary: "npm run build",
      result: "Output\n> build completed successfully",
    },
    {
      id: "3",
      name: "Grep",
      type: "search",
      status: "running",
      inputSummary: "handleRequest",
    },
  ]);

  const [isComplete, setIsComplete] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSteps((prev) =>
        prev.map((step) =>
          step.id === "3"
            ? {
                ...step,
                status: "success" as const,
                duration: 312,
                result: "Output\nFound 5 matches in 3 files",
              }
            : step
        )
      );
      setIsComplete(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="max-w-md p-4">
      <ToolSteps steps={steps} isComplete={isComplete} />
    </div>
  );
}
