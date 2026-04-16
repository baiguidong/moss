"use client";

import * as React from "react";
import { Bot, Loader2 } from "lucide-react";
import type { ExecutionSummary } from "@/types";

export function ExecutionPetPanel({
  executions,
  onFocus,
}: {
  executions: ExecutionSummary[];
  onFocus: (executionId: string) => void;
}) {
  // Show all sub-agents (both running and completed)
  if (executions.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-wrap gap-2"
      style={{ maxWidth: "280px" }}
    >
      {executions.map((exec) => (
        <button
          key={exec.id}
          onClick={() => onFocus(exec.id)}
          title={exec.originalPrompt.slice(0, 80)}
          className="group relative"
        >
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)] transition-all hover:scale-110 hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)]"
            style={{
              background: exec.busy
                ? "linear-gradient(135deg, #3b82f6, #8b5cf6)"
                : "linear-gradient(135deg, #22c55e, #16a34a)",
              borderColor: exec.busy ? "rgba(139, 92, 246, 0.5)" : "rgba(34, 197, 94, 0.5)",
              opacity: exec.busy ? 1 : 0.7,
            }}
          >
            {exec.busy ? (
              <Loader2 className="h-5 w-5 text-white animate-spin" />
            ) : (
              <Bot className="h-5 w-5 text-white" />
            )}
          </div>
          {/* Tooltip */}
          <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-black/80 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none">
            {exec.originalPrompt.slice(0, 50)}
            {exec.originalPrompt.length > 50 ? "..." : ""}
          </div>
        </button>
      ))}
    </div>
  );
}
