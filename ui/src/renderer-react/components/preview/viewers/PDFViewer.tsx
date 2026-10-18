"use client";

import * as React from "react";

export function PDFViewer({ filePath, title, onReady, onError }: { filePath: string; title: string; onReady?: () => void; onError?: (message: string) => void }) {
  const webviewRef = React.useRef<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const pdfSrc = React.useMemo(() => (window.mossWeb ? window.mossWeb.fileUrl(filePath) : `file://${filePath}`) + "#navpanes=0", [filePath]);

  React.useEffect(() => {
    const webview = webviewRef.current;
    setLoading(true);
    setError(null);
    if (!webview) return;

    const handleLoad = () => {
      setLoading(false);
      setError(null);
      onReady?.();
    };
    const handleError = (event: any) => {
      setLoading(false);
      setError(event?.description || "PDF 加载失败");
      onError?.(event?.description || "PDF 加载失败");
    };
    const timeoutId = window.setTimeout(() => {
      setLoading(false);
    }, 10000);

    webview.addEventListener("did-finish-load", handleLoad);
    webview.addEventListener("did-fail-load", handleError);
    return () => {
      window.clearTimeout(timeoutId);
      webview.removeEventListener("did-finish-load", handleLoad);
      webview.removeEventListener("did-fail-load", handleError);
    };
  }, [pdfSrc]);

  if (window.mossWeb) return <iframe onLoad={onReady} title={title} src={pdfSrc} className="h-full w-full border-0" />;

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-background">
      {loading ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载 PDF...</div> : null}
      <webview
        key={pdfSrc}
        ref={webviewRef}
        src={pdfSrc}
        className="h-full w-full"
        style={{ display: loading ? "none" : "inline-flex" }}
        webpreferences={JSON.stringify({
          webviewtag: true,
          allowRunningInsecureContent: false,
          webSecurity: true,
        })}
        allowpopups={true}
      />
    </div>
  );
}
