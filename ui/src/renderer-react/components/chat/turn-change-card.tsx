"use client";

import * as React from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileDiff,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { DiffViewer } from "@/components/chat/diff-viewer";
import { cn } from "@/lib/utils";
import type {
  TurnChangeSummary,
  TurnRewindPreview,
} from "../../types";

function shortPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || filePath;
}

export function TurnChangeCard({
  sessionId,
  change,
  rewindSupported,
  rewindDisabledReason,
  initiallyExpanded = false,
  inset = true,
}: {
  sessionId: string;
  change: TurnChangeSummary;
  rewindSupported: boolean;
  rewindDisabledReason?: string | null;
  initiallyExpanded?: boolean;
  inset?: boolean;
}) {
  const [reviewOpen, setReviewOpen] = React.useState(initiallyExpanded);
  const [selectedPath, setSelectedPath] = React.useState(change.files[0]?.filePath || "");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<TurnRewindPreview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const verified = change.coverage === 'complete' || change.coverage === 'partial';
  const selectedFile = change.files.find((file) => file.filePath === selectedPath)
    || change.files[0];
  const [observedDetail, setObservedDetail] = React.useState<TurnChangeSummary['files'][number] | null>(null);
  const [detailError, setDetailError] = React.useState('');
  React.useEffect(() => {
    let active = true; setObservedDetail(null); setDetailError('');
    if (reviewOpen && change.observationId && verified && selectedFile && selectedFile.verified !== false) void window.agentDesktop.getObservationDiff({ sessionId, observationId: change.observationId, filePath: selectedFile.filePath })
      .then(file => { if (active) setObservedDetail(file); }).catch(reason => { if (active) setDetailError(String(reason)); });
    return () => { active = false; };
  }, [sessionId, change.observationId, verified, selectedFile?.filePath, selectedFile?.verified, reviewOpen]);

  // Keep empty observations as evidence, but don't show an empty comparison.
  // Incomplete coverage and zero-line changes (e.g. binary files) remain visible.
  if (change.coverage === 'complete' && change.files.length === 0 && change.stats.filesChanged === 0) return null;

  const openConfirmation = async () => {
    setConfirmOpen(true);
    setPreview(null);
    setError("");
    setBusy(true);
    try {
      const result = await window.agentDesktop.previewTurnRewind({
        sessionId,
        userMessageId: change.userMessageId,
      });
      setPreview(result);
      if (!result.canRewind) setError(result.error || "这一轮不能撤销。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const confirmRewind = async () => {
    setBusy(true);
    setError("");
    try {
      await window.agentDesktop.rewindTurn({
        sessionId,
        userMessageId: change.userMessageId,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <div className={cn("mb-3 min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card/75 shadow-[0_14px_40px_-34px_rgba(0,0,0,0.72)]", inset && "ml-[var(--assistant-content-inset,36px)]")}>
      <div className="flex min-h-10 items-center gap-3 px-3 py-2">
        <FileDiff className="h-4 w-4 shrink-0 text-muted-foreground" />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setReviewOpen((value) => !value)}
        >
          <span className="truncate text-xs font-medium text-foreground">
            {verified ? `${change.coverage === 'partial' ? '已确认变化' : '本轮改动'} ${change.stats.filesChanged} 个文件` : '文件变化未核实'}
          </span>
          {verified && <>
            <span className="shrink-0 text-[11px] tabular-nums text-emerald-600 dark:text-emerald-400">
              +{change.stats.additions}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-red-600 dark:text-red-400">
              -{change.stats.deletions}
            </span>
          </>}
          {reviewOpen
            ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        </button>
        <button
          type="button"
          disabled={!rewindSupported || busy}
          title={rewindSupported ? "撤销到这一轮开始之前" : rewindDisabledReason || "当前会话不支持撤销"}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
          onClick={() => void openConfirmation()}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          回退已备份文件
        </button>
      </div>

      {(change.observationNote || change.excludedCount || !verified) ? <div role="status" className="border-t border-border/50 px-3 py-2 text-[11px] text-muted-foreground">{change.observationNote || (!verified ? '缺少本轮文件观察记录，无法确认文件变化。' : '')}{change.excludedCount ? ` · ${change.excludedCount} 项按观察策略排除` : ''}</div> : null}

      {reviewOpen && verified && selectedFile ? (
        <div className="border-t border-border/60">
          <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-border/50 px-2 py-1.5">
            {change.files.map((file) => (
              <button
                key={file.filePath}
                type="button"
                title={file.filePath}
                className={cn(
                  "h-7 shrink-0 rounded-md px-2 font-mono text-[10px] transition-colors",
                  file.filePath === selectedFile.filePath
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() => setSelectedPath(file.filePath)}
              >
                {shortPath(file.filePath)}
                <span className="ml-1.5 opacity-70">+{file.additions} -{file.deletions}</span>
              </button>
            ))}
          </div>
          <div className="max-h-[420px] overflow-auto px-1 pb-2">
            {(observedDetail?.detail || detailError) && <p className="p-3 text-xs text-muted-foreground">{observedDetail?.detail || detailError}</p>}
            <DiffViewer
              filePath={selectedFile.filePath}
              oldString=""
              newString=""
              structuredPatch={observedDetail?.structuredPatch || selectedFile.structuredPatch}
              maxLines={120}
              variant="transcript"
            />
          </div>
          {change.hasUnverifiedChanges ? (
            <div className="flex items-start gap-2 border-t border-border/50 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              这里只列出已确认的变化，超出观察范围的文件未计入。
            </div>
          ) : null}
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="border-t border-border/60 bg-muted/25 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground">撤销到本轮开始之前？</div>
              <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                这一轮及之后的对话会从当前上下文移除，已记录的文件改动会恢复；原记录仍保留在审计事件中。
              </div>
            </div>
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="取消撤销"
              onClick={() => setConfirmOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {busy && !preview ? (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              正在检查 checkpoint…
            </div>
          ) : null}
          {preview?.canRewind ? (
            <div className="mt-2 text-[11px] text-muted-foreground">
              将恢复 {preview.filesChanged?.length || 0} 个文件
              <span className="ml-2 text-emerald-600 dark:text-emerald-400">+{preview.insertions || 0}</span>
              <span className="ml-1.5 text-red-600 dark:text-red-400">-{preview.deletions || 0}</span>
            </div>
          ) : null}
          {error ? (
            <div className="mt-2 text-[11px] text-destructive">{error}</div>
          ) : null}

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              className="h-7 rounded-md px-2.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              onClick={() => setConfirmOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || !preview?.canRewind}
              className="flex h-7 items-center gap-1.5 rounded-md bg-destructive px-2.5 text-[11px] text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => void confirmRewind()}
            >
              {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              确认撤销
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
