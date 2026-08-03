"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import mermaid from "mermaid";
import { CopyButton } from "@/components/shared/copy-button";
import { Code2, Download, Image as ImageIcon, Maximize, Maximize2, Minimize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { CodeViewer } from "@/components/chat/code-viewer";

let mermaidInitialized = false;
type MermaidRenderCacheEntry =
  | { status: "pending"; promise: Promise<string> }
  | { status: "success"; svg: string }
  | { status: "error"; error: string };

const mermaidRenderCache = new Map<string, MermaidRenderCacheEntry>();
const MERMAID_RENDER_CACHE_MAX = 80;
const mermaidInlineState = new Map<string, { zoom: number; mode: "diagram" | "code" }>();
const MERMAID_INLINE_STATE_MAX = 80;
let activePreviewCode: string | null = null;
let activePreviewZoom = 1;
let activePreviewMode: "diagram" | "code" = "diagram";
let activePreviewScroll = { left: 0, top: 0 };
const previewListeners = new Set<() => void>();
const inlineListeners = new Set<() => void>();

function setActivePreviewCode(code: string | null) {
  activePreviewCode = code;
  if (!code) {
    activePreviewZoom = 1;
    activePreviewMode = "diagram";
    activePreviewScroll = { left: 0, top: 0 };
  }
  for (const listener of previewListeners) listener();
}

function setActivePreviewZoom(zoom: number) {
  activePreviewZoom = zoom;
  for (const listener of previewListeners) listener();
}

function setActivePreviewMode(mode: "diagram" | "code") {
  activePreviewMode = mode;
  for (const listener of previewListeners) listener();
}

function setActivePreviewScroll(left: number, top: number) {
  activePreviewScroll = { left, top };
}

function subscribePreviewState(listener: () => void) {
  previewListeners.add(listener);
  return () => {
    previewListeners.delete(listener);
  };
}

function notifyInlineListeners() {
  for (const listener of inlineListeners) listener();
}

function subscribeInlineState(listener: () => void) {
  inlineListeners.add(listener);
  return () => {
    inlineListeners.delete(listener);
  };
}

function getInlineState(code: string) {
  return mermaidInlineState.get(code) || { zoom: 1, mode: "diagram" as const };
}

function setInlineState(code: string, patch: Partial<{ zoom: number; mode: "diagram" | "code" }>) {
  const current = getInlineState(code);
  if (mermaidInlineState.has(code)) mermaidInlineState.delete(code);
  mermaidInlineState.set(code, {
    zoom: patch.zoom ?? current.zoom,
    mode: patch.mode ?? current.mode,
  });
  while (mermaidInlineState.size > MERMAID_INLINE_STATE_MAX) {
    const oldest = mermaidInlineState.keys().next().value;
    if (oldest === undefined) break;
    mermaidInlineState.delete(oldest);
  }
  notifyInlineListeners();
}

function initMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "strict",
    suppressErrorRendering: true,
    fontFamily: "var(--font-sans)",
    flowchart: {
      htmlLabels: true,
      useMaxWidth: true,
    },
  });
  mermaidInitialized = true;
}

let mermaidIdCounter = 0;

function cacheMermaidSvg(code: string, svg: string) {
  if (mermaidRenderCache.has(code)) mermaidRenderCache.delete(code);
  mermaidRenderCache.set(code, { status: "success", svg });
  while (mermaidRenderCache.size > MERMAID_RENDER_CACHE_MAX) {
    const oldest = mermaidRenderCache.keys().next().value;
    if (oldest === undefined) break;
    mermaidRenderCache.delete(oldest);
  }
}

function cacheMermaidError(code: string, error: string) {
  if (mermaidRenderCache.has(code)) mermaidRenderCache.delete(code);
  mermaidRenderCache.set(code, { status: "error", error });
}

function parseSvgMetrics(svg: string): { width: number; height: number } | null {
  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/i);
  if (viewBoxMatch) {
    const viewBox = viewBoxMatch[1];
    if (!viewBox) return null;
    const values = viewBox.split(/[\s,]+/).map((part) => Number.parseFloat(part));
    if (values.length === 4 && values.every((v) => Number.isFinite(v))) {
      const [, , width, height] = values;
      if (width !== undefined && height !== undefined) {
        return { width, height };
      }
    }
  }
  const widthMatch = svg.match(/\bwidth="([0-9.]+)(?:px)?"/i);
  const heightMatch = svg.match(/\bheight="([0-9.]+)(?:px)?"/i);
  if (widthMatch && heightMatch) {
    const width = Number.parseFloat(widthMatch[1]);
    const height = Number.parseFloat(heightMatch[1]);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      return { width, height };
    }
  }
  return null;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const RENDER_TIMEOUT_MS = 8000;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function cleanupMermaidNodes(id: string) {
  document.getElementById(id)?.remove();
  document.getElementById(`d${id}`)?.remove();
}

