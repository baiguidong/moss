"use client";

import * as React from "react";
import { Bot, Check, ChevronDown, ChevronUp, CircleAlert, Loader2, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatTranscript } from "@/components/chat-transcript";
import { cn } from "@/lib/utils";
import type { WorkerThread } from "@/lib/agent-transcript";

const WORKER_ANIMALS = [
  { emoji: "🦊", name: "fox", gradient: "from-amber-500/25 via-orange-500/18 to-red-500/20" },
  { emoji: "🦦", name: "otter", gradient: "from-cyan-500/25 via-sky-500/18 to-blue-500/18" },
  { emoji: "🐸", name: "frog", gradient: "from-emerald-500/25 via-lime-500/18 to-green-500/20" },
  { emoji: "🦆", name: "duck", gradient: "from-yellow-500/25 via-amber-400/18 to-orange-400/18" },
  { emoji: "🐱", name: "cat", gradient: "from-fuchsia-500/20 via-pink-500/18 to-rose-500/18" },
];

function getAnimal(index: number) {
  return WORKER_ANIMALS[index % WORKER_ANIMALS.length];
}

function WorkerStatusIcon({ status }: { status: WorkerThread["status"] }) {
  if (status === "running" || status === "queued") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  }
  if (status === "completed") {
    return <Check className="h-3.5 w-3.5 text-emerald-500" />;
  }
  return <CircleAlert className="h-3.5 w-3.5 text-destructive" />;
}

function WorkerPill({
  thread,
  animalIndex,
  isActive,
  onToggle,
}: {
  thread: WorkerThread;
  animalIndex: number;
  isActive: boolean;
  onToggle: () => void;
}) {
  const isRunning = thread.status === "running" || thread.status === "queued";
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-lg shadow-[0_12px_32px_-24px_rgba(0,0,0,0.6)] transition-all",
        isActive
          ? "border-primary/50 bg-card"
          : "border-border/70 bg-card/82 hover:-translate-y-0.5 hover:border-primary/30",
      )}
      title={`${thread.title} · ${thread.status}`}
    >
      <span className={cn(isRunning && "animate-bounce")}>
        {getAnimal(animalIndex).emoji}
      </span>
    </button>
  );
}

export function WorkerThreadPanel({
  threads,
  archivedThreads,
  activeThreadId,
  onToggleThread,
}: {
  threads: WorkerThread[];
  archivedThreads: WorkerThread[];
  activeThreadId: string | null;
  onToggleThread: (threadId: string | null) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);

  const allThreads = [...threads, ...archivedThreads];
  if (allThreads.length === 0) return null;

  const activeThread = allThreads.find((t) => t.id === activeThreadId) || null;
  const runningCount = threads.filter(
    (t) => t.status === "running" || t.status === "queued",
  ).length;
  const hasArchived = archivedThreads.length > 0;

  return (
    <div className="space-y-2">
      {/* Active worker detail panel */}
      {activeThread && (
        <div className="overflow-hidden rounded-[24px] border border-border/80 bg-card/96 shadow-[0_24px_72px_-48px_rgba(0,0,0,0.75)] backdrop-blur">
          <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-primary/25 to-primary/8 text-sm">
                  {getAnimal(allThreads.findIndex((t) => t.id === activeThread.id)).emoji}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{activeThread.title}</h3>
                    <WorkerStatusIcon status={activeThread.status} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {activeThread.agentId ? <span className="font-mono">{activeThread.agentId}</span> : null}
                  </div>
                </div>
              </div>
              {activeThread.prompt ? (
                <p className="mt-3 max-w-[720px] whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                  {activeThread.prompt}
                </p>
              ) : null}
              {activeThread.resultText ? (
                <div className="mt-3 max-w-[720px] rounded-2xl border border-border/70 bg-background/70 px-3 py-3">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    Output
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {activeThread.resultText}
                  </p>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onToggleThread(null)}
              className="rounded-full border border-border/70 bg-background/70 p-2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="关闭 worker transcript"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <ScrollArea className="max-h-[42vh] min-h-[180px]">
            <div className="bg-[radial-gradient(circle_at_top_left,rgba(58,191,129,0.08),transparent_22%),var(--background)] py-2">
              <ChatTranscript
                messages={activeThread.messages}
                emptyState={(
                  <div className="rounded-[24px] border border-dashed border-border/70 bg-card/50 px-4 py-6 text-sm text-muted-foreground">
                    该 worker 还没有可展示的消息。
                  </div>
                )}
              />
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Worker pill strip */}
      <div className="rounded-[20px] border border-border/80 bg-card/88 px-3 py-2.5 shadow-[0_18px_48px_-36px_rgba(0,0,0,0.68)] backdrop-blur">
        {/* Summary row */}
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Workers · </span>
              <span className="text-sm text-foreground">
                {threads.length > 0 && (
                  <>
                    {threads.length} 本轮
                    {runningCount > 0 ? `（${runningCount} 进行中）` : "（已完成）"}
                  </>
                )}
                {threads.length > 0 && hasArchived && <span className="text-muted-foreground"> + </span>}
                {hasArchived && (
                  <span className="text-muted-foreground">{archivedThreads.length} 历史</span>
                )}
              </span>
            </div>
          </div>

          {hasArchived && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              aria-label={expanded ? "收起历史 workers" : "展开历史 workers"}
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  <span>收起</span>
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  <span>{archivedThreads.length} 历史</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Pills — current run first, separator, then archived (clamped to 1 row when collapsed) */}
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 overflow-hidden transition-[max-height] duration-300",
            !expanded && hasArchived ? "max-h-11" : "max-h-[400px]",
          )}
        >
          {/* Current run workers */}
          {threads.map((thread, i) => (
            <WorkerPill
              key={thread.id}
              thread={thread}
              animalIndex={i}
              isActive={thread.id === activeThreadId}
              onToggle={() => onToggleThread(thread.id === activeThreadId ? null : thread.id)}
            />
          ))}

          {/* Separator between current and historical */}
          {threads.length > 0 && hasArchived && (
            <div className="h-7 w-px shrink-0 rounded-full bg-border/60 mx-0.5" aria-hidden />
          )}

          {/* Archived (historical) workers */}
          {archivedThreads.map((thread, i) => (
            <WorkerPill
              key={thread.id}
              thread={thread}
              animalIndex={threads.length + i}
              isActive={thread.id === activeThreadId}
              onToggle={() => onToggleThread(thread.id === activeThreadId ? null : thread.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
