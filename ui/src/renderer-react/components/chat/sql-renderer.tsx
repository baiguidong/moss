"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { format } from "sql-formatter";
import { Code2, Database, Download, Maximize2, X } from "lucide-react";
import { CodeViewer } from "@/components/chat/code-viewer";
import { CopyButton } from "@/components/shared/copy-button";

type SqlMode = "formatted" | "raw";

function formatSql(code: string) {
  try {
    return { ok: true as const, formatted: format(code, { language: "sql", tabWidth: 2, keywordCase: "upper" }) };
  } catch (err: any) {
    return { ok: false as const, error: String(err?.message || err), formatted: code };
  }
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/sql" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useIsDarkTheme() {
  const [dark, setDark] = React.useState(() => document.documentElement.getAttribute("data-theme") === "dark");
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.getAttribute("data-theme") === "dark");
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function SqlCodeMirror({ value, dark }: { value: string; dark: boolean }) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          sql(),
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": {
              minHeight: "100%",
              backgroundColor: dark ? "#020617" : "#ffffff",
              color: dark ? "#e5e7eb" : "#0f172a",
              fontSize: "12px",
            },
            ".cm-scroller": {
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              lineHeight: "1.55",
            },
            ".cm-gutters": {
              backgroundColor: dark ? "#020617" : "#f8fafc",
              color: dark ? "#64748b" : "#94a3b8",
              borderRightColor: dark ? "#1e293b" : "#e2e8f0",
            },
            ".cm-activeLine, .cm-activeLineGutter": {
              backgroundColor: dark ? "rgba(148, 163, 184, 0.10)" : "rgba(15, 23, 42, 0.04)",
            },
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, [dark, value]);

  return <div ref={hostRef} className="h-full min-h-[360px] overflow-hidden" />;
}

type SqlState = {
  mode: SqlMode;
};

const sqlState = new Map<string, SqlState>();
const sqlListeners = new Set<() => void>();
const SQL_STATE_MAX = 80;
let activeSqlPreviewKey: string | null = null;
let activeSqlPreviewText = "";
const sqlPreviewListeners = new Set<() => void>();

function getSqlState(key: string): SqlState {
  return sqlState.get(key) || { mode: "formatted" };
}

function setSqlState(key: string, patch: Partial<SqlState>) {
  const current = getSqlState(key);
  if (sqlState.has(key)) sqlState.delete(key);
  sqlState.set(key, { mode: patch.mode ?? current.mode });
  while (sqlState.size > SQL_STATE_MAX) {
    const oldest = sqlState.keys().next().value;
    if (oldest === undefined) break;
    sqlState.delete(oldest);
  }
  for (const listener of sqlListeners) listener();
}

function subscribeSqlState(listener: () => void) {
  sqlListeners.add(listener);
  return () => {
    sqlListeners.delete(listener);
  };
}

function setActiveSqlPreview(key: string | null, text = "") {
  activeSqlPreviewKey = key;
  activeSqlPreviewText = text;
  for (const listener of sqlPreviewListeners) listener();
}

function setActiveSqlPreviewText(text: string) {
  activeSqlPreviewText = text;
  for (const listener of sqlPreviewListeners) listener();
}

function subscribeSqlPreviewState(listener: () => void) {
  sqlPreviewListeners.add(listener);
  return () => {
    sqlPreviewListeners.delete(listener);
  };
}

export function SqlRenderer({ code, blockId }: { code: string; blockId?: string }) {
  const stateKey = blockId || code;
  const formatted = React.useMemo(() => formatSql(code), [code]);
  const initialState = getSqlState(stateKey);
  const [mode, setMode] = React.useState<SqlMode>(initialState.mode);
  const [previewOpen, setPreviewOpen] = React.useState(() => activeSqlPreviewKey === stateKey);
  const [modalCode, setModalCode] = React.useState(() => activeSqlPreviewKey === stateKey ? activeSqlPreviewText : formatted.formatted);
  const dark = useIsDarkTheme();
  const activeInlineCode = mode === "raw" ? code : formatted.formatted;

  React.useEffect(() => {
    const sync = () => setMode(getSqlState(stateKey).mode);
    sync();
    return subscribeSqlState(sync);
  }, [stateKey]);

  React.useEffect(() => {
    const sync = () => {
      setPreviewOpen(activeSqlPreviewKey === stateKey);
      if (activeSqlPreviewKey === stateKey) setModalCode(activeSqlPreviewText);
    };
    sync();
    return subscribeSqlPreviewState(sync);
  }, [stateKey]);

  const closePreview = React.useCallback(() => {
    if (activeSqlPreviewKey === stateKey) setActiveSqlPreview(null);
  }, [stateKey]);

  return (
    <>
      <div className="my-4 overflow-hidden rounded-[18px] border border-border/60 bg-[var(--color-surface-container-low)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-[var(--color-surface-container)] px-3 py-2">
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            <Database className="h-3.5 w-3.5" />
            SQL
            {formatted.ok ? (
              <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] tracking-normal text-emerald-600 dark:text-emerald-300">
                已格式化
              </span>
            ) : (
              <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] tracking-normal text-warning">
                保留原文
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setSqlState(stateKey, { mode: mode === "formatted" ? "raw" : "formatted" })}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {mode === "formatted" ? "原文" : "格式化"}
            </button>
            <button
              type="button"
              onClick={() => downloadText("query.sql", activeInlineCode)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="下载 SQL"
              title="下载 SQL"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setActiveSqlPreview(stateKey, activeInlineCode)}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Maximize2 className="h-3 w-3" />
              放大
            </button>
            <CopyButton text={activeInlineCode} label="复制" />
          </div>
        </div>
        {!formatted.ok ? (
          <div className="border-b border-warning/20 bg-warning/10 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {formatted.error}
          </div>
        ) : null}
        <div className="border-t border-border/60">
          <CodeViewer code={activeInlineCode} language="sql" title="SQL" maxLines={24} showLineNumbers />
        </div>
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
                    <Code2 className="h-4 w-4" />
                    SQL Source
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveSqlPreviewText(code)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      原文
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSqlPreviewText(formatted.formatted)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      格式化
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadText("query.sql", modalCode)}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label="下载 SQL"
                      title="下载 SQL"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <CopyButton text={modalCode} label="复制" />
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
                <div className="min-h-0 flex-1 overflow-auto">
                  <SqlCodeMirror value={modalCode} dark={dark} />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
