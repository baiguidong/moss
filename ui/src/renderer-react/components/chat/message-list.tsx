"use client";

import * as React from "react";
import { ArrowDownToLine, ArrowUpToLine } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { cn } from "@/lib/utils";
import { AssistantMessage } from "@/components/chat/assistant-message";
import {
  ActivityGroup,
  type ActivityStep,
} from "@/components/chat/activity-group";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { ToolResultBlock } from "@/components/chat/tool-result-block";
import { UserMessage } from "@/components/chat/user-message";
import { TurnChangeCard } from "@/components/chat/turn-change-card";
import {
  buildConversationNavigationItems,
  ConversationNavigator,
  getActiveConversationNavigationItemId,
  type ConversationNavigationItem,
} from "@/components/chat/conversation-navigator";
import { WorkspacePathProvider } from "@/components/workspace-path-context";
import { extractShellResult, getToolKind } from "@/components/chat/tool-utils";
import type {
  ToolResultRenderMessage,
  ToolUseRenderMessage,
  TranscriptRenderMessage,
} from "@/lib/agent-transcript";
import type { TurnChangeSummary, TurnChangesPayload } from "../../types";

type RenderItem =
  | {
      kind: "tool_group";
      id: string;
      toolCalls: ToolUseRenderMessage[];
      steps: ActivityStep[];
      mergeable: boolean;
    }
  | {
      kind: "message";
      message: Exclude<TranscriptRenderMessage, ToolUseRenderMessage>;
    };

function getRenderItemTurnId(item: RenderItem): string | undefined {
  if (item.kind === "message") return item.message.turnId;
  for (const step of item.steps) {
    const turnId = step.kind === "thinking" ? step.message.turnId : step.toolCall.turnId;
    if (turnId) return turnId;
  }
  return undefined;
}

function getRenderItemId(item: RenderItem): string {
  return item.kind === "message" ? item.message.id : item.id;
}

function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

function appendChildToolCall(
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>,
  parentToolUseId: string,
  toolCall: ToolUseRenderMessage,
) {
  const current = childToolCallsByParent.get(parentToolUseId);
  if (current) {
    current.push(toolCall);
    return;
  }
  childToolCallsByParent.set(parentToolUseId, [toolCall]);
}

function buildSyntheticBashToolCall(
  message: TranscriptRenderMessage,
  status: ToolUseRenderMessage["status"] = "success",
): ToolUseRenderMessage {
  const command = message.type === "bash" ? message.command : undefined;
  return {
    id: `${message.id}-bash-tool`,
    timestamp: message.timestamp,
    type: "tool_use",
    role: "assistant",
    toolUseId: `synthetic-bash-${message.id}`,
    toolName: "Bash",
    displayName: "Bash",
    input: command ? { command } : undefined,
    inputText: command,
    status,
  };
}

