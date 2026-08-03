"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { JsonView, type NodeExpandingEvent } from "react-json-view-lite";
import formatXml from "xml-formatter";
import { Code2, Download, Eye, FileCode2, ImageIcon, Maximize2, X } from "lucide-react";
import { CodeViewer } from "@/components/chat/code-viewer";
import { CopyButton } from "@/components/shared/copy-button";

type XmlKind = "xml" | "html" | "svg";
type XmlMode = "tree" | "source" | "preview";
type ParsedXml = { ok: true; tree: unknown; formatted: string } | { ok: false; error: string; formatted: string };

function getMime(kind: XmlKind) {
  if (kind === "html") return "text/html";
  if (kind === "svg") return "image/svg+xml";
  return "application/xml";
}

function getLabel(kind: XmlKind) {
  return kind.toUpperCase();
}

function canPreview(kind: XmlKind) {
  return kind === "html" || kind === "svg";
}

function formatStructuredXml(code: string, kind: XmlKind) {
  try {
    return formatXml(code, {
      indentation: "  ",
      collapseContent: kind === "html",
      lineSeparator: "\n",
    }).trimEnd();
  } catch {
    return code;
  }
}

function elementToTree(node: Element): Record<string, unknown> {
  const attributes = Array.from(node.attributes).reduce<Record<string, string>>((acc, attribute) => {
    acc[attribute.name] = attribute.value;
    return acc;
  }, {});
  const children: unknown[] = [];

  for (const child of Array.from(node.childNodes || [])) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      children.push(elementToTree(child as Element));
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text) children.push(text);
    } else if (child.nodeType === Node.CDATA_SECTION_NODE) {
      children.push({ cdata: child.textContent || "" });
    } else if (child.nodeType === Node.COMMENT_NODE) {
      const comment = child.textContent?.trim();
      if (comment) children.push({ comment });
    }
  }

  return {
    name: node.nodeName,
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function parseXml(code: string, kind: XmlKind): ParsedXml {
  const formatted = formatStructuredXml(code, kind);
  try {
    const document = new DOMParser().parseFromString(code, getMime(kind));
    const parserError = document.querySelector("parsererror");
    if (parserError) {
      return { ok: false, error: parserError.textContent?.trim() || "XML parse error", formatted };
    }
    const root = document.documentElement;
    if (!root) return { ok: false, error: "No root element found", formatted };
    return { ok: true, tree: elementToTree(root), formatted };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err), formatted };
  }
}

function isTreeValue(value: unknown): value is object | any[] {
  return value !== null && (Array.isArray(value) || typeof value === "object");
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
    if (Number(level) > 2) keys.delete(key);
  }
  return keys;
}

