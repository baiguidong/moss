"use client";

import * as React from "react";
import {
  CheckCircle2,
  Circle,
  CircleDot,
  Cloud,
  FolderOpen,
  Globe2,
  ListChecks,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { BrowserPanel } from "@/components/browser-panel";
import { FileTree } from "@/components/file-tree";
import { WorkspaceVersions } from "@/components/workspace-versions";
import { WorkspaceToolbarButton } from "@/components/workspace-toolbar-button";
import type { FileTreeNode, SessionTask, SessionTaskStatus } from "@/types";

type TaskPanelView = "files" | "browser";
const workspaceIconButtonClass = "flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";

const viewMeta: Record<TaskPanelView, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  files: { label: "文件", icon: Cloud },
  browser: { label: "浏览器", icon: Globe2 },
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

function SessionTasks({
  tasks,
  projectName,
}: {
  tasks: SessionTask[];
  projectName?: string | null;
}) {
  const taskCounts = React.useMemo(() => {
    const counts: Record<SessionTaskStatus, number> = {
      pending: 0,
      in_progress: 0,
      completed: 0,
    };
    for (const task of tasks) counts[task.status] += 1;
    return counts;
  }, [tasks]);

  return (
    <section className="shrink-0 border-b border-border/80 px-3 py-2.5" aria-label="会话任务">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5 shrink-0" />
          <span>{projectName ? "项目任务" : "会话任务"}</span>
        </div>
        <Badge variant={tasks.length > 0 ? "default" : "secondary"}>
          {tasks.length} 项
        </Badge>
      </div>

      {tasks.length > 0 ? (
        <>
          <div className="mb-2 grid grid-cols-3 gap-1.5 text-[10px] text-muted-foreground">
            <div className="rounded-md border border-border/55 bg-background/55 px-1.5 py-1">
              {taskCounts.in_progress} 进行中
            </div>
            <div className="rounded-md border border-border/55 bg-background/55 px-1.5 py-1">
              {taskCounts.pending} 待处理
            </div>
            <div className="rounded-md border border-border/55 bg-background/55 px-1.5 py-1">
              {taskCounts.completed} 已完成
            </div>
          </div>
          <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
            {tasks.map((task) => {
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
                  className={cn("flex gap-2 rounded-md border px-2 py-2", meta.rowClassName)}
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
        <div className="rounded-md border border-dashed border-border/60 px-2 py-2 text-center text-[11px] text-muted-foreground">
          暂无任务
        </div>
      )}
    </section>
  );
}

export function TaskPanel({
  collapsed,
  searchQuery,
  onSearchChange,
  onRefresh,
  onOpenWorkspace,
  treeItems,
  expandedPaths,
  selectedFilePath,
  onFocusFile,
  onToggleFolder,
  onSelectFile,
  sessionId,
  sessionTasks = [],
  projectName,
  browserOpenSignal,
  onBrowserOpen,
  workspace,
  workspaceRemote = false,
  workspaceBusy = false,
  hasUnsavedEdits = false,
  onVersionRestored,
}: {
  collapsed: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void | Promise<void>;
  onOpenWorkspace: () => void;
  treeItems: FileTreeNode[];
  expandedPaths: Set<string>;
  selectedFilePath: string | null;
  onFocusFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
  sessionId?: string | null;
  sessionTasks?: SessionTask[];
  projectName?: string | null;
  browserOpenSignal?: number;
  onBrowserOpen?: () => void;
  workspace?: string;
  workspaceRemote?: boolean;
  workspaceBusy?: boolean;
  hasUnsavedEdits?: boolean;
  onVersionRestored?: () => void | Promise<void>;
}) {
  const [activeView, setActiveView] = React.useState<TaskPanelView>("files");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const searchButton = React.useRef<HTMLButtonElement>(null);
  const searchId = React.useId();
  const searchVisible = searchOpen || Boolean(searchQuery);

  React.useEffect(() => { setSearchOpen(false); }, [sessionId, workspace]);

  React.useEffect(() => {
    if (!browserOpenSignal) return;
    setActiveView("browser");
  }, [browserOpenSignal]);

  const selectView = (view: TaskPanelView) => {
    setActiveView(view);
    if (view === "browser") onBrowserOpen?.();
  };

  const closeSearch = () => {
    setSearchOpen(false);
    onSearchChange("");
    searchButton.current?.focus();
  };

  const workspaceActions = <>
    <WorkspaceToolbarButton aria-label="打开工作区" tooltip={sessionId ? "打开工作区" : "打开工作区：请先选择会话"} disabled={!sessionId} onClick={onOpenWorkspace}>
      <FolderOpen className="h-3.5 w-3.5" />
    </WorkspaceToolbarButton>
    <WorkspaceToolbarButton ref={searchButton} aria-label="搜索工作区文件" tooltip={searchVisible ? "收起搜索" : "搜索文件"} aria-expanded={searchVisible} aria-controls={searchVisible ? searchId : undefined} onClick={() => searchVisible ? closeSearch() : setSearchOpen(true)} className={cn(searchVisible && "bg-muted text-foreground")}>
      <Search className="h-3.5 w-3.5" />
    </WorkspaceToolbarButton>
  </>;

  if (collapsed) return null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border/80 px-3 py-2">
        <div className="grid grid-cols-2 gap-1 rounded-md border border-border/70 bg-muted/35 p-1">
          {(Object.keys(viewMeta) as TaskPanelView[]).map((view) => {
            const Icon = viewMeta[view].icon;
            return (
              <button
                key={view}
                type="button"
                onClick={() => selectView(view)}
                className={cn(
                  "flex h-8 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
                  activeView === view
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {viewMeta[view].label}
              </button>
            );
          })}
        </div>
      </div>

      {activeView === "browser" ? (
        <BrowserPanel sessionId={sessionId} />
      ) : (
        <>
          {sessionTasks.length > 0 && <SessionTasks tasks={sessionTasks} projectName={projectName} />}

          {sessionId && workspace ? <WorkspaceVersions
            key={`${sessionId}:${workspace}`}
            sessionId={sessionId}
            workspace={workspace}
            remote={workspaceRemote}
            busy={workspaceBusy}
            hasUnsavedEdits={hasUnsavedEdits}
            onRestored={onVersionRestored || onRefresh}
            onRefreshFiles={onRefresh}
            toolbarActions={workspaceActions}
          /> : <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3">
            <span className="shrink-0 text-xs font-medium">工作区</span>
            <div className="flex shrink-0 items-center gap-1">
              {workspaceActions}
              <WorkspaceToolbarButton aria-label="刷新工作区" tooltip="刷新工作区文件" disabled={!sessionId || !workspace} onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5" /></WorkspaceToolbarButton>
            </div>
          </div>}

          {searchVisible && <div id={searchId} className="flex h-9 shrink-0 items-center border-b border-border/80 px-3" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeSearch(); } }}>
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                aria-label="搜索工作区文件"
                placeholder="搜索文件..."
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                className="h-6 rounded bg-muted/50 pl-7 pr-6 text-xs placeholder:text-muted-foreground/60"
              />
              <button type="button" className={cn(workspaceIconButtonClass, "absolute right-0 top-1/2 -translate-y-1/2")} onClick={closeSearch} aria-label="关闭搜索" title="关闭搜索">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>}

          <ScrollArea constrainContentWidth className="min-h-0 w-full min-w-0 flex-1">
            <div className="w-full min-w-0 p-2">
              <FileTree
                items={treeItems}
                title="工作区文件"
                expandedPaths={expandedPaths}
                selectedFilePath={selectedFilePath}
                onFocusFile={onFocusFile}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
              />
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}
