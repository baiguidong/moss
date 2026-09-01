"use client";

import * as React from "react";
import type { ToolStatus } from "@/lib/agent-transcript";

type ToolDisplaySettings = {
  autoCollapseToolCalls: boolean;
};

const ToolDisplaySettingsContext = React.createContext<ToolDisplaySettings>({
  autoCollapseToolCalls: false,
});

export type ToolExecutionState = "running" | "completed" | "failed";

export function resolveAutoCollapseToolCalls(
  sessionOverride: boolean | null | undefined,
  globalDefault: boolean,
) {
  return sessionOverride ?? globalDefault;
}

export function getToolExecutionState({
  status,
  failed,
  hasResult,
}: {
  status: ToolStatus;
  failed: boolean;
  hasResult: boolean;
}): ToolExecutionState {
  if (failed || status === "error") return "failed";
  if (hasResult || status === "success") return "completed";
  return "running";
}

export function shouldAutoCollapseToolCall({
  enabled,
  status,
  failed,
  hasResult,
}: {
  enabled: boolean;
  status: ToolStatus;
  failed: boolean;
  hasResult: boolean;
}) {
  return enabled && getToolExecutionState({ status, failed, hasResult }) !== "running";
}

export function ToolDisplaySettingsProvider({
  autoCollapseToolCalls,
  children,
}: ToolDisplaySettings & { children: React.ReactNode }) {
  const value = React.useMemo(
    () => ({ autoCollapseToolCalls }),
    [autoCollapseToolCalls],
  );
  return React.createElement(ToolDisplaySettingsContext.Provider, { value }, children);
}

export function useToolDisplaySettings() {
  return React.useContext(ToolDisplaySettingsContext);
}
