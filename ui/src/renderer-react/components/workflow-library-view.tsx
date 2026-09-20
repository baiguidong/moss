"use client";

import * as React from "react";
import {
  GitFork,
  History,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { workflowPreviewTask } from "@/lib/workflow-library";
import { WorkflowGraphPanel } from "@/components/workflow-graph-panel";
import type { WorkflowCatalogDetail, WorkflowCatalogEntry } from "../types";

export function WorkflowLibraryView({
  onCreateInChat,
  onEditInChat,
  onUseInChat,
  onOpenSession,
}: {
  onCreateInChat: () => void;
  onEditInChat: (workflow: WorkflowCatalogDetail) => void;
  onUseInChat: (workflow: WorkflowCatalogDetail) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const [workflows, setWorkflows] = React.useState<WorkflowCatalogEntry[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<WorkflowCatalogDetail | null>(null);
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const refreshRequest = React.useRef(0);
  const detailRequest = React.useRef(0);
  const selectedPublishedRevision = workflows.find((workflow) => (
    workflow.id === selectedId
  ))?.publishedRevision;

  const refresh = React.useCallback(async () => {
    const request = ++refreshRequest.current;
    try {
      setError("");
      const next = await window.agentDesktop.workflows.list({ publishedOnly: true });
      if (request !== refreshRequest.current) return;
      setWorkflows(next);
      setDetail((current) => (
        current && next.some((item) => item.id === current.record.id) ? current : null
      ));
      setSelectedId((current) => (
        current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null
      ));
    } catch (cause) {
      if (request !== refreshRequest.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    return window.agentDesktop.workflows.onChanged(() => { void refresh(); });
  }, [refresh]);

  React.useEffect(() => {
    if (!selectedId) {
      detailRequest.current += 1;
      setDetail(null);
      return;
    }
    const request = ++detailRequest.current;
    setDetail((current) => current?.record.id === selectedId ? current : null);
    if (!selectedPublishedRevision) return;
    void window.agentDesktop.workflows.get({ workflowId: selectedId, revision: selectedPublishedRevision })
      .then((next) => {
        if (request === detailRequest.current && next.record.publishedRevision) setDetail(next);
      })
      .catch((cause) => {
        if (request === detailRequest.current) setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [selectedId, selectedPublishedRevision]);

  const visible = workflows.filter((workflow) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${workflow.title} ${workflow.name} ${workflow.description}`.toLowerCase().includes(needle);
  });

  const deleteTemplate = async () => {
    if (!detail || !window.confirm(`永久删除模板“${detail.revision.definition.meta.title}”？此操作无法撤销。`)) return;
    setBusy(true);
    setError("");
    try {
      await window.agentDesktop.workflows.delete({ workflowId: detail.record.id });
      setDetail(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/70 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
          <GitFork className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-foreground">工作流</h1>
          <p className="text-[11px] text-muted-foreground">已确认发布、可直接使用的流程模板</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} title="刷新">
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button size="sm" onClick={onCreateInChat}>
          <Plus className="mr-1.5 h-4 w-4" />通过对话创建
        </Button>
      </header>

      {error ? <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-5 py-2 text-xs text-destructive">{error}</div> : null}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-border/70">
          <div className="border-b border-border/60 p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模板" className="h-8 pl-8 text-xs" />
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1.5 p-2">
              {visible.map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  onClick={() => {
                    if (workflow.id !== selectedId) setDetail(null);
                    setSelectedId(workflow.id);
                  }}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left transition-colors",
                    selectedId === workflow.id
                      ? "border-primary/35 bg-primary/5"
                      : "border-transparent hover:border-border hover:bg-muted/50",
                  )}
                >
                  <div className="truncate text-xs font-medium text-foreground">{workflow.title}</div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{workflow.name}</div>
                  <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">{workflow.description}</p>
                  <div className="mt-2 flex items-center gap-2 text-[9px] text-muted-foreground">
                    <span>r{workflow.publishedRevision ?? workflow.currentRevision}</span>
                    <span>{workflow.scope === "project" ? "当前项目" : "个人"}</span>
                  </div>
                </button>
              ))}
              {visible.length === 0 ? (
                <div className="px-3 py-12 text-center text-xs leading-relaxed text-muted-foreground">
                  暂无已发布模板。先在会话中创建和修改流程，确认后再发布到这里。
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </aside>

        {detail ? (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-start gap-3 border-b border-border/60 px-5 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold text-foreground">{detail.revision.definition.meta.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{detail.revision.definition.meta.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><History className="h-3 w-3" />版本 r{detail.record.publishedRevision ?? detail.record.currentRevision}</span>
                  {detail.record.origin?.sessionId ? (
                    <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => onOpenSession(detail.record.origin!.sessionId!)}>
                      <MessageSquareText className="h-3 w-3" />来源会话
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" onClick={() => onUseInChat(detail)} title="在会话中描述任务输入">
                  <Play className="mr-1.5 h-3.5 w-3.5" />使用模板
                </Button>
                <Button variant="outline" size="sm" onClick={() => onEditInChat(detail)}>
                  <MessageSquareText className="mr-1.5 h-3.5 w-3.5" />对话修改
                </Button>
                <Button
                  disabled={busy}
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void deleteTemplate()}
                  title="永久删除模板"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <WorkflowGraphPanel task={workflowPreviewTask(detail)} workbench previewOnly />
          </main>
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-center p-8 text-center">
            <div>
              <GitFork className="mx-auto h-10 w-10 text-muted-foreground/35" />
              <div className="mt-3 text-sm font-medium text-foreground">创建可复用的 Workflow</div>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">先在会话中查看和修改草稿；确认发布后，模板才会出现在这里。</p>
              <Button className="mt-4" size="sm" onClick={onCreateInChat}><Plus className="mr-1.5 h-4 w-4" />开始设计</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
