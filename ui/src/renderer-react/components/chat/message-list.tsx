"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { cn } from "@/lib/utils";
import { AssistantMessage } from "@/components/chat/assistant-message";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { collectFileChanges, FileChangeChips, ToolCallGroup } from "@/components/chat/tool-call-group";
import { ToolResultBlock } from "@/components/chat/tool-result-block";
import { UserMessage } from "@/components/chat/user-message";
import { WorkspacePathProvider } from "@/components/workspace-path-context";
import type {
  ToolResultRenderMessage,
  ToolUseRenderMessage,
  TranscriptRenderMessage,
} from "@/lib/agent-transcript";

type RenderItem =
  | {
      kind: "tool_group";
      id: string;
      toolCalls: ToolUseRenderMessage[];
    }
  | {
      kind: "message";
      message: Exclude<TranscriptRenderMessage, ToolUseRenderMessage>;
    };

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

function buildRenderModel(messages: TranscriptRenderMessage[]) {
  const renderItems: RenderItem[] = [];
  const resultMap = new Map<string, ToolResultRenderMessage>();
  const childToolCallsByParent = new Map<string, ToolUseRenderMessage[]>();
  const toolUseIds = new Set<string>();
  let pendingToolCalls: ToolUseRenderMessage[] = [];
  const inlineParentToolUseIds = new Set<string>();

  const flushGroup = (resetInlineParents = false) => {
    if (pendingToolCalls.length > 0) {
      renderItems.push({
        kind: "tool_group",
        id: `group-${pendingToolCalls[0]!.id}`,
        toolCalls: [...pendingToolCalls],
      });
      for (const toolCall of pendingToolCalls) {
        inlineParentToolUseIds.add(toolCall.toolUseId);
      }
      pendingToolCalls = [];
    }

    if (resetInlineParents) {
      inlineParentToolUseIds.clear();
    }
  };

  for (const message of messages) {
    if (message.type === "tool_use") {
      toolUseIds.add(message.toolUseId);
    } else if (message.type === "tool_result" && message.toolUseId) {
      resultMap.set(message.toolUseId, message);
    }
  }

  for (const message of messages) {
    if (message.type === "tool_result" && message.toolUseId && toolUseIds.has(message.toolUseId)) {
      continue;
    }

    if (message.type === "tool_use") {
      const parentPending = message.parentToolUseId
        ? pendingToolCalls.some((toolCall) => toolCall.toolUseId === message.parentToolUseId)
        : false;

      if (message.parentToolUseId && (inlineParentToolUseIds.has(message.parentToolUseId) || parentPending)) {
        flushGroup();
        appendChildToolCall(childToolCallsByParent, message.parentToolUseId, message);
        inlineParentToolUseIds.add(message.toolUseId);
        continue;
      }

      pendingToolCalls.push(message);
      continue;
    }

    flushGroup(true);
    renderItems.push({
      kind: "message",
      message,
    });
  }

  flushGroup();
  return { renderItems, resultMap, childToolCallsByParent };
}

function BashCommandBlock({
  command,
  output,
  exitCode,
}: {
  command: string;
  output: string;
  exitCode: number | null;
}) {
  const failed = exitCode != null && exitCode !== 0;
  return (
    <div className="mb-4 flex justify-end">
      <div className="w-full max-w-[760px] overflow-hidden rounded-[18px] rounded-tr-[8px] border border-border/70 bg-card/92 font-mono text-xs shadow-[0_18px_48px_-40px_rgba(0,0,0,0.75)]">
        <div className="flex items-center gap-2 border-b border-border/50 bg-muted/40 px-3 py-1.5 text-muted-foreground">
          <span className="text-green-500">$</span>
          <span className="min-w-0 flex-1 truncate text-foreground">{command}</span>
          {failed && <span className="shrink-0 text-destructive">exit {exitCode}</span>}
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {output.trim() ? output : "（无输出）"}
        </pre>
      </div>
    </div>
  );
}

