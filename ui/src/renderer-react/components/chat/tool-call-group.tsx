"use client";

import * as React from "react";
import { ChevronDown, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolCallBlock } from "@/components/chat/tool-call-block";
import {
  TOOL_CALL_FRAME_CLASS_NAME,
  TOOL_CALL_HEADER_CLASS_NAME,
} from "@/components/chat/tool-call-frame";
import { useToolDisplaySettings } from "@/components/chat/tool-display-settings";
import type { ToolResultRenderMessage, ToolUseRenderMessage } from "@/lib/agent-transcript";

type Props = {
  toolCalls: ToolUseRenderMessage[];
  resultMap: Map<string, ToolResultRenderMessage>;
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>;
  embedded?: boolean;
  focusedToolUseId?: string;
};

export type ToolCallDisplayRun = {
  kind: "exploration" | "tools";
  toolCalls: ToolUseRenderMessage[];
};

const READ_TOOL_NAMES = new Set(["read", "fileread"]);
const SEARCH_TOOL_NAMES = new Set([
  "grep",
  "glob",
  "search",
  "filesearch",
]);

function getExplorationToolKind(toolCall: ToolUseRenderMessage) {
  const normalizedName = toolCall.toolName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (READ_TOOL_NAMES.has(normalizedName)) return "read";
  if (SEARCH_TOOL_NAMES.has(normalizedName)) return "search";
  return null;
}

export function isExplorationToolCall(toolCall: ToolUseRenderMessage) {
  return getExplorationToolKind(toolCall) !== null;
}

export function getExplorationSummary(
  toolCalls: ToolUseRenderMessage[],
  resultMap: Map<string, ToolResultRenderMessage>,
) {
  const summary = { read: 0, search: 0, failed: 0, running: 0 };
  for (const toolCall of toolCalls) {
    const kind = getExplorationToolKind(toolCall);
    if (!kind) continue;
    summary[kind] += 1;
    const result = resultMap.get(toolCall.toolUseId);
    if (toolCall.status === "error" || result?.isError) summary.failed += 1;
    else if (!result && (toolCall.status === "running" || toolCall.status === "pending")) {
      summary.running += 1;
    }
  }
  return summary;
}

export function groupToolCallsForDisplay(toolCalls: ToolUseRenderMessage[]): ToolCallDisplayRun[] {
  const runs: ToolCallDisplayRun[] = [];
  for (const toolCall of toolCalls) {
    const kind = isExplorationToolCall(toolCall) ? "exploration" : "tools";
    const current = runs.at(-1);
    if (current?.kind === kind) current.toolCalls.push(toolCall);
    else runs.push({ kind, toolCalls: [toolCall] });
  }
  return runs;
}

