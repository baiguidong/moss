"use client";

export function URLViewer({ url, onReady }: { url: string; onReady?: () => void }) {
  return <iframe onLoad={onReady} title={url} src={url} sandbox="allow-same-origin allow-scripts allow-forms allow-popups" className="h-full w-full bg-background" />;
}
