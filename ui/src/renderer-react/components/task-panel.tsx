"use client";

import * as React from "react";
import { Cloud, FolderOpen, Globe2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BrowserPanel } from "@/components/browser-panel";
import { FileTree } from "@/components/file-tree";
import type { FileTreeNode } from "@/types";

type TaskPanelView = "files" | "browser";

const viewMeta: Record<TaskPanelView, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  files: { label: "文件", icon: Cloud },
  browser: { label: "浏览器", icon: Globe2 },
};

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