export function buildRenderModel(messages: TranscriptRenderMessage[]) {
  const renderItems: RenderItem[] = [];
  const resultMap = new Map<string, ToolResultRenderMessage>();
  const childToolCallsByParent = new Map<string, ToolUseRenderMessage[]>();
  const toolUseIds = new Set<string>();
  let activeToolGroup: Extract<RenderItem, { kind: "tool_group" }> | null = null;

  const beginToolGroup = (id: string, mergeable: boolean) => {
    const group: Extract<RenderItem, { kind: "tool_group" }> = {
      kind: "tool_group",
      id: `group-${id}`,
      toolCalls: [],
      steps: [],
      mergeable,
    };
    activeToolGroup = group;
    renderItems.push(group);
  };

  const appendTopLevelToolCall = (toolCall: ToolUseRenderMessage) => {
    const mergeable = isMergeableActivityTool(toolCall);
    if (activeToolGroup && activeToolGroup.mergeable !== mergeable) activeToolGroup = null;
    if (!activeToolGroup) {
      beginToolGroup(toolCall.id, mergeable);
    }
    activeToolGroup!.toolCalls.push(toolCall);
    activeToolGroup!.steps.push({ kind: "tool", toolCall });
    if (!mergeable) activeToolGroup = null;
  };

  const appendThinking = (message: Extract<TranscriptRenderMessage, { type: "thinking" }>) => {
    if (!activeToolGroup || !activeToolGroup.mergeable) beginToolGroup(message.id, true);
    activeToolGroup!.steps.push({ kind: "thinking", message });
  };

  for (const message of messages) {
    if (message.type === "tool_use") {
      toolUseIds.add(message.toolUseId);
    } else if (message.type === "tool_result" && message.toolUseId) {
      resultMap.set(message.toolUseId, message);
    }
  }

  for (const message of messages) {
    if (message.type === "user_text") {
      activeToolGroup = null;
      renderItems.push({ kind: "message", message });
      continue;
    }

    if (message.type === "thinking") {
      appendThinking(message);
      continue;
    }

    if (message.type === "tool_result" && message.toolUseId && toolUseIds.has(message.toolUseId)) {
      continue;
    }

    if (message.type === "bash") {
      const failed = message.exitCode != null && message.exitCode !== 0;
      const toolCall = buildSyntheticBashToolCall(message, failed ? "error" : "success");
      appendTopLevelToolCall(toolCall);
      resultMap.set(toolCall.toolUseId, {
        id: `${message.id}-bash-result`,
        timestamp: message.timestamp,
        type: "tool_result",
        role: "assistant",
        toolUseId: toolCall.toolUseId,
        toolName: "Bash",
        content: message.output,
        rawContent: {
          stdout: message.output,
          stderr: "",
          exitCode: message.exitCode ?? undefined,
        },
        isError: failed,
      });
      continue;
    }

    if (message.type === "tool_result" && extractShellResult(message.rawContent)) {
      const toolCall = buildSyntheticBashToolCall(message, message.isError ? "error" : "success");
      appendTopLevelToolCall(toolCall);
      resultMap.set(toolCall.toolUseId, {
        ...message,
        toolUseId: toolCall.toolUseId,
        toolName: "Bash",
      });
      continue;
    }

    if (message.type === "tool_use") {
      if (message.parentToolUseId && toolUseIds.has(message.parentToolUseId)) {
        appendChildToolCall(childToolCallsByParent, message.parentToolUseId, message);
        continue;
      }

      appendTopLevelToolCall(message);
      continue;
    }

    // Unmatched tool results are internal output from a partially loaded
    // transcript. Do not promote their first line into a chat message.
    if (message.type === "tool_result") continue;

    activeToolGroup = null;
    renderItems.push({
      kind: "message",
      message,
    });
  }

  return { renderItems, resultMap, childToolCallsByParent };
}

export function isMergeableActivityTool(toolCall: ToolUseRenderMessage) {
  const normalized = toolCall.toolName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (getToolKind(toolCall.toolName, toolCall.input) === "agent") return false;
  return !normalized.includes("askuserquestion")
    && !normalized.includes("enterplanmode")
    && !normalized.includes("exitplanmode")
    && !normalized.includes("imagegen")
    && !normalized.includes("generateimage")
    && !normalized.includes("memory");
}

function BashCommandBlock({
  exitCode,
}: {
  command: string;
  output: string;
  exitCode: number | null;
}) {
  const failed = exitCode != null && exitCode !== 0;
  return (
    <div className="mb-1 flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-[13px] text-muted-foreground">
      <span
        className={
          failed
            ? "inline-block h-2 w-2 shrink-0 rounded-full bg-destructive"
            : "inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500"
        }
      />
      <span className="min-w-0 flex-1 truncate">Bash</span>
      {failed ? <span className="shrink-0 text-[10px] text-destructive">exit {exitCode}</span> : null}
    </div>
  );
}

