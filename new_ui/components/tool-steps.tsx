"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Check,
  Loader2,
  AlertCircle,
  Terminal,
  FileSearch,
  Code,
  Globe,
  Database,
  Zap,
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
}

interface ToolStepsProps {
  steps: ToolStep[];
  isComplete?: boolean;
  autoCollapse?: boolean;
  className?: string;
}

const toolIcons: Record<ToolStep["type"], React.ReactNode> = {
  exec: <Terminal className="h-3.5 w-3.5" />,
  search: <FileSearch className="h-3.5 w-3.5" />,
  code: <Code className="h-3.5 w-3.5" />,
  api: <Globe className="h-3.5 w-3.5" />,
  db: <Database className="h-3.5 w-3.5" />,
  other: <Zap className="h-3.5 w-3.5" />,
};

const statusColors: Record<ToolStatus, string> = {
  pending: "text-muted-foreground bg-muted",
  running: "text-primary bg-primary/10",
  success: "text-emerald-500 bg-emerald-500/10",
  error: "text-destructive bg-destructive/10",
};

function StatusIndicator({ status }: { status: ToolStatus }) {
  if (status === "running") {
    return <Loader2 className="h-3 w-3 animate-spin text-primary" />;
  }
  if (status === "success") {
    return <Check className="h-3 w-3 text-emerald-500" />;
  }
  if (status === "error") {
    return <AlertCircle className="h-3 w-3 text-destructive" />;
  }
  return <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />;
}

function SingleToolStep({
  step,
  isLast,
  autoCollapse,
}: {
  step: ToolStep;
  isLast: boolean;
  autoCollapse?: boolean;
}) {
  const [isExpanded, setIsExpanded] = React.useState(step.status === "running");

  // Auto-collapse when step completes
  React.useEffect(() => {
    if (autoCollapse && step.status === "success") {
      const timer = setTimeout(() => setIsExpanded(false), 800);
      return () => clearTimeout(timer);
    }
  }, [step.status, autoCollapse]);

  // Auto-expand when running
  React.useEffect(() => {
    if (step.status === "running") {
      setIsExpanded(true);
    }
  }, [step.status]);

  return (
    <div className="relative">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-[11px] top-7 h-[calc(100%-12px)] w-px bg-border" />
      )}

      <div className="group relative">
        {/* Step header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors",
            "hover:bg-muted/50"
          )}
        >
          {/* Status dot/icon */}
          <div
            className={cn(
              "relative z-10 flex h-6 w-6 items-center justify-center rounded-full",
              statusColors[step.status]
            )}
          >
            <StatusIndicator status={step.status} />
          </div>

          {/* Tool info */}
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium",
                step.status === "running"
                  ? "text-primary"
                  : step.status === "success"
                  ? "text-foreground"
                  : step.status === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {toolIcons[step.type]}
              <span className="truncate">{step.name}</span>
            </span>

            {step.duration && step.status !== "running" && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {step.duration}ms
              </span>
            )}
          </div>

          {/* Expand indicator */}
          <motion.div
            animate={{ rotate: isExpanded ? 0 : -90 }}
            transition={{ duration: 0.15 }}
            className="text-muted-foreground"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </motion.div>
        </button>

        {/* Step details */}
        <AnimatePresence>
          {isExpanded && step.result && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="ml-11 mt-1 rounded-md bg-muted/30 p-3">
                <pre className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all font-mono">
                  {step.result}
                </pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function ToolSteps({
  steps,
  isComplete = false,
  autoCollapse = true,
  className,
}: ToolStepsProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const runningCount = steps.filter((s) => s.status === "running").length;
  const completedCount = steps.filter((s) => s.status === "success").length;
  const hasErrors = steps.some((s) => s.status === "error");

  // Auto-collapse entire section when all steps complete
  React.useEffect(() => {
    if (autoCollapse && isComplete && !hasErrors) {
      const timer = setTimeout(() => setIsCollapsed(true), 1200);
      return () => clearTimeout(timer);
    }
  }, [isComplete, autoCollapse, hasErrors]);

  return (
    <div className={cn("rounded-xl border border-border bg-card/50", className)}>
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={cn(
          "flex w-full items-center justify-between px-4 py-3 transition-colors",
          "hover:bg-muted/30",
          !isCollapsed && "border-b border-border"
        )}
      >
        <div className="flex items-center gap-3">
          {/* Animated status indicator */}
          <div className="relative">
            {runningCount > 0 ? (
              <div className="relative">
                <div className="h-2 w-2 rounded-full bg-primary" />
                <div className="absolute inset-0 h-2 w-2 animate-ping rounded-full bg-primary/60" />
              </div>
            ) : hasErrors ? (
              <div className="h-2 w-2 rounded-full bg-destructive" />
            ) : isComplete ? (
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
            ) : (
              <div className="h-2 w-2 rounded-full bg-muted-foreground" />
            )}
          </div>

          <span className="text-sm font-medium text-foreground">
            {runningCount > 0
              ? "执行中..."
              : hasErrors
              ? "执行失败"
              : isComplete
              ? "执行完成"
              : "查看步骤"}
          </span>

          {/* Progress badge */}
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {completedCount}/{steps.length}
          </span>
        </div>

        <motion.div
          animate={{ rotate: isCollapsed ? -90 : 0 }}
          transition={{ duration: 0.15 }}
          className="text-muted-foreground"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.div>
      </button>

      {/* Steps list */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-1 p-3">
              {steps.map((step, index) => (
                <SingleToolStep
                  key={step.id}
                  step={step}
                  isLast={index === steps.length - 1}
                  autoCollapse={autoCollapse}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Demo component to show the tool steps in action
export function ToolStepsDemo() {
  const [steps, setSteps] = React.useState<ToolStep[]>([
    {
      id: "1",
      name: "browser.navigate",
      type: "api",
      status: "success",
      duration: 234,
      result: "成功导航到目标页面",
    },
    {
      id: "2",
      name: "exec.execute",
      type: "exec",
      status: "success",
      duration: 156,
      result: "桌面文件列表:\n- 项目文档.docx\n- 数据分析.xlsx\n- 截图001.png",
    },
    {
      id: "3",
      name: "search.files",
      type: "search",
      status: "running",
      result: "正在搜索相关文件...",
    },
  ]);

  const [isComplete, setIsComplete] = React.useState(false);

  // Simulate step completion
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSteps((prev) =>
        prev.map((step) =>
          step.id === "3"
            ? { ...step, status: "success" as const, duration: 312, result: "找到 5 个匹配文件" }
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
