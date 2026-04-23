"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const imageDataUrlCache = new Map<string, string>();
const imageDataUrlPending = new Map<string, Promise<string | null>>();

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

function extractLocalImagePath(src: string): string | null {
  const trimmed = String(src || "").trim();
  if (!trimmed) return null;

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
    return null;
  }

  if (/^(data:|blob:|https?:)/i.test(trimmed)) return null;

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
  const originalSrc = String(src || "").trim();
  const localPath = React.useMemo(
    () => extractLocalImagePath(originalSrc),
    [originalSrc],
  );
  const [resolvedSrc, setResolvedSrc] = React.useState<string | null>(
    localPath ? imageDataUrlCache.get(localPath) || null : originalSrc || null,
  );
  const [failed, setFailed] = React.useState(false);

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
      setResolvedSrc(originalSrc);
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
          imageDataUrlCache.set(localPath, dataUrl);
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
  }, [originalSrc, localPath]);

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
    <img
      src={resolvedSrc}
      alt={alt || ""}
      className={className}
      onError={() => {
        setFailed(true);
        setResolvedSrc(null);
      }}
    />
  );
}
