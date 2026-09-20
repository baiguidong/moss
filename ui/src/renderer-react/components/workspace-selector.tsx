"use client";

import * as React from "react";
import { Check, ChevronDown, FolderOpen, LoaderCircle, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WorkspaceLocation } from "../types";

function workspaceLabel(workspacePath?: string) {
  if (!workspacePath) return "选择工作空间";
  return workspacePath.split(/[\\/]/u).filter(Boolean).pop() || workspacePath;
}

export function WorkspaceSelector({
  value,
  onChange,
  disabled = false,
}: {
  value?: string;
  onChange: (workspace: string | undefined) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [workspaces, setWorkspaces] = React.useState<WorkspaceLocation[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setLoadError("");
      void window.agentDesktop.listWorkspaces({
        query,
        limit: query.trim() ? 20 : 5,
      }).then((items) => {
        if (!cancelled) setWorkspaces(items);
      }).catch((error: unknown) => {
        if (!cancelled) {
          setWorkspaces([]);
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, query ? 150 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const selectWorkspace = (workspace: WorkspaceLocation) => {
    onChange(workspace.path);
    setOpen(false);
    void window.agentDesktop.touchWorkspace({ path: workspace.path }).catch(() => {});
  };

  const openLocalFolder = async () => {
    const workspacePath = await window.agentDesktop.pickDirectory();
    if (!workspacePath) return;
    onChange(workspacePath);
    setOpen(false);
  };

  const showCreateDialog = () => {
    setOpen(false);
    setName("");
    setCreateError("");
    setCreateOpen(true);
  };

  const createWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const workspace = await window.agentDesktop.createWorkspace({ name: name.trim() });
      onChange(workspace.path);
      setCreateOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) setQuery("");
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "inline-flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
              value
                ? "border-green-500/30 bg-green-500/10 text-green-600 hover:bg-green-500/15 dark:text-green-400"
                : "border-border/70 bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
            title={value || "选择工作空间"}
            aria-label={value ? `工作空间：${workspaceLabel(value)}` : "选择工作空间"}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{workspaceLabel(value)}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-80 p-2"
        >
          <div className="relative mb-2" onKeyDown={(event) => event.stopPropagation()}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索工作空间"
              className="h-10 border-0 bg-muted/60 pl-9 shadow-none focus-visible:ring-1"
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex h-16 items-center justify-center text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
              </div>
            ) : loadError ? (
              <div className="px-2 py-4 text-center text-xs text-destructive">{loadError}</div>
            ) : workspaces.length > 0 ? workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.path}
                className="gap-2 py-2.5"
                title={workspace.path}
                onSelect={() => selectWorkspace(workspace)}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm">{workspace.name}</span>
                {value === workspace.path ? <Check className="h-4 w-4 shrink-0 text-emerald-500" /> : null}
              </DropdownMenuItem>
            )) : (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                {query.trim() ? "未找到工作空间" : "暂无最近使用的工作空间"}
              </div>
            )}
          </div>

          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 py-2.5" onSelect={showCreateDialog}>
            <Plus className="h-4 w-4" />
            <span>新建工作空间</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 py-2.5" onSelect={() => { void openLocalFolder(); }}>
            <FolderOpen className="h-4 w-4" />
            <span>打开本地文件夹</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {createOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !creating) setCreateOpen(false);
          }}
        >
          <form
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
            onSubmit={createWorkspace}
          >
            <div className="flex items-center justify-between px-6 py-5">
              <h2 className="text-xl font-semibold text-foreground">新建工作空间</h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
                aria-label="关闭新建工作空间"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="px-6 pb-6">
              <p className="mb-5 text-sm leading-6 text-muted-foreground">
                为工作空间命名，本地将自动创建同名文件夹，创建后名称不可修改。
              </p>
              <Input
                autoFocus
                maxLength={80}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setCreateError("");
                }}
                placeholder="输入工作空间名称"
                disabled={creating}
                className="h-11"
              />
              {createError ? <p className="mt-2 text-xs text-destructive">{createError}</p> : null}
            </div>
            <div className="flex justify-end gap-3 px-6 pb-6">
              <Button type="button" variant="secondary" disabled={creating} onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                确认
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
