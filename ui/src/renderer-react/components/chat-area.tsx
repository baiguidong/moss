"use client";

import * as React from "react";
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  FolderOpen,
  GitFork,
  LoaderCircle,
  Plus,
  Send,
  Square,
  Terminal,
  Wrench,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { MessageListPane, type VirtualMessageListHandle } from "@/components/chat/message-list";
import { ToolDisplaySettingsProvider } from "@/components/chat/tool-display-settings";
import { FilePreview } from "@/components/file-preview";
import { pasteService } from "@/lib/paste-service";
import { copyToClipboard } from "@/components/chat/clipboard";
import {
  buildWorkerRenderMessagesFromSubagentEvents,
  type TranscriptRenderMessage,
} from "@/lib/agent-transcript";
import type { BackgroundTaskInfo, InstalledConnector, SessionDetail, SessionSummary } from "../types";
import {
  AssistantAvatar,
  getSelectableInstalledAssistants,
  type InstalledAssistant,
} from "@/components/assistant-selection-area";
import {
  ConnectorIcon,
  connectorTypeLabel,
  getSelectableInstalledConnectors,
} from "@/components/connector-selection-area";
import {
  getSelectableInstalledSkills,
  SkillIcon,
  type InstalledSkillOption,
} from "@/components/skill-selection-area";
import { ComposerResourceSelectionArea } from "@/components/composer-resource-selection-area";
import { SlashCommandMenu, SlashCommandSubMenu, getSlashCommandFilter, SLASH_COMMANDS, COMMANDS_WITH_ARGS } from "@/components/slash-command-menu";
import {
  getComposerMentionTabs,
  getDefaultComposerPlaceholder,
  getNextComposerMentionTab,
  getPreviousComposerMentionTab,
  type ComposerMentionTab,
} from "@/lib/composer-mentions";

type ComposerIntent = "chat" | "plan" | "coordinator";
type PendingPlanApproval = {
  kind: "plan";
  originalPrompt: string;
  plan: string;
  requestedAt: number;
};

type IntentOption = {
  id: ComposerIntent;
  title: string;
  description?: string;
};

const chatIntentOption: IntentOption = {
  id: "chat",
  title: "chat",
};

const intentOptions: IntentOption[] = [
  {
    id: "coordinator",
    title: "boss",
    description: "主 agent 协调多个 worker 并行执行复杂任务",
  },
  {
    id: "plan",
    title: "plan",
    description: "规划任务步骤和执行计划",
  },
];

function buildTranscriptPlainText(messages: TranscriptRenderMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.type === "user_text") {
      const content = message.content.trim();
      if (content) parts.push(`用户：\n${content}`);
    } else if (message.type === "assistant_text") {
      const content = message.content.trim();
      if (content) parts.push(`Moss：\n${content}`);
    } else if (message.type === "bash") {
      const output = message.output.trim();
      parts.push(`命令：$ ${message.command}${output ? `\n${output}` : ""}`);
    }
  }
  return parts.join("\n\n");
}

