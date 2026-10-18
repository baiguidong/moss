"use client";

import * as React from "react";
import type { PresentationResult } from '@/types';
import type { ToolStatus } from "@/lib/agent-transcript";

export const TOOL_DISPLAY_MODES = ["expanded", "collapsed", "merged"] as const;
export type ToolDisplayMode = typeof TOOL_DISPLAY_MODES[number];

type ToolDisplaySettings = {
  sessionId?: string;
  toolDisplayMode: ToolDisplayMode;
  disclosureOverrides?: Map<string, boolean>;
  presentationResults?: Map<string, PresentationResult>;
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
    && getToolExecutionState({ status, failed, hasResult }) === "completed";
}

export function shouldExpandThinking(
  mode: ToolDisplayMode,
  isActive: boolean,
) {
  return mode === "expanded" || (mode === "collapsed" && isActive);
}

export function ToolDisplaySettingsProvider({
  toolDisplayMode,
  sessionId,
  children,
}: ToolDisplaySettings & { children: React.ReactNode }) {
  const disclosureOverrides = React.useRef(new Map<string, boolean>()).current;
  const [presentationResults, setPresentationResults] = React.useState(new Map<string, PresentationResult>());
  React.useEffect(() => {
    if (!sessionId || !window.agentDesktop.presentation?.onResult) return;
    let active = true;
    const accept = (result: PresentationResult, initial = false) => { if (!active || !result.request_id) return; setPresentationResults(current => { if (initial && current.has(result.request_id)) return current; const next = new Map(current); next.set(result.request_id, result); while (next.size > 256) next.delete(next.keys().next().value); return next; }); };
    const off = window.agentDesktop.presentation.onResult(payload => { if (payload.sessionId === sessionId) accept(payload.result); });
    void window.agentDesktop.presentation.snapshot({ sessionId }).then(value => { for (const result of value?.results || []) accept(result, true); }).catch(() => {});
    return () => { active = false; off(); };
  }, [sessionId]);
  const value = React.useMemo(
    () => ({ toolDisplayMode, disclosureOverrides, sessionId, presentationResults }),
    [toolDisplayMode, disclosureOverrides, sessionId, presentationResults],
  );
  return React.createElement(ToolDisplaySettingsContext.Provider, { value }, children);
}

export function useToolDisplaySettings() {
  return React.useContext(ToolDisplaySettingsContext);
}
