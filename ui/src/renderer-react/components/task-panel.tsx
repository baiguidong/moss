"use client";

import * as React from "react";
import {
  Search,
  X,
  RefreshCw,
  Cloud,
  FileText,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { FileTree } from "@/components/file-tree";
import type { FileTreeNode } from "@/types";

export type PreviewTabData = {
  path: string;
  relativePath: string;
  content: string;
  size?: number;
  truncated?: boolean;
};

export function TaskPanel({
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
  previewContent,
  previewTitle,
}: {
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
  previewContent: string;
  previewTitle: string;
}) {
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setIsRefreshing(false), 300);
    }
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="border-b border-border">
        <div className="flex">
          <div className="flex flex-1 items-center justify-center gap-2 border-b-2 border-primary bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
            <Cloud className="h-4 w-4" />
            <span>临时空间</span>
            <Badge variant="default" className="ml-1 h-5 px-1.5 text-xs">
              {treeItems.length}
            </Badge>
          </div>
        </div>
      </div>

      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索文件..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-9 bg-muted/50 pl-9 pr-8 text-sm placeholder:text-muted-foreground/60"
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
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground",
              isRefreshing && "animate-spin"
            )}
            onClick={handleRefresh}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          <div className="rounded-lg border border-border/50 bg-muted/20 p-2">
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

          <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
            <div className="mb-3 flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">预览</span>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {previewTabs.length === 0 ? (
                <Badge variant="secondary">未打开文件</Badge>
              ) : (
                previewTabs.map((tab) => (
                  <button
                    key={tab.path}
                    onClick={() => onActivatePreview(tab.path)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs transition-colors",
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
            <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-background p-3 text-[11px] leading-relaxed text-muted-foreground">
              {previewContent}
            </pre>
          </div>
        </div>
      </ScrollArea>

      <div className="flex justify-end border-t border-border px-4 py-3">
        <button
          type="button"
          className="text-xs text-primary transition-colors hover:text-primary/80"
          onClick={onOpenWorkspace}
        >
          工作区预览
        </button>
      </div>
    </div>
  );
}
