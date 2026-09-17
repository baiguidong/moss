"use client";

import * as React from "react";
import type { ToolStatus } from "@/lib/agent-transcript";

export const TOOL_DISPLAY_MODES = ["expanded", "collapsed", "merged"] as const;
export type ToolDisplayMode = typeof TOOL_DISPLAY_MODES[number];

type ToolDisplaySettings = {
  toolDisplayMode: ToolDisplayMode;
};

const ToolDisplaySettingsContext = React.createContext<ToolDisplaySettings>({
  toolDisplayMode: "expanded",
});

export type ToolExecutionState = "running" | "completed" | "failed";

export function isToolDisplayMode(value: unknown): value is ToolDisplayMode {
  return typeof value === "string" && TOOL_DISPLAY_MODES.includes(value as ToolDisplayMode);
}

export function resolveToolDisplayMode(
  sessionOverride: ToolDisplayMode | null | undefined,
  globalDefault: ToolDisplayMode,
): ToolDisplayMode {
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
  mode,
  status,
  failed,
  hasResult,
}: {
  mode: ToolDisplayMode;
  status: ToolStatus;
  failed: boolean;
  hasResult: boolean;
}) {
  return mode === "collapsed"
    && getToolExecutionState({ status, failed, hasResult }) !== "running";
}

export function shouldExpandThinking(
  mode: ToolDisplayMode,
  isActive: boolean,
) {
  return mode === "expanded" || (mode === "collapsed" && isActive);
}

export function ToolDisplaySettingsProvider({
  toolDisplayMode,
  children,
}: ToolDisplaySettings & { children: React.ReactNode }) {
  const value = React.useMemo(
    () => ({ toolDisplayMode }),
    [toolDisplayMode],
  );
  return React.createElement(ToolDisplaySettingsContext.Provider, { value }, children);
}

export function useToolDisplaySettings() {
  return React.useContext(ToolDisplaySettingsContext);
}
