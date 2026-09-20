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
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { BrowserPanel } from "@/components/browser-panel";
import { FileTree } from "@/components/file-tree";
import type { FileTreeNode, SessionTask, SessionTaskStatus } from "@/types";

type TaskPanelView = "files" | "browser";

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
  onSaveFileToLibrary,
}: {
  collapsed: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
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
  onSaveFileToLibrary?: (path: string, target?: 'personal' | 'project') => Promise<void>;
}) {
  const [activeView, setActiveView] = React.useState<TaskPanelView>("files");

  React.useEffect(() => {
    if (!browserOpenSignal) return;
    setActiveView("browser");
  }, [browserOpenSignal]);

  const selectView = (view: TaskPanelView) => {
    setActiveView(view);
    if (view === "browser") onBrowserOpen?.();
  };

  if (collapsed) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
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
          <SessionTasks tasks={sessionTasks} projectName={projectName} />

          <div className="shrink-0 border-b border-border/80 px-3 py-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索文件..."
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                className="h-9 rounded-md bg-muted/50 pl-9 pr-8 text-sm placeholder:text-muted-foreground/60"
              />
              {searchQuery ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => onSearchChange("")}
                  title="清除搜索"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="p-2">
              <FileTree
                items={treeItems}
                title="工作区文件"
                expandedPaths={expandedPaths}
                selectedFilePath={selectedFilePath}
                onFocusFile={onFocusFile}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
                onRefresh={onRefresh}
                onSaveToLibrary={onSaveFileToLibrary}
                projectName={projectName}
              />
            </div>
          </ScrollArea>

          <div className="shrink-0 border-t border-border/80 px-3 py-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full justify-center gap-2 rounded-md text-xs"
              onClick={onOpenWorkspace}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              打开工作区
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