function renderMermaidOnce(code: string): Promise<string> {
  const cached = mermaidRenderCache.get(code);
  if (cached?.status === "success") return Promise.resolve(cached.svg);
  if (cached?.status === "error") return Promise.reject(new Error(cached.error));
  if (cached?.status === "pending") return cached.promise;

  initMermaid();
  const id = `mermaid-${++mermaidIdCounter}`;
  let settled = false;

  const promise = new Promise<string>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanupMermaidNodes(id);
      const message = "Mermaid 渲染超时，请点击代码查看确认图表源码。";
      cacheMermaidError(code, message);
      reject(new Error(message));
    }, RENDER_TIMEOUT_MS);

    const finish = () => {
      settled = true;
      window.clearTimeout(timeout);
      cleanupMermaidNodes(id);
    };

    try {
      void mermaid.render(id, code).then(
        ({ svg: renderedSvg }) => {
          finish();
          cacheMermaidSvg(code, renderedSvg);
          resolve(renderedSvg);
        },
        (err) => {
          finish();
          const message = String(err?.message || err);
          cacheMermaidError(code, message);
          reject(new Error(message));
        },
      );
    } catch (err: any) {
      finish();
      const message = String(err?.message || err);
      cacheMermaidError(code, message);
      reject(new Error(message));
    }
  });

  mermaidRenderCache.set(code, { status: "pending", promise });
  return promise;
}

