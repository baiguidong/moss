"use client";

import * as React from "react";
import {
  archivePlugin,
  assetPlugin,
  audioPlugin,
  cadPlugin,
  createViewer,
  drawingPlugin,
  emailPlugin,
  epubPlugin,
  gisPlugin,
  imagePlugin,
  model3dPlugin,
  ofdPlugin,
  officePlugin,
  textPlugin,
  videoPlugin,
  xmindPlugin,
  xpsPlugin,
} from "@open-file-viewer/core";
import "@open-file-viewer/core/style.css";
import "leaflet/dist/leaflet.css";
import { createOfflinePreviewUrl } from "./offline-preview-url";

const OFV_PLUGINS = [
  imagePlugin(),
  videoPlugin(),
  audioPlugin(),
  textPlugin(),
  epubPlugin(),
  xpsPlugin(),
  officePlugin(),
  ofdPlugin(),
  archivePlugin(),
  emailPlugin(),
  drawingPlugin(),
  xmindPlugin(),
  cadPlugin(),
  model3dPlugin(),
  gisPlugin(),
  assetPlugin(),
];

export type OpenFileViewerProps = {
  filePath: string;
  fileName: string;
  mimeType?: string;
  rootPath?: string;
  capability?: "full" | "basic" | "structure";
  content?: string;
};

function resolveTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark"
    || document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

function capabilityMessage(capability: OpenFileViewerProps["capability"]): string | null {
  if (capability === "structure") {
    return "当前格式仅提供结构或元数据预览，内容可能不完整。";
  }
  if (capability === "basic") {
    return "当前格式为基础预览，复杂布局、字体或专有对象可能降级。";
  }
  return null;
}

export function OpenFileViewer({
  filePath,
  fileName,
  mimeType,
  rootPath,
  capability = "full",
  content,
}: OpenFileViewerProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [theme, setTheme] = React.useState<"light" | "dark">(resolveTheme);
  const [error, setError] = React.useState<string | null>(null);
  const source = React.useMemo(
    () => content === undefined
      ? createOfflinePreviewUrl(filePath, rootPath)
      : new Blob([content], { type: mimeType || "text/plain" }),
    [content, filePath, mimeType, rootPath],
  );
  const notice = capabilityMessage(capability);

  React.useEffect(() => {
    const observer = new MutationObserver(() => setTheme(resolveTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!document.getElementById("ofv-leaflet-css")) {
      const marker = document.createElement("meta");
      marker.id = "ofv-leaflet-css";
      marker.dataset.source = "bundled";
      document.head.append(marker);
    }
  }, []);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setError(null);
    const viewer = createViewer({
      container,
      file: source,
      fileName,
      mimeType,
      width: "100%",
      height: "100%",
      locale: "zh-CN",
      theme,
      fit: "contain",
      plugins: OFV_PLUGINS,
      fallback: "inline",
      toolbar: {
        zoom: true,
        rotate: true,
        download: true,
        fullscreen: true,
        print: true,
        search: true,
      },
      onError: (viewerError) => setError(viewerError.message || "文件解析失败。"),
    });
    return () => viewer.destroy();
  }, [fileName, mimeType, source, theme]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      {notice ? (
        <div className="border-b border-border/70 bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      <div ref={containerRef} className="min-h-0 flex-1 border-0" />
    </div>
  );
}

export default OpenFileViewer;