function downloadText(filename: string, text: string, type = "application/xml") {
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

function XmlCodeMirror({ value, dark }: { value: string; dark: boolean }) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          html(),
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

function XmlPreviewPane({ code, kind, expanded = false }: { code: string; kind: XmlKind; expanded?: boolean }) {
  if (kind === "svg") {
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(code)}`;
    return (
      <div className="flex h-full min-h-[260px] items-center justify-center overflow-auto bg-white p-4 dark:bg-[#020617]">
        <img
          src={src}
          alt="SVG preview"
          className={expanded ? "max-h-none max-w-none" : "max-h-[380px] max-w-full"}
        />
      </div>
    );
  }

  if (kind === "html") {
    return (
      <div className="h-full min-h-[320px] bg-white dark:bg-[#020617]">
        <iframe
          title="HTML preview"
          srcDoc={code}
          sandbox=""
          className="h-full min-h-[320px] w-full border-0 bg-white"
        />
      </div>
    );
  }

  return null;
}

type XmlState = {
  mode: XmlMode;
  sourceMode: "formatted" | "raw";
  expanded?: Set<string>;
};

const xmlState = new Map<string, XmlState>();
const xmlListeners = new Set<() => void>();
const XML_STATE_MAX = 80;
let activeXmlPreviewKey: string | null = null;
let activeXmlPreviewText = "";
let activeXmlPreviewMode: XmlMode = "source";
const xmlPreviewListeners = new Set<() => void>();

function getXmlState(key: string): XmlState {
  return xmlState.get(key) || { mode: "tree", sourceMode: "formatted" };
}

function setXmlState(key: string, patch: Partial<XmlState>) {
  const current = getXmlState(key);
  if (xmlState.has(key)) xmlState.delete(key);
  xmlState.set(key, {
    mode: patch.mode ?? current.mode,
    sourceMode: patch.sourceMode ?? current.sourceMode,
    expanded: patch.expanded ?? current.expanded,
  });
  while (xmlState.size > XML_STATE_MAX) {
    const oldest = xmlState.keys().next().value;
    if (oldest === undefined) break;
    xmlState.delete(oldest);
  }
  for (const listener of xmlListeners) listener();
}

function subscribeXmlState(listener: () => void) {
  xmlListeners.add(listener);
  return () => {
    xmlListeners.delete(listener);
  };
}

function setActiveXmlPreview(key: string | null, text = "", mode: XmlMode = "source") {
  activeXmlPreviewKey = key;
  activeXmlPreviewText = text;
  activeXmlPreviewMode = mode;
  for (const listener of xmlPreviewListeners) listener();
}

function setActiveXmlPreviewText(text: string) {
  activeXmlPreviewText = text;
  for (const listener of xmlPreviewListeners) listener();
}

function setActiveXmlPreviewMode(mode: XmlMode) {
  activeXmlPreviewMode = mode;
  for (const listener of xmlPreviewListeners) listener();
}

function subscribeXmlPreviewState(listener: () => void) {
  xmlPreviewListeners.add(listener);
  return () => {
    xmlPreviewListeners.delete(listener);
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

export function XmlRenderer({ code, blockId, kind = "xml" }: { code: string; blockId?: string; kind?: XmlKind }) {
  const stateKey = blockId || `${kind}:${code}`;
  const parsed = React.useMemo(() => parseXml(code, kind), [code, kind]);
  const initialState = getXmlState(stateKey);
  const [mode, setMode] = React.useState<XmlMode>(initialState.mode);
  const [sourceMode, setSourceMode] = React.useState<"formatted" | "raw">(initialState.sourceMode);
  const [expandedKeys, setExpandedKeys] = React.useState<Set<string> | undefined>(initialState.expanded);
  const [previewOpen, setPreviewOpen] = React.useState(() => activeXmlPreviewKey === stateKey);
  const [modalCode, setModalCode] = React.useState(() => activeXmlPreviewKey === stateKey ? activeXmlPreviewText : parsed.formatted);
  const [modalMode, setModalMode] = React.useState<XmlMode>(() => activeXmlPreviewKey === stateKey ? activeXmlPreviewMode : "source");
  const dark = useIsDarkTheme();
  const label = getLabel(kind);
  const activeInlineCode = sourceMode === "raw" ? code : parsed.formatted;
  const parseError = "error" in parsed ? parsed.error : null;
  const previewable = canPreview(kind);

  React.useEffect(() => {
    const sync = () => {
      const state = getXmlState(stateKey);
      setMode(state.mode);
      setSourceMode(state.sourceMode);
      setExpandedKeys(state.expanded);
    };
    sync();
    return subscribeXmlState(sync);
  }, [stateKey]);

  React.useEffect(() => {
    const sync = () => {
      setPreviewOpen(activeXmlPreviewKey === stateKey);
      if (activeXmlPreviewKey === stateKey) {
        setModalCode(activeXmlPreviewText);
        setModalMode(activeXmlPreviewMode);
      }
    };
    sync();
    return subscribeXmlPreviewState(sync);
  }, [stateKey]);

  const closePreview = React.useCallback(() => {
    if (activeXmlPreviewKey === stateKey) setActiveXmlPreview(null);
  }, [stateKey]);

  const shouldExpandNode = React.useCallback((level: number, _value: any, field?: string) => {
    const keys = expandedKeys ?? (parsed.ok ? collectDefaultExpandedKeys(parsed.tree) : new Set<string>());
    return keys.has(getNodeKey(level, field));
  }, [expandedKeys, parsed]);

  const beforeExpandChange = React.useCallback((event: NodeExpandingEvent) => {
    if (!parsed.ok) return true;
    const current = getXmlState(stateKey).expanded ?? collectDefaultExpandedKeys(parsed.tree);
    const next = new Set(current);
    const nodeKey = getNodeKey(event.level, event.field);
    if (event.newExpandValue) next.add(nodeKey);
    else next.delete(nodeKey);
    setXmlState(stateKey, { expanded: next });
    return true;
  }, [parsed, stateKey]);

  return (
    <>
      <div className="my-4 overflow-hidden rounded-[18px] border border-border/60 bg-[var(--color-surface-container-low)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-[var(--color-surface-container)] px-3 py-2">
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            <FileCode2 className="h-3.5 w-3.5" />
            {label}
            {parsed.ok ? (
              <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] tracking-normal text-emerald-600 dark:text-emerald-300">
                结构正常
              </span>
            ) : (
              <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] tracking-normal text-destructive">
                解析异常
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
            {parsed.ok ? (
              <button
                type="button"
                onClick={() => setXmlState(stateKey, { mode: mode === "tree" ? "source" : "tree" })}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {mode === "tree" ? "源码" : "树形"}
              </button>
            ) : null}
            {previewable ? (
              <button
                type="button"
                onClick={() => setXmlState(stateKey, { mode: "preview" })}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label={`${label} 预览`}
                title={`${label} 预览`}
              >
                {kind === "svg" ? <ImageIcon className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                预览
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setXmlState(stateKey, {
                  mode: "source",
                  sourceMode: sourceMode === "formatted" ? "raw" : "formatted",
                });
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {sourceMode === "formatted" ? "原文" : "格式化"}
            </button>
            <button
              type="button"
              onClick={() => downloadText(`data.${kind}`, activeInlineCode, getMime(kind))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={`下载 ${label}`}
              title={`下载 ${label}`}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setActiveXmlPreview(stateKey, activeInlineCode, mode)}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Maximize2 className="h-3 w-3" />
              放大
            </button>
            <CopyButton text={activeInlineCode} label="复制" />
          </div>
        </div>
        {parseError ? (
          <div className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive">
            {parseError}
          </div>
        ) : null}
        {previewable && mode === "preview" ? (
          <div className="max-h-[420px] overflow-auto border-t border-border/60">
            <XmlPreviewPane code={activeInlineCode} kind={kind} />
          </div>
        ) : parsed.ok && mode === "tree" ? (
          <div className="max-h-[420px] overflow-auto bg-white p-3 text-left dark:bg-[#020617]">
            <JsonView
              data={parsed.tree}
              shouldExpandNode={shouldExpandNode}
              beforeExpandChange={beforeExpandChange}
              clickToExpandNode
              compactTopLevel
              style={treeStyle}
              aria-label={`${label} tree`}
            />
          </div>
        ) : (
          <div className="border-t border-border/60">
            <CodeViewer code={activeInlineCode} language={kind === "xml" ? "xml" : "html"} title={`${label} Source`} maxLines={24} showLineNumbers />
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
                    {modalMode === "tree" ? (
                      <FileCode2 className="h-4 w-4" />
                    ) : modalMode === "preview" ? (
                      kind === "svg" ? <ImageIcon className="h-4 w-4" /> : <Eye className="h-4 w-4" />
                    ) : (
                      <Code2 className="h-4 w-4" />
                    )}
                    {modalMode === "tree" ? `${label} Tree` : modalMode === "preview" ? `${label} Preview` : `${label} Source`}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                    {parsed.ok ? (
                      <button
                        type="button"
                        onClick={() => setActiveXmlPreviewMode(modalMode === "tree" ? "source" : "tree")}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        {modalMode === "tree" ? "源码" : "树形"}
                      </button>
                    ) : null}
                    {previewable ? (
                      <button
                        type="button"
                        onClick={() => setActiveXmlPreviewMode("preview")}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        预览
                      </button>
                    ) : null}
                    {parsed.ok && modalMode === "tree" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setXmlState(stateKey, { expanded: collectExpandableKeys(parsed.tree) })}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          展开
                        </button>
                        <button
                          type="button"
                          onClick={() => setXmlState(stateKey, { expanded: new Set() })}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          折叠
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setActiveXmlPreviewText(code)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      原文
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveXmlPreviewText(parsed.formatted)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      格式化
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadText(`data.${kind}`, modalCode, getMime(kind))}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={`下载 ${label}`}
                      title={`下载 ${label}`}
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
                  {previewable && modalMode === "preview" ? (
                    <XmlPreviewPane code={modalCode} kind={kind} expanded />
                  ) : parsed.ok && modalMode === "tree" ? (
                    <div className="min-h-[360px] bg-white p-4 text-left dark:bg-[#020617]">
                      <JsonView
                        data={parsed.tree}
                        shouldExpandNode={shouldExpandNode}
                        beforeExpandChange={beforeExpandChange}
                        clickToExpandNode
                        compactTopLevel
                        style={treeStyle}
                        aria-label={`${label} tree`}
                      />
                    </div>
                  ) : (
                    <XmlCodeMirror value={modalCode} dark={dark} />
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