async function downloadSvgAsPng(svg: string, filename = "mermaid-diagram.png") {
  const metrics = parseSvgMetrics(svg);
  const width = Math.max(1, Math.ceil(metrics?.width || 1200));
  const height = Math.max(1, Math.ceil(metrics?.height || 800));

  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to render Mermaid image"));
  });
  image.src = svgToDataUrl(svg);
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Unable to export Mermaid image");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MermaidRenderer({ code }: { code: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const previewPanelRef = React.useRef<HTMLDivElement>(null);
  const previewCanvasRef = React.useRef<HTMLDivElement>(null);
  const initialEntry = mermaidRenderCache.get(code);
  const initialInlineState = getInlineState(code);
  const [svg, setSvg] = React.useState<string | null>(initialEntry?.status === "success" ? initialEntry.svg : null);
  const [error, setError] = React.useState<string | null>(initialEntry?.status === "error" ? initialEntry.error : null);
  const [inlineZoom, setInlineZoom] = React.useState(initialInlineState.zoom);
  const [inlineMode, setInlineMode] = React.useState<"diagram" | "code">(initialInlineState.mode);
  const [previewOpen, setPreviewOpen] = React.useState(() => activePreviewCode === code);
  const [previewZoom, setPreviewZoom] = React.useState(activePreviewZoom);
  const [previewMode, setPreviewMode] = React.useState<"diagram" | "code">(activePreviewMode);
  const previewOpenRef = React.useRef(previewOpen);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  const openPreview = React.useCallback(() => {
    setActivePreviewCode(code);
  }, [code]);

  const closePreview = React.useCallback(() => {
    if (activePreviewCode === code) setActivePreviewCode(null);
  }, [code]);

  React.useEffect(() => {
    previewOpenRef.current = previewOpen;
  }, [previewOpen]);

  React.useEffect(() => {
    const syncPreviewOpen = () => {
      setPreviewOpen(activePreviewCode === code);
      setPreviewZoom(activePreviewZoom);
      setPreviewMode(activePreviewMode);
    };
    syncPreviewOpen();
    return subscribePreviewState(syncPreviewOpen);
  }, [code]);

  React.useEffect(() => {
    const syncInlineState = () => {
      const inlineState = getInlineState(code);
      setInlineZoom(inlineState.zoom);
      setInlineMode(inlineState.mode);
    };
    syncInlineState();
    return subscribeInlineState(syncInlineState);
  }, [code]);

  React.useEffect(() => {
    let cancelled = false;
    const cached = mermaidRenderCache.get(code);
    if (cached?.status === "success") {
      setSvg(cached.svg);
      setError(null);
      return () => {
        cancelled = true;
      };
    }
    if (cached?.status === "error") {
      setSvg(null);
      setError(cached.error);
      return () => {
        cancelled = true;
      };
    }
    setSvg(null);
    setError(null);
    void renderMermaidOnce(code).then((renderedSvg) => {
      if (!cancelled) {
        setSvg(renderedSvg);
        setError(null);
      }
    }).catch((err) => {
      if (!cancelled) {
        setSvg(null);
        setError(String(err?.message || err));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const svgMetrics = svg ? parseSvgMetrics(svg) : null;

  const updateInlineZoom = React.useCallback((next: number | ((value: number) => number)) => {
    const current = getInlineState(code).zoom;
    const value = typeof next === "function" ? next(current) : next;
    setInlineState(code, { zoom: clampZoom(value) });
  }, [code]);
  const inlineZoomIn = React.useCallback(() => updateInlineZoom((v) => v + ZOOM_STEP), [updateInlineZoom]);
  const inlineZoomOut = React.useCallback(() => updateInlineZoom((v) => v - ZOOM_STEP), [updateInlineZoom]);
  const resetInlineZoom = React.useCallback(() => setInlineState(code, { zoom: 1 }), [code]);
  const updatePreviewZoom = React.useCallback((next: number | ((value: number) => number)) => {
    const value = typeof next === "function" ? next(activePreviewZoom) : next;
    setActivePreviewZoom(clampZoom(value));
  }, []);
  const zoomIn = React.useCallback(() => updatePreviewZoom((v) => v + ZOOM_STEP), [updatePreviewZoom]);
  const zoomOut = React.useCallback(() => updatePreviewZoom((v) => v - ZOOM_STEP), [updatePreviewZoom]);
  const resetZoom = React.useCallback(() => setActivePreviewZoom(1), []);
  const fitToPage = React.useCallback(() => {
    if (!svgMetrics || !previewCanvasRef.current) return;
    const rect = previewCanvasRef.current.getBoundingClientRect();
    const availableWidth = Math.max(1, rect.width - 48);
    const availableHeight = Math.max(1, rect.height - 48);
    setActivePreviewZoom(Math.min(availableWidth / svgMetrics.width, availableHeight / svgMetrics.height));
  }, [svgMetrics]);
  const toggleFullscreen = React.useCallback(() => {
    const element = previewPanelRef.current;
    if (!element) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void element.requestFullscreen?.();
  }, []);
  const downloadPng = React.useCallback(() => {
    if (!svg) return;
    void downloadSvgAsPng(svg).catch((err) => {
      console.error("Failed to download Mermaid diagram:", err);
    });
  }, [svg]);

  React.useEffect(() => {
    if (!previewOpen && activePreviewCode === code) setActivePreviewCode(null);
  }, [previewOpen]);

  React.useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) {
        event.preventDefault();
        closePreview();
      }
    };
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [closePreview, previewOpen]);

  React.useLayoutEffect(() => {
    if (!previewOpen || !previewCanvasRef.current) return;
    const element = previewCanvasRef.current;
    element.scrollLeft = activePreviewScroll.left;
    element.scrollTop = activePreviewScroll.top;
  }, [previewMode, previewOpen, previewZoom, svg]);

  if (error) {
    return (
      <div className="my-4 overflow-hidden rounded-[18px] border border-destructive/30">
        <div className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/10 px-3 py-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-destructive">
            Mermaid Error
          </div>
          <CopyButton text={code} label="复制代码" />
        </div>
        <div className="bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive">
          {error}
        </div>
        <div className="border-t border-destructive/20">
          <CodeViewer code={code} language="mermaid" title="Mermaid Source" maxLines={200} showLineNumbers />
        </div>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 flex items-center justify-center rounded-[18px] border border-border/50 bg-muted/30 py-8">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          Rendering diagram...
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="my-4 overflow-hidden rounded-[18px] border border-border/60 bg-[var(--color-surface-container-low)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-[var(--color-surface-container)] px-3 py-2">
          <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            Mermaid
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setInlineState(code, { mode: inlineMode === "diagram" ? "code" : "diagram" })}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={inlineMode === "diagram" ? "查看代码" : "查看图表"}
              title={inlineMode === "diagram" ? "查看代码" : "查看图表"}
            >
              {inlineMode === "diagram" ? <Code2 className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={inlineZoomOut}
              disabled={inlineMode !== "diagram"}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label="缩小"
              title="缩小"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={resetInlineZoom}
              disabled={inlineMode !== "diagram"}
              className="min-w-[46px] rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label="重置缩放"
              title="重置缩放"
            >
              {Math.round(inlineZoom * 100)}%
            </button>
            <button
              type="button"
              onClick={inlineZoomIn}
              disabled={inlineMode !== "diagram"}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label="放大"
              title="放大"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={downloadPng}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="下载图片"
              title="下载图片"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={openPreview}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Maximize2 className="h-3 w-3" />
              放大
            </button>
            <CopyButton text={code} label="复制" />
          </div>
        </div>
        <div
          ref={containerRef}
          className="flex cursor-pointer items-center justify-center overflow-auto bg-white p-4 dark:bg-white"
          onClick={openPreview}
        >
          {inlineMode === "diagram" ? (
            <div
              className="[&_svg]:block [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-none"
              style={{
                width: "100%",
                zoom: inlineZoom,
              } as React.CSSProperties}
              dangerouslySetInnerHTML={{
                __html: svg,
              }}
            />
          ) : (
            <div className="w-full bg-background text-left" onClick={(event) => event.stopPropagation()}>
              <CodeViewer code={code} language="mermaid" title="Mermaid Source" maxLines={200} showLineNumbers />
            </div>
          )}
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
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="fixed left-1/2 top-1/2 z-50 w-full max-w-[1100px] -translate-x-1/2 -translate-y-1/2"
            >
              <div ref={previewPanelRef} className="mx-4 max-h-[85vh] overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl fullscreen:mx-0 fullscreen:flex fullscreen:h-screen fullscreen:max-h-screen fullscreen:w-screen fullscreen:flex-col fullscreen:rounded-none fullscreen:border-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
                  <div className="shrink-0 text-sm font-semibold text-foreground">
                    Mermaid Diagram
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                    <div className="flex flex-wrap items-center justify-end gap-1 rounded-lg border border-border bg-muted/50 px-1 py-1">
                      <button
                        type="button"
                        onClick={() => setActivePreviewMode(previewMode === "diagram" ? "code" : "diagram")}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label={previewMode === "diagram" ? "查看代码" : "查看图表"}
                        title={previewMode === "diagram" ? "查看代码" : "查看图表"}
                      >
                        {previewMode === "diagram" ? <Code2 className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={zoomOut}
                        disabled={previewMode !== "diagram"}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                        aria-label="缩小"
                        title="缩小"
                      >
                        <ZoomOut className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={resetZoom}
                        disabled={previewMode !== "diagram"}
                        className="min-w-[52px] rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                        title="重置缩放"
                      >
                        {Math.round(previewZoom * 100)}%
                      </button>
                      <button
                        type="button"
                        onClick={zoomIn}
                        disabled={previewMode !== "diagram"}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                        aria-label="放大"
                        title="放大"
                      >
                        <ZoomIn className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={fitToPage}
                        disabled={previewMode !== "diagram"}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                        aria-label="适应页面"
                        title="适应页面"
                      >
                        <Maximize2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label={isFullscreen ? "退出全屏" : "全屏"}
                        title={isFullscreen ? "退出全屏" : "全屏"}
                      >
                        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={downloadPng}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label="下载图片"
                        title="下载图片"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                    <CopyButton text={code} label="复制" />
                    <button
                      type="button"
                      onClick={closePreview}
                      aria-label="关闭"
                      title="关闭"
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div
                  ref={previewCanvasRef}
                  className="overflow-auto bg-white p-6 fullscreen:flex-1"
                  style={isFullscreen ? undefined : { maxHeight: "calc(85vh - 80px)" }}
                  onScroll={(event) => {
                    if (!previewOpenRef.current || activePreviewCode !== code) return;
                    const element = event.currentTarget;
                    setActivePreviewScroll(element.scrollLeft, element.scrollTop);
                  }}
                  onWheel={(event) => {
                    event.stopPropagation();
                    if (previewMode !== "diagram" || (!event.ctrlKey && !event.metaKey)) return;
                    event.preventDefault();
                    updatePreviewZoom((value) => value + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
                  }}
                >
                  {previewMode === "diagram" ? (
                    <div
                      className="mx-auto [&_svg]:block [&_svg]:h-full [&_svg]:w-full [&_svg]:max-w-none"
                      style={
                        svgMetrics
                          ? { width: `${svgMetrics.width * previewZoom}px`, height: `${svgMetrics.height * previewZoom}px` }
                          : undefined
                      }
                      dangerouslySetInnerHTML={{
                        __html: svg,
                      }}
                    />
                  ) : (
                    <div className="bg-background">
                      <CodeViewer code={code} language="mermaid" title="Mermaid Source" maxLines={200} showLineNumbers />
                    </div>
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
