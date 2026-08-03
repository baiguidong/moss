"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspacePath } from "@/components/workspace-path-context";

const IMAGE_CACHE_MAX = 100;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;
const imageDataUrlCache = new Map<string, string>();
const imageDataUrlPending = new Map<string, Promise<string | null>>();

function cacheImageDataUrl(key: string, dataUrl: string) {
  if (imageDataUrlCache.has(key)) imageDataUrlCache.delete(key);
  imageDataUrlCache.set(key, dataUrl);
  while (imageDataUrlCache.size > IMAGE_CACHE_MAX) {
    const oldest = imageDataUrlCache.keys().next().value;
    if (oldest === undefined) break;
    imageDataUrlCache.delete(oldest);
  }
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function decodeFileUrlToPath(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol !== "file:") return null;
    const decoded = decodeURIComponent(url.pathname || "");
    if (!decoded) return null;
    if (/^\/[A-Za-z]:\//.test(decoded)) {
      return decoded.slice(1);
    }
    return decoded;
  } catch {
    return null;
  }
}

function decodeLocalUrlPath(src: string, protocol: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol !== protocol) return null;
    const decoded = decodeURIComponent(url.pathname || "");
    if (!decoded) return null;
    if (/^\/[A-Za-z]:\//.test(decoded)) {
      return decoded.slice(1);
    }
    return decoded;
  } catch {
    return null;
  }
}

function resolveImagePath(src: string, workspace: string, homeDir: string): string | null {
  const trimmed = String(src || "").trim();
  if (!trimmed) return null;

  if (/^[~～]($|[\\/])/.test(trimmed)) {
    if (!homeDir) return null;
    const relativeToHome = trimmed.slice(1).replace(/^[\\/]/, "");
    const sep = homeDir.endsWith("/") ? "" : "/";
    return relativeToHome ? `${homeDir}${sep}${relativeToHome}` : homeDir;
  }

  if (trimmed.startsWith("file://")) {
    return decodeFileUrlToPath(trimmed);
  }

  if (trimmed.startsWith("moss-image://")) {
    return decodeLocalUrlPath(trimmed, "moss-image:");
  }

  if (
    trimmed.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("\\\\")
  ) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed, "http://local-renderer");
    if (
      /^\/?image$/i.test(url.pathname) ||
      /\/_next\/image$/i.test(url.pathname)
    ) {
      const path = url.searchParams.get("url");
      return path ? decodeURIComponent(path) : null;
    }
  } catch {
    // not a URL-like path
  }

  if (/^(data:|blob:|https?:|moss-media:)/i.test(trimmed)) return null;

  // Relative path: resolve against workspace directory
  if (workspace) {
    const sep = workspace.endsWith("/") ? "" : "/";
    return `${workspace}${sep}${trimmed}`;
  }

  return null;
}

