"use client";

import * as React from "react";
import {
  Bot,
  Copy,
  Loader,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ToolSteps } from "@/components/tool-steps";
import { FilePreview } from "@/components/file-preview";
import { MarkdownView } from "@/components/markdown-view";
import type { ChatMessage } from "@/lib/agent-transcript";

function ThinkingBlock({
  thinking,
  streaming,
}: {
  thinking: string;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(true);

  React.useEffect(() => {
    if (streaming) {
      setExpanded(true);
    }
  }, [streaming]);

  return (
    <div className="overflow-hidden rounded-[24px] border border-border/80 bg-card/75 shadow-[0_14px_45px_-36px_rgba(0,0,0,0.8)]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 border-b border-border/70 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            思考过程
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {streaming ? "正在生成思考内容" : "展示模型返回的 thinking 内容块"}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{expanded ? "收起" : "展开"}</span>
      </button>

      {expanded && (
        <div className="max-h-[22rem] overflow-auto px-4 py-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-foreground">
            {thinking}
          </pre>
        </div>
      )}
    </div>
  );
}

export function MessageBubble({ message, sessionBusy }: { message: ChatMessage; sessionBusy?: boolean }) {
  const isUser = message.role === "user";
  const hasBody = Boolean(message.content.trim());
  const hasThinking = Boolean(message.thinking?.trim());
  const hasImages = message.images && message.images.length > 0;
  const hasFiles = message.files && message.files.length > 0;

  const [iconSrc, setIconSrc] = React.useState<string | null>(null);

  // AI is actively working: session is busy, streaming, thinking, or tools running
  const isBusy = sessionBusy || message.streaming || Boolean(message.thinking) ||
    ((message.toolSteps?.length ?? 0) > 0 && !message.toolsComplete);

  React.useEffect(() => {
    if (isUser) return;
    if (iconSrc) return;
    window.agentDesktop.fs.getAppIcon().then((icon) => {
      if (icon) setIconSrc(icon);
    }).catch(() => {});
  }, [isUser]);

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      {!isUser && (
        <Avatar className={cn("h-9 w-9 shrink-0", isUser ? "bg-primary" : "bg-secondary")}>
          <AvatarFallback
            className={cn(
              "text-xs",
              isUser
                ? "bg-primary text-primary-foreground"
                : "bg-gradient-to-br from-primary/25 to-primary/10 text-primary",
            )}
          >
            {isUser ? (
              <User className="h-4 w-4" />
            ) : iconSrc ? (
              <img src={iconSrc} alt="Moss" className={cn("size-full object-cover rounded-full", isBusy && "animate-spin")} />
            ) : (
              <Bot className={cn("h-4 w-4", isBusy && "animate-spin")} />
            )}
          </AvatarFallback>
        </Avatar>
      )}
      <div
        className={cn(
          "space-y-3",
          isUser
            ? "max-w-[78%] flex flex-col items-end"
            : message.toolSteps?.length
              ? "w-full max-w-4xl"
              : "max-w-[82%]",
        )}
      >
        {!isUser && message.toolSteps && message.toolSteps.length > 0 && (
          <ToolSteps steps={message.toolSteps} isComplete={message.toolsComplete} />
        )}

        {!isUser && hasThinking && (
          <ThinkingBlock thinking={message.thinking!} streaming={message.streaming} />
        )}

        {(hasImages || hasFiles) && (
          <div className="flex flex-wrap gap-2">
            {message.images?.map((imgPath, i) => (
              <FilePreview key={`img-${i}`} path={imgPath} readonly />
            ))}
            {message.files?.map((filePath, i) => (
              <FilePreview key={`file-${i}`} path={filePath} readonly />
            ))}
          </div>
        )}

        {(hasBody || isUser || message.streaming) && (
          <div className="group relative">
            <div
              className={cn(
                "rounded-[24px] px-4 py-3 text-sm leading-relaxed shadow-[0_18px_55px_-40px_rgba(0,0,0,0.85)]",
                isUser
                  ? "rounded-tr-md bg-primary text-primary-foreground"
                  : "rounded-tl-md border border-border/70 bg-card/88 text-foreground",
              )}
            >
              <div className="space-y-3">
                {hasBody ? (
                  isUser ? (
                    <p className="whitespace-pre-wrap break-words leading-7">{message.content}</p>
                  ) : (
                    <MarkdownView>{message.content}</MarkdownView>
                  )
                ) : (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader className={cn("h-3.5 w-3.5 animate-spin", message.streaming ? "opacity-100" : "opacity-60")} />
                    <span>Working...</span>
                  </div>
                )}

                {message.meta && message.meta.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {message.meta.map((entry) => (
                      <span
                        key={entry}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px]",
                          isUser
                            ? "border-primary-foreground/20 text-primary-foreground/75"
                            : "border-border bg-background/60 text-muted-foreground",
                        )}
                      >
                        {entry}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {isUser && hasBody && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(message.content);
                }}
                className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-primary-foreground/20"
                title="复制"
              >
                <Copy className="h-3.5 w-3.5 text-primary-foreground/80" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatTranscript({
  messages,
  bottomRef,
  emptyState,
  sessionBusy,
}: {
  messages: ChatMessage[];
  bottomRef?: React.RefObject<HTMLDivElement | null>;
  emptyState?: React.ReactNode;
  sessionBusy?: boolean;
}) {
  const isLastAssistant = (index: number) => {
    if (!sessionBusy) return false;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        return i === index;
      }
    }
    return false;
  };

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5 px-3 py-3 sm:px-4 sm:py-4">
      {messages.length > 0
        ? messages.map((message, index) => <MessageBubble key={message.id} message={message} sessionBusy={isLastAssistant(index)} />)
        : emptyState ?? (
            <div className="rounded-[24px] border border-dashed border-border/70 bg-card/50 px-4 py-6 text-sm text-muted-foreground">
              暂无消息
            </div>
          )}
      {bottomRef ? <div ref={bottomRef} /> : null}
    </div>
  );
}
