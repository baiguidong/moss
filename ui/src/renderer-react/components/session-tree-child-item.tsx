"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ChildSessionStatus = "running" | "completed" | "failed" | null;

export function SessionTreeChildItem({
  title,
  busy,
  status,
  isActive,
  isLastChild,
  onClick,
}: {
  title: string;
  busy: boolean;
  status?: ChildSessionStatus;
  isActive: boolean;
  isLastChild: boolean;
  onClick: () => void;
}) {
  const displayStatus = busy || status === "running"
    ? "运行中"
    : status === "failed" ? "失败" : "已完成";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative ml-3 flex h-8 w-[calc(100%_-_0.75rem)] max-w-full items-center overflow-hidden rounded-lg border px-2 text-left transition-colors",
        isActive
          ? "border-primary/25 bg-primary/10 shadow-[0_8px_24px_-24px_rgba(0,0,0,0.65)]"
          : "border-transparent bg-transparent hover:border-sidebar-border/70 hover:bg-sidebar-accent/80",
      )}
      aria-label={`打开子会话：${title}，${displayStatus}`}
      aria-current={isActive ? "page" : undefined}
      title={`${title} · ${displayStatus}`}
    >
      <span aria-hidden="true" className="relative h-full w-4 shrink-0 text-sidebar-foreground/25">
        <span className={cn("absolute left-1 top-0 w-px bg-current", isLastChild ? "h-1/2" : "h-full")} />
        <span className="absolute left-1 top-1/2 h-px w-2.5 bg-current" />
      </span>
      <span
        className={cn(
          "mr-1.5 h-2 w-2 shrink-0 rounded-full",
          displayStatus === "运行中"
            ? "animate-pulse bg-sky-500"
            : displayStatus === "失败" ? "bg-destructive" : "bg-emerald-500",
        )}
        aria-hidden="true"
      />
      <span className="block w-0 min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-sidebar-foreground">
        {title}
      </span>
    </button>
  );
}