export function LocalImage({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
}) {
  const workspace = useWorkspacePath();
  const originalSrc = String(src || "").trim();
  const [homeDir, setHomeDir] = React.useState("");
  const usesHomePath = /^[~～]($|[\\/])/.test(originalSrc);

  React.useEffect(() => {
    if (!usesHomePath || homeDir) return;
    let cancelled = false;
    void window.agentDesktop.fs.getHomeDir().then((dir) => {
      if (!cancelled && dir) setHomeDir(dir);
    }).catch(() => {
      // leave unresolved; the failure state below will render
    });
    return () => {
      cancelled = true;
    };
  }, [homeDir, usesHomePath]);

  const localPath = React.useMemo(
    () => resolveImagePath(originalSrc, workspace, homeDir),
    [homeDir, originalSrc, workspace],
  );
  const [resolvedSrc, setResolvedSrc] = React.useState<string | null>(
    localPath ? imageDataUrlCache.get(localPath) || null : originalSrc || null,
  );
  const [failed, setFailed] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewZoom, setPreviewZoom] = React.useState(1);

  React.useEffect(() => {
    let cancelled = false;
    setFailed(false);

    if (!originalSrc) {
      setResolvedSrc(null);
      return () => {
        cancelled = true;
      };
    }

    if (!localPath) {
      if (usesHomePath && !homeDir) {
        setResolvedSrc(null);
        return () => {
          cancelled = true;
        };
      }
      // If originalSrc looks like a bare filename (no protocol, no leading /),
      // it's a relative path that we couldn't resolve — show failure state.
      if (originalSrc && !/^(data:|blob:|https?:|moss-media:)/i.test(originalSrc)) {
        setFailed(true);
        setResolvedSrc(null);
      } else {
        setResolvedSrc(originalSrc || null);
      }
      return () => {
        cancelled = true;
      };
    }

    const cached = imageDataUrlCache.get(localPath);
    if (cached) {
      setResolvedSrc(cached);
      return () => {
        cancelled = true;
      };
    }

    const pending = imageDataUrlPending.get(localPath)
      || window.agentDesktop.fs.getImageBase64(localPath).then((dataUrl) => {
        if (dataUrl) {
          cacheImageDataUrl(localPath, dataUrl);
        }
        imageDataUrlPending.delete(localPath);
        return dataUrl;
      }).catch((error) => {
        imageDataUrlPending.delete(localPath);
        throw error;
      });

    imageDataUrlPending.set(localPath, pending);

    void pending.then((dataUrl) => {
      if (cancelled) return;
      if (dataUrl) {
        setResolvedSrc(dataUrl);
      } else {
        setFailed(true);
      }
    }).catch(() => {
      if (!cancelled) {
        setFailed(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [homeDir, originalSrc, localPath, usesHomePath]);

  React.useEffect(() => {
    if (!previewOpen) {
      setPreviewZoom(1);
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPreviewOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [previewOpen]);

  if (!resolvedSrc) {
    return (
      <div
        className={cn(
          "my-2 flex min-h-24 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-4 text-xs text-muted-foreground",
          className,
        )}
      >
        {failed ? (alt || "图片加载失败") : "正在加载图片..."}
      </div>
    );
  }

  return (
    <>
      <img
        src={resolvedSrc}
        alt={alt || ""}
        className={cn("cursor-zoom-in", className)}
        tabIndex={0}
        role="button"
        onClick={() => setPreviewOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setPreviewOpen(true);
          }
        }}
        onError={() => {
          setFailed(true);
          setResolvedSrc(null);
        }}
      />

      {previewOpen ? createPortal(
        <div className="fixed inset-0 z-50 bg-black/80" onClick={() => setPreviewOpen(false)}>
          <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-white/15 bg-black/55 p-1 shadow-2xl backdrop-blur">
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="缩小图片"
              onClick={(event) => {
                event.stopPropagation();
                setPreviewZoom((value) => clampZoom(value - ZOOM_STEP));
              }}
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="min-w-[56px] rounded-md px-2 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="重置图片缩放"
              onClick={(event) => {
                event.stopPropagation();
                setPreviewZoom(1);
              }}
            >
              {Math.round(previewZoom * 100)}%
            </button>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="放大图片"
              onClick={(event) => {
                event.stopPropagation();
                setPreviewZoom((value) => clampZoom(value + ZOOM_STEP));
              }}
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="关闭图片预览"
              onClick={(event) => {
                event.stopPropagation();
                setPreviewOpen(false);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            className="flex h-full w-full items-center justify-center overflow-auto p-6"
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => {
              if (!event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              setPreviewZoom((value) => clampZoom(value + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
            }}
          >
            <img
              src={resolvedSrc}
              alt={alt || ""}
              className="select-none rounded-lg object-contain shadow-2xl"
              style={{
                width: `calc((100vw - 3rem) * ${previewZoom})`,
                height: `calc((100vh - 3rem) * ${previewZoom})`,
              }}
              draggable={false}
            />
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
