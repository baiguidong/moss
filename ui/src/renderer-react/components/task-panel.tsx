"use client";

import * as React from "react";
import {
  CheckCircle2,
  Cloud,
  Circle,
  CircleDot,
  FileClock,
  FolderOpen,
  Globe2,
  LayoutDashboard,
  ListChecks,
  Search,
  X,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { BrowserPanel } from "@/components/browser-panel";
import { FileTree } from "@/components/file-tree";
import type { FileTreeNode, SessionTask, SessionTaskStatus, WorkspacePreviewData } from "@/types";

export type PreviewTabData = WorkspacePreviewData;
type TaskPanelView = "overview" | "files" | "browser" | "changes";

const viewMeta: Record<TaskPanelView, { label: string; title: string; icon: React.ComponentType<{ className?: string }> }> = {
  overview: { label: "概览", title: "概览", icon: LayoutDashboard },
  files: { label: "文件", title: "工作空间文件", icon: Cloud },
  browser: { label: "浏览器", title: "浏览器", icon: Globe2 },
  changes: { label: "变更", title: "变更", icon: FileClock },
};

const taskStatusMeta: Record<SessionTaskStatus, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  rowClassName: string;
}> = {
  pending: {
    label: "待处理",
    icon: Circle,
    iconClassName: "text-muted-foreground",
    rowClassName: "border-border/55 bg-background/60",
  },
  in_progress: {
    label: "进行中",
    icon: CircleDot,
    iconClassName: "text-primary",
    rowClassName: "border-primary/35 bg-primary/10",
  },
  completed: {
    label: "已完成",
    icon: CheckCircle2,
    iconClassName: "text-emerald-600 dark:text-emerald-400",
    rowClassName: "border-border/45 bg-background/45",
  },
};

function getTaskDisplayText(task: SessionTask): string {
  if (task.status === "in_progress" && task.activeForm?.trim()) {
    return task.activeForm.trim();
  }
  return task.subject;
}

function previewLabel(tab: WorkspacePreviewData): string {
  switch (tab.contentType) {
    case "markdown":
      return "Markdown";
    case "html":
      return "HTML";
    case "image":
      return "图片";
    case "pdf":
      return "PDF";
    case "word":
      return "Word";
    case "excel":
      return "Excel";
    case "ppt":
      return "PPT";
    case "diff":
      return "Diff";
    case "url":
      return "URL";
    case "text":
      return "文本";
    case "unsupported":
      return "不支持";
    case "code":
    default:
      return "代码";
  }
}

function countFiles(items: FileTreeNode[]): number {
  let count = 0;
  for (const item of items) {
    if (item.type === "file") {
      count += 1;
    } else if (item.children) {
      count += countFiles(item.children);
    }
  }
  return count;
}

function isDirtyPreview(tab: WorkspacePreviewData): boolean {
  return Boolean((tab.metadata as { dirty?: boolean } | undefined)?.dirty);
}

