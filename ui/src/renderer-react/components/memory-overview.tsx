"use client";

import * as React from "react";
import {
  Archive,
  BookOpenText,
  ChevronDown,
  ChevronRight,
  Clock3,
  Cloud,
  FileText,
  FolderKanban,
  HardDrive,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { cn } from "@/lib/utils";
import type {
  MemoryCatalog,
  MemoryEntryContent,
  MemoryGlobalEntry,
  MemoryProjectEntry,
  MemoryProjectHistoryEntry,
  MemorySessionEntry,
  MemorySource,
} from "../types";

export type MemoryScope = "global" | "project" | "session";

type MemorySelection =
  | { scope: "global"; path: string; source?: MemorySource }
  | { scope: "project"; projectId: string; kind: "overview" }
  | { scope: "project"; projectId: string; kind: "history"; sessionId: string }
  | { scope: "session"; sessionId: string };

const TYPE_LABELS: Record<string, string> = {
  index: "记忆索引",
  user: "用户信息",
  feedback: "协作反馈",
  project: "项目背景",
  reference: "常用资源",
  memory: "长期记忆",
};

const SOURCE_LABELS: Record<MemorySource, string> = {
  local: "本地全局记忆",
  remote: "云端全局记忆",
};

function entriesForSource(entries: MemoryGlobalEntry[], source: MemorySource): MemoryGlobalEntry[] {
  return entries.filter((entry) => (entry.source || "local") === source);
}

function selectionKey(selection: MemorySelection | null): string {
  if (!selection) return "";
  if (selection.scope === "global") return `global:${selection.source || "local"}:${selection.path}`;
  if (selection.scope === "session") return `session:${selection.sessionId}`;
  return selection.kind === "overview"
    ? `project:${selection.projectId}:overview`
    : `project:${selection.projectId}:history:${selection.sessionId}`;
}

export function defaultSelection(catalog: MemoryCatalog, scope: MemoryScope, source: MemorySource = "local"): MemorySelection | null {
  if (scope === "global") {
    const entries = entriesForSource(catalog.global.files, source).filter((entry) => entry.readable !== false);
    const first = entries.find((entry) => entry.isIndex)
      || entries.find((entry) => entry.indexed)
      || entries[0];
    return first ? { scope: "global", path: first.path, source } : null;
  }
  if (scope === "project") {
    const withOverview = catalog.projects.find((project) => project.hasOverview);
    if (withOverview) return { scope: "project", projectId: withOverview.id, kind: "overview" };
    const withHistory = catalog.projects.find((project) => (
      project.history.some((entry) => entry.readable !== false)
    ));
    const firstHistory = withHistory?.history.find((entry) => entry.readable !== false);
    return withHistory && firstHistory
      ? { scope: "project", projectId: withHistory.id, kind: "history", sessionId: firstHistory.sessionId }
      : null;
  }
  const first = catalog.sessions.find((session) => session.hasSummary && session.readable !== false);
  return first ? { scope: "session", sessionId: first.id } : null;
}

function selectionExists(catalog: MemoryCatalog, selection: MemorySelection | null, scope: MemoryScope, source: MemorySource): boolean {
  if (!selection || selection.scope !== scope) return false;
  if (selection.scope === "global") {
    if ((selection.source || "local") !== source) return false;
    return catalog.global.files.some((entry) => (
      entry.readable !== false
      && entry.path === selection.path
      && (entry.source || "local") === (selection.source || "local")
    ));
  }
  if (selection.scope === "session") {
    return catalog.sessions.some((entry) => (
      entry.id === selection.sessionId && entry.hasSummary && entry.readable !== false
    ));
  }
  const project = catalog.projects.find((entry) => entry.id === selection.projectId);
  if (!project) return false;
  return selection.kind === "overview"
    ? project.hasOverview
    : project.history.some((entry) => (
        entry.sessionId === selection.sessionId && entry.readable !== false
      ));
}

function formatDateTime(value: number | null | undefined): string {
  if (!value) return "尚未更新";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trimStart();
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="min-w-0 rounded-md border border-border/75 bg-card px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>{detail}</p>
    </section>
  );
}