function SessionTabBar({
  title,
  messageCount,
  leftCollapsed,
  rightCollapsed,
  onToggleLeft,
  onToggleRight,
  autoCollapseToolCalls,
  onToggleAutoCollapseToolCalls,
  toolDisplaySettingBusy,
  outline,
  onJumpToOutlineItem,
  messages,
  onFork,
  forking,
  forkDisabledReason,
}: {
  title: string;
  messageCount: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  autoCollapseToolCalls: boolean;
  onToggleAutoCollapseToolCalls?: () => void;
  toolDisplaySettingBusy: boolean;
  outline: OutlineEntry[];
  onJumpToOutlineItem: (messageId: string) => void;
  messages: TranscriptRenderMessage[];
  onFork?: () => void;
  forking?: boolean;
  forkDisabledReason?: string | null;
}) {
  const [outlineOpen, setOutlineOpen] = React.useState(false);
  const [transcriptCopied, setTranscriptCopied] = React.useState(false);
  const handleCopyTranscript = React.useCallback(async () => {
    const text = buildTranscriptPlainText(messages);
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setTranscriptCopied(true);
    window.setTimeout(() => setTranscriptCopied(false), 1200);
  }, [messages]);
  const [outlineQuery, setOutlineQuery] = React.useState("");
  const outlineRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!outlineOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (outlineRef.current && !outlineRef.current.contains(e.target as Node)) {
        setOutlineOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [outlineOpen]);

  const filteredOutline = outlineQuery.trim()
    ? outline.filter((entry) =>
        `${entry.question}\n${entry.answerPreview}`.toLowerCase().includes(outlineQuery.trim().toLowerCase()))
    : outline;

  return (
    <div className="shrink-0 border-b border-border/70 bg-background/88 px-3 py-2 backdrop-blur sm:px-4">
      <div className="mx-auto flex max-w-[1180px] min-w-0 items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={onToggleLeft}
          aria-label={leftCollapsed ? "展开左侧栏" : "收起左侧栏"}
        >
          {leftCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>

        <div ref={outlineRef} className="relative min-w-0 flex-1">
          <button
            type="button"
            className="w-full min-w-0 rounded-full border border-border/75 bg-card/88 px-4 py-1.5 shadow-[0_14px_40px_-34px_rgba(0,0,0,0.7)] transition-colors hover:bg-card"
            title="点击查看会话大纲"
            onClick={() => setOutlineOpen((prev) => !prev)}
          >
            <div className="flex min-w-0 items-center justify-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {title || "New Session"}
              </span>
              <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                {messageCount} 条
              </span>
            </div>
          </button>
          {outlineOpen && (
            <div className="absolute left-1/2 top-full z-30 mt-1 w-[420px] max-w-[80vw] -translate-x-1/2 overflow-hidden rounded-xl border border-border/70 bg-card/95 shadow-[0_16px_48px_-16px_rgba(0,0,0,0.5)] backdrop-blur">
              <div className="border-b border-border/50 p-2">
                <input
                  value={outlineQuery}
                  onChange={(e) => setOutlineQuery(e.target.value)}
                  placeholder="搜索对话轮次..."
                  className="w-full rounded-lg border border-border/60 bg-background/70 px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
                />
              </div>
              <div className="max-h-72 overflow-y-auto py-1">
                {filteredOutline.length === 0 ? (
                  <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                    {outline.length === 0 ? "还没有对话轮次" : "无匹配结果"}
                  </div>
                ) : (
                  filteredOutline.map((entry, index) => (
                    <button
                      key={entry.messageId}
                      type="button"
                      className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                      onClick={() => {
                        onJumpToOutlineItem(entry.messageId);
                        setOutlineOpen(false);
                      }}
                    >
                      <span className="truncate text-xs font-medium text-foreground">
                        {index + 1}. {entry.question || "（附件消息）"}
                      </span>
                      {entry.answerPreview && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {entry.answerPreview}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={onFork}
                  disabled={!onFork || forking || Boolean(forkDisabledReason)}
                  aria-label={forking ? "正在分叉会话" : "分叉当前会话"}
                >
                  <GitFork className={cn("h-4 w-4", forking && "animate-pulse")} />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {forkDisabledReason || (forking ? "正在分叉会话" : "分叉当前会话")}
            </TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={handleCopyTranscript}
            title="复制全部对话"
            aria-label="复制全部对话"
          >
            {transcriptCopied ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8 rounded-full", autoCollapseToolCalls && "text-primary")}
            onClick={onToggleAutoCollapseToolCalls}
            disabled={!onToggleAutoCollapseToolCalls || toolDisplaySettingBusy}
            title={autoCollapseToolCalls
              ? "当前会话：关闭完成后自动折叠"
              : "当前会话：完成后自动折叠工具调用"}
            aria-label={autoCollapseToolCalls
              ? "关闭当前会话的工具调用自动折叠"
              : "开启当前会话的工具调用自动折叠"}
          >
            <Wrench className={cn("h-4 w-4", toolDisplaySettingBusy && "animate-pulse")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={onToggleRight}
            aria-label={rightCollapsed ? "展开右侧栏" : "收起右侧栏"}
          >
            {rightCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
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
  return (
    <div className="rounded-[24px] border border-primary/25 bg-card/92 p-4 shadow-[0_18px_55px_-40px_rgba(0,0,0,0.75)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-primary">
          执行计划待确认
        </span>
        <span className="text-xs text-muted-foreground">
          批准后将启动独立子 Agent 执行
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
          {busy ? "正在执行..." : "批准并执行"}
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
  readOnlyReason,
  composerIntent,
  hasActiveSession,
  sessionId,
  attachments: externalAttachments,
  onAttachmentsChange,
  workspace,
  onWorkspaceChange,
  onChange,
  onComposerIntentChange,
  onSend,
  onStop,
  installedAssistants,
  selectedAssistant,
  onSelectAssistant,
  onClearAssistant,
  onOpenExpertHub,
  onOpenSkillHub,
  allowSkillSelection = true,
  installedConnectors,
  selectedConnectorIds,
  onToggleConnector,
  onOpenConnectorHub,
  className,
  contextUsage,
}: {
  value: string;
  selectedAppName: string;
  loading: boolean;
  readOnlyReason?: string | null;
  composerIntent: ComposerIntent;
  hasActiveSession: boolean;
  sessionId?: string;
  attachments?: Array<{ name: string; path: string }>;
  onAttachmentsChange?: (attachments: Array<{ name: string; path: string }>) => void;
  workspace?: string;
  onWorkspaceChange?: (workspace: string | undefined) => void;
  onChange: (value: string) => void;
  onComposerIntentChange: (intent: ComposerIntent) => void;
  installedAssistants?: InstalledAssistant[];
  selectedAssistant?: InstalledAssistant | null;
  onSelectAssistant?: (assistant: InstalledAssistant) => void;
  onClearAssistant?: () => void;
  onOpenExpertHub?: () => void;
  onOpenSkillHub?: () => void;
  allowSkillSelection?: boolean;
  installedConnectors?: InstalledConnector[];
  selectedConnectorIds?: string[];
  onToggleConnector?: (connector: InstalledConnector) => void;
  onOpenConnectorHub?: () => void;
  onSend: (files?: Array<{ name: string; path: string }>, skills?: SkillMentionItem[]) => void;
  onStop?: () => void;
  className?: string;
  contextUsage?: ContextUsageInfo | null;
}) {
  const [internalAttachments, setInternalAttachments] = React.useState<Array<{ name: string; path: string }>>([]);
  const attachments = externalAttachments ?? internalAttachments;
  const setAttachments = React.useCallback((
    updater: Array<{ name: string; path: string }> | ((prev: Array<{ name: string; path: string }>) => Array<{ name: string; path: string }>)
  ) => {
    if (typeof updater === 'function') {
      if (onAttachmentsChange) {
        onAttachmentsChange(updater(externalAttachments ?? internalAttachments));
      } else {
        setInternalAttachments(updater);
      }
    } else {
      onAttachmentsChange?.(updater);
    }
  }, [onAttachmentsChange, externalAttachments, internalAttachments]);
  const composerId = React.useRef<string>('composer-' + Math.random().toString(36).slice(2));
  const setAttachmentsRef = React.useRef(setAttachments);
  React.useEffect(() => {
    setAttachmentsRef.current = setAttachments;
  }, [setAttachments]);
  const isHomeComposer = !hasActiveSession;
  const activeIntentOption = [chatIntentOption, ...intentOptions]
    .find((option) => option.id === composerIntent) ?? chatIntentOption;
  // Sending while loading is allowed: the message is queued and dispatched
  // when the current turn ends (REPL type-while-busy behavior).
  const submitDisabled =
    (!value.trim() && attachments.length === 0) || Boolean(readOnlyReason);
  const [slashCommandFilter, setSlashCommandFilter] = React.useState<string | null>(null);
  const [slashCommandIndex, setSlashCommandIndex] = React.useState(0);
  const [subMenuCommand, setSubMenuCommand] = React.useState<string | null>(null);
  const [subMenuIndex, setSubMenuIndex] = React.useState(0);
  const [mentionFilter, setMentionFilter] = React.useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [mentionItems, setMentionItems] = React.useState<WorkspaceMentionItem[]>([]);
  const [mentionTab, setMentionTab] = React.useState<ComposerMentionTab>(
    hasActiveSession ? "files" : "skills",
  );
  const [skillItems, setSkillItems] = React.useState<SkillMentionItem[]>([]);
  const [selectedSkills, setSelectedSkills] = React.useState<SkillMentionItem[]>([]);
  const [skillsLoading, setSkillsLoading] = React.useState(false);
  const skillsLoadedRef = React.useRef(false);
  const workspaceRootRef = React.useRef<string | null>(null);
  const mentionTabs = React.useMemo(() => getComposerMentionTabs({
    includeFiles: hasActiveSession,
    includeSkills: allowSkillSelection,
    includeAssistants: !hasActiveSession && Boolean(onSelectAssistant),
    includeConnectors: Boolean(onToggleConnector),
  }), [allowSkillSelection, hasActiveSession, onSelectAssistant, onToggleConnector]);
  const defaultPlaceholder = React.useMemo(() => getDefaultComposerPlaceholder({
    hasActiveSession,
    includeSkills: allowSkillSelection,
    includeAssistants: !hasActiveSession && Boolean(onSelectAssistant),
    includeConnectors: Boolean(onToggleConnector),
  }), [allowSkillSelection, hasActiveSession, onSelectAssistant, onToggleConnector]);

  React.useEffect(() => {
    if (!mentionTabs.includes(mentionTab)) setMentionTab(mentionTabs[0]);
  }, [mentionTab, mentionTabs]);

  const loadInstalledSkills = React.useCallback(async () => {
    if (skillsLoadedRef.current) return;
    skillsLoadedRef.current = true;
    setSkillsLoading(true);
    try {
      const res = await window.agentDesktop.ipcInvoke("skill-store:getInstalledSkills") as
        { success?: boolean; data?: SkillMentionItem[] } | undefined;
      if (res?.success && Array.isArray(res.data)) {
        setSkillItems(res.data);
      }
    } catch {
      skillsLoadedRef.current = false;
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (allowSkillSelection) void loadInstalledSkills();
  }, [allowSkillSelection, loadInstalledSkills]);

  React.useEffect(() => {
    if (!allowSkillSelection) setSelectedSkills([]);
  }, [allowSkillSelection]);

  const mentionDirPart = React.useMemo(() => {
    if (mentionFilter === null) return null;
    const idx = mentionFilter.lastIndexOf("/");
    return idx >= 0 ? mentionFilter.slice(0, idx) : "";
  }, [mentionFilter]);

  const [mentionNotice, setMentionNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (mentionDirPart === null) {
      setMentionItems([]);
      setMentionNotice(null);
      return;
    }
    if (!sessionId) {
      setMentionItems([]);
      setMentionNotice(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        let dirPath: string | undefined;
        if (mentionDirPart) {
          if (!workspaceRootRef.current) {
            const rootRes = await window.agentDesktop.listWorkspaceDir({ sessionId });
            if (cancelled) return;
            workspaceRootRef.current = rootRes?.root ?? null;
          }
          if (!workspaceRootRef.current) return;
          dirPath = `${workspaceRootRef.current}/${mentionDirPart}`;
        }
        const res = await window.agentDesktop.listWorkspaceDir({ sessionId, dirPath });
        if (cancelled) return;
        if (res?.root) workspaceRootRef.current = res.root;
        const items = Array.isArray(res?.items) ? res.items : [];
        setMentionItems(items);
        if (res?.remote) {
          setMentionNotice("云端模式暂不支持浏览工作区文件");
        } else if (items.length === 0) {
          setMentionNotice(mentionDirPart ? "该目录为空" : "工作区目前没有文件");
        } else {
          setMentionNotice(null);
        }
      } catch (err) {
        console.warn("[mention] listWorkspaceDir failed:", err);
        if (!cancelled) {
          setMentionItems([]);
          setMentionNotice("无法读取工作区文件列表");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [mentionDirPart, sessionId]);

  const mentionBase = mentionFilter !== null
    ? mentionFilter.slice(mentionFilter.lastIndexOf("/") + 1).toLowerCase()
    : "";
  const visibleMentionItems = React.useMemo(() => {
    if (mentionFilter === null) return [];
    const prefixMatches = mentionItems.filter((item) => item.name.toLowerCase().startsWith(mentionBase));
    const containsMatches = mentionItems.filter(
      (item) => !item.name.toLowerCase().startsWith(mentionBase) && item.name.toLowerCase().includes(mentionBase),
    );
    return [...prefixMatches, ...containsMatches].slice(0, 8);
  }, [mentionBase, mentionFilter, mentionItems]);

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const maxHeight = isHomeComposer ? 240 : 120;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value, isHomeComposer]);

  const visibleSkillItems = React.useMemo(() => {
    if (mentionFilter === null || !allowSkillSelection) return [];
    const query = mentionFilter.toLowerCase();
    return getSelectableInstalledSkills(skillItems)
      .filter((skill) =>
        !query
        || (skill.displayName || skill.name).toLowerCase().includes(query)
        || (skill.description || "").toLowerCase().includes(query))
      .slice(0, 8);
  }, [allowSkillSelection, mentionFilter, skillItems]);

  const visibleAssistantItems = React.useMemo(() => {
    if (mentionFilter === null || hasActiveSession) return [];
    const query = mentionFilter.toLocaleLowerCase('zh-Hans-CN');
    return getSelectableInstalledAssistants(installedAssistants ?? [])
      .filter((assistant) => !query || [
        assistant.displayName,
        assistant.name,
        assistant.description,
        assistant.category,
      ].some((value) => String(value || '').toLocaleLowerCase('zh-Hans-CN').includes(query)))
      .slice(0, 8);
  }, [hasActiveSession, installedAssistants, mentionFilter]);

  const visibleConnectorItems = React.useMemo(() => {
    if (mentionFilter === null) return [];
    const query = mentionFilter.toLocaleLowerCase('zh-Hans-CN');
    return getSelectableInstalledConnectors(installedConnectors ?? [])
      .filter((connector) => !query || [
        connector.name,
        connector.description,
        connector.type,
      ].some((value) => String(value || '').toLocaleLowerCase('zh-Hans-CN').includes(query)))
      .slice(0, 8);
  }, [installedConnectors, mentionFilter]);

  const activeMentionItemCount = mentionTab === 'files'
    ? visibleMentionItems.length
    : mentionTab === 'skills'
      ? visibleSkillItems.length
      : mentionTab === 'assistants'
        ? visibleAssistantItems.length
        : visibleConnectorItems.length;

  const applyMention = React.useCallback((item: WorkspaceMentionItem) => {
    const isDir = item.type === "directory";
    const insert = isDir ? `@${item.relativePath}/` : `@${item.relativePath} `;
    onChange(value.replace(/(^|\s)@[^\s@]*$/, `$1${insert}`));
    setMentionIndex(0);
    setMentionFilter(isDir ? `${item.relativePath}/` : null);
  }, [onChange, value]);

  const applySkillMention = React.useCallback((skill: SkillMentionItem) => {
    setSelectedSkills((prev) => prev.some((item) => item.name === skill.name)
      ? prev.filter((item) => item.name !== skill.name)
      : [...prev, skill]);
    onChange(value.replace(/(^|\s)@[^\s@]*$/, "$1"));
    setMentionFilter(null);
    setMentionIndex(0);
    setMentionTab("files");
  }, [onChange, value]);

  const applyAssistantMention = React.useCallback((assistant: InstalledAssistant) => {
    if (selectedAssistant?.name === assistant.name) {
      onClearAssistant?.();
    } else {
      onSelectAssistant?.(assistant);
    }
    onChange(value.replace(/(^|\s)@[^\s@]*$/, "$1"));
    setMentionFilter(null);
    setMentionIndex(0);
    setMentionTab("files");
  }, [onChange, onClearAssistant, onSelectAssistant, selectedAssistant?.name, value]);

  const applyConnectorMention = React.useCallback((connector: InstalledConnector) => {
    onToggleConnector?.(connector);
    onChange(value.replace(/(^|\s)@[^\s@]*$/, "$1"));
    setMentionFilter(null);
    setMentionIndex(0);
    setMentionTab("files");
  }, [onChange, onToggleConnector, value]);

  const toggleSelectedSkill = React.useCallback((skill: SkillMentionItem) => {
    setSelectedSkills((prev) => prev.some((item) => item.name === skill.name)
      ? prev.filter((item) => item.name !== skill.name)
      : [...prev, skill]);
  }, []);

  React.useEffect(() => {
    pasteService.init();
    pasteService.registerHandler(composerId.current, async (event) => {
      const handled = await pasteService.handlePaste(
        event,
        (files) => setAttachmentsRef.current(prev => [...prev, ...files]),
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
            if (result && typeof result === 'object' && 'path' in result) savedPath = result.path;
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

  const handleSelectFile = async () => {
    const files = await window.agentDesktop.pickFiles();
    if (files.length > 0) {
      setAttachments(prev => [...prev, ...files]);
    }
  };

  const handleSelectDirectory = async () => {
    const dir = await window.agentDesktop.pickDirectory();
    if (dir) {
      onWorkspaceChange?.(dir);
    }
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
    onSend(files, allowSkillSelection && selectedSkills.length > 0 ? [...selectedSkills] : undefined);
    setAttachments([]);
    setSelectedSkills([]);
  };

  const selectedConnectorItems = React.useMemo(() => {
    const selected = new Set(selectedConnectorIds ?? []);
    return getSelectableInstalledConnectors(installedConnectors ?? [])
      .filter((connector) => selected.has(connector.id));
  }, [installedConnectors, selectedConnectorIds]);
  const hasSelectedResources = Boolean(selectedAssistant)
    || (allowSkillSelection && selectedSkills.length > 0)
    || selectedConnectorItems.length > 0;
  const selectedResourceIcons = hasSelectedResources ? (
    <div className="flex flex-wrap gap-1.5" aria-label="已选资源">
      {selectedAssistant ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {isHomeComposer && onClearAssistant ? (
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary transition-colors hover:bg-primary/15 hover:text-foreground"
                onClick={onClearAssistant}
                aria-label={`移除助手：${selectedAssistant.displayName || selectedAssistant.name}`}
              >
                <AssistantAvatar assistant={selectedAssistant} className="h-4 w-4" />
              </button>
            ) : (
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary"
                aria-label={`当前助手：${selectedAssistant.displayName || selectedAssistant.name}`}
              >
                <AssistantAvatar assistant={selectedAssistant} className="h-4 w-4" />
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent>
            {selectedAssistant.displayName || selectedAssistant.name}
            {isHomeComposer && onClearAssistant ? ' · 点击移除' : ' · 当前助手'}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {allowSkillSelection ? selectedSkills.map((skill) => (
        <Tooltip key={skill.name}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary transition-colors hover:bg-primary/15 hover:text-foreground"
              onClick={() => setSelectedSkills((prev) => prev.filter((item) => item.name !== skill.name))}
              aria-label={`移除技能：${skill.displayName || skill.name}`}
            >
              <SkillIcon skill={skill} className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{skill.displayName || skill.name} · 点击移除</TooltipContent>
        </Tooltip>
      )) : null}
      {selectedConnectorItems.map((connector) => (
        <Tooltip key={connector.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary transition-colors hover:bg-primary/15 hover:text-foreground"
              onClick={() => onToggleConnector?.(connector)}
              aria-label={`移除连接器：${connector.name}`}
            >
              <ConnectorIcon connector={connector} className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{connector.name} · 点击移除</TooltipContent>
        </Tooltip>
      ))}
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "rounded-[26px] border border-border/80 bg-card/92 backdrop-blur",
        isHomeComposer
          ? "shadow-[0_24px_80px_-44px_rgba(0,0,0,0.55)]"
          : "shadow-[0_16px_54px_-38px_rgba(0,0,0,0.45)]",
        className,
      )}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="relative">
        {slashCommandFilter && !isHomeComposer && !subMenuCommand && (
          <SlashCommandMenu
            filter={slashCommandFilter}
            onSelect={(cmd) => {
              const cmdKey = cmd.startsWith("/") ? cmd.slice(1) : cmd;
              if (COMMANDS_WITH_ARGS[cmdKey]) {
                setSubMenuCommand(cmdKey);
                setSlashCommandFilter(null);
                setSlashCommandIndex(0);
                setSubMenuIndex(0);
              } else {
                onChange(cmd + " ");
                setSlashCommandFilter(null);
                setSlashCommandIndex(0);
              }
            }}
            selectedIndex={slashCommandIndex}
            onSetSelectedIndex={setSlashCommandIndex}
          />
        )}
        {mentionFilter !== null && (
          <MentionMenu
            tabs={mentionTabs}
            tab={mentionTab}
            onTabChange={(tab) => {
              setMentionTab(tab);
              setMentionIndex(0);
            }}
            fileItems={visibleMentionItems}
            skillItems={visibleSkillItems}
            assistantItems={visibleAssistantItems}
            connectorItems={visibleConnectorItems}
            notice={visibleMentionItems.length === 0
              ? (mentionNotice ?? (sessionId ? "无匹配文件" : null))
              : null}
            selectedIndex={Math.min(mentionIndex, Math.max(0, activeMentionItemCount - 1))}
            selectedSkillNames={selectedSkills.map((skill) => skill.name)}
            selectedAssistantName={selectedAssistant?.name}
            selectedConnectorIds={selectedConnectorIds ?? []}
            onSelectFile={applyMention}
            onSelectSkill={applySkillMention}
            onSelectAssistant={applyAssistantMention}
            onSelectConnector={applyConnectorMention}
          />
        )}
        {subMenuCommand && !isHomeComposer && COMMANDS_WITH_ARGS[subMenuCommand] && (
          <SlashCommandSubMenu
            commandName={subMenuCommand}
            onSelect={(value) => {
              onChange(`/${subMenuCommand} ${value} `);
              setSubMenuCommand(null);
              setSubMenuIndex(0);
            }}
            selectedIndex={subMenuIndex}
            onSetSelectedIndex={setSubMenuIndex}
          />
        )}
        <Textarea
          placeholder={
            readOnlyReason
              ? readOnlyReason
              : (
            isHomeComposer
              ? selectedAssistant?.name === "app-builder-assistant" && selectedAppName
                ? `描述你想如何修改 ${selectedAppName}...`
                : selectedAssistant?.name === "app-builder-assistant"
                  ? "描述你想创建或修改的 App、目标用户、交互和风格..."
                  : composerIntent === "coordinator"
                    ? "描述复杂任务，我会启动多个 worker 并行执行..."
                    : composerIntent === "plan"
                    ? "描述需求，我会先给出计划..."
                      : defaultPlaceholder
              : defaultPlaceholder
              )
          }
          value={value}
          onChange={(event) => {
            const newValue = event.target.value;
            onChange(newValue);
            const caret = event.target.selectionStart ?? newValue.length;
            const filter = getSlashCommandFilter(newValue, caret);
            setSlashCommandFilter(filter);
            const mention = getFileMentionFilter(newValue, caret);
            setMentionFilter(mention);
            if (mention === null) setMentionIndex(0);
          }}
          disabled={Boolean(readOnlyReason)}
          ref={textareaRef}
          className={cn(
            "resize-none border-0 bg-transparent px-4 pt-4 text-sm leading-6 text-foreground caret-primary placeholder:text-muted-foreground/70 focus-visible:ring-0 sm:px-5",
            isHomeComposer
              ? "min-h-[160px] max-h-[240px] overflow-y-auto pb-4 [field-sizing:fixed]"
              : "min-h-[44px] max-h-[120px] overflow-y-auto pb-3 [field-sizing:fixed]",
          )}
          rows={isHomeComposer ? 5 : 1}
          onKeyDown={(event) => {
            if (mentionFilter !== null) {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                setMentionTab((prev) => event.key === "ArrowLeft"
                  ? getPreviousComposerMentionTab(mentionTabs, prev)
                  : getNextComposerMentionTab(mentionTabs, prev));
                setMentionIndex(0);
                return;
              }
              if (event.key === "Tab") {
                event.preventDefault();
                setMentionTab((prev) => getNextComposerMentionTab(mentionTabs, prev));
                setMentionIndex(0);
                return;
              }
              if (activeMentionItemCount > 0) {
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setMentionIndex((prev) => Math.max(0, prev - 1));
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setMentionIndex((prev) => Math.min(activeMentionItemCount - 1, prev + 1));
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  const clamped = Math.min(mentionIndex, activeMentionItemCount - 1);
                  if (mentionTab === "files") {
                    const item = visibleMentionItems[clamped];
                    if (item) applyMention(item);
                  } else if (mentionTab === "skills") {
                    const skill = visibleSkillItems[clamped];
                    if (skill) applySkillMention(skill);
                  } else if (mentionTab === "assistants") {
                    const assistant = visibleAssistantItems[clamped];
                    if (assistant) applyAssistantMention(assistant);
                  } else {
                    const connector = visibleConnectorItems[clamped];
                    if (connector) applyConnectorMention(connector);
                  }
                  return;
                }
              }
              if (event.key === "Escape") {
                setMentionFilter(null);
                setMentionIndex(0);
                setMentionTab("files");
                return;
              }
            }
            if (subMenuCommand && COMMANDS_WITH_ARGS[subMenuCommand]) {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSubMenuIndex((prev) => Math.max(0, prev - 1));
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSubMenuIndex((prev) => prev + 1);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                const options = COMMANDS_WITH_ARGS[subMenuCommand].optionList;
                const idx = Math.min(subMenuIndex, options.length - 1);
                if (options[idx]) {
                  onChange(`/${subMenuCommand} ${options[idx].value} `);
                  setSubMenuCommand(null);
                  setSubMenuIndex(0);
                }
                return;
              }
              if (event.key === "Escape") {
                setSubMenuCommand(null);
                setSubMenuIndex(0);
                return;
              }
              if (event.key === "Backspace" && !value.trim()) {
                setSubMenuCommand(null);
                setSubMenuIndex(0);
                return;
              }
            }
            if (slashCommandFilter) {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSlashCommandIndex((prev) => Math.max(0, prev - 1));
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSlashCommandIndex((prev) => prev + 1);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                const query = slashCommandFilter.toLowerCase().slice(1);
                const matches = SLASH_COMMANDS.filter(
                  (cmd: { name: string; description: string }) =>
                    cmd.name.toLowerCase().startsWith("/" + query) ||
                    cmd.description.toLowerCase().includes(query)
                );
                const visible = matches.slice(0, 8);
                const idx = Math.min(slashCommandIndex, visible.length - 1);
                if (visible[idx]) {
                  const cmdName = visible[idx].name;
                  const cmdKey = cmdName.startsWith("/") ? cmdName.slice(1) : cmdName;
                  if (COMMANDS_WITH_ARGS[cmdKey]) {
                    setSubMenuCommand(cmdKey);
                    setSlashCommandFilter(null);
                    setSlashCommandIndex(0);
                    setSubMenuIndex(0);
                  } else {
                    onChange(cmdName + " ");
                    setSlashCommandFilter(null);
                    setSlashCommandIndex(0);
                  }
                }
                return;
              }
              if (event.key === "Escape") {
                setSlashCommandFilter(null);
                setSlashCommandIndex(0);
                return;
              }
            }
            if (event.key === "Escape" && loading && onStop) {
              event.preventDefault();
              onStop();
              return;
            }
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

        {slashCommandFilter && isHomeComposer && !subMenuCommand && (
          <SlashCommandMenu
            filter={slashCommandFilter}
            onSelect={(cmd) => {
              const cmdKey = cmd.startsWith("/") ? cmd.slice(1) : cmd;
              if (COMMANDS_WITH_ARGS[cmdKey]) {
                setSubMenuCommand(cmdKey);
                setSlashCommandFilter(null);
                setSlashCommandIndex(0);
                setSubMenuIndex(0);
              } else {
                onChange(cmd + " ");
                setSlashCommandFilter(null);
                setSlashCommandIndex(0);
              }
            }}
            selectedIndex={slashCommandIndex}
            onSetSelectedIndex={setSlashCommandIndex}
          />
        )}
        {subMenuCommand && isHomeComposer && COMMANDS_WITH_ARGS[subMenuCommand] && (
          <SlashCommandSubMenu
            commandName={subMenuCommand}
            onSelect={(value) => {
              onChange(`/${subMenuCommand} ${value} `);
              setSubMenuCommand(null);
              setSubMenuIndex(0);
            }}
            selectedIndex={subMenuIndex}
            onSetSelectedIndex={setSubMenuIndex}
          />
        )}

      </div>

      {!isHomeComposer && (
        <div className="px-4 py-2 sm:px-5">
          {selectedResourceIcons ? <div className="mb-2">{selectedResourceIcons}</div> : null}
          {attachments.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachments.map((file, index) => (
                <FilePreview
                  key={`${file.path}-${index}`}
                  path={file.path}
                  onRemove={() => handleRemoveAttachment(index)}
                />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSelectFile}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/35 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                title="选择文件"
              >
                <Plus className="h-3 w-3" />
                <FileText className="h-3.5 w-3.5" />
                <span>文件</span>
              </button>

              <ComposerResourceSelectionArea
                skills={skillItems}
                selectedSkills={selectedSkills}
                onToggleSkill={allowSkillSelection ? toggleSelectedSkill : undefined}
                onOpenSkillHub={onOpenSkillHub}
                skillsLoading={skillsLoading}
                connectors={installedConnectors}
                selectedConnectorIds={selectedConnectorIds}
                onToggleConnector={onToggleConnector}
                onOpenConnectorHub={onOpenConnectorHub}
              />

              <span className="text-xs text-muted-foreground">模式：</span>
              <span className="inline-flex items-center rounded-full border border-green-500/50 bg-green-500/15 px-2 py-1 text-xs text-green-600">
                {activeIntentOption.title}
              </span>

            </div>

            <div className="flex items-center justify-end gap-2">
              {contextUsage && <ContextUsageRing usage={contextUsage} />}
              {loading && (
                <Button
                  variant="outline"
                  className="h-9 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
                  onClick={onStop}
                >
                  <Square className="h-3 w-3" />
                  <span className="ml-1">停止</span>
                </Button>
              )}

              <Button
                className="h-9 rounded-full px-3.5 sm:px-4"
                disabled={submitDisabled}
                onClick={handleSendClick}
              >
                <Send className="h-4 w-4" />
                {loading ? "排队" : "发送"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {isHomeComposer && (
        <div className="px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={handleSelectFile}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/35 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                title="选择文件"
              >
                <Plus className="h-3 w-3" />
                <FileText className="h-3.5 w-3.5" />
                <span>文件</span>
              </button>
              <button
                type="button"
                onClick={handleSelectDirectory}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/35 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                title="选择目录"
              >
                <Plus className="h-3 w-3" />
                <FolderOpen className="h-3.5 w-3.5" />
                <span>目录</span>
              </button>

              <span className="ml-2 shrink-0 text-xs text-muted-foreground">模式：</span>
              {[chatIntentOption, ...intentOptions].map((option) => {
                const isSelected = composerIntent === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onComposerIntentChange(option.id)}
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1.5 text-xs transition-colors",
                      isSelected
                        ? "border-green-500/50 bg-green-500/15 text-green-600"
                        : "border-border/70 bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    {option.title}
                  </button>
                );
              })}

              <ComposerResourceSelectionArea
                assistants={installedAssistants}
                selectedAssistant={selectedAssistant}
                onSelectAssistant={onSelectAssistant}
                onClearAssistant={onClearAssistant}
                onOpenExpertHub={onOpenExpertHub}
                skills={skillItems}
                selectedSkills={selectedSkills}
                onToggleSkill={allowSkillSelection ? toggleSelectedSkill : undefined}
                onOpenSkillHub={onOpenSkillHub}
                skillsLoading={skillsLoading}
                connectors={installedConnectors}
                selectedConnectorIds={selectedConnectorIds}
                onToggleConnector={onToggleConnector}
                onOpenConnectorHub={onOpenConnectorHub}
              />
            </div>

            <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
              {selectedAssistant?.name === "app-builder-assistant" && selectedAppName && (
                <span className="max-w-[160px] shrink-0 truncate rounded-full border border-border/70 bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
                  更新 {selectedAppName}
                </span>
              )}

              <Button
                className="h-9 rounded-full px-3.5 sm:px-4"
                disabled={submitDisabled}
                onClick={handleSendClick}
              >
                <Send className="h-4 w-4" />
                {loading ? "排队" : "发送"}
              </Button>
            </div>
          </div>

          {selectedResourceIcons ? <div className="mt-3">{selectedResourceIcons}</div> : null}
          {(attachments.length > 0 || workspace) && (
            <div className="mt-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {attachments.map((file, index) => (
                  <span
                    key={`${file.path}-${index}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-muted/60 px-2.5 py-1 text-xs text-foreground"
                  >
                    <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="max-w-[180px] truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(index)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}

                {workspace && (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs text-green-600">
                    <FolderOpen className="h-3 w-3 shrink-0" />
                    <span className="max-w-[220px] truncate">{workspace.split('/').pop() || workspace}</span>
                    <button
                      type="button"
                      onClick={() => onWorkspaceChange?.(undefined)}
                      className="text-green-600/60 hover:text-green-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
              </div>
            </div>
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
  attachments,
  onAttachmentsChange,
  workspace,
  onWorkspaceChange,
  onChange,
  onComposerIntentChange,
  onSend,
  installedAssistants,
  selectedAssistant,
  onSelectAssistant,
  onClearAssistant,
  installedConnectors,
  selectedConnectorIds,
  onToggleConnector,
  onOpenConnectorHub,
  onOpenExpertHub,
  onOpenSkillHub,
  remoteEnabled,
  newSessionMode,
  onNewSessionModeChange,
}: {
  value: string;
  selectedAppName: string;
  loading: boolean;
  composerIntent: ComposerIntent;
  sessionId?: string;
  attachments: Array<{ name: string; path: string }>;
  onAttachmentsChange: (attachments: Array<{ name: string; path: string }>) => void;
  workspace?: string;
  onWorkspaceChange: (workspace: string | undefined) => void;
  onChange: (value: string) => void;
  onComposerIntentChange: (intent: ComposerIntent) => void;
  onSend: (files?: Array<{ name: string; path: string }>, skills?: SkillMentionItem[]) => void;
  installedAssistants?: InstalledAssistant[];
  selectedAssistant?: InstalledAssistant | null;
  onSelectAssistant?: (assistant: InstalledAssistant) => void;
  onClearAssistant?: () => void;
  installedConnectors?: InstalledConnector[];
  selectedConnectorIds?: string[];
  onToggleConnector?: (connector: InstalledConnector) => void;
  onOpenConnectorHub?: () => void;
  onOpenExpertHub?: () => void;
  onOpenSkillHub?: () => void;
  remoteEnabled?: boolean;
  newSessionMode?: 'local' | 'remote-direct';
  onNewSessionModeChange?: (mode: 'local' | 'remote-direct') => void;
}) {
  return (
      <div className="flex h-full w-full min-w-0 flex-col items-center justify-center px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto mb-8 text-center sm:mb-10 w-full max-w-[720px]">
        <h1 className="text-2xl font-medium tracking-[-0.02em] text-foreground sm:text-3xl">
          Hi，今天有什么安排？
        </h1>
        <p className="mx-auto mt-3 max-w-[560px] text-sm leading-7 text-muted-foreground sm:text-base">
          让 moss 帮你规划任务、协同执行，或者通过助手直接开始一个新的构建目标。
        </p>
      </div>

      {remoteEnabled && (
        <div className="mx-auto mb-4 w-full max-w-[720px] flex flex-wrap justify-center gap-4">
          <button
            type="button"
            onClick={() => onNewSessionModeChange?.('local')}
            className={cn(
              "rounded-full border px-6 py-3 text-sm font-medium shadow-[0_8px_30px_-8px_rgba(0,0,0,0.4)] backdrop-blur transition-all",
              newSessionMode !== 'remote-direct'
                ? "border-green-500/50 bg-green-500/15 text-green-600 hover:bg-green-500/20 hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-12px_rgba(0,0,0,0.5)]"
                : "border-border/70 bg-card/60 text-foreground hover:-translate-y-0.5 hover:bg-card/80 hover:shadow-[0_14px_40px_-12px_rgba(0,0,0,0.5)]"
            )}
          >
            本地
          </button>
          <button
            type="button"
            onClick={() => onNewSessionModeChange?.('remote-direct')}
            className={cn(
              "rounded-full border px-6 py-3 text-sm font-medium shadow-[0_8px_30px_-8px_rgba(0,0,0,0.4)] backdrop-blur transition-all",
              newSessionMode === 'remote-direct'
                ? "border-green-500/50 bg-green-500/15 text-green-600 hover:bg-green-500/20 hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-12px_rgba(0,0,0,0.5)]"
                : "border-border/70 bg-card/60 text-foreground hover:-translate-y-0.5 hover:bg-card/80 hover:shadow-[0_14px_40px_-12px_rgba(0,0,0,0.5)]"
            )}
          >
            云端
          </button>
        </div>
      )}

      <ComposerPanel
        value={value}
        selectedAppName={selectedAppName}
        loading={loading}
        composerIntent={composerIntent}
        hasActiveSession={false}
        sessionId={sessionId}
        attachments={attachments}
        onAttachmentsChange={onAttachmentsChange}
        workspace={workspace}
        onWorkspaceChange={onWorkspaceChange}
        onChange={onChange}
        onComposerIntentChange={onComposerIntentChange}
        onSend={onSend}
        installedAssistants={installedAssistants}
        selectedAssistant={selectedAssistant ?? null}
        onSelectAssistant={onSelectAssistant}
        onClearAssistant={onClearAssistant}
        onOpenExpertHub={onOpenExpertHub}
        onOpenSkillHub={onOpenSkillHub}
        installedConnectors={installedConnectors}
        selectedConnectorIds={selectedConnectorIds}
        onToggleConnector={onToggleConnector}
        onOpenConnectorHub={onOpenConnectorHub}
        className="w-full max-w-[820px]"
      />
    </div>
  );
}

type OutlineEntry = {
  messageId: string;
  question: string;
  answerPreview: string;
};

function deriveOutline(messages: TranscriptRenderMessage[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let current: OutlineEntry | null = null;
  for (const message of messages) {
    if (message.type === "user_text") {
      current = {
        messageId: message.id,
        question: message.content.trim().slice(0, 80),
        answerPreview: "",
      };
      entries.push(current);
    } else if (current && !current.answerPreview && message.type === "assistant_text") {
      current.answerPreview = message.content.trim().slice(0, 80);
    }
  }
  return entries;
}

type WorkspaceMentionItem = {
  name: string;
  path: string;
  relativePath: string;
  type: "directory" | "file";
};

export type SkillMentionItem = InstalledSkillOption;

function getFileMentionFilter(text: string, cursorPos: number): string | null {
  const before = text.slice(0, cursorPos);
  const match = before.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? match[1] : null;
}

const MENTION_TAB_LABELS: Record<ComposerMentionTab, string> = {
  files: '文件',
  skills: '技能',
  assistants: '专家',
  connectors: '连接器',
};

function MentionResourceRow({
  active,
  selected,
  icon,
  title,
  description,
  selectionStyle,
  onSelect,
}: {
  active: boolean;
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  selectionStyle: 'check' | 'checkbox';
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'flex h-12 w-full items-center gap-3 rounded-md px-3 text-left transition-colors',
        active || selected ? 'bg-primary/10' : 'hover:bg-muted',
      )}
      onClick={onSelect}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      {selectionStyle === 'checkbox' ? (
        <span className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
        )}>
          {selected ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      ) : selected ? (
        <Check className="h-4 w-4 shrink-0 text-primary" />
      ) : null}
    </button>
  );
}

function MentionMenu({
  tabs,
  tab,
  onTabChange,
  fileItems,
  skillItems,
  assistantItems,
  connectorItems,
  notice,
  selectedIndex,
  selectedSkillNames,
  selectedAssistantName,
  selectedConnectorIds,
  onSelectFile,
  onSelectSkill,
  onSelectAssistant,
  onSelectConnector,
}: {
  tabs: ComposerMentionTab[];
  tab: ComposerMentionTab;
  onTabChange: (tab: ComposerMentionTab) => void;
  fileItems: WorkspaceMentionItem[];
  skillItems: SkillMentionItem[];
  assistantItems: InstalledAssistant[];
  connectorItems: InstalledConnector[];
  notice?: string | null;
  selectedIndex: number;
  selectedSkillNames: string[];
  selectedAssistantName?: string;
  selectedConnectorIds: string[];
  onSelectFile: (item: WorkspaceMentionItem) => void;
  onSelectSkill: (item: SkillMentionItem) => void;
  onSelectAssistant: (assistant: InstalledAssistant) => void;
  onSelectConnector: (connector: InstalledConnector) => void;
}) {
  const selectedSkills = new Set(selectedSkillNames);
  const selectedConnectors = new Set(selectedConnectorIds);
  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 overflow-hidden rounded-xl border border-border/70 bg-card/95 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.5)] backdrop-blur">
      <div className="flex min-w-0 items-center border-b border-border/50 px-2 py-1.5 text-xs">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 transition-colors",
                tab === key
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                onTabChange(key);
              }}
            >
              {MENTION_TAB_LABELS[key]}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden shrink-0 pl-2 pr-1 text-[10px] text-muted-foreground/60 sm:inline">
          ← → 切换 · Enter 选择
        </span>
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {tab === "files" ? (
          fileItems.length === 0 ? (
            notice ? <div className="px-3 py-2 text-xs text-muted-foreground">{notice}</div> : null
          ) : (
            fileItems.map((item, i) => (
              <button
                key={item.relativePath}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors",
                  i === selectedIndex
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                )}
                onClick={() => onSelectFile(item)}
              >
                {item.type === "directory" ? (
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{item.relativePath}{item.type === "directory" ? "/" : ""}</span>
              </button>
            ))
          )
        ) : tab === 'skills' ? (
          skillItems.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">没有匹配的已安装技能</div>
          ) : skillItems.map((skill, i) => (
            <MentionResourceRow
              key={skill.name}
              active={i === selectedIndex}
              selected={selectedSkills.has(skill.name)}
              icon={<SkillIcon skill={skill} className="h-4 w-4" />}
              title={skill.displayName || skill.name}
              description={skill.description || skill.name}
              selectionStyle="checkbox"
              onSelect={() => onSelectSkill(skill)}
            />
          ))
        ) : tab === 'assistants' ? (
          assistantItems.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">没有匹配的已安装专家</div>
          ) : assistantItems.map((assistant, i) => (
            <MentionResourceRow
              key={assistant.name}
              active={i === selectedIndex}
              selected={selectedAssistantName === assistant.name}
              icon={<AssistantAvatar assistant={assistant} className="h-4 w-4" />}
              title={assistant.displayName || assistant.name}
              description={assistant.description || assistant.category || assistant.name}
              selectionStyle="check"
              onSelect={() => onSelectAssistant(assistant)}
            />
          ))
        ) : connectorItems.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">没有匹配的已认证连接器</div>
        ) : connectorItems.map((connector, i) => (
          <MentionResourceRow
            key={connector.id}
            active={i === selectedIndex}
            selected={selectedConnectors.has(connector.id)}
            icon={<ConnectorIcon connector={connector} className="h-4 w-4" />}
            title={connector.name}
            description={`${connectorTypeLabel(connector)}${connector.description ? ` · ${connector.description}` : ''}`}
            selectionStyle="checkbox"
            onSelect={() => onSelectConnector(connector)}
          />
        ))}
      </div>
    </div>
  );
}

function formatTaskElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h${minutes % 60}m`;
  }
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: "等待中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  killed: "已停止",
};

export type ContextUsageInfo = {
  used: number;
  inputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  outputTokens: number;
};

const CONTEXT_WINDOW_TOKENS = 200_000;

function formatTokenCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function ContextUsageRing({ usage }: { usage: ContextUsageInfo }) {
  const pct = Math.min(1, usage.used / CONTEXT_WINDOW_TOKENS);
  const colorClass = pct >= 0.9
    ? "text-destructive"
    : pct >= 0.7
      ? "text-amber-500"
      : "text-muted-foreground";
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex cursor-default items-center", colorClass)}>
          <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90">
            <circle cx="9" cy="9" r={radius} fill="none" strokeWidth="2.5" className="stroke-border" />
            <circle
              cx="9"
              cy="9"
              r={radius}
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              stroke="currentColor"
              strokeDasharray={`${circumference * pct} ${circumference}`}
            />
          </svg>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div>
          上下文已用 {formatTokenCount(usage.used)} / {formatTokenCount(CONTEXT_WINDOW_TOKENS)}（{Math.round(pct * 100)}%）
        </div>
        <div className="mt-0.5 text-background/70">
          输入 {formatTokenCount(usage.inputTokens)} · 缓存读 {formatTokenCount(usage.cacheRead)} · 缓存写 {formatTokenCount(usage.cacheWrite)} · 输出 {formatTokenCount(usage.outputTokens)}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function deriveComposerActivity(
  messages: TranscriptRenderMessage[],
  loading: boolean,
) {
  if (!loading) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.type === "tool_use" && (m.status === "running" || m.status === "pending")) {
      return { label: `正在执行 ${m.displayName || m.toolName}`, kind: "tool" as const };
    }
    if (m.type === "thinking" && m.streaming) {
      const lines = m.content.trim().split("\n").filter(Boolean);
      const tail = lines[lines.length - 1] ?? "";
      return { label: tail.length > 64 ? `…${tail.slice(-64)}` : tail || "思考中", kind: "thinking" as const };
    }
    if (m.type === "assistant_text" && m.streaming) {
      return { label: "正在输出回复", kind: "text" as const };
    }
  }
  return { label: "正在思考", kind: "thinking" as const };
}

function ActivityStrip({
  label,
  startTime,
}: {
  label: string;
  startTime: number;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="mb-1 flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{formatTaskElapsed(Math.max(0, now - startTime))}</span>
    </div>
  );
}

function BackgroundTaskRow({
  sessionId,
  task,
  now,
}: {
  sessionId?: string;
  task: BackgroundTaskInfo;
  now: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [output, setOutput] = React.useState("");
  const [truncated, setTruncated] = React.useState(false);
  const outputRef = React.useRef<HTMLPreElement | null>(null);
  const isRunning = task.status === "running";

  React.useEffect(() => {
    if (!expanded || !sessionId) return;
    let cancelled = false;
    const fetchOutput = async () => {
      try {
        const res = await window.agentDesktop.getTaskOutput({ sessionId, taskId: task.id });
        if (cancelled) return;
        setOutput(res?.content ?? "");
        setTruncated(Boolean(res?.truncated));
      } catch {
        // ignore transient read failures; next poll retries
      }
    };
    void fetchOutput();
    if (!isRunning) return () => { cancelled = true; };
    const timer = window.setInterval(fetchOutput, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [expanded, isRunning, sessionId, task.id]);

  React.useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  const elapsed = task.startTime
    ? formatTaskElapsed((task.endTime ?? now) - task.startTime)
    : null;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/40 text-xs">
      <div className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-foreground"
          onClick={() => setExpanded((prev) => !prev)}
          title={task.command}
        >
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          {task.kind === "monitor" ? (
            <Activity className="h-3 w-3 shrink-0 text-amber-500" />
          ) : (
            <Terminal className="h-3 w-3 shrink-0 text-sky-500" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {task.description || task.command || task.id}
          </span>
        </button>
        {isRunning && (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
        )}
        <span className="shrink-0">
          {TASK_STATUS_LABELS[task.status] ?? task.status}
          {task.status === "failed" && task.exitCode != null ? ` (${task.exitCode})` : ""}
        </span>
        {elapsed && <span className="shrink-0 tabular-nums">{elapsed}</span>}
        {isRunning && sessionId && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 transition-colors hover:text-destructive"
            title="停止该后台任务"
            onClick={() => {
              void window.agentDesktop.killTask({ sessionId, taskId: task.id });
            }}
          >
            <Square className="h-3 w-3" />
          </button>
        )}
      </div>
      {expanded && (
        <div className="border-t border-border/50 px-3 py-2">
          {truncated && (
            <div className="pb-1 text-[10px] text-muted-foreground/70">（仅显示最近输出）</div>
          )}
          <pre
            ref={outputRef}
            className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground"
          >
            {output || "（暂无输出）"}
          </pre>
        </div>
      )}
    </div>
  );
}

function BackgroundTaskPanel({
  sessionId,
  tasks,
}: {
  sessionId?: string;
  tasks: BackgroundTaskInfo[];
}) {
  const hasRunning = tasks.some((t) => t.status === "running");
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!hasRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunning]);

  if (tasks.length === 0) return null;

  return (
    <div className="mb-2 space-y-1">
      {tasks.map((task) => (
        <BackgroundTaskRow key={task.id} sessionId={sessionId} task={task} now={now} />
      ))}
    </div>
  );
}

export function ChatArea({
  messages,
  value,
  selectedAppName,
  loading,
  readOnlyReason,
  hasActiveSession,
  isProjectSession = false,
  sessionTitle,
  sessionMessageCount,
  sessionId,
  sessionWorkspace,
  focusedToolUseId,
  pendingPlanApproval,
  planDecisionBusy,
  leftCollapsed,
  rightCollapsed,
  composerIntent,
  childSessions = [],
  childSessionDetail,
  childSessionLoading = false,
  onChange,
  onComposerIntentChange,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onApprovePlan,
  onRejectPlan,
  onSend,
  onStop,
  onOpenChildSession,
  onCloseChildSession,
  installedAssistants,
  selectedAssistant,
  onSelectAssistant,
  onClearAssistant,
  installedConnectors,
  selectedConnectorIds,
  onToggleConnector,
  onOpenConnectorHub,
  onOpenExpertHub,
  onOpenSkillHub,
  remoteEnabled,
  newSessionMode,
  onNewSessionModeChange,
  queuedMessages,
  onRemoveQueuedMessage,
  backgroundTasks,
  composerAttachments,
  onComposerAttachmentsChange,
  contextUsage,
  onForkSession,
  forkingSession = false,
  forkDisabledReason,
  autoCollapseToolCalls = false,
  onToggleAutoCollapseToolCalls,
  toolDisplaySettingBusy = false,
}: {
  messages: TranscriptRenderMessage[];
  value: string;
  selectedAppName: string;
  loading: boolean;
  readOnlyReason?: string | null;
  hasActiveSession: boolean;
  isProjectSession?: boolean;
  sessionTitle: string;
  sessionMessageCount: number;
  sessionId?: string;
  sessionWorkspace?: string;
  focusedToolUseId?: string;
  pendingPlanApproval: PendingPlanApproval | null;
  planDecisionBusy: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  composerIntent: ComposerIntent;
  childSessions?: SessionSummary[];
  childSessionDetail?: SessionDetail | null;
  childSessionLoading?: boolean;
  onChange: (value: string) => void;
  onComposerIntentChange: (intent: ComposerIntent) => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  onApprovePlan: () => void;
  onRejectPlan: () => void;
  onSend: (files?: Array<{ name: string; path: string }>, workspace?: string, skills?: SkillMentionItem[]) => void;
  onStop: () => void;
  onOpenChildSession?: (sessionId: string) => void;
  onCloseChildSession?: () => void;
  installedAssistants?: InstalledAssistant[];
  selectedAssistant?: InstalledAssistant | null;
  onSelectAssistant?: (assistant: InstalledAssistant) => void;
  onClearAssistant?: () => void;
  installedConnectors?: InstalledConnector[];
  selectedConnectorIds?: string[];
  onToggleConnector?: (connector: InstalledConnector) => void;
  onOpenConnectorHub?: () => void;
  onOpenExpertHub?: () => void;
  onOpenSkillHub?: () => void;
  remoteEnabled?: boolean;
  newSessionMode?: 'local' | 'remote-direct';
  onNewSessionModeChange?: (mode: 'local' | 'remote-direct') => void;
  queuedMessages?: Array<{ id: string; prompt: string; files?: Array<{ name: string; path: string }> }>;
  onRemoveQueuedMessage?: (id: string) => void;
  backgroundTasks?: BackgroundTaskInfo[];
  composerAttachments?: Array<{ name: string; path: string }>;
  onComposerAttachmentsChange?: (attachments: Array<{ name: string; path: string }>) => void;
  contextUsage?: ContextUsageInfo | null;
  onForkSession?: () => void;
  forkingSession?: boolean;
  forkDisabledReason?: string | null;
  autoCollapseToolCalls?: boolean;
  onToggleAutoCollapseToolCalls?: () => void;
  toolDisplaySettingBusy?: boolean;
}) {
  const [attachments, setAttachments] = React.useState<Array<{ name: string; path: string }>>([]);
  const [workspace, setWorkspace] = React.useState<string | undefined>();
  const virtualListRef = React.useRef<VirtualMessageListHandle | null>(null);
  const childSessionMessages = React.useMemo(
    () => buildWorkerRenderMessagesFromSubagentEvents(childSessionDetail?.history || []),
    [childSessionDetail?.history],
  );

  React.useEffect(() => {
    if (!focusedToolUseId || !hasActiveSession) return;
    const groupTimer = window.setTimeout(() => {
      virtualListRef.current?.scrollToTool(focusedToolUseId);
    }, 60);
    const exactTimer = window.setTimeout(() => {
      const selector = `[data-tool-use-id="${CSS.escape(focusedToolUseId)}"]`;
      document.querySelector<HTMLElement>(selector)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 320);
    return () => {
      window.clearTimeout(groupTimer);
      window.clearTimeout(exactTimer);
    };
  }, [focusedToolUseId, hasActiveSession, messages]);

  const outline = React.useMemo(() => deriveOutline(messages), [messages]);
  const handleJumpToOutlineItem = React.useCallback((messageId: string) => {
    virtualListRef.current?.scrollToMessage(messageId);
  }, []);

  const busyStartRef = React.useRef<number | null>(null);
  if (loading && busyStartRef.current === null) {
    busyStartRef.current = Date.now();
  } else if (!loading) {
    busyStartRef.current = null;
  }
  const composerActivity = React.useMemo(
    () => deriveComposerActivity(messages, loading),
    [messages, loading],
  );

  React.useEffect(() => {
    if (hasActiveSession) {
      setAttachments([]);
      setWorkspace(undefined);
    }
  }, [hasActiveSession]);

  const handleHomeLandingSend = (
    files: Array<{ name: string; path: string }> | undefined,
    skills?: SkillMentionItem[],
  ) => {
    onSend(files, workspace, skills);
  };

  if (!hasActiveSession) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(58,191,129,0.12),transparent_24%),radial-gradient(circle_at_80%_10%,rgba(255,176,32,0.1),transparent_24%),var(--background)]">
        <HomeLanding
          value={value}
          selectedAppName={selectedAppName}
          loading={loading}
          composerIntent={composerIntent}
          sessionId={sessionId}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          workspace={workspace}
          onWorkspaceChange={setWorkspace}
          onChange={onChange}
          onComposerIntentChange={onComposerIntentChange}
          onSend={handleHomeLandingSend}
          installedAssistants={installedAssistants}
          selectedAssistant={selectedAssistant ?? null}
          onSelectAssistant={onSelectAssistant}
          onClearAssistant={onClearAssistant ?? (() => {})}
          installedConnectors={installedConnectors}
          selectedConnectorIds={selectedConnectorIds}
          onToggleConnector={onToggleConnector}
          onOpenConnectorHub={onOpenConnectorHub}
          onOpenExpertHub={onOpenExpertHub}
          onOpenSkillHub={onOpenSkillHub}
          remoteEnabled={remoteEnabled}
          newSessionMode={newSessionMode}
          onNewSessionModeChange={onNewSessionModeChange}
        />
        <div className="shrink-0 px-3 pb-4 sm:px-4" />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(58,191,129,0.08),transparent_22%),var(--background)]">
      <SessionTabBar
        title={sessionTitle}
        messageCount={sessionMessageCount}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeft={onToggleLeftSidebar}
        onToggleRight={onToggleRightSidebar}
        autoCollapseToolCalls={autoCollapseToolCalls}
        onToggleAutoCollapseToolCalls={onToggleAutoCollapseToolCalls}
        toolDisplaySettingBusy={toolDisplaySettingBusy}
        outline={outline}
        onJumpToOutlineItem={handleJumpToOutlineItem}
        messages={messages}
        onFork={onForkSession}
        forking={forkingSession}
        forkDisabledReason={forkDisabledReason}
      />

      {(childSessionDetail || childSessionLoading) ? (
        <section className="absolute inset-x-0 bottom-0 top-14 z-30 flex min-h-0 flex-col bg-background" aria-label="成员会话">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/70 px-3 sm:px-4">
            <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={onCloseChildSession}>
              <ArrowLeft className="h-4 w-4" />
              返回群聊
            </Button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{childSessionDetail?.title || "加载成员会话…"}</div>
              <div className="text-[11px] text-muted-foreground">
                {childSessionDetail?.subagentStatus === "running" || childSessionDetail?.busy ? "执行中 · 由主持人调度" : "成员会话 · 只读"}
              </div>
            </div>
            {childSessionLoading ? <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </header>
          <MessageListPane
            key={childSessionDetail?.id || "loading-child-session"}
            className="min-h-0 flex-1"
            messages={childSessionMessages}
            workspace={childSessionDetail?.workspace}
            loading={Boolean(childSessionLoading || childSessionDetail?.busy || childSessionDetail?.subagentStatus === "running")}
            emptyState={(
              <div className="rounded-xl border border-dashed border-border/70 bg-card/50 px-3 py-4 text-xs text-muted-foreground">
                {childSessionLoading ? "正在加载成员会话…" : "该成员还没有可展示的消息。"}
              </div>
            )}
          />
        </section>
      ) : null}

      <ToolDisplaySettingsProvider autoCollapseToolCalls={autoCollapseToolCalls}>
        <MessageListPane
          key={sessionId || "default"}
          ref={virtualListRef}
          className="flex-1"
          messages={messages}
          workspace={sessionWorkspace}
          loading={loading}
          focusedToolUseId={focusedToolUseId}
          footer={pendingPlanApproval ? (
            <PlanApprovalCard
              pendingPlanApproval={pendingPlanApproval}
              busy={planDecisionBusy || loading}
              onApprove={onApprovePlan}
              onReject={onRejectPlan}
            />
          ) : undefined}
        />
      </ToolDisplaySettingsProvider>


      <div className="shrink-0 min-w-0 bg-background/94 px-3 py-3 backdrop-blur sm:px-4">
        <div className="mx-auto max-w-[1180px] min-w-0">
          {childSessions.length > 0 ? (
            <div
              className="mb-2 flex h-10 min-w-0 items-center justify-start overflow-hidden text-[11px] text-muted-foreground"
              aria-label={`${childSessions.length} 个子任务`}
            >
              <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                {childSessions.slice(0, 10).map((child) => {
                  const status = child.subagentStatus === 'running' || child.busy
                    ? '运行中'
                    : child.subagentStatus === 'failed' ? '失败' : '已完成';
                  return (
                    <Tooltip key={child.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="relative flex h-8 max-w-48 shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-card px-2 transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`打开子任务：${child.title}，${status}`}
                          onClick={() => onOpenChildSession?.(child.id)}
                        >
                          <img src="./build/icon.png" alt="" className={cn("h-4 w-4 shrink-0 object-contain", status === '运行中' && "animate-spin")} />
                          <span className="truncate">{child.title}</span>
                          <span
                            className={cn(
                              "absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full border border-card",
                              status === '运行中'
                                ? "bg-sky-500"
                                : status === '失败' ? "bg-destructive" : "bg-emerald-500",
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{child.title} · {status}</TooltipContent>
                    </Tooltip>
                  );
                })}
                {childSessions.length > 10 ? (
                  <span className="flex h-8 shrink-0 items-center rounded-lg border border-border/60 px-2 text-[10px] tabular-nums">
                    +{childSessions.length - 10}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
          {backgroundTasks && backgroundTasks.length > 0 && (
            <BackgroundTaskPanel sessionId={sessionId} tasks={backgroundTasks} />
          )}
          {loading && composerActivity && busyStartRef.current !== null && (
            <ActivityStrip label={composerActivity.label} startTime={busyStartRef.current} />
          )}
          {queuedMessages && queuedMessages.length > 0 && (
            <div className="mb-2 space-y-1">
              {queuedMessages.map((q, index) => (
                <div
                  key={q.id}
                  className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
                >
                  <Clock className="h-3 w-3 shrink-0" />
                  <span className="shrink-0 text-muted-foreground/70">#{index + 1} 排队中</span>
                  <span className="min-w-0 flex-1 truncate">
                    {q.prompt || `[${q.files?.length ?? 0} 个附件]`}
                    {q.prompt && q.files && q.files.length > 0 ? `（含 ${q.files.length} 个附件）` : ''}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 transition-colors hover:text-foreground"
                    onClick={() => onRemoveQueuedMessage?.(q.id)}
                    title="移除排队消息"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <ComposerPanel
            value={value}
            selectedAppName={selectedAppName}
            loading={loading}
            readOnlyReason={readOnlyReason}
            composerIntent={composerIntent}
            hasActiveSession
            sessionId={sessionId}
            attachments={composerAttachments}
            onAttachmentsChange={onComposerAttachmentsChange}
            contextUsage={contextUsage}
            onChange={onChange}
            onComposerIntentChange={onComposerIntentChange}
            onSend={(files, skills) => onSend(files, undefined, skills)}
            onStop={onStop}
            installedAssistants={installedAssistants}
            selectedAssistant={selectedAssistant ?? null}
            onSelectAssistant={onSelectAssistant}
            onClearAssistant={onClearAssistant}
            onOpenExpertHub={onOpenExpertHub}
            onOpenSkillHub={onOpenSkillHub}
            allowSkillSelection={!isProjectSession}
            installedConnectors={installedConnectors}
            selectedConnectorIds={selectedConnectorIds}
            onToggleConnector={onToggleConnector}
            onOpenConnectorHub={onOpenConnectorHub}
          />
        </div>
      </div>
    </div>
  );
}
