"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { yaml } from "@codemirror/lang-yaml";
import { JsonView, type NodeExpandingEvent } from "react-json-view-lite";
import { dump, load } from "js-yaml";
import { Code2, Download, FileCode2, Maximize2, X } from "lucide-react";
import { CodeViewer } from "@/components/chat/code-viewer";
import { CopyButton } from "@/components/shared/copy-button";

type ParseYamlResult = { ok: true; value: unknown; formatted: string } | { ok: false; error: string };

function parseYaml(code: string): ParseYamlResult {
  try {
    const value = load(code);
    return {
      ok: true,
      value,
      formatted: dump(value, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
        sortKeys: false,
      }).trimEnd(),
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function isTreeValue(value: unknown): value is object | any[] {
  return value !== null && value !== undefined && (Array.isArray(value) || typeof value === "object");
}

function getNodeKey(level: number, field?: string) {
  return `${level}:${field ?? "$value"}`;
}

function collectExpandableKeys(value: unknown, level = 0, field?: string, keys = new Set<string>()) {
  if (!isTreeValue(value)) return keys;
  keys.add(getNodeKey(level, field));
  if (Array.isArray(value)) {
    for (const item of value) collectExpandableKeys(item, level + 1, undefined, keys);
    return keys;
  }
  for (const [key, child] of Object.entries(value)) collectExpandableKeys(child, level + 1, key, keys);
  return keys;
}

function collectDefaultExpandedKeys(value: unknown) {
  const keys = collectExpandableKeys(value);
  for (const key of [...keys]) {
    const [level] = key.split(":");
    if (Number(level) > 1) keys.delete(key);
  }
  return keys;
}

function downloadText(filename: string, text: string, type = "application/yaml") {
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

function YamlCodeMirror({ value, dark }: { value: string; dark: boolean }) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          yaml(),
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

type YamlInlineState = {
  mode: "tree" | "raw";
  expanded?: Set<string>;
};

const yamlInlineState = new Map<string, YamlInlineState>();
const yamlInlineListeners = new Set<() => void>();
const YAML_INLINE_STATE_MAX = 80;
let activeYamlPreviewCode: string | null = null;
let activeYamlPreviewText = "";
let activeYamlPreviewMode: "tree" | "source" = "source";
const yamlPreviewListeners = new Set<() => void>();

function getYamlInlineState(key: string): YamlInlineState {
  return yamlInlineState.get(key) || { mode: "tree" };
}

function setYamlInlineState(key: string, patch: Partial<YamlInlineState>) {
  const current = getYamlInlineState(key);
  if (yamlInlineState.has(key)) yamlInlineState.delete(key);
  yamlInlineState.set(key, {
    mode: patch.mode ?? current.mode,
    expanded: patch.expanded ?? current.expanded,
  });
  while (yamlInlineState.size > YAML_INLINE_STATE_MAX) {
    const oldest = yamlInlineState.keys().next().value;
    if (oldest === undefined) break;
    yamlInlineState.delete(oldest);
  }
  for (const listener of yamlInlineListeners) listener();
}

function subscribeYamlInlineState(listener: () => void) {
  yamlInlineListeners.add(listener);
  return () => {
    yamlInlineListeners.delete(listener);
  };
}

function setActiveYamlPreview(key: string | null, text = "", mode: "tree" | "source" = "source") {
  activeYamlPreviewCode = key;
  activeYamlPreviewText = text;
  activeYamlPreviewMode = mode;
  for (const listener of yamlPreviewListeners) listener();
}

function setActiveYamlPreviewText(text: string) {
  activeYamlPreviewText = text;
  for (const listener of yamlPreviewListeners) listener();
}

function setActiveYamlPreviewMode(mode: "tree" | "source") {
  activeYamlPreviewMode = mode;
  for (const listener of yamlPreviewListeners) listener();
}

function subscribeYamlPreviewState(listener: () => void) {
  yamlPreviewListeners.add(listener);
  return () => {
    yamlPreviewListeners.delete(listener);
  };
}

type JsonViewStyle = NonNullable<React.ComponentProps<typeof JsonView>["style"]>;

const treeStyle: JsonViewStyle = {
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

export function YamlRenderer({ code, blockId }: { code: string; blockId?: string }) {
  const stateKey = blockId || code;
  const parsed = React.useMemo(() => parseYaml(code), [code]);
  const initialInlineState = getYamlInlineState(stateKey);
  const [inlineMode, setInlineMode] = React.useState<"tree" | "raw">(initialInlineState.mode);
  const [expandedKeys, setExpandedKeys] = React.useState<Set<string> | undefined>(initialInlineState.expanded);
  const [previewOpen, setPreviewOpen] = React.useState(() => activeYamlPreviewCode === stateKey);
  const [modalCode, setModalCode] = React.useState(() => activeYamlPreviewCode === stateKey ? activeYamlPreviewText : code);
  const [modalMode, setModalMode] = React.useState<"tree" | "source">(() => activeYamlPreviewCode === stateKey ? activeYamlPreviewMode : "source");
  const dark = useIsDarkTheme();

  React.useEffect(() => {
    const syncInlineState = () => {
      const state = getYamlInlineState(stateKey);
      setInlineMode(state.mode);
      setExpandedKeys(state.expanded);
    };
    syncInlineState();
    return subscribeYamlInlineState(syncInlineState);
  }, [stateKey]);

  React.useEffect(() => {
    const syncPreviewState = () => {
      setPreviewOpen(activeYamlPreviewCode === stateKey);
      if (activeYamlPreviewCode === stateKey) {
        setModalCode(activeYamlPreviewText);
        setModalMode(activeYamlPreviewMode);
      }
    };
    syncPreviewState();
    return subscribeYamlPreviewState(syncPreviewState);
  }, [stateKey]);

  const closePreview = React.useCallback(() => {
    if (activeYamlPreviewCode === stateKey) setActiveYamlPreview(null);
  }, [stateKey]);

  const displayCode = parsed.ok ? parsed.formatted : code;
  const activeInlineCode = inlineMode === "raw" ? code : displayCode;
  const shouldExpandNode = React.useCallback((level: number, _value: any, field?: string) => {
    const keys = expandedKeys ?? (parsed.ok ? collectDefaultExpandedKeys(parsed.value) : new Set<string>());
    return keys.has(getNodeKey(level, field));
  }, [expandedKeys, parsed]);
  const beforeExpandChange = React.useCallback((event: NodeExpandingEvent) => {
    const current = getYamlInlineState(stateKey).expanded ?? (parsed.ok ? collectDefaultExpandedKeys(parsed.value) : new Set<string>());
    const next = new Set(current);
    const nodeKey = getNodeKey(event.level, event.field);
    if (event.newExpandValue) next.add(nodeKey);
    else next.delete(nodeKey);
    setYamlInlineState(stateKey, { expanded: next });
    return true;
  }, [parsed, stateKey]);

  if (parsed.ok === false) {
    return (
      <div className="my-4 overflow-hidden rounded-[18px] border border-destructive/30">
        <div className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/10 px-3 py-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-destructive">
            YAML Error
          </div>
          <CopyButton text={code} label="复制代码" />
        </div>
        <div className="bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive">
          {parsed.error}
        </div>
        <div className="border-t border-destructive/20">
          <CodeViewer code={code} language="yaml" title="YAML Source" maxLines={24} showLineNumbers />
        </div>
      </div>
    );
  }

  if (!isTreeValue(parsed.value)) {
    return <CodeViewer code={code} language="yaml" title="YAML Source" maxLines={24} showLineNumbers />;
  }

  return (
    <>
      <div className="my-4 overflow-hidden rounded-[18px] border border-border/60 bg-[var(--color-surface-container-low)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-[var(--color-surface-container)] px-3 py-2">
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            <FileCode2 className="h-3.5 w-3.5" />
            YAML
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setYamlInlineState(stateKey, { mode: inlineMode === "tree" ? "raw" : "tree" })}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {inlineMode === "tree" ? "原文" : "树形"}
            </button>
            <button
              type="button"
              onClick={() => downloadText("data.yaml", activeInlineCode)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="下载 YAML"
              title="下载 YAML"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setActiveYamlPreview(stateKey, activeInlineCode, inlineMode === "tree" ? "tree" : "source")}
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
              shouldExpandNode={shouldExpandNode}
              beforeExpandChange={beforeExpandChange}
              clickToExpandNode
              compactTopLevel
              style={treeStyle}
              aria-label="YAML tree"
            />
          </div>
        ) : (
          <div className="border-t border-border/60">
            <CodeViewer code={code} language="yaml" title="YAML Source" maxLines={24} showLineNumbers />
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
                    {modalMode === "tree" ? <FileCode2 className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}
                    {modalMode === "tree" ? "YAML Tree" : "YAML Source"}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveYamlPreviewMode(modalMode === "tree" ? "source" : "tree")}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {modalMode === "tree" ? "源码" : "树形"}
                    </button>
                    {modalMode === "tree" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setYamlInlineState(stateKey, { expanded: collectExpandableKeys(parsed.value) })}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          展开
                        </button>
                        <button
                          type="button"
                          onClick={() => setYamlInlineState(stateKey, { expanded: new Set() })}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          折叠
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setActiveYamlPreviewText(code)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      原文
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveYamlPreviewText(displayCode)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      格式化
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadText("data.yaml", modalCode)}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label="下载 YAML"
                      title="下载 YAML"
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
                        shouldExpandNode={shouldExpandNode}
                        beforeExpandChange={beforeExpandChange}
                        clickToExpandNode
                        compactTopLevel
                        style={treeStyle}
                        aria-label="YAML tree"
                      />
                    </div>
                  ) : (
                    <YamlCodeMirror value={modalCode} dark={dark} />
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