function SystemMessage({
  content,
  meta,
}: {
  content: string;
  meta?: string[];
}) {
  return (
    <div className="mb-4 flex justify-center">
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
) {
  if (item.kind === "tool_group") {
    return (
      <ToolCallGroup
        key={item.id}
        toolCalls={item.toolCalls}
        resultMap={resultMap}
        childToolCallsByParent={childToolCallsByParent}
        isStreaming={item.toolCalls.some((toolCall) => toolCall.status === "running" || toolCall.status === "pending")}
      />
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
    return <SystemMessage key={message.id} content={message.content} meta={message.meta} />;
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

function LoadingIndicator() {
  return (
    <div className="flex justify-start gap-2">
      <img
        src="./build/icon.png"
        alt="Moss"
        className="h-7 w-7 shrink-0 self-start rounded-sm object-contain animate-spin"
        style={{ animationDuration: "2s" }}
      />
      <div className="rounded-[18px] rounded-tl-[8px] border border-border/70 bg-card/92 px-4 py-3 text-sm text-muted-foreground shadow-[0_18px_48px_-40px_rgba(0,0,0,0.75)]">
        working...
      </div>
    </div>
  );
}

const TIME_SEPARATOR_GAP_MS = 10 * 60 * 1000;

function itemTimestamp(item: RenderItem): Date | null {
  if (item.kind === "message") return item.message.timestamp ?? null;
  return item.toolCalls[0]?.timestamp ?? null;
}

function formatSeparatorTime(date: Date) {
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return hm;
  const sameYear = date.getFullYear() === now.getFullYear();
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  return sameYear ? `${md} ${hm}` : `${date.getFullYear()}年${md} ${hm}`;
}

function TimeSeparator({ date }: { date: Date }) {
  return (
    <div className="flex justify-center py-2">
      <span className="rounded-full bg-muted/50 px-2.5 py-0.5 text-[10px] text-muted-foreground/80">
        {formatSeparatorTime(date)}
      </span>
    </div>
  );
}

function extractItemCopyText(item: RenderItem): string {
  if (item.kind === "tool_group") {
    return item.toolCalls
      .map((toolCall) => `${toolCall.displayName || toolCall.toolName}${toolCall.inputText ? `: ${toolCall.inputText}` : ""}`)
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
};

function VirtuosoHeader() {
  return <div className="h-3" />;
}

function VirtuosoFooter({ context }: { context?: VirtualListContext }) {
  return (
    <div className="mx-auto w-full max-w-[980px] px-3 pb-4 pt-1 sm:px-4">
      {context?.loading && <LoadingIndicator />}
      {context?.footer}
    </div>
  );
}

export type VirtualMessageListHandle = {
  scrollToBottom: (behavior?: "auto" | "smooth") => void;
  scrollToMessage: (messageId: string) => void;
};

export const VirtualMessageList = React.forwardRef<
  VirtualMessageListHandle,
  {
    messages: TranscriptRenderMessage[];
    workspace?: string;
    loading?: boolean;
    footer?: React.ReactNode;
    emptyState?: React.ReactNode;
    onAtBottomChange?: (atBottom: boolean) => void;
    hideToolCalls?: boolean;
  }
>(function VirtualMessageList(
  { messages, workspace, loading, footer, emptyState, onAtBottomChange, hideToolCalls },
  ref,
) {
  const { renderItems: allRenderItems, resultMap, childToolCallsByParent } = React.useMemo(
    () => buildRenderModel(messages),
    [messages],
  );

  // Tool-noise toggle: drop tool results and thinking, keep tool groups only
  // when they produced file changes (rendered as chips).
  const renderItems = React.useMemo(() => {
    if (!hideToolCalls) return allRenderItems;
    return allRenderItems.filter((item) => {
      if (item.kind === "tool_group") {
        return collectFileChanges(item.toolCalls, childToolCallsByParent).length > 0;
      }
      return item.message.type !== "tool_result" && item.message.type !== "thinking";
    });
  }, [allRenderItems, childToolCallsByParent, hideToolCalls]);
  const virtuosoRef = React.useRef<VirtuosoHandle | null>(null);
  const atBottomRef = React.useRef(true);
  const renderItemsRef = React.useRef<RenderItem[]>(renderItems);
  renderItemsRef.current = renderItems;
  const [contextMenu, setContextMenu] = React.useState<MessageContextMenuState | null>(null);

  const scrollToBottom = React.useCallback((behavior: "auto" | "smooth" = "smooth") => {
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior,
    });
  }, []);

  const scrollToMessage = React.useCallback((messageId: string) => {
    const index = renderItemsRef.current.findIndex((item) =>
      item.kind === "message"
        ? item.message.id === messageId
        : item.toolCalls.some((toolCall) => toolCall.id === messageId));
    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex({ index, align: "start", behavior: "smooth" });
    }
  }, []);

  React.useImperativeHandle(ref, () => ({ scrollToBottom, scrollToMessage }), [scrollToBottom, scrollToMessage]);

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
        <div className="mx-auto w-full max-w-[980px] px-3 py-3 sm:px-4">
          {emptyState || (
            <div className="rounded-[24px] border border-dashed border-border/70 bg-card/50 px-4 py-6 text-sm text-muted-foreground">
              暂无消息
            </div>
          )}
          {loading && <LoadingIndicator />}
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
        context={{ footer, loading }}
        followOutput={(isAtBottom) => (isAtBottom ? "auto" : false)}
        atBottomThreshold={120}
        atBottomStateChange={(atBottom) => {
          atBottomRef.current = atBottom;
          onAtBottomChange?.(atBottom);
        }}
        initialTopMostItemIndex={Math.max(0, renderItems.length - 1)}
        increaseViewportBy={{ top: 400, bottom: 400 }}
        components={{ Header: VirtuosoHeader, Footer: VirtuosoFooter }}
        itemContent={(index, item) => {
          const ts = itemTimestamp(item);
          const prevTs = index > 0 ? itemTimestamp(renderItems[index - 1]!) : null;
          const showSeparator = Boolean(
            ts && prevTs && ts.getTime() - prevTs.getTime() > TIME_SEPARATOR_GAP_MS,
          );
          return (
            <div
              className="mx-auto w-full max-w-[980px] min-w-0 px-3 py-0.5 sm:px-4"
              onContextMenu={(e) => {
                const selection = window.getSelection()?.toString() ?? "";
                const messageText = extractItemCopyText(item);
                if (!selection && !messageText) return;
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, messageText });
              }}
            >
              {showSeparator && ts && <TimeSeparator date={ts} />}
              {hideToolCalls && item.kind === "tool_group" ? (
                <FileChangeChips changes={collectFileChanges(item.toolCalls, childToolCallsByParent)} />
              ) : (
                renderTranscriptItem(item, resultMap, childToolCallsByParent)
              )}
            </div>
          );
        }}
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
    footer?: React.ReactNode;
    emptyState?: React.ReactNode;
    hideToolCalls?: boolean;
    className?: string;
  }
>(function MessageListPane({ className, ...listProps }, ref) {
  const innerRef = React.useRef<VirtualMessageListHandle>(null);
  React.useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior) => innerRef.current?.scrollToBottom(behavior),
      scrollToMessage: (messageId) => innerRef.current?.scrollToMessage(messageId),
    }),
    [],
  );
  const [atBottom, setAtBottom] = React.useState(true);

  return (
    <div className={cn("relative min-h-0 min-w-0", className)}>
      <VirtualMessageList ref={innerRef} onAtBottomChange={setAtBottom} {...listProps} />
      {!atBottom && (
        <button
          type="button"
          className="absolute bottom-4 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border/70 bg-card/95 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground"
          title="回到底部"
          onClick={() => innerRef.current?.scrollToBottom("smooth")}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
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
    <div className="mx-auto flex w-full max-w-[980px] min-w-0 flex-col gap-1 px-3 py-3 sm:px-4 sm:py-4">
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
