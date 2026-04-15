"use client";

import * as React from "react";
import { Send, Paperclip, Mic, Sparkles, Bot, User, Square, MonitorPlay, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ToolSteps } from "@/components/tool-steps";
import type { ChatMessage } from "@/lib/agent-transcript";
import type { StoredApp } from "../types";

function ThinkingBlock({
  thinking,
  streaming,
}: {
  thinking: string;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const wasStreamingRef = React.useRef(Boolean(streaming));
  const autoCollapsedRef = React.useRef(false);

  React.useEffect(() => {
    if (streaming) {
      autoCollapsedRef.current = false;
      setExpanded(true);
    }
  }, [streaming]);

  React.useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = Boolean(streaming);

    if (streaming) return;
    if (!wasStreaming || autoCollapsedRef.current) return;

    // 当流式结束时，我们不再自动折叠，而是让它保持展开，
    // 类似于 tool steps 的逻辑，或者保持一个默认状态
    // const timer = window.setTimeout(() => {
    //   autoCollapsedRef.current = true;
    //   setExpanded(false);
    // }, 600);

    // return () => window.clearTimeout(timer);
  }, [streaming, thinking]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/70">
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

function renderTextSegments(content: string) {
  const normalized = content.trim();
  if (!normalized) return null;

  // 这里的正则改为不分大小写
  const fenceRegex = /```([\w-]*)\n?([\s\S]*?)```/gi;
  const segments: Array<{ type: "text" | "code"; value: string; language?: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(normalized))) {
    const textBefore = normalized.slice(lastIndex, match.index).trim();
    if (textBefore) {
      segments.push({ type: "text", value: textBefore });
    }

    const langPart = (match[1] || "").toLowerCase();
    // 增强过滤：支持 html, htm 以及带参数的代码块标签
    if (langPart.startsWith("html") || langPart.startsWith("htm") || langPart === "app-meta") {
      // 跳过，不推入 segments
    } else {
      segments.push({
        type: "code",
        language: match[1] || "",
        value: match[2].trimEnd(),
      });
    }
    lastIndex = match.index + match[0].length;
  }

  const trailing = normalized.slice(lastIndex).trim();
  if (trailing) {
    segments.push({ type: "text", value: trailing });
  }

  if (segments.length === 0) return null;

  return segments.map((segment, index) => {
    if (segment.type === "code") {
      return (
        <div key={`${segment.type}-${index}`} className="overflow-hidden rounded-xl border border-border/70 bg-background/70">
          {segment.language && (
            <div className="border-b border-border/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {segment.language}
            </div>
          )}
          <pre className="overflow-x-auto p-3 text-[12px] leading-6 text-foreground">
            <code>{segment.value}</code>
          </pre>
        </div>
      );
    }

    return segment.value
      .split(/\n{2,}/)
      .map((paragraph, paragraphIndex) => (
        <p
          key={`${segment.type}-${index}-${paragraphIndex}`}
          className="whitespace-pre-wrap break-words leading-7"
        >
          {paragraph.trim()}
        </p>
      ));
  });
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const hasBody = Boolean(message.content.trim());
  const hasThinking = Boolean(message.thinking?.trim());

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <Avatar className={cn("h-8 w-8 shrink-0", isUser ? "bg-primary" : "bg-secondary")}>
        <AvatarFallback
          className={cn(
            "text-xs",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-gradient-to-br from-primary/20 to-primary/10 text-primary"
          )}
        >
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          "space-y-2",
          isUser
            ? "max-w-[78%] flex flex-col items-end"
            : message.toolSteps?.length
            ? "w-full max-w-4xl"
            : "max-w-[78%]"
        )}
      >
        {!isUser && message.toolSteps && message.toolSteps.length > 0 && (
          <ToolSteps steps={message.toolSteps} isComplete={message.toolsComplete} />
        )}

        {!isUser && hasThinking && (
          <ThinkingBlock thinking={message.thinking!} streaming={message.streaming} />
        )}

        {(hasBody || isUser || (!hasThinking && !message.toolSteps?.length)) && (
          <div
            className={cn(
              "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              isUser
                ? "rounded-tr-sm bg-primary text-primary-foreground"
                : "rounded-tl-sm bg-muted text-foreground"
            )}
          >
            <div className="space-y-3">
              {hasBody ? (
                renderTextSegments(message.content)
              ) : (
                <p className="text-xs text-muted-foreground">
                  {message.streaming ? "正在生成响应..." : "已处理工具调用"}
                </p>
              )}

              {message.meta && message.meta.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {message.meta.map((entry) => (
                    <span
                      key={entry}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px]",
                        isUser
                          ? "border-primary-foreground/20 text-primary-foreground/80"
                          : "border-border bg-background/60 text-muted-foreground"
                      )}
                    >
                      {entry}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <span
              className={cn(
                "mt-2 block text-[10px]",
                isUser ? "text-primary-foreground/60" : "text-muted-foreground"
              )}
            >
              {message.timestamp.toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {message.streaming ? " · 响应中" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatArea({
  title,
  subtitle,
  messages,
  value,
  apps,
  selectedAppName,
  loading,
  hasActiveSession,
  onCreateSession,
  onChange,
  onSelectAppName,
  onSend,
  onPlan,
  onCreateApp,
  onIterateApp,
  onStop,
}: {
  title: string;
  subtitle: string;
  messages: ChatMessage[];
  value: string;
  apps: StoredApp[];
  selectedAppName: string;
  loading: boolean;
  hasActiveSession: boolean;
  onCreateSession: () => void;
  onChange: (value: string) => void;
  onSelectAppName: (value: string) => void;
  onSend: () => void;
  onPlan: () => void;
  onCreateApp: () => void;
  onIterateApp: () => void;
  onStop: () => void;
}) {
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const selectedApp = apps.find((entry) => entry.name === selectedAppName) || null;

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-foreground">{title}</h1>
            <p className={cn("text-xs", subtitle.includes("未登录") || subtitle.includes("login") ? "text-destructive font-medium animate-pulse" : "text-muted-foreground")}>
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {loading && (
            <Button variant="outline" size="sm" onClick={onStop} className="gap-2">
              <Square className="h-3.5 w-3.5" />
              停止
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-5">
          {!hasActiveSession ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <div className="w-full max-w-xl rounded-[28px] border border-border/80 bg-card/80 p-8 text-center shadow-[0_24px_80px_-36px_rgba(0,0,0,0.45)]">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5">
                  <Sparkles className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-2xl font-semibold text-foreground">开始一个新会话</h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-muted-foreground">
                  创建会话后再进入聊天工作区。后续一轮里的多个工具调用会聚合在同一个 tool 框里展示。
                </p>
                <Button className="mt-6 h-11 rounded-xl px-6 text-sm" onClick={onCreateSession}>
                  新建会话
                </Button>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-[300px] items-center justify-center text-center text-sm text-muted-foreground">
              新建会话后，直接在下方输入任务。聊天区会按本地 agent 的真实事件流解析并展示。
            </div>
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border bg-background/95 p-4 backdrop-blur">
        <div className="mx-auto max-w-4xl">
          <div className="relative rounded-xl border border-border bg-card shadow-sm transition-shadow focus-within:border-primary/50 focus-within:shadow-md focus-within:shadow-primary/5">
          <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                模式选择
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {selectedApp
                  ? `当前会更新 ${selectedApp.name}`
                  : "选择“发送”直接对话，选择“生成 App”进入开发流"}
              </p>
            </div>
            <select
              value={selectedAppName}
              onChange={(event) => onSelectAppName(event.target.value)}
              className="h-9 min-w-[180px] rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/50"
              disabled={!hasActiveSession || loading}
            >
              <option value="">普通对话 / 新 App</option>
              {apps.map((app) => (
                <option key={app.name} value={app.name}>
                  {app.name}
                </option>
              ))}
            </select>
          </div>
          <Textarea
            placeholder={selectedApp ? `描述你想如何修改 ${selectedApp.name}...` : "输入任务或普通消息..."}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-[72px] max-h-[180px] resize-none border-0 bg-transparent px-4 py-3 pr-64 text-sm leading-6 text-foreground caret-primary placeholder:text-muted-foreground/70 focus-visible:ring-0"
            rows={2}
            disabled={!hasActiveSession}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void onSend();
              }
            }}
          />
          <div className="absolute bottom-3 right-3 flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-xl px-3 text-xs font-medium text-muted-foreground"
              disabled={!hasActiveSession || !value.trim() || loading}
              onClick={onPlan}
            >
              <Pencil className="mr-1.5 h-4 w-4" />
              制定计划
            </Button>
            <Button
              className="h-9 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
              disabled={!hasActiveSession || !value.trim() || loading}
              onClick={selectedApp ? onIterateApp : onCreateApp}
            >
              {selectedApp ? <Pencil className="mr-1.5 h-4 w-4" /> : <MonitorPlay className="mr-1.5 h-4 w-4" />}
              {selectedApp ? "更新 App" : "生成 App"}
            </Button>
            <Button size="icon" className="h-9 w-9" disabled={!hasActiveSession || !value.trim() || loading} onClick={onSend}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          当前后端直接连接本地 Claude Code agent，请核实重要信息
        </p>
        </div>
      </div>
    </div>
  );
}
