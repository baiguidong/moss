"use client";

import * as React from "react";
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  FileText,
  Loader,
  Send,
  Square,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ToolSteps } from "@/components/tool-steps";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FilePreview } from "@/components/file-preview";
import { MarkdownView } from "@/components/markdown-view";
import { pasteService } from "@/lib/paste-service";
import type { ChatMessage } from "@/lib/agent-transcript";

type ComposerIntent = "chat" | "plan" | "create-app" | "iterate-app" | "coordinator";
type PendingPlanApproval = {
  kind: "create-app" | "plan";
  originalPrompt: string;
  plan: string;
  requestedAt: number;
};

type IntentOption = {
  id: ComposerIntent;
  title: string;
  description?: string;
};

const intentOptions: IntentOption[] = [
  {
    id: "coordinator",
    title: "Coordinator",
    description: "主 agent 协调多个 worker 并行执行复杂任务",
  },
  {
    id: "plan",
    title: "Copilot",
  },
  {
    id: "create-app",
    title: "创建 App",
  },
];

function SessionTabBar({
  title,
  messageCount,
  leftCollapsed,
  rightCollapsed,
  onToggleLeft,
  onToggleRight,
}: {
  title: string;
  messageCount: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-border/70 bg-background/88 px-3 py-2 backdrop-blur sm:px-4">
      <div className="mx-auto flex max-w-[980px] items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={onToggleLeft}
          aria-label={leftCollapsed ? "展开左侧栏" : "收起左侧栏"}
        >
          {leftCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>

        <div className="min-w-0 max-w-[calc(100%-6rem)] rounded-full border border-border/75 bg-card/88 px-4 py-1.5 shadow-[0_14px_40px_-34px_rgba(0,0,0,0.7)]">
          <div className="flex items-center justify-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {title || "New Session"}
            </span>
            <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
              {messageCount} 条
            </span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={onToggleRight}
          aria-label={rightCollapsed ? "展开右侧栏" : "收起右侧栏"}
        >
          {rightCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

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

function renderTextSegments(content: string, streaming = false) {
  const normalized = content.trim();
  if (!normalized) return null;

  const fenceRegex = /```([\w-]*)\n?([\s\S]*?)```/gi;
  const segments: Array<{ type: "text" | "code"; value: string; language?: string; incomplete?: boolean }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(normalized))) {
    const textBefore = normalized.slice(lastIndex, match.index).trim();
    if (textBefore) {
      segments.push({ type: "text", value: textBefore });
    }

    segments.push({
      type: "code",
      language: match[1] || "",
      value: match[2].trimEnd(),
    });
    lastIndex = match.index + match[0].length;
  }

  const trailing = normalized.slice(lastIndex).trim();
  if (trailing) {
    const incompleteFenceMatch = trailing.match(/^```([\w-]*)\n?([\s\S]*)$/i);
    if (incompleteFenceMatch) {
      segments.push({
        type: "code",
        language: incompleteFenceMatch[1] || "",
        value: incompleteFenceMatch[2].trimEnd(),
        incomplete: true,
      });
    } else {
      segments.push({ type: "text", value: trailing });
    }
  }

  if (segments.length === 0) return null;

  return segments.map((segment, index) => {
    if (segment.type === "code") {
      const language = (segment.language || "").toLowerCase();
      const lines = segment.value.split("\n").length;
      const displayName =
        language === "app-meta"
          ? "app-meta.json"
          : language === "html" || language === "htm"
            ? "index.html"
            : segment.language
              ? `snippet.${segment.language}`
              : "code.txt";

      return (
        <Collapsible
          key={`${segment.type}-${index}`}
          defaultOpen={false}
          className="overflow-hidden rounded-2xl border border-border/70 bg-background/70"
        >
          <CollapsibleTrigger className="group w-full">
            <div className="flex items-center justify-between gap-3 px-3 py-3 text-left">
              <div className="min-w-0 flex items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12px] font-medium text-foreground">
                    {`Generated ${displayName}`}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {segment.incomplete && streaming ? "生成中" : `${lines} lines`}
                    {segment.language ? ` · ${segment.language}` : ""}
                  </div>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {segment.language || "code"}
            </div>
            <pre className="max-h-[26rem] overflow-auto p-3 text-[12px] leading-6 text-foreground">
              <code>{segment.value}</code>
            </pre>
          </CollapsibleContent>
        </Collapsible>
      );
    }

    return segment.value.split(/\n{2,}/).map((paragraph, paragraphIndex) => (
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
  const hasImages = message.images && message.images.length > 0;
  const hasFiles = message.files && message.files.length > 0;

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <Avatar className={cn("h-9 w-9 shrink-0", isUser ? "bg-primary" : "bg-secondary")}>
        <AvatarFallback
          className={cn(
            "text-xs",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-gradient-to-br from-primary/25 to-primary/10 text-primary",
          )}
        >
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
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

        {(hasBody || isUser || (!hasThinking && !message.toolSteps?.length)) && (
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
                    {!message.streaming && <span>Working...</span>}
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

function IntentChip({
  option,
  active,
  disabled,
  onClick,
  onRemove,
}: {
  option: IntentOption;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  onRemove?: () => void;
}) {
  const isCoordinator = option.id === "coordinator";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors sm:px-4 sm:text-sm",
        active && isCoordinator
          ? "border-purple-500/40 bg-gradient-to-r from-purple-500/10 to-blue-500/10 text-purple-600 dark:text-purple-400"
          : active
            ? "border-primary/35 bg-primary/10 text-primary"
            : "border-transparent bg-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground",
        disabled && "cursor-not-allowed opacity-45",
      )}
      title={option.description}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex items-center gap-1.5"
      >
        <span>{option.title}</span>
        {active && option.description && (
          <span className="hidden text-[10px] opacity-70 sm:inline">
            {option.description}
          </span>
        )}
      </button>
      {active && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 rounded-full p-0.5 hover:bg-primary/20"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function PlanApprovalCard({
  pendingPlanApproval,
  busy,
  onApprove,
  onReject,
}: {
  pendingPlanApproval: PendingPlanApproval;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isCreateApp = pendingPlanApproval.kind === "create-app";
  return (
    <div className="rounded-[24px] border border-primary/25 bg-card/92 p-4 shadow-[0_18px_55px_-40px_rgba(0,0,0,0.75)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-primary">
          {isCreateApp ? "创建 App 计划待确认" : "执行计划待确认"}
        </span>
        <span className="text-xs text-muted-foreground">
          {isCreateApp ? "批准后才会真正开始生成 App" : "批准后将启动独立子 Agent 执行"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-7 text-foreground">
        <span className="font-medium">需求：</span>
        {pendingPlanApproval.originalPrompt}
      </p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-border/70 bg-background/75">
        <div className="border-b border-border/70 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          已生成的计划
        </div>
        <pre className="max-h-[18rem] overflow-auto whitespace-pre-wrap break-words px-3 py-3 text-[12px] leading-6 text-foreground">
          {pendingPlanApproval.plan}
        </pre>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          className="rounded-full px-4"
          onClick={onApprove}
          disabled={busy}
        >
          {busy ? "正在执行..." : isCreateApp ? "批准并创建 App" : "批准并执行"}
        </Button>
        <Button
          variant="outline"
          className="rounded-full px-4"
          onClick={onReject}
          disabled={busy}
        >
          退回计划
        </Button>
      </div>
    </div>
  );
}

function ComposerPanel({
  value,
  selectedAppName,
  loading,
  composerIntent,
  hasActiveSession,
  sessionId,
  onChange,
  onComposerIntentChange,
  onSend,
  onStop,
}: {
  value: string;
  selectedAppName: string;
  loading: boolean;
  composerIntent: ComposerIntent;
  hasActiveSession: boolean;
  sessionId?: string;
  onChange: (value: string) => void;
  onComposerIntentChange: (intent: ComposerIntent) => void;
  onSend: (files?: Array<{ name: string; path: string }>) => void;
  onStop?: () => void;
}) {
  const [attachments, setAttachments] = React.useState<Array<{ name: string; path: string }>>([]);
  const composerId = React.useRef<string>('composer-' + Math.random().toString(36).slice(2));
  const isHomeComposer = !hasActiveSession;
  const submitDisabled =
    (!value.trim() && attachments.length === 0) || loading || (composerIntent === "iterate-app" && !selectedAppName);

  React.useEffect(() => {
    pasteService.init();
    pasteService.registerHandler(composerId.current, async (event) => {
      const handled = await pasteService.handlePaste(
        event,
        (files) => setAttachments(prev => [...prev, ...files]),
        undefined
      );
      return handled;
    });
    pasteService.setLastFocusedComponent(composerId.current);
    return () => {
      pasteService.unregisterHandler(composerId.current);
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const newAttachments: Array<{ name: string; path: string }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = (file as File & { path?: string }).path;
      if (filePath) {
        newAttachments.push({ name: file.name, path: filePath });
      } else if (file.type.startsWith('image/')) {
        const ext = file.name.split('.').pop() || 'png';
        const fileName = file.name || `pasted_image.${ext}`;
        try {
          const arrayBuffer = await file.arrayBuffer();
          const data = Array.from(new Uint8Array(arrayBuffer));
          let savedPath: string | null = null;
          if (sessionId) {
            const result = await window.agentDesktop.fs.saveImageToWorkspace(sessionId, fileName, data) as { path: string } | { error: string };
            if ('path' in result) savedPath = result.path;
          }
          if (!savedPath) {
            const tempPath = await window.agentDesktop.fs.createTempFile(fileName);
            if (tempPath) {
              await window.agentDesktop.fs.writeFile(tempPath, data);
              savedPath = tempPath;
            }
          }
          if (savedPath) {
            newAttachments.push({ name: fileName, path: savedPath });
          }
        } catch (err) {
          console.error('Failed to save dropped image:', err);
        }
      }
    }
    if (newAttachments.length > 0) {
      setAttachments(prev => [...prev, ...newAttachments]);
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const clipboardItems = e.clipboardData?.items;
    if (!clipboardItems) return;

    const newAttachments: Array<{ name: string; path: string }> = [];
    for (let i = 0; i < clipboardItems.length; i++) {
      const item = clipboardItems[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const ext = item.type.split('/')[1] || 'png';
          const fileName = file.name || `pasted_image.${ext}`;
          try {
            const arrayBuffer = await file.arrayBuffer();
            const data = Array.from(new Uint8Array(arrayBuffer));

            let savedPath: string | null = null;
            if (sessionId) {
              const result = await window.agentDesktop.fs.saveImageToWorkspace(sessionId, fileName, data) as { path: string } | { error: string };
              if ('path' in result) savedPath = result.path;
            }
            if (!savedPath) {
              // Fallback to temp file
              const tempPath = await window.agentDesktop.fs.createTempFile(fileName);
              if (tempPath) {
                await window.agentDesktop.fs.writeFile(tempPath, data);
                savedPath = tempPath;
              }
            }

            if (savedPath) {
              newAttachments.push({ name: fileName, path: savedPath });
            }
          } catch (err) {
            console.error('Failed to save pasted image:', err);
          }
        }
      }
    }
    if (newAttachments.length > 0) {
      e.preventDefault();
      setAttachments(prev => [...prev, ...newAttachments]);
    }
  };

  const handleSendClick = () => {
    const files = attachments.length > 0 ? attachments : undefined;
    onSend(files);
    setAttachments([]);
  };

  return (
    <div
      className={cn(
        "rounded-[26px] border border-border/80 bg-card/92 backdrop-blur",
        isHomeComposer
          ? "shadow-[0_24px_80px_-44px_rgba(0,0,0,0.55)]"
          : "shadow-[0_16px_54px_-38px_rgba(0,0,0,0.45)]",
      )}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="relative">
        <Textarea
          placeholder={
            isHomeComposer
              ? composerIntent === "iterate-app" && selectedAppName
                ? `描述你想如何修改 ${selectedAppName}...`
                : composerIntent === "create-app"
                  ? "描述你想创建的 App、目标用户、交互和风格..."
                  : composerIntent === "coordinator"
                    ? "描述复杂任务，我会启动多个 worker 并行执行..."
                    : composerIntent === "plan"
                      ? "描述需求，我会先给出计划..."
                      : "输入任务、问题或想法..."
              : "继续输入消息..."
          }
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "resize-none border-0 bg-transparent px-4 pt-4 text-sm leading-7 text-foreground caret-primary placeholder:text-muted-foreground/70 focus-visible:ring-0 sm:px-5",
            isHomeComposer ? "min-h-[220px] pb-18 pr-26" : "min-h-[92px] pb-16 pr-26",
          )}
          rows={isHomeComposer ? 7 : 3}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              if (submitDisabled) {
                return;
              }
              event.preventDefault();
              void handleSendClick();
            }
          }}
          onPaste={handlePaste}
        />

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            {attachments.map((file, index) => (
              <FilePreview
                key={`${file.path}-${index}`}
                path={file.path}
                onRemove={() => handleRemoveAttachment(index)}
              />
            ))}
          </div>
        )}

        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          {!isHomeComposer && loading && (
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-full"
              onClick={onStop}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          )}

          <Button
            className="h-9 rounded-full px-3.5 sm:px-4"
            disabled={submitDisabled}
            onClick={handleSendClick}
          >
            <Send className="h-4 w-4" />
            发送
          </Button>
        </div>
      </div>

      {/* Selected intent tag - shown below textarea inside composer panel */}
      {isHomeComposer && composerIntent !== "chat" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-4 py-2">
          <span className="text-xs text-muted-foreground">模式：</span>
          <IntentChip
            key={composerIntent}
            option={intentOptions.find(o => o.id === composerIntent)!}
            active={true}
            onClick={() => onComposerIntentChange("chat")}
            onRemove={() => onComposerIntentChange("chat")}
          />
          {composerIntent === "iterate-app" && selectedAppName && (
            <span className="rounded-full border border-border/70 px-3 py-1.5 text-xs text-muted-foreground">
              更新 {selectedAppName}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function HomeLanding({
  value,
  selectedAppName,
  loading,
  composerIntent,
  sessionId,
  onChange,
  onComposerIntentChange,
  onSend,
}: {
  value: string;
  selectedAppName: string;
  loading: boolean;
  composerIntent: ComposerIntent;
  sessionId?: string;
  onChange: (value: string) => void;
  onComposerIntentChange: (intent: ComposerIntent) => void;
  onSend: (files?: Array<{ name: string; path: string }>) => void;
}) {
  return (
    <div className="mx-auto flex h-[60%] w-full max-w-[80%] flex-col justify-center px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-8 text-center sm:mb-10">
        <h1 className="mt-24 text-2xl font-medium tracking-[-0.02em] text-foreground sm:text-3xl">
          Hi，今天有什么安排？
        </h1>
        <p className="mx-auto mt-3 max-w-[560px] text-sm leading-7 text-muted-foreground sm:text-base">
          让 moss 帮你创建App、规划任务，或者直接开始一个新的构建目标。
        </p>
      </div>

      <div className="mb-6 flex justify-center gap-4">
        {intentOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onComposerIntentChange(option.id)}
            className="rounded-full border border-border/70 bg-card/60 px-6 py-3 text-sm font-medium text-foreground shadow-[0_8px_30px_-8px_rgba(0,0,0,0.4)] backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-card/80 hover:shadow-[0_14px_40px_-12px_rgba(0,0,0,0.5)]"
          >
            {option.title}
          </button>
        ))}
      </div>

      <ComposerPanel
        value={value}
        selectedAppName={selectedAppName}
        loading={loading}
        composerIntent={composerIntent}
        hasActiveSession={false}
        sessionId={sessionId}
        onChange={onChange}
        onComposerIntentChange={onComposerIntentChange}
        onSend={onSend}
      />
    </div>
  );
}

export function ChatArea({
  messages,
  value,
  selectedAppName,
  loading,
  hasActiveSession,
  sessionTitle,
  sessionMessageCount,
  sessionId,
  pendingPlanApproval,
  planDecisionBusy,
  leftCollapsed,
  rightCollapsed,
  composerIntent,
  onChange,
  onComposerIntentChange,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onApprovePlan,
  onRejectPlan,
  onSend,
  onStop,
}: {
  messages: ChatMessage[];
  value: string;
  selectedAppName: string;
  loading: boolean;
  hasActiveSession: boolean;
  sessionTitle: string;
  sessionMessageCount: number;
  sessionId?: string;
  pendingPlanApproval: PendingPlanApproval | null;
  planDecisionBusy: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  composerIntent: ComposerIntent;
  onChange: (value: string) => void;
  onComposerIntentChange: (intent: ComposerIntent) => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  onApprovePlan: () => void;
  onRejectPlan: () => void;
  onSend: (files?: Array<{ name: string; path: string }>) => void;
  onStop: () => void;
}) {
  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  if (!hasActiveSession) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(58,191,129,0.12),transparent_24%),radial-gradient(circle_at_80%_10%,rgba(255,176,32,0.1),transparent_24%),var(--background)]">
        <HomeLanding
          value={value}
          selectedAppName={selectedAppName}
          loading={loading}
          composerIntent={composerIntent}
          sessionId={sessionId}
          onChange={onChange}
          onComposerIntentChange={onComposerIntentChange}
          onSend={onSend}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(58,191,129,0.08),transparent_22%),var(--background)]">
      <SessionTabBar
        title={sessionTitle}
        messageCount={sessionMessageCount}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeft={onToggleLeftSidebar}
        onToggleRight={onToggleRightSidebar}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5 px-3 py-3 sm:px-4 sm:py-4">
          {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
          {pendingPlanApproval && (
            <PlanApprovalCard
              pendingPlanApproval={pendingPlanApproval}
              busy={planDecisionBusy || loading}
              onApprove={onApprovePlan}
              onReject={onRejectPlan}
            />
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border/70 bg-background/94 px-3 py-3 backdrop-blur sm:px-4">
        {/* Selected intent tag - shown inside composer for active session */}
        {composerIntent !== "chat" && (
          <div className="mx-auto max-w-[980px] mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">模式：</span>
              {intentOptions.map((option) => (
                <IntentChip
                  key={option.id}
                  option={option}
                  active={composerIntent === option.id}
                  onClick={() => onComposerIntentChange(option.id)}
                  onRemove={composerIntent === option.id ? () => onComposerIntentChange("chat") : undefined}
                />
              ))}
            </div>
          </div>
        )}
        <div className="mx-auto max-w-[980px]">
          <ComposerPanel
            value={value}
            selectedAppName={selectedAppName}
            loading={loading}
            composerIntent={composerIntent}
            hasActiveSession
            sessionId={sessionId}
            onChange={onChange}
            onComposerIntentChange={onComposerIntentChange}
            onSend={onSend}
            onStop={onStop}
          />
        </div>
      </div>
    </div>
  );
}