function MemoryListButton({
  active,
  icon,
  title,
  description,
  meta,
  indent = false,
  disabled = false,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description?: string;
  meta?: string;
  indent?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        indent && "ml-5 w-[calc(100%-1.25rem)]",
        active
          ? "border-primary/35 bg-primary/8 text-foreground"
          : "border-transparent text-muted-foreground hover:border-border/80 hover:bg-muted/55 hover:text-foreground",
        disabled && "cursor-default opacity-60",
      )}
    >
      <span className={cn("mt-0.5 text-muted-foreground", active && "text-primary")}>{icon}</span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
          {meta ? <span className="shrink-0 text-[11px] text-muted-foreground">{meta}</span> : null}
        </span>
        {description ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </button>
  );
}

function CatalogEmpty({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border/80 bg-muted/45">{icon}</span>
      <p className="text-sm">{title}</p>
    </div>
  );
}

export function GlobalList({
  entries,
  source,
  selected,
  queryActive = false,
  emptyTitle,
  onSelect,
}: {
  entries: MemoryGlobalEntry[];
  source: MemorySource;
  selected: string;
  queryActive?: boolean;
  emptyTitle?: string;
  onSelect: (selection: MemorySelection) => void;
}) {
  const [showUnindexed, setShowUnindexed] = React.useState(false);
  const sourceEntries = entriesForSource(entries, source);
  if (sourceEntries.length === 0) {
    return <CatalogEmpty icon={source === "remote" ? <Cloud className="h-4 w-4" /> : <HardDrive className="h-4 w-4" />} title={emptyTitle || (queryActive ? "没有匹配的记忆" : `暂无${SOURCE_LABELS[source]}`)} />;
  }
  const indexEntries = sourceEntries.filter((entry) => entry.isIndex);
  const indexedEntries = sourceEntries.filter((entry) => entry.indexed && !entry.isIndex);
  const unindexedEntries = sourceEntries.filter((entry) => !entry.indexed && !entry.isIndex);
  const unindexedVisible = queryActive || showUnindexed
    || unindexedEntries.some((entry) => selected === selectionKey({ scope: "global", path: entry.path, source }));

  return (
    <div className="space-y-3">
      <section className="border-b border-border/70 pb-3" aria-label={`${SOURCE_LABELS[source]}索引`}>
        {indexEntries.map((entry) => (
          <MemoryListButton
            key={entry.id}
            active={selected === `global:${source}:${entry.path}`}
            icon={<BookOpenText className="h-4 w-4" />}
            title={entry.path}
            description={`${SOURCE_LABELS[source]}索引`}
            meta="记忆索引"
            disabled={!entry.readable}
            onClick={() => onSelect({ scope: "global", path: entry.path, source })}
          />
        ))}
        {indexEntries.length === 0 && !queryActive ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">尚未生成 MEMORY.md 索引</p>
        ) : null}
      </section>
      <section>
        <div className="mb-1 flex h-7 items-center justify-between px-2 text-xs font-semibold text-foreground">
          <span>有效记忆</span>
          <span className="font-normal tabular-nums text-muted-foreground">
            {indexedEntries.length}
          </span>
        </div>
        <div className="space-y-1">
          {indexedEntries.map((entry) => (
            <MemoryListButton
              key={entry.id}
              active={selected === `global:${entry.source || "local"}:${entry.path}`}
              icon={<FileText className="h-4 w-4" />}
              title={entry.title}
              description={entry.description || entry.path}
              meta={TYPE_LABELS[entry.type] || entry.type}
              disabled={!entry.readable}
              onClick={() => onSelect({ scope: "global", path: entry.path, source })}
            />
          ))}
        </div>
      </section>

      {unindexedEntries.length > 0 ? (
        <section className="border-t border-border/70 pt-2">
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            aria-expanded={unindexedVisible}
            onClick={() => setShowUnindexed((value) => !value)}
          >
            {unindexedVisible ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Archive className="h-3.5 w-3.5" />
            <span className="flex-1">未索引文件</span>
            <span className="tabular-nums">{unindexedEntries.length}</span>
          </button>
          {unindexedVisible ? (
            <div className="mt-1 space-y-1">
              {unindexedEntries.map((entry) => (
                <MemoryListButton
                  key={entry.id}
                  active={selected === `global:${entry.source || "local"}:${entry.path}`}
                  icon={<FileText className="h-4 w-4" />}
                  title={entry.title}
                  description={entry.description || entry.path}
                  meta="未索引"
                  disabled={!entry.readable}
                  onClick={() => onSelect({ scope: "global", path: entry.path, source })}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function GlobalMemorySourceTabs({ source, onChange }: {
  source: MemorySource;
  onChange: (source: MemorySource) => void;
}) {
  return (
    <div className="mt-6 inline-flex max-w-full gap-1 overflow-x-auto rounded-md border border-border/80 bg-muted/40 p-1" role="tablist" aria-label="全局记忆来源">
      {(["local", "remote"] as const).map((value) => {
        const Icon = value === "remote" ? Cloud : HardDrive;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={source === value}
            onClick={() => onChange(value)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              source === value
                ? "border-primary/50 bg-primary/10 font-semibold text-primary shadow-sm"
                : "border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {SOURCE_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}

function ProjectList({
  projects,
  selected,
  onSelect,
}: {
  projects: MemoryProjectEntry[];
  selected: string;
  onSelect: (selection: MemorySelection) => void;
}) {
  if (projects.length === 0) return <CatalogEmpty icon={<FolderKanban className="h-4 w-4" />} title="暂无项目记忆" />;
  return (
    <div className="space-y-4">
      {projects.map((project) => (
        <section key={project.id}>
          <div className="mb-1 flex items-center gap-2 px-2 text-xs font-semibold text-foreground">
            <FolderKanban className="h-3.5 w-3.5 text-primary" />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span className="font-normal tabular-nums text-muted-foreground">{project.finalizedSessionCount}</span>
          </div>
          {project.hasOverview ? (
            <MemoryListButton
              active={selected === `project:${project.id}:overview`}
              icon={<BookOpenText className="h-4 w-4" />}
              title="项目概览"
              description={`第 ${project.version} 版 · ${formatDateTime(project.memoryUpdatedAt)}`}
              onClick={() => onSelect({ scope: "project", projectId: project.id, kind: "overview" })}
            />
          ) : null}
          {project.history.map((history) => (
            <MemoryListButton
              key={history.id}
              active={selected === `project:${project.id}:history:${history.sessionId}`}
              icon={<Clock3 className="h-4 w-4" />}
              title={history.title}
              description={history.conclusion || "会话沉淀"}
              meta={formatDateTime(history.updatedAt)}
              indent
              disabled={!history.readable}
              onClick={() => onSelect({
                scope: "project",
                projectId: project.id,
                kind: "history",
                sessionId: history.sessionId,
              })}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

export function SessionList({
  sessions,
  selected,
  onSelect,
}: {
  sessions: MemorySessionEntry[];
  selected: string;
  onSelect: (selection: MemorySelection) => void;
}) {
  const summaries = sessions.filter((session) => session.hasSummary);
  if (summaries.length === 0) return <CatalogEmpty icon={<MessageSquareText className="h-4 w-4" />} title="暂无会话摘要" />;
  return (
    <div className="space-y-1">
      {summaries.map((session) => (
        <MemoryListButton
          key={session.id}
          active={selected === `session:${session.id}`}
          icon={<MessageSquareText className="h-4 w-4" />}
          title={session.title}
          description={session.projectName || (session.agentMode === "remote-direct" ? "Moss Server" : "普通会话")}
          meta={session.readable === false
            ? "超过大小限制"
            : formatDateTime(session.summaryUpdatedAt)}
          disabled={session.readable === false}
          onClick={() => onSelect({ scope: "session", sessionId: session.id })}
        />
      ))}
    </div>
  );
}

function matches(value: string, query: string): boolean {
  return value.toLocaleLowerCase("zh-CN").includes(query.toLocaleLowerCase("zh-CN"));
}

function latestTimestamp(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => Boolean(value));
  return valid.length > 0 ? Math.max(...valid) : null;
}

export function MemoryOverview({ scope }: { scope: MemoryScope }) {
  const [catalog, setCatalog] = React.useState<MemoryCatalog | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [globalSource, setGlobalSource] = React.useState<MemorySource>("local");
  const [requestedSelection, setSelection] = React.useState<MemorySelection | null>(null);
  const [detail, setDetail] = React.useState<MemoryEntryContent | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState("");
  const detailRequestRef = React.useRef(0);
  const selection = React.useMemo(() => {
    if (!catalog) return null;
    return selectionExists(catalog, requestedSelection, scope, globalSource)
      ? requestedSelection
      : defaultSelection(catalog, scope, globalSource);
  }, [catalog, requestedSelection, scope, globalSource]);

  const loadCatalog = React.useCallback(async () => {
    setLoading(true);
    try {
      const next = await window.agentDesktop.memory.getCatalog();
      setCatalog(next);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  React.useEffect(() => {
    setQuery("");
  }, [scope, globalSource]);

  React.useEffect(() => {
    const requestId = ++detailRequestRef.current;
    setDetail(null);
    setDetailError("");
    setDetailLoading(false);
    if (!catalog || !selection) return;

    const load = async () => {
      if (selection.scope === "session") {
        const session = catalog.sessions.find((entry) => entry.id === selection.sessionId);
        if (!session?.hasSummary) return;
      }
      setDetailLoading(true);
      try {
        const next = await window.agentDesktop.memory.readEntry(selection);
        if (detailRequestRef.current !== requestId) return;
        setDetail({
          ...next,
          content: selection.scope === "global" ? stripFrontmatter(next.content) : next.content,
        });
      } catch (loadError) {
        if (detailRequestRef.current !== requestId) return;
        setDetailError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (detailRequestRef.current === requestId) setDetailLoading(false);
      }
    };
    void load();
  }, [catalog, selection]);

  const normalizedQuery = query.trim();
  const sourceGlobalEntries = React.useMemo(() => (
    entriesForSource(catalog?.global.files || [], globalSource)
  ), [catalog, globalSource]);
  const globalEntries = React.useMemo(() => {
    if (!normalizedQuery) return sourceGlobalEntries;
    return sourceGlobalEntries.filter((entry) => entry.isIndex
      || matches(`${entry.title} ${entry.description} ${entry.path} ${entry.type}`, normalizedQuery));
  }, [sourceGlobalEntries, normalizedQuery]);
  const projects = React.useMemo(() => {
    const entries = catalog?.projects || [];
    if (!normalizedQuery) return entries;
    return entries.map((project) => {
      const projectMatch = matches(project.name, normalizedQuery);
      return {
        ...project,
        history: projectMatch
          ? project.history
          : project.history.filter((entry) => matches(`${entry.title} ${entry.conclusion}`, normalizedQuery)),
      };
    }).filter((project) => matches(project.name, normalizedQuery) || project.history.length > 0);
  }, [catalog, normalizedQuery]);
  const summarySessions = React.useMemo(() => (
    catalog?.sessions.filter((entry) => entry.hasSummary) || []
  ), [catalog]);
  const sessions = React.useMemo(() => {
    if (!normalizedQuery) return summarySessions;
    return summarySessions.filter((entry) => matches(`${entry.title} ${entry.projectName || ""}`, normalizedQuery));
  }, [summarySessions, normalizedQuery]);

  const selectedKey = selectionKey(selection);
  const selectedGlobal = selection?.scope === "global"
    ? catalog?.global.files.find((entry) => (
        entry.path === selection.path
        && (entry.source || "local") === (selection.source || "local")
      )) || null
    : null;
  const selectedProject = selection?.scope === "project"
    ? catalog?.projects.find((entry) => entry.id === selection.projectId) || null
    : null;
  const selectedHistory = selection?.scope === "project" && selection.kind === "history"
    ? selectedProject?.history.find((entry) => entry.sessionId === selection.sessionId) || null
    : null;
  const selectedSession = selection?.scope === "session"
    ? catalog?.sessions.find((entry) => entry.id === selection.sessionId) || null
    : null;

  const indexedGlobalEntries = sourceGlobalEntries.filter((entry) => entry.indexed && !entry.isIndex);
  const unindexedGlobalEntries = sourceGlobalEntries.filter((entry) => !entry.indexed && !entry.isIndex);
  const globalLatest = latestTimestamp(sourceGlobalEntries.filter((entry) => entry.indexed || entry.isIndex).map((entry) => entry.updatedAt));
  const globalRootLabel = globalSource === "remote"
    ? catalog?.global.remoteRootLabel || "Moss Server / memory"
    : catalog?.global.rootLabel || "~/.moss/memory";
  const remoteUnavailable = globalSource === "remote" && catalog?.global.remoteStatus
    && catalog.global.remoteStatus !== "ready";
  const globalEmptyTitle = remoteUnavailable
    ? catalog.global.remoteStatus === "error" ? "云端记忆加载失败，请刷新重试" : "尚未连接云端记忆，请在设置中连接 Moss Server"
    : undefined;
  const projectLatest = latestTimestamp(catalog?.projects.map((entry) => entry.memoryUpdatedAt) || []);
  const sessionLatest = latestTimestamp(summarySessions.map((entry) => entry.summaryUpdatedAt));
  const metrics = scope === "global" ? [
    { label: "有效记忆", value: remoteUnavailable ? "—" : String(indexedGlobalEntries.length), detail: "仅统计当前来源 MEMORY.md 已索引内容" },
    { label: "未索引文件", value: remoteUnavailable ? "—" : String(unindexedGlobalEntries.length), detail: "当前来源中未被 MEMORY.md 引用的文件" },
    { label: "最近更新", value: globalLatest ? formatDateTime(globalLatest) : "暂无", detail: globalRootLabel },
  ] : scope === "project" ? [
    { label: "已有沉淀的项目", value: String(catalog?.projects.filter((entry) => entry.hasOverview || entry.history.length > 0).length || 0), detail: `${catalog?.projects.length || 0} 个 Moss 项目` },
    { label: "会话沉淀", value: String(catalog?.projects.reduce((sum, entry) => sum + entry.history.length, 0) || 0), detail: "由项目会话完成时生成" },
    { label: "最近更新", value: projectLatest ? formatDateTime(projectLatest) : "暂无", detail: "仅在所属项目中使用" },
  ] : [
    { label: "会话摘要", value: String(summarySessions.length), detail: "仅展示已生成摘要的会话" },
    { label: "项目会话", value: String(summarySessions.filter((entry) => entry.projectId).length), detail: "与项目沉淀相互独立" },
    { label: "最近更新", value: sessionLatest ? formatDateTime(sessionLatest) : "暂无", detail: "仅用于当前会话上下文" },
  ];

  const detailTitle = selectedGlobal?.title
    || (selectedHistory ? selectedHistory.title : selectedProject?.name)
    || selectedSession?.title
    || "选择一条记忆";
  const detailDescription = selectedGlobal?.description
    || (selectedHistory ? `${selectedProject?.name || "项目"} · 会话沉淀` : selectedProject ? `项目概览 · 第 ${selectedProject.version} 版` : "")
    || (selectedSession?.projectName ? `${selectedSession.projectName} · 当前上下文` : selectedSession ? "当前上下文" : "");
  const detailUpdatedAt = detail?.updatedAt
    || selectedGlobal?.updatedAt
    || selectedHistory?.updatedAt
    || selectedProject?.memoryUpdatedAt
    || selectedSession?.summaryUpdatedAt;

  if (error) {
    return (
      <div className="mt-8 flex min-h-72 flex-col items-center justify-center gap-3 border-y border-border/70 text-sm text-muted-foreground">
        <p>记忆数据暂时不可用</p>
        <Button variant="outline" size="sm" onClick={() => void loadCatalog()}>
          <RefreshCw className="h-4 w-4" />重试
        </Button>
      </div>
    );
  }

  return (
    <div className="pb-8">
      {scope === "global" ? (
        <GlobalMemorySourceTabs source={globalSource} onChange={(source) => {
          if (source === globalSource) return;
          ++detailRequestRef.current;
          setGlobalSource(source);
          setQuery("");
          setDetail(null);
          setDetailError("");
          setSelection(null);
        }} />
      ) : null}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {loading && !catalog
          ? Array.from({ length: 3 }, (_, index) => <div key={index} className="h-[104px] animate-pulse rounded-md border border-border/70 bg-muted/50" />)
          : metrics.map((metric) => <Metric key={metric.label} {...metric} />)}
      </div>

      <section className="mt-6 overflow-hidden rounded-md border border-border/80 bg-card shadow-sm">
        <div className="grid min-h-[560px] lg:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-border/80 bg-muted/20 lg:border-b-0 lg:border-r">
            <div className="border-b border-border/70 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={scope === "global" ? `搜索${SOURCE_LABELS[globalSource]}` : scope === "project" ? "搜索项目沉淀" : "搜索会话摘要"}
                  aria-label="搜索记忆"
                  className="bg-background pl-9"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2.5 lg:max-h-[650px]">
              {scope === "global" ? (
                <GlobalList
                  key={globalSource}
                  entries={globalEntries}
                  source={globalSource}
                  selected={selectedKey}
                  queryActive={Boolean(normalizedQuery)}
                  emptyTitle={globalEmptyTitle}
                  onSelect={setSelection}
                />
              ) : scope === "project" ? (
                <ProjectList projects={projects} selected={selectedKey} onSelect={setSelection} />
              ) : (
                <SessionList sessions={sessions} selected={selectedKey} onSelect={setSelection} />
              )}
            </div>
          </aside>

          <article className="flex min-h-0 min-w-0 flex-col">
            <header className="flex min-h-[76px] flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-foreground">{detailTitle}</h2>
                  <Badge variant="outline">
                    {scope === "global" ? SOURCE_LABELS[globalSource] : scope === "project" ? "项目记忆" : "会话摘要"}
                  </Badge>
                  {selectedGlobal ? <Badge variant="secondary">{TYPE_LABELS[selectedGlobal.type] || selectedGlobal.type}</Badge> : null}
                  {selectedGlobal && !selectedGlobal.indexed ? <Badge variant="outline">未索引</Badge> : null}
                  {selectedSession?.agentMode === "remote-direct" ? <Badge variant="secondary">Moss Server</Badge> : null}
                </div>
                {detailDescription ? <p className="mt-1 truncate text-xs text-muted-foreground">{detailDescription}</p> : null}
                {selectedGlobal ? <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{selectedGlobal.path}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                {detail?.bytes || selectedGlobal?.bytes || selectedHistory?.bytes || selectedSession?.bytes
                  ? <span>{formatBytes(detail?.bytes || selectedGlobal?.bytes || selectedHistory?.bytes || selectedSession?.bytes || 0)}</span>
                  : null}
                <span>{formatDateTime(detailUpdatedAt)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="刷新记忆"
                  title="刷新"
                  disabled={loading}
                  onClick={() => void loadCatalog()}
                >
                  <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                </Button>
              </div>
            </header>

            <div className="min-h-[480px] flex-1 overflow-y-auto px-6 py-5 lg:max-h-[650px] lg:px-8">
              {detailLoading ? (
                <div className="flex min-h-72 items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" aria-label="正在加载记忆" />
                </div>
              ) : detailError ? (
                <CatalogEmpty icon={<FileText className="h-4 w-4" />} title={detailError} />
              ) : detail?.content.trim() ? (
                <MarkdownRenderer content={detail.content} variant="document" sourceId={`memory:${selectedKey}`} />
              ) : (
                <CatalogEmpty icon={<BookOpenText className="h-4 w-4" />} title="请选择左侧记忆" />
              )}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
