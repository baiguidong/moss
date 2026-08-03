"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter } from "@codemirror/lint";
import { JsonView, type NodeExpandingEvent } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import { Code2, Download, FileJson, Maximize2, X } from "lucide-react";
import { CodeViewer } from "@/components/chat/code-viewer";
import { CopyButton } from "@/components/shared/copy-button";

function parseJson(code: string): { ok: true; value: unknown; formatted: string } | { ok: false; error: string } {
  try {
    const value = JSON.parse(code);
    return { ok: true, value, formatted: JSON.stringify(value, null, 2) };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function isJsonTreeValue(value: unknown): value is object | any[] {
  return value !== null && (Array.isArray(value) || typeof value === "object");
}

function downloadText(filename: string, text: string, type = "application/json") {
  const blob = new Blob([text], { type });
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

function JsonCodeMirror({
  value,
  dark,
}: {
  value: string;
  dark: boolean;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          json(),
          linter(jsonParseLinter()),
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
            ".cm-tooltip": {
              borderColor: dark ? "#334155" : "#cbd5e1",
              backgroundColor: dark ? "#0f172a" : "#ffffff",
            },
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, [dark, value]);

  return <div ref={hostRef} className="h-full min-h-[360px] overflow-hidden" />;
}

type JsonInlineState = {
  mode: "tree" | "raw";
  expanded?: Set<string>;
};

const jsonInlineState = new Map<string, JsonInlineState>();
const jsonInlineListeners = new Set<() => void>();
const JSON_INLINE_STATE_MAX = 80;
let activeJsonPreviewCode: string | null = null;
let activeJsonPreviewText = "";
let activeJsonPreviewMode: "tree" | "source" = "source";
const jsonPreviewListeners = new Set<() => void>();

function getJsonNodeKey(level: number, field?: string) {
  return `${level}:${field ?? "$value"}`;
}

function collectExpandableKeys(value: unknown, level = 0, field?: string, keys = new Set<string>()) {
  if (!isJsonTreeValue(value)) return keys;
  keys.add(getJsonNodeKey(level, field));
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExpandableKeys(item, level + 1, undefined, keys);
    }
    return keys;
  }
  for (const [key, child] of Object.entries(value)) {
    collectExpandableKeys(child, level + 1, key, keys);
  }
  return keys;
}

function collectDefaultExpandedKeys(value: unknown) {
  const keys = new Set<string>();
  collectExpandableKeys(value, 0, undefined, keys);
  for (const key of [...keys]) {
    const [level] = key.split(":");
    if (Number(level) > 1) keys.delete(key);
  }
  return keys;
}

function getJsonInlineState(code: string): JsonInlineState {
  return jsonInlineState.get(code) || { mode: "tree" };
}

function setJsonInlineState(code: string, patch: Partial<{ mode: "tree" | "raw"; expanded?: Set<string> }>) {
  const current = getJsonInlineState(code);
  if (jsonInlineState.has(code)) jsonInlineState.delete(code);
  jsonInlineState.set(code, {
    mode: patch.mode ?? current.mode,
    expanded: patch.expanded ?? current.expanded,
  });
  while (jsonInlineState.size > JSON_INLINE_STATE_MAX) {
    const oldest = jsonInlineState.keys().next().value;
    if (oldest === undefined) break;
    jsonInlineState.delete(oldest);
  }
  for (const listener of jsonInlineListeners) listener();
}

function subscribeJsonInlineState(listener: () => void) {
  jsonInlineListeners.add(listener);
  return () => {
    jsonInlineListeners.delete(listener);
  };
}

function setActiveJsonPreview(code: string | null, text = "", mode: "tree" | "source" = "source") {
  activeJsonPreviewCode = code;
  activeJsonPreviewText = text;
  activeJsonPreviewMode = mode;
  for (const listener of jsonPreviewListeners) listener();
}

function setActiveJsonPreviewText(text: string) {
  activeJsonPreviewText = text;
  for (const listener of jsonPreviewListeners) listener();
}

function setActiveJsonPreviewMode(mode: "tree" | "source") {
  activeJsonPreviewMode = mode;
  for (const listener of jsonPreviewListeners) listener();
}

function subscribeJsonPreviewState(listener: () => void) {
  jsonPreviewListeners.add(listener);
  return () => {
    jsonPreviewListeners.delete(listener);
  };
}

type JsonViewStyle = NonNullable<React.ComponentProps<typeof JsonView>["style"]>;

const jsonTreeStyle: JsonViewStyle = {
  container: "moss-json-tree",
  basicChildStyle: "moss-json-row",
  childFieldsContainer: "moss-json-children",
  label: "moss-json-label",
  clickableLabel: "moss-json-label moss-json-label-clickable",
  nullValue: "moss-json-null",
  undefinedValue: "moss-json-null",
  numberValue: "moss-json-number",
  stringValue: "moss-json-string",
  booleanValue: "moss-json-boolean",
  otherValue: "moss-json-other",
  punctuation: "moss-json-punctuation",
  expandIcon: "moss-json-expander moss-json-expand",
  collapseIcon: "moss-json-expander moss-json-collapse",
  collapsedContent: "moss-json-collapsed",
  quotesForFieldNames: false,
  noQuotesForStringValues: false,
  stringifyStringValues: true,
};

export function JsonRenderer({ code }: { code: string }) {
  const parsed = React.useMemo(() => parseJson(code), [code]);
  const initialInlineState = getJsonInlineState(code);
  const [inlineMode, setInlineMode] = React.useState<"tree" | "raw">(initialInlineState.mode);
  const [expandedKeys, setExpandedKeys] = React.useState<Set<string> | undefined>(initialInlineState.expanded);
  const [previewOpen, setPreviewOpen] = React.useState(() => activeJsonPreviewCode === code);
  const [modalCode, setModalCode] = React.useState(() => activeJsonPreviewCode === code ? activeJsonPreviewText : code);
  const [modalMode, setModalMode] = React.useState<"tree" | "source">(() => activeJsonPreviewCode === code ? activeJsonPreviewMode : "source");
  const dark = useIsDarkTheme();

  React.useEffect(() => {
    const syncInlineState = () => {
      const state = getJsonInlineState(code);
      setInlineMode(state.mode);
      setExpandedKeys(state.expanded);
    };
    syncInlineState();
    return subscribeJsonInlineState(syncInlineState);
  }, [code]);

  React.useEffect(() => {
    const syncPreviewState = () => {
      setPreviewOpen(activeJsonPreviewCode === code);
      if (activeJsonPreviewCode === code) {
        setModalCode(activeJsonPreviewText);
        setModalMode(activeJsonPreviewMode);
      }
    };
    syncPreviewState();
    return subscribeJsonPreviewState(syncPreviewState);
  }, [code]);

  const closePreview = React.useCallback(() => {
    if (activeJsonPreviewCode === code) setActiveJsonPreview(null);
  }, [code]);

  const displayCode = parsed.ok ? parsed.formatted : code;
  const activeInlineCode = inlineMode === "raw" ? code : displayCode;
  const shouldExpandJsonNode = React.useCallback((level: number, _value: any, field?: string) => {
    const keys = expandedKeys ?? (parsed.ok ? collectDefaultExpandedKeys(parsed.value) : new Set<string>());
    return keys.has(getJsonNodeKey(level, field));
  }, [expandedKeys, parsed]);
  const beforeExpandChange = React.useCallback((event: NodeExpandingEvent) => {
    const current = getJsonInlineState(code).expanded ?? (parsed.ok ? collectDefaultExpandedKeys(parsed.value) : new Set<string>());
    const next = new Set(current);
    const key = getJsonNodeKey(event.level, event.field);
    if (event.newExpandValue) {
      next.add(key);
    } else {
      next.delete(key);
    }
    setJsonInlineState(code, { expanded: next });
    return true;
  }, [code, parsed]);

  if (parsed.ok === false) {
    return (
      <div className="my-4 overflow-hidden rounded-[18px] border border-destructive/30">
        <div className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/10 px-3 py-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-destructive">
            JSON Error
          </div>
          <CopyButton text={code} label="复制代码" />
        </div>
        <div className="bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive">
          {parsed.error}
        </div>
        <div className="border-t border-destructive/20">
          <CodeViewer code={code} language="json" title="JSON Source" maxLines={24} showLineNumbers />
        </div>
      </div>
    );
  }

  if (!isJsonTreeValue(parsed.value)) {
    return <CodeViewer code={code} language="json" title="JSON Source" maxLines={24} showLineNumbers />;
  }

  return (
    <>
      <div className="my-4 overflow-hidden rounded-[18px] border border-border/60 bg-[var(--color-surface-container-low)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-[var(--color-surface-container)] px-3 py-2">
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            <FileJson className="h-3.5 w-3.5" />
            JSON
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setJsonInlineState(code, { mode: inlineMode === "tree" ? "raw" : "tree" })}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={inlineMode === "tree" ? "原文展示" : "树形展示"}
              title={inlineMode === "tree" ? "原文展示" : "树形展示"}
            >
              {inlineMode === "tree" ? "原文" : "树形"}
            </button>
            <button
              type="button"
              onClick={() => downloadText("data.json", activeInlineCode)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="下载 JSON"
              title="下载 JSON"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveJsonPreview(code, activeInlineCode, inlineMode === "tree" ? "tree" : "source");
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Maximize2 className="h-3 w-3" />
              放大
            </button>
            <CopyButton text={activeInlineCode} label="复制" />
          </div>
        </div>
        {inlineMode === "tree" ? (
          <div className="max-h-[420px] overflow-auto bg-white p-3 text-left dark:bg-[#020617]">
            <JsonView
              data={parsed.value}
              shouldExpandNode={shouldExpandJsonNode}
              beforeExpandChange={beforeExpandChange}
              clickToExpandNode
              compactTopLevel
              style={jsonTreeStyle}
              aria-label="JSON tree"
            />
          </div>
        ) : (
          <div className="border-t border-border/60">
            <CodeViewer code={code} language="json" title="JSON Source" maxLines={24} showLineNumbers />
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
                    {modalMode === "tree" ? <FileJson className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}
                    {modalMode === "tree" ? "JSON Tree" : "JSON Source"}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveJsonPreviewMode(modalMode === "tree" ? "source" : "tree")}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {modalMode === "tree" ? "源码" : "树形"}
                    </button>
                    {modalMode === "tree" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setJsonInlineState(code, { expanded: collectExpandableKeys(parsed.value) })}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          展开
                        </button>
                        <button
                          type="button"
                          onClick={() => setJsonInlineState(code, { expanded: new Set() })}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          折叠
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setActiveJsonPreviewText(code)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      原文
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveJsonPreviewText(displayCode)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      格式化
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadText("data.json", modalCode)}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label="下载 JSON"
                      title="下载 JSON"
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
                  {modalMode === "tree" ? (
                    <div className="min-h-[360px] bg-white p-4 text-left dark:bg-[#020617]">
                      <JsonView
                        data={parsed.value}
                        shouldExpandNode={shouldExpandJsonNode}
                        beforeExpandChange={beforeExpandChange}
                        clickToExpandNode
                        compactTopLevel
                        style={jsonTreeStyle}
                        aria-label="JSON tree"
                      />
                    </div>
                  ) : (
                    <JsonCodeMirror value={modalCode} dark={dark} />
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
