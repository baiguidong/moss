"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import Papa from "papaparse";
import { Download, Maximize2, Table2, X } from "lucide-react";
import { CodeViewer } from "@/components/chat/code-viewer";
import { CopyButton } from "@/components/shared/copy-button";

type DelimitedKind = "csv" | "tsv";
type DelimitedMode = "table" | "raw";

type ParsedDelimited = {
  rows: string[][];
  errors: string[];
};

function parseDelimited(code: string, kind: DelimitedKind): ParsedDelimited {
  const parsed = Papa.parse<string[]>(code, {
    delimiter: kind === "tsv" ? "\t" : "",
    skipEmptyLines: "greedy",
  });
  const rows = (parsed.data || [])
    .filter((row): row is string[] => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell ?? "")));
  const errors = (parsed.errors || []).map((error) => error.message).filter(Boolean);
  return { rows, errors };
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type DelimitedState = {
  mode: DelimitedMode;
};

const delimitedState = new Map<string, DelimitedState>();
const delimitedListeners = new Set<() => void>();
const DELIMITED_STATE_MAX = 80;
let activeDelimitedPreviewKey: string | null = null;
const previewListeners = new Set<() => void>();

function getDelimitedState(key: string): DelimitedState {
  return delimitedState.get(key) || { mode: "table" };
}

function setDelimitedState(key: string, patch: Partial<DelimitedState>) {
  const current = getDelimitedState(key);
  if (delimitedState.has(key)) delimitedState.delete(key);
  delimitedState.set(key, { mode: patch.mode ?? current.mode });
  while (delimitedState.size > DELIMITED_STATE_MAX) {
    const oldest = delimitedState.keys().next().value;
    if (oldest === undefined) break;
    delimitedState.delete(oldest);
  }
  for (const listener of delimitedListeners) listener();
}

function subscribeDelimitedState(listener: () => void) {
  delimitedListeners.add(listener);
  return () => {
    delimitedListeners.delete(listener);
  };
}

function setActiveDelimitedPreview(key: string | null) {
  activeDelimitedPreviewKey = key;
  for (const listener of previewListeners) listener();
}

function subscribePreviewState(listener: () => void) {
  previewListeners.add(listener);
  return () => {
    previewListeners.delete(listener);
  };
}

function DelimitedTable({ rows }: { rows: string[][] }) {
  const header = rows[0] || [];
  const body = rows.slice(1);
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

  if (rows.length === 0 || columnCount === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
        空表格
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead>
          <tr className="bg-muted/60">
            {Array.from({ length: columnCount }).map((_, index) => (
              <th key={index} className="whitespace-nowrap border border-border/70 px-3 py-2 font-semibold text-foreground">
                {header[index] || `Column ${index + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.length > 0 ? body.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-background even:bg-muted/20">
              {Array.from({ length: columnCount }).map((_, colIndex) => (
                <td key={colIndex} className="max-w-[280px] whitespace-pre-wrap break-words border border-border/60 px-3 py-2 align-top text-foreground">
                  {row[colIndex] || ""}
                </td>
              ))}
            </tr>
          )) : (
            <tr>
              {Array.from({ length: columnCount }).map((_, colIndex) => (
                <td key={colIndex} className="border border-border/60 px-3 py-2 text-muted-foreground" />
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function DelimitedRenderer({
  code,
  blockId,
  kind,
}: {
  code: string;
  blockId?: string;
  kind: DelimitedKind;
}) {
  const stateKey = blockId || `${kind}:${code}`;
  const parsed = React.useMemo(() => parseDelimited(code, kind), [code, kind]);
  const initialState = getDelimitedState(stateKey);
  const [mode, setMode] = React.useState<DelimitedMode>(initialState.mode);
  const [previewOpen, setPreviewOpen] = React.useState(() => activeDelimitedPreviewKey === stateKey);
  const label = kind.toUpperCase();
  const filename = kind === "tsv" ? "data.tsv" : "data.csv";
  const mime = kind === "tsv" ? "text/tab-separated-values" : "text/csv";

  React.useEffect(() => {
    const sync = () => setMode(getDelimitedState(stateKey).mode);
    sync();
    return subscribeDelimitedState(sync);
  }, [stateKey]);

  React.useEffect(() => {
    const sync = () => setPreviewOpen(activeDelimitedPreviewKey === stateKey);
    sync();
    return subscribePreviewState(sync);
  }, [stateKey]);

  const closePreview = React.useCallback(() => {
    if (activeDelimitedPreviewKey === stateKey) setActiveDelimitedPreview(null);
  }, [stateKey]);

  return (
    <>
      <div className="my-4 overflow-hidden rounded-[18px] border border-border/60 bg-[var(--color-surface-container-low)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-[var(--color-surface-container)] px-3 py-2">
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            <Table2 className="h-3.5 w-3.5" />
            {label}
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tracking-normal text-muted-foreground">
              {parsed.rows.length} 行
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setDelimitedState(stateKey, { mode: mode === "table" ? "raw" : "table" })}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {mode === "table" ? "原文" : "表格"}
            </button>
            <button
              type="button"
              onClick={() => downloadText(filename, code, mime)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={`下载 ${label}`}
              title={`下载 ${label}`}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setActiveDelimitedPreview(stateKey)}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Maximize2 className="h-3 w-3" />
              放大
            </button>
            <CopyButton text={code} label="复制" />
          </div>
        </div>
        {parsed.errors.length > 0 ? (
          <div className="border-b border-warning/20 bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
            {parsed.errors[0]}
          </div>
        ) : null}
        {mode === "table" ? (
          <div className="max-h-[420px] overflow-auto bg-white p-3 dark:bg-[#020617]">
            <DelimitedTable rows={parsed.rows} />
          </div>
        ) : (
          <div className="border-t border-border/60">
            <CodeViewer code={code} language={kind} title={`${label} Source`} maxLines={24} showLineNumbers />
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {previewOpen && (
          <>
            <motion.div
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50"
              onClick={closePreview}
            />
            <motion.div
              initial={false}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.15 }}
              className="fixed left-1/2 top-1/2 z-50 w-full max-w-[1100px] -translate-x-1/2 -translate-y-1/2"
            >
              <div className="mx-4 flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
                  <div className="flex shrink-0 items-center gap-2 text-sm font-semibold text-foreground">
                    <Table2 className="h-4 w-4" />
                    {label}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDelimitedState(stateKey, { mode: mode === "table" ? "raw" : "table" })}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {mode === "table" ? "原文" : "表格"}
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadText(filename, code, mime)}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={`下载 ${label}`}
                      title={`下载 ${label}`}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <CopyButton text={code} label="复制" />
                    <button
                      type="button"
                      onClick={closePreview}
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="关闭"
                      title="关闭"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-white p-4 dark:bg-[#020617]">
                  {mode === "table" ? (
                    <DelimitedTable rows={parsed.rows} />
                  ) : (
                    <CodeViewer code={code} language={kind} title={`${label} Source`} maxLines={200} showLineNumbers />
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