export function TaskPanel({
  collapsed,
  onToggleCollapse,
  searchQuery,
  onSearchChange,
  onRefresh,
  onOpenWorkspace,
  treeItems,
  expandedPaths,
  selectedFilePath,
  onToggleFolder,
  onSelectFile,
  previewTabs,
  activePreviewPath,
  onActivatePreview,
  previewTitle,
  sessionId,
  sessionTasks,
  projectName,
  browserOpenSignal,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onOpenWorkspace: () => void;
  treeItems: FileTreeNode[];
  expandedPaths: Set<string>;
  selectedFilePath: string | null;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
  previewTabs: PreviewTabData[];
  activePreviewPath: string | null;
  onActivatePreview: (path: string) => void;
  previewTitle: string;
  sessionId?: string | null;
  sessionTasks?: SessionTask[];
  projectName?: string | null;
  browserOpenSignal?: number;
}) {
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [activeView, setActiveView] = React.useState<TaskPanelView>("overview");
  const ActiveViewIcon = viewMeta[activeView].icon;
  const activePreviewTab = React.useMemo(
    () => previewTabs.find((tab) => tab.path === activePreviewPath) || previewTabs[0] || null,
    [activePreviewPath, previewTabs]
  );
  const visibleFileCount = React.useMemo(() => countFiles(treeItems), [treeItems]);
  const dirtyPreviewCount = React.useMemo(() => previewTabs.filter(isDirtyPreview).length, [previewTabs]);
  const taskCounts = React.useMemo(() => {
    const counts: Record<SessionTaskStatus, number> = {
      pending: 0,
      in_progress: 0,
      completed: 0,
    };
    for (const task of sessionTasks || []) {
      counts[task.status] += 1;
    }
    return counts;
  }, [sessionTasks]);

  React.useEffect(() => {
    if (!browserOpenSignal) return;
    setActiveView("browser");
  }, [browserOpenSignal]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setIsRefreshing(false), 300);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_96%,transparent),color-mix(in_oklab,var(--background)_94%,transparent))]">
      {collapsed ? null : (
        <>
          <div className="border-b border-border/80 px-3 py-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ActiveViewIcon className="h-4 w-4 text-primary" />
                <span>{viewMeta[activeView].title}</span>
              </div>
              <div className="grid grid-cols-4 gap-1 rounded-md border border-border/70 bg-muted/35 p-1">
                {(Object.keys(viewMeta) as TaskPanelView[]).map((view) => (
                  <button
                    key={view}
                    type="button"
                    title={viewMeta[view].title}
                    onClick={() => setActiveView(view)}
                    className={cn(
                      "h-7 rounded px-1 text-xs font-medium transition-colors",
                      activeView === view
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {viewMeta[view].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {activeView === "overview" ? (
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-3 p-3">
                <div className="rounded-lg border border-border/65 bg-card/72 p-3">
                  <div className="mb-3 text-xs font-medium text-muted-foreground">当前会话</div>
                  {projectName ? (
                    <div className="mb-3 rounded-md border border-primary/25 bg-primary/8 px-2 py-1.5 text-xs text-primary">
                      项目：{projectName}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-border/60 bg-background/75 p-2">
                      <div className="text-lg font-semibold text-foreground">{visibleFileCount}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">文件</div>
                    </div>
                    <div className="rounded-md border border-border/60 bg-background/75 p-2">
                      <div className="text-lg font-semibold text-foreground">{previewTabs.length}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">预览</div>
                    </div>
                    <div className="rounded-md border border-border/60 bg-background/75 p-2">
                      <div className="text-lg font-semibold text-foreground">{dirtyPreviewCount}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">未保存</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border/65 bg-card/72 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    <span>当前文件</span>
                  </div>
                  <div className="truncate rounded-md border border-border/60 bg-background/75 px-2 py-2 font-mono text-xs text-foreground">
                    {previewTitle || "未选择文件"}
                  </div>
                </div>

                <div className="rounded-lg border border-border/65 bg-card/72 p-3">
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                      <ListChecks className="h-3.5 w-3.5 shrink-0" />
                      <span>{projectName ? "项目任务" : "会话任务"}</span>
                    </div>
                    <Badge variant={(sessionTasks?.length || 0) > 0 ? "default" : "secondary"}>
                      {sessionTasks?.length || 0} 项
                    </Badge>
                  </div>

                  {(sessionTasks?.length || 0) > 0 ? (
                    <>
                      <div className="mb-2 grid grid-cols-3 gap-1.5 text-[11px] text-muted-foreground">
                        <div className="rounded-md border border-border/55 bg-background/55 px-2 py-1">
                          {taskCounts.in_progress} 进行中
                        </div>
                        <div className="rounded-md border border-border/55 bg-background/55 px-2 py-1">
                          {taskCounts.pending} 待处理
                        </div>
                        <div className="rounded-md border border-border/55 bg-background/55 px-2 py-1">
                          {taskCounts.completed} 已完成
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {sessionTasks!.map((task) => {
                          const meta = taskStatusMeta[task.status];
                          const Icon = meta.icon;
                          const displayText = getTaskDisplayText(task);
                          const showOriginal =
                            task.status === "in_progress" &&
                            Boolean(task.activeForm?.trim()) &&
                            task.activeForm?.trim() !== task.subject.trim();

                          return (
                            <div
                              key={task.id}
                              className={cn(
                                "flex gap-2 rounded-md border px-2 py-2",
                                meta.rowClassName,
                              )}
                            >
                              <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", meta.iconClassName)} />
                              <div className="min-w-0 flex-1">
                                <div
                                  className={cn(
                                    "break-words text-xs leading-snug text-foreground",
                                    task.status === "in_progress" && "font-medium",
                                    task.status === "completed" && "text-muted-foreground line-through",
                                  )}
                                >
                                  {displayText}
                                </div>
                                {showOriginal ? (
                                  <div className="mt-1 break-words text-[11px] leading-snug text-muted-foreground">
                                    {task.subject}
                                  </div>
                                ) : null}
                                {task.owner || task.blockedBy.length > 0 ? (
                                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                                    {task.owner ? <span>@{task.owner}</span> : null}
                                    {task.blockedBy.length > 0 ? (
                                      <span>阻塞于 #{task.blockedBy.join(", #")}</span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                              <span className="shrink-0 self-start rounded border border-border/55 bg-background/55 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {meta.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-md border border-dashed border-border/65 bg-background/45 px-2 py-2 text-xs text-muted-foreground">
                      当前会话还没有任务。
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveView("files")}
                    className="rounded-lg border border-border/65 bg-card/72 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/35 hover:text-foreground"
                  >
                    打开工作空间文件
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveView("browser")}
                    className="rounded-lg border border-border/65 bg-card/72 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/35 hover:text-foreground"
                  >
                    打开浏览器
                  </button>
                </div>
              </div>
            </ScrollArea>
          ) : activeView === "browser" ? (
            <BrowserPanel sessionId={sessionId} />
          ) : activeView === "changes" ? (
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-2 p-3">
                {previewTabs.length === 0 ? (
                  <div className="rounded-lg border border-border/65 bg-card/72 p-3 text-xs text-muted-foreground">
                    当前会话还没有打开的文件变更。
                  </div>
                ) : (
                  previewTabs.map((tab) => (
                    <button
                      key={tab.path}
                      type="button"
                      onClick={() => onActivatePreview(tab.path)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors",
                        activePreviewPath === tab.path
                          ? "border-primary/45 bg-primary/10"
                          : "border-border/65 bg-card/72 hover:border-primary/35",
                      )}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {tab.relativePath.split("/").pop()}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {tab.relativePath}
                        </span>
                      </span>
                      <Badge variant={isDirtyPreview(tab) ? "default" : "secondary"}>
                        {isDirtyPreview(tab) ? "未保存" : previewLabel(tab)}
                      </Badge>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          ) : (
            <>
              <div className="border-b border-border/80 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="搜索文件..."
                      value={searchQuery}
                      onChange={(e) => onSearchChange(e.target.value)}
                      className="h-10 rounded-xl bg-muted/50 pl-9 pr-8 text-sm placeholder:text-muted-foreground/60"
                    />
                    {searchQuery && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => onSearchChange("")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-3 p-3">
                  <div className="rounded-[22px] border border-border/65 bg-card/72 p-2.5 shadow-[0_18px_60px_-48px_rgba(0,0,0,0.6)]">
                    <FileTree
                      items={treeItems}
                      title="工作区文件"
                      expandedPaths={expandedPaths}
                      selectedFilePath={selectedFilePath}
                      onToggleFolder={onToggleFolder}
                      onSelectFile={onSelectFile}
                      onRefresh={handleRefresh}
                    />
                  </div>

                  <div className="rounded-[22px] border border-border/65 bg-card/72 p-3 shadow-[0_18px_60px_-48px_rgba(0,0,0,0.6)]">
                    <div className="mb-2.5 flex items-center gap-2">
                      <FolderOpen className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">预览</span>
                    </div>

                    <div className="mb-2.5 flex flex-wrap gap-2">
                      {previewTabs.length === 0 ? (
                        <Badge variant="secondary">未打开文件</Badge>
                      ) : (
                        previewTabs.map((tab) => (
                          <button
                            key={tab.path}
                            onClick={() => onActivatePreview(tab.path)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs transition-colors",
                              activePreviewPath === tab.path
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                            )}
                          >
                            {tab.relativePath.split("/").pop()}
                          </button>
                        ))
                      )}
                    </div>

                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" />
                      <span className="truncate">{previewTitle}</span>
                    </div>
                    {activePreviewPath ? (
                      <div className="rounded-[18px] border border-border/60 bg-background/90 p-3 text-[11px] leading-relaxed text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-2">
                          {activePreviewTab ? <Badge variant="secondary">{previewLabel(activePreviewTab)}</Badge> : null}
                          <span>文件已在左侧预览抽屉打开。</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[18px] border border-border/60 bg-background/90 p-3 text-[11px] leading-relaxed text-muted-foreground">
                        点击文件后会在左侧打开预览抽屉。
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>

              <div className="flex justify-end border-t border-border/80 px-3 py-2.5">
                <button
                  type="button"
                  className="rounded-full border border-border/70 bg-card/75 px-3 py-1.5 text-xs text-primary transition-colors hover:border-primary/35 hover:text-primary/80"
                  onClick={onOpenWorkspace}
                >
                  工作区预览
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