function SystemMessage({
  content,
  meta,
  variant,
  status,
}: {
  content: string;
  meta?: string[];
  variant?: Extract<TranscriptRenderMessage, { type: "system" }>["variant"];
  status?: Extract<TranscriptRenderMessage, { type: "system" }>["status"];
}) {
  if (variant === "local_command") {
    return (
      <div className="flex justify-start gap-2" style={{ marginBottom: "var(--chat-message-spacing, 10px)" }}>
        <div className="max-w-[760px] rounded-xl border border-border/70 bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">本地命令</div>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{content}</pre>
        </div>
      </div>
    );
  }

  if (variant === "connector_auth") {
    return (
      <div className="flex justify-start gap-2" style={{ marginBottom: "var(--chat-message-spacing, 10px)" }}>
        <div className={cn(
          "max-w-[760px] rounded-xl border px-4 py-3 text-sm",
          status === "failed"
            ? "border-destructive/30 bg-destructive/8 text-destructive"
            : status === "success"
              ? "border-emerald-500/30 bg-emerald-500/8 text-foreground"
              : "border-border/70 bg-muted/35 text-muted-foreground",
        )}>
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">连接器授权</div>
          <div className="leading-relaxed">{content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center" style={{ marginBottom: "var(--chat-message-spacing, 10px)" }}>
      <div className="max-w-[760px] rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs text-muted-foreground">
        {content}
        {meta && meta.length > 0 ? ` · ${meta.join(" · ")}` : ""}
      </div>
    </div>
  );
}

function renderTranscriptItem(
  item: RenderItem,
  resultMap: Map<string, ToolResultRenderMessage>,
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>,
  focusedToolUseId?: string,
  isLive = false,
) {
  if (item.kind === "tool_group") {
    return (
      <div key={item.id} className="group min-w-0 w-full" style={{ marginBottom: "var(--chat-message-spacing, 10px)" }}>
        <ActivityGroup
          steps={item.steps}
          toolCalls={item.toolCalls}
          mergeable={item.mergeable}
          resultMap={resultMap}
          childToolCallsByParent={childToolCallsByParent}
          focusedToolUseId={focusedToolUseId}
          isLive={isLive}
        />
      </div>
    );
  }

  const message = item.message;
  if (message.type === "user_text") {
    return <UserMessage key={message.id} message={message} />;
  }
  if (message.type === "assistant_text") {
    return <AssistantMessage key={message.id} message={message} />;
  }
  if (message.type === "thinking") {
    return <ThinkingBlock key={message.id} content={message.content} isActive={Boolean(message.streaming)} />;
  }
  if (message.type === "tool_result") {
    return <ToolResultBlock key={message.id} result={message} />;
  }
  if (message.type === "system") {
    return <SystemMessage key={message.id} content={message.content} meta={message.meta} variant={message.variant} status={message.status} />;
  }
  if (message.type === "bash") {
    return (
      <BashCommandBlock
        key={message.id}
        command={message.command}
        output={message.output}
        exitCode={message.exitCode}
      />
    );
  }
  return null;
}

function formatLoadingElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatLoadingTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function LoadingIndicator({ startTime, tokens = 0 }: { startTime?: number; tokens?: number }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (startTime == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startTime]);
  const meta: string[] = [];
  if (startTime != null) meta.push(formatLoadingElapsed(now - startTime));
  if (tokens > 0) meta.push(`↓ ${formatLoadingTokens(tokens)} tokens`);
  return (
    <div className="flex justify-start gap-2">
      <img
        src="./build/icon.png"
        alt="Moss"
        className="h-7 w-7 shrink-0 self-start rounded-sm object-contain animate-spin"
        style={{ animationDuration: "2s" }}
      />
      <div className="flex items-center gap-2 rounded-[18px] rounded-tl-[8px] border border-border/70 bg-card/92 px-4 py-3 text-sm text-muted-foreground shadow-[0_18px_48px_-40px_rgba(0,0,0,0.75)]">
        <span>working...</span>
        {meta.length > 0 && (
          <span className="tabular-nums text-xs text-muted-foreground/70">{meta.join(" · ")}</span>
        )}
      </div>
    </div>
  );
}

function extractItemCopyText(item: RenderItem): string {
  if (item.kind === "tool_group") {
    return item.steps
      .map((step) => step.kind === "thinking"
        ? step.message.content
        : `${step.toolCall.displayName || step.toolCall.toolName}${step.toolCall.inputText ? `: ${step.toolCall.inputText}` : ""}`)
      .join("\n");
  }
  const message = item.message;
  switch (message.type) {
    case "user_text":
    case "assistant_text":
    case "thinking":
    case "system":
      return message.content;
    case "tool_result":
      return message.content;
    case "bash":
      return `$ ${message.command}\n${message.output}`;
    default:
      return "";
  }
}

type MessageContextMenuState = {
  x: number;
  y: number;
  messageText: string;
};

function MessageContextMenu({
  state,
  onClose,
}: {
  state: MessageContextMenuState;
  onClose: () => void;
}) {
  const selection = window.getSelection()?.toString() ?? "";
  const x = Math.min(state.x, window.innerWidth - 180);
  const y = Math.min(state.y, window.innerHeight - 96);
  const copy = (text: string) => {
    if (text) void navigator.clipboard.writeText(text);
    onClose();
  };
  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className="absolute w-40 overflow-hidden rounded-lg border border-border/70 bg-card/95 py-1 text-xs shadow-[0_8px_30px_-8px_rgba(0,0,0,0.5)] backdrop-blur"
        style={{ left: x, top: y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          disabled={!selection}
          className="block w-full px-3 py-1.5 text-left text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:text-muted-foreground/50"
          onClick={() => copy(selection)}
        >
          复制选中内容
        </button>
        <button
          type="button"
          disabled={!state.messageText}
          className="block w-full px-3 py-1.5 text-left text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:text-muted-foreground/50"
          onClick={() => copy(state.messageText)}
        >
          复制此消息
        </button>
      </div>
    </div>
  );
}

type VirtualListContext = {
  footer?: React.ReactNode;
  loading?: boolean;
  loadingStartTime?: number;
  loadingTokens?: number;
  contentClassName?: string;
};

function VirtuosoHeader() {
  return <div className="h-3" />;
}

function VirtuosoFooter({ context }: { context?: VirtualListContext }) {
  return (
    <div className={cn(
      "mx-auto w-full pb-4 pt-1",
      context?.contentClassName ?? "max-w-[1180px] px-3 sm:px-4",
    )}>
      {context?.loading && (
        <LoadingIndicator startTime={context.loadingStartTime} tokens={context.loadingTokens} />
      )}
      {context?.footer}
    </div>
  );
}

export type VirtualMessageListHandle = {
  scrollToTop: (behavior?: "auto" | "smooth") => void;
  scrollToBottom: (behavior?: "auto" | "smooth") => void;
  scrollToMessage: (messageId: string) => void;
  scrollToTool: (toolUseId: string) => void;
};

function toolTreeContains(
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

export function findToolRenderItemIndex(
  renderItems: RenderItem[],
  childToolCallsByParent: Map<string, ToolUseRenderMessage[]>,
  toolUseId: string,
) {
  return renderItems.findIndex((item) => {
    if (item.kind === "message") return false;
    return item.toolCalls.some((toolCall) => toolTreeContains(toolCall, toolUseId, childToolCallsByParent));
  });
}

export const VirtualMessageList = React.forwardRef<
  VirtualMessageListHandle,
  {
    messages: TranscriptRenderMessage[];
    workspace?: string;
    loading?: boolean;
    loadingStartTime?: number;
    loadingTokens?: number;
    footer?: React.ReactNode;
    emptyState?: React.ReactNode;
    onAtTopChange?: (atTop: boolean) => void;
    onAtBottomChange?: (atBottom: boolean) => void;
    focusedToolUseId?: string;
    contentClassName?: string;
    sessionId?: string;
  }
>(function VirtualMessageList(
  {
    messages,
    workspace,
    loading,
    loadingStartTime,
    loadingTokens,
    footer,
    emptyState,
    onAtTopChange,
    onAtBottomChange,
    focusedToolUseId,
    contentClassName,
    sessionId,
  },
  ref,
) {
  const { renderItems, resultMap, childToolCallsByParent } = React.useMemo(
    () => buildRenderModel(messages),
    [messages],
  );
  const virtuosoRef = React.useRef<VirtuosoHandle | null>(null);
  const atBottomRef = React.useRef(true);
  const renderItemsRef = React.useRef<RenderItem[]>(renderItems);
  renderItemsRef.current = renderItems;
  const [contextMenu, setContextMenu] = React.useState<MessageContextMenuState | null>(null);
  const [visibleStartIndex, setVisibleStartIndex] = React.useState(() => Math.max(0, renderItems.length - 1));
  const [highlightedMessageId, setHighlightedMessageId] = React.useState<string | null>(null);
  const highlightTimerRef = React.useRef<number | null>(null);
  const [turnChanges, setTurnChanges] = React.useState<Map<string, TurnChangeSummary>>(new Map());
  const [rewindSupport, setRewindSupport] = React.useState<TurnChangesPayload["rewind"]>({
    supported: false,
    reason: "当前会话不支持撤销。",
  });

  React.useEffect(() => {
    if (!sessionId) {
      setTurnChanges(new Map());
      return;
    }
    if (loading) return;
    let cancelled = false;
    void window.agentDesktop.getTurnChanges({ sessionId }).then((payload) => {
      if (cancelled) return;
      setTurnChanges(new Map(payload.turns.map((turn) => [turn.userMessageId, turn])));
      setRewindSupport(payload.rewind);
    }).catch(() => {
      if (!cancelled) setTurnChanges(new Map());
    });
    return () => {
      cancelled = true;
    };
  }, [loading, messages, sessionId]);

  const lastRenderItemByTurn = React.useMemo(() => {
    const result = new Map<string, string>();
    for (const item of renderItems) {
      const turnId = getRenderItemTurnId(item);
      if (turnId) result.set(turnId, getRenderItemId(item));
    }
    return result;
  }, [renderItems]);

  const conversationNavigationItems = React.useMemo(() => buildConversationNavigationItems(
    renderItems.flatMap((item, renderIndex) => (
      item.kind === "message" && item.message.type === "user_text"
        ? [{
            id: item.message.id,
            content: item.message.content || item.message.attachments
              ?.map((attachment) => attachment.name || attachment.path.split(/[\\/]/).at(-1) || attachment.path)
              .join(", ") || "",
            renderIndex,
            attachmentCount: item.message.attachments?.length || 0,
          }]
        : []
    )),
  ), [renderItems]);
  const activeConversationItemId = getActiveConversationNavigationItemId(
    conversationNavigationItems,
    visibleStartIndex,
  );
  const resolvedContentClassName = cn(
    contentClassName ?? "max-w-[1180px] px-3 sm:px-4",
    conversationNavigationItems.length >= 4 && "md:px-12",
  );

  React.useEffect(() => () => {
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
  }, []);

  const scrollToTop = React.useCallback((behavior: "auto" | "smooth" = "smooth") => {
    virtuosoRef.current?.scrollToIndex({ index: 0, align: "start", behavior });
  }, []);

  const scrollToBottom = React.useCallback((behavior: "auto" | "smooth" = "smooth") => {
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior,
    });
  }, []);

  const scrollToMessage = React.useCallback((messageId: string) => {
    let resolvedMessageId: string | null = null;
    const matches = (message: TranscriptRenderMessage) => {
      const matched = message.id === messageId || message.sourceMessageIds?.includes(messageId);
      if (matched) resolvedMessageId = message.id;
      return matched;
    };
    const index = renderItemsRef.current.findIndex((item) =>
      item.kind === "message"
        ? matches(item.message)
        : item.steps.some((step) => (
          step.kind === "thinking" ? matches(step.message) : matches(step.toolCall)
        )));
    if (index >= 0) {
      setHighlightedMessageId(resolvedMessageId);
      virtuosoRef.current?.scrollToIndex({ index, align: "start", behavior: "smooth" });
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => {
        setHighlightedMessageId((current) => current === resolvedMessageId ? null : current);
        highlightTimerRef.current = null;
      }, 1800);
    }
  }, []);

  const scrollToTool = React.useCallback((toolUseId: string) => {
    const index = findToolRenderItemIndex(renderItemsRef.current, childToolCallsByParent, toolUseId);
    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" });
    }
  }, [childToolCallsByParent]);

  const navigateToConversationItem = React.useCallback((item: ConversationNavigationItem) => {
    setHighlightedMessageId(item.id);
    virtuosoRef.current?.scrollToIndex({
      index: item.renderIndex,
      align: "start",
      behavior: Math.abs(item.renderIndex - visibleStartIndex) <= 8 ? "smooth" : "auto",
    });
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId((current) => current === item.id ? null : current);
      highlightTimerRef.current = null;
    }, 1400);
  }, [visibleStartIndex]);

  React.useImperativeHandle(ref, () => ({
    scrollToTop,
    scrollToBottom,
    scrollToMessage,
    scrollToTool,
  }), [scrollToBottom, scrollToMessage, scrollToTool, scrollToTop]);

  // followOutput only reacts to item-count changes; streaming grows the last
  // item's content without adding items, so keep following manually while the
  // user is at the bottom.
  React.useEffect(() => {
    if (atBottomRef.current) {
      const timer = window.setTimeout(() => {
        if (atBottomRef.current) scrollToBottom("auto");
      }, 50);
      return () => window.clearTimeout(timer);
    }
  }, [messages, loading, scrollToBottom]);

  if (renderItems.length === 0) {
    return (
      <WorkspacePathProvider workspace={workspace || ""}>
        <div className={cn(
          "mx-auto w-full py-3",
          contentClassName ?? "max-w-[1180px] px-3 sm:px-4",
        )}>
          {emptyState || (
            <div className="rounded-[24px] border border-dashed border-border/70 bg-card/50 px-4 py-6 text-sm text-muted-foreground">
              暂无消息
            </div>
          )}
          {loading && <LoadingIndicator startTime={loadingStartTime} tokens={loadingTokens} />}
          {footer}
        </div>
      </WorkspacePathProvider>
    );
  }

  return (
    <WorkspacePathProvider workspace={workspace || ""}>
      {contextMenu && (
        <MessageContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      )}
      <Virtuoso<RenderItem, VirtualListContext>
        ref={virtuosoRef}
        className="h-full min-w-0"
        data={renderItems}
        computeItemKey={(_index, item) => (item.kind === "tool_group" ? item.id : item.message.id)}
        context={{
          footer,
          loading,
          loadingStartTime,
          loadingTokens,
          contentClassName: resolvedContentClassName,
        }}
        followOutput={(isAtBottom) => (isAtBottom ? "auto" : false)}
        atTopStateChange={onAtTopChange}
        atBottomThreshold={120}
        atBottomStateChange={(atBottom) => {
          atBottomRef.current = atBottom;
          onAtBottomChange?.(atBottom);
        }}
        rangeChanged={(range) => setVisibleStartIndex(range.startIndex)}
        initialTopMostItemIndex={Math.max(0, renderItems.length - 1)}
        increaseViewportBy={{ top: 400, bottom: 400 }}
        components={{ Header: VirtuosoHeader, Footer: VirtuosoFooter }}
        itemContent={(index, item) => {
          const turnId = getRenderItemTurnId(item);
          const turnChange = turnId ? turnChanges.get(turnId) : undefined;
          const showTurnChange = Boolean(
            sessionId
            && turnId
            && turnChange
            && lastRenderItemByTurn.get(turnId) === getRenderItemId(item),
          );
          return (
          <div
            data-chat-message-list
            className={cn(
              "mx-auto w-full min-w-0 rounded-lg py-0.5 transition-[background-color,box-shadow] duration-300",
              item.kind === "message"
                && item.message.id === highlightedMessageId
                && "bg-[#a24632]/6 shadow-[inset_3px_0_0_#a24632] dark:bg-[#ef8d78]/8 dark:shadow-[inset_3px_0_0_#ef8d78]",
              resolvedContentClassName,
            )}
            onContextMenu={(e) => {
              const selection = window.getSelection()?.toString() ?? "";
              const messageText = extractItemCopyText(item);
              if (!selection && !messageText) return;
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, messageText });
            }}
          >
            {renderTranscriptItem(
              item,
              resultMap,
              childToolCallsByParent,
              focusedToolUseId,
              Boolean(loading && index === renderItems.length - 1),
            )}
            {showTurnChange && turnChange ? (
              <TurnChangeCard
                sessionId={sessionId}
                change={turnChange}
                rewindSupported={rewindSupport.supported}
                rewindDisabledReason={rewindSupport.reason}
              />
            ) : null}
          </div>
          );
        }}
      />
      <ConversationNavigator
        items={conversationNavigationItems}
        activeItemId={activeConversationItemId}
        onNavigate={navigateToConversationItem}
      />
    </WorkspacePathProvider>
  );
});