export function shouldExpandExploredGroup(
  autoCollapseToolCalls: boolean,
  containsFocusedTool: boolean,
) {
  return containsFocusedTool || !autoCollapseToolCalls;
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

function ToolCallTree({
  toolCall,
  resultMap,
  childToolCallsByParent,
  focusedToolUseId,
  defaultCollapsed = false,
}: {
  toolCall: ToolUseRenderMessage;
  resultMap: Map<string, ToolResultRenderMessage>;
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>;
  focusedToolUseId?: string;
  defaultCollapsed?: boolean;
}) {
  const result = resultMap.get(toolCall.toolUseId);
  const children = childToolCallsByParent.get(toolCall.toolUseId) || [];
  const containsFocusedTool = Boolean(
    focusedToolUseId && toolTreeHasUseId(toolCall, focusedToolUseId, childToolCallsByParent),
  );

  return (
    <ToolCallBlock
      toolCall={toolCall}
      result={result}
      focused={toolCall.toolUseId === focusedToolUseId}
      expandForFocus={containsFocusedTool}
      defaultCollapsed={defaultCollapsed}
    >
      {children.length > 0 ? (
        <div className="border-l border-[color:var(--color-repl-muted)]/35 pl-2">
          <div className="space-y-1">
            {children.map((child) => (
              <ToolCallTree
                key={child.id}
                toolCall={child}
                resultMap={resultMap}
                childToolCallsByParent={childToolCallsByParent}
                focusedToolUseId={focusedToolUseId}
                defaultCollapsed={defaultCollapsed}
              />
            ))}
          </div>
        </div>
      ) : null}
    </ToolCallBlock>
  );
}

function ToolCallRun({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  focusedToolUseId,
  explored = false,
}: Omit<Props, "embedded"> & { explored?: boolean }) {
  const { autoCollapseToolCalls } = useToolDisplaySettings();
  const containsFocusedTool = Boolean(
    explored
    && focusedToolUseId
    && toolCalls.some((toolCall) => (
      toolTreeHasUseId(toolCall, focusedToolUseId, childToolCallsByParent)
    )),
  );
  const [exploredExpanded, setExploredExpanded] = React.useState(
    shouldExpandExploredGroup(autoCollapseToolCalls, containsFocusedTool),
  );

  React.useEffect(() => {
    setExploredExpanded(shouldExpandExploredGroup(autoCollapseToolCalls, containsFocusedTool));
  }, [autoCollapseToolCalls, containsFocusedTool]);

  const explorationSummary = getExplorationSummary(toolCalls, resultMap);
  const failed = explored && explorationSummary.failed > 0;
  const running = explored && explorationSummary.running > 0;
  const explorationCountText = [
    explorationSummary.read > 0 ? `Read ×${explorationSummary.read}` : "",
    explorationSummary.search > 0 ? `Search ×${explorationSummary.search}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex min-w-0 items-start gap-2">
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[color:var(--color-repl-border)] bg-[var(--color-repl-header-bg)] text-[color:var(--color-repl-muted)]"
        title="工具调用"
        role="img"
        aria-label="工具调用"
      >
        <Wrench className="h-3.5 w-3.5" strokeWidth={1.8} />
      </div>
      <div className="repl-transcript min-w-0 flex-1 space-y-1">
        {explored ? (
          <div className={TOOL_CALL_FRAME_CLASS_NAME}>
            <button
              type="button"
              className={cn(
                TOOL_CALL_HEADER_CLASS_NAME,
                "w-full overflow-hidden text-left text-[13px] leading-[1.55] transition-colors hover:bg-[var(--color-repl-header-bg)]",
              )}
              onClick={() => setExploredExpanded((value) => !value)}
              aria-expanded={exploredExpanded}
              title={exploredExpanded ? "收起探索工具" : "展开探索工具"}
            >
              <span
                className={cn(
                  "mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full",
                  failed && "bg-[var(--color-repl-muted)]",
                  !failed && running && "animate-pulse bg-[var(--color-repl-muted)]",
                  !failed && !running && "bg-[var(--color-repl-success)]",
                )}
              />
              <span
                className={cn(
                  "shrink-0 font-semibold",
                  failed
                    ? "text-[color:var(--color-repl-muted)]"
                    : "text-[color:var(--color-repl-fg)]",
                )}
              >
                {running ? "Exploring" : "Explored"}
              </span>
              <span className="min-w-0 truncate text-[11px] text-[color:var(--color-repl-muted)]">
                {explorationCountText}
                {explorationSummary.failed > 0 ? (
                  <span className="text-[color:var(--color-repl-error)]">
                    {explorationCountText ? " · " : ""}Failed ×{explorationSummary.failed}
                  </span>
                ) : null}
              </span>
              <span className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[color:var(--color-repl-muted)] transition-colors hover:bg-white/10 hover:text-[color:var(--color-repl-fg)]">
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    !exploredExpanded && "-rotate-90",
                  )}
                />
              </span>
            </button>
          </div>
        ) : null}
        {explored && exploredExpanded ? (
          <div className="ml-[3px] space-y-1 border-l border-[color:var(--color-repl-muted)]/30 pl-2.5">
            {toolCalls.map((toolCall) => (
              <div key={toolCall.id} className="relative">
                <span
                  aria-hidden="true"
                  className="absolute -left-2.5 top-4 w-2.5 border-t border-[color:var(--color-repl-muted)]/30"
                />
                <ToolCallTree
                  toolCall={toolCall}
                  resultMap={resultMap}
                  childToolCallsByParent={childToolCallsByParent}
                  focusedToolUseId={focusedToolUseId}
                  defaultCollapsed
                />
              </div>
            ))}
          </div>
        ) : !explored ? (
          toolCalls.map((toolCall) => (
            <ToolCallTree
              key={toolCall.id}
              toolCall={toolCall}
              resultMap={resultMap}
              childToolCallsByParent={childToolCallsByParent}
              focusedToolUseId={focusedToolUseId}
            />
          ))
        ) : null}
      </div>
    </div>
  );
}

export function ToolCallGroup({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  embedded = false,
  focusedToolUseId,
}: Props) {
  const runs = groupToolCallsForDisplay(toolCalls);

  return (
    <div
      className={cn(
        "min-w-0 space-y-1.5",
        embedded ? "w-full max-w-full" : "max-w-[796px]",
      )}
    >
      {runs.map((run) => (
        <ToolCallRun
          key={`${run.kind}-${run.toolCalls[0]?.id}`}
          toolCalls={run.toolCalls}
          resultMap={resultMap}
          childToolCallsByParent={childToolCallsByParent}
          focusedToolUseId={focusedToolUseId}
          explored={run.kind === "exploration"}
        />
      ))}
    </div>
  );
}
