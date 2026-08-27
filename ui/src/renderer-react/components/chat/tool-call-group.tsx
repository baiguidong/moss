"use client";

import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolCallBlock } from "@/components/chat/tool-call-block";
import type { ToolResultRenderMessage, ToolUseRenderMessage } from "@/lib/agent-transcript";

type Props = {
  toolCalls: ToolUseRenderMessage[];
  resultMap: Map<string, ToolResultRenderMessage>;
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>;
  embedded?: boolean;
  focusedToolUseId?: string;
};

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
}: {
  toolCall: ToolUseRenderMessage;
  resultMap: Map<string, ToolResultRenderMessage>;
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>;
  focusedToolUseId?: string;
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
    >
      {children.length > 0 ? (
        <div className="border-l border-[color:var(--color-repl-muted)]/35 pl-2.5">
          <div className="space-y-2">
            {children.map((child) => (
              <ToolCallTree
                key={child.id}
                toolCall={child}
                resultMap={resultMap}
                childToolCallsByParent={childToolCallsByParent}
                focusedToolUseId={focusedToolUseId}
              />
            ))}
          </div>
        </div>
      ) : null}
    </ToolCallBlock>
  );
}

export function ToolCallGroup({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  embedded = false,
  focusedToolUseId,
}: Props) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2",
        embedded ? "w-full max-w-full" : "max-w-[796px]",
      )}
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[color:var(--color-repl-border)] bg-[var(--color-repl-header-bg)] text-[color:var(--color-repl-muted)]"
        title="工具调用"
        role="img"
        aria-label="工具调用"
      >
        <Wrench className="h-3.5 w-3.5" strokeWidth={1.8} />
      </div>
      <div className="repl-transcript min-w-0 flex-1 space-y-2.5">
        {toolCalls.map((toolCall) => (
          <ToolCallTree
            key={toolCall.id}
            toolCall={toolCall}
            resultMap={resultMap}
            childToolCallsByParent={childToolCallsByParent}
            focusedToolUseId={focusedToolUseId}
          />
        ))}
      </div>
    </div>
  );
}