// Shared message-region shell: the virtual list plus the "back to bottom"
// affordance. Used by the main chat, the inline worker panel, and the detached
// execution window so all three scroll and behave identically.
export const MessageListPane = React.forwardRef<
  VirtualMessageListHandle,
  {
    messages: TranscriptRenderMessage[];
    workspace?: string;
    loading?: boolean;
    loadingStartTime?: number;
    loadingTokens?: number;
    footer?: React.ReactNode;
    emptyState?: React.ReactNode;
    focusedToolUseId?: string;
    className?: string;
    contentClassName?: string;
    sessionId?: string;
  }
>(function MessageListPane({ className, ...listProps }, ref) {
  const innerRef = React.useRef<VirtualMessageListHandle>(null);
  React.useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior) => innerRef.current?.scrollToTop(behavior),
      scrollToBottom: (behavior) => innerRef.current?.scrollToBottom(behavior),
      scrollToMessage: (messageId) => innerRef.current?.scrollToMessage(messageId),
      scrollToTool: (toolUseId) => innerRef.current?.scrollToTool(toolUseId),
    }),
    [],
  );
  const [atTop, setAtTop] = React.useState(false);
  const [atBottom, setAtBottom] = React.useState(true);
  const longConversation = React.useMemo(
    () => listProps.messages.filter((message) => (
      message.type === "user_text"
      && Boolean(message.content.trim() || message.attachments?.length)
    )).length >= 4,
    [listProps.messages],
  );

  return (
    <div className={cn("relative min-h-0 min-w-0", className)}>
      <VirtualMessageList
        ref={innerRef}
        onAtTopChange={setAtTop}
        onAtBottomChange={setAtBottom}
        {...listProps}
      />
      {longConversation && (!atTop || !atBottom) ? (
        <div
          className="absolute bottom-4 z-30 flex flex-col items-center gap-2"
          style={{ right: "max(0.75rem, calc((100% - 1200px) / 2))" }}
        >
          {!atTop ? (
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/92 text-muted-foreground shadow-lg backdrop-blur transition-all hover:-translate-y-px hover:text-foreground"
              title="回到顶部"
              aria-label="回到顶部"
              onClick={() => innerRef.current?.scrollToTop("auto")}
            >
              <ArrowUpToLine className="h-4 w-4" />
            </button>
          ) : null}
          {!atBottom ? (
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/92 text-muted-foreground shadow-lg backdrop-blur transition-all hover:-translate-y-px hover:text-foreground"
              title="回到底部"
              aria-label="回到底部"
              onClick={() => innerRef.current?.scrollToBottom("auto")}
            >
              <ArrowDownToLine className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export function MessageList({
  messages,
  bottomRef,
  emptyState,
  workspace,
  loading,
}: {
  messages: TranscriptRenderMessage[];
  bottomRef?: React.RefObject<HTMLDivElement | null>;
  emptyState?: React.ReactNode;
  workspace?: string;
  loading?: boolean;
}) {
  const { renderItems, resultMap, childToolCallsByParent } = React.useMemo(
    () => buildRenderModel(messages),
    [messages],
  );

  React.useEffect(() => {
    const bottom = bottomRef?.current;
    if (!bottom) return;
    const scroller = getScrollParent(bottom);
    if (scroller) {
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      // User has scrolled up to read history — don't yank them back to the bottom.
      if (distanceFromBottom > 160) return;
    }
    bottom.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [bottomRef, messages]);

  return (
    <WorkspacePathProvider workspace={workspace || ""}>
    <div className="mx-auto flex w-full max-w-[1180px] min-w-0 flex-col gap-1 px-3 py-3 sm:px-4 sm:py-4">
      {renderItems.length > 0 ? (
        renderItems.map((item) => renderTranscriptItem(item, resultMap, childToolCallsByParent))
      ) : (
        emptyState || (
          <div className="rounded-[24px] border border-dashed border-border/70 bg-card/50 px-4 py-6 text-sm text-muted-foreground">
            暂无消息
          </div>
        )
      )}

      {loading && <LoadingIndicator />}

      {bottomRef ? <div ref={bottomRef} /> : null}
    </div>
    </WorkspacePathProvider>
  );
}
