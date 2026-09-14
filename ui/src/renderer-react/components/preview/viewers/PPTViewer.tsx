"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { documentIpc } from "@/ipc/document.ipc";
import { shellIpc } from "@/ipc/shell.ipc";
import { LazyOpenFileViewer } from "./LazyOpenFileViewer";
import { PDFViewer } from "./PDFViewer";

const pdfCache = new Map<string, { pdfPath: string; timestamp: number }>();
const CACHE_TIMEOUT = 5 * 60 * 1000;

export function PPTViewer({ filePath, fileVersion }: { filePath: string; fileVersion?: number }) {
  const [pdfPath, setPdfPath] = React.useState<string>();
  const [useOfv, setUseOfv] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const cacheKey = `${filePath}:${fileVersion ?? "unknown"}`;

  const load = React.useCallback(async (bypassCache = false) => {
    setLoading(true);
    setPdfPath(undefined);
    setUseOfv(false);
    try {
      const cached = pdfCache.get(cacheKey);
      if (!bypassCache && cached && Date.now() - cached.timestamp < CACHE_TIMEOUT) {
        setPdfPath(cached.pdfPath);
        return;
      }
      if (cached) pdfCache.delete(cacheKey);

      if (await documentIpc.libreOffice.isAvailable()) {
        const response = await documentIpc.convert({ filePath, to: "libreoffice-pdf" });
        if (response?.result?.success && response.result.data) {
          setPdfPath(response.result.data);
          pdfCache.set(cacheKey, { pdfPath: response.result.data, timestamp: Date.now() });
          return;
        }
      }
      setUseOfv(true);
    } catch {
      setUseOfv(true);
    } finally {
      setLoading(false);
    }
  }, [cacheKey, filePath]);

  React.useEffect(() => {
    void load(false);
  }, [load]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在选择 PowerPoint 解析器...</div>;
  }

  if (pdfPath) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-end gap-2 border-b border-border/70 px-4 py-2.5">
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => void load(true)}>刷新</Button>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => void shellIpc.openFile(filePath)}>用系统应用打开</Button>
        </div>
        <div className="min-h-0 flex-1">
          <PDFViewer filePath={pdfPath} title={filePath} />
        </div>
      </div>
    );
  }

  if (useOfv) {
    return <LazyOpenFileViewer filePath={filePath} fileName={filePath} capability="basic" />;
  }

  return null;
}
