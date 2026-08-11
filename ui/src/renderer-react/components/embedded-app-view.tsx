"use client";

import * as React from "react";
import { MonitorPlay, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type EmbeddedAppSession = {
  embedId: string;
  url: string;
  preload: string;
  app?: {
    id: string;
    name: string;
    displayName: string;
    description: string;
  };
};

export function EmbeddedAppView({
  appName,
}: {
  appName: string;
}) {
  const webviewRef = React.useRef<any>(null);
  const [session, setSession] = React.useState<EmbeddedAppSession | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    let embedIdToClose = "";
    setSession(null);
    setError("");
    setLoading(true);

    window.agentDesktop.openEmbeddedApp({ name: appName }).then((result) => {
      if (!result?.ok || !result.embedId || !result.url || !result.preload) {
        if (!cancelled) {
          setError(result?.error || "App 加载失败");
          setLoading(false);
        }
        return;
      }
      embedIdToClose = result.embedId;
      if (cancelled) {
        void window.agentDesktop.closeEmbeddedApp({ embedId: result.embedId });
        return;
      }
      setSession({
        embedId: result.embedId,
        url: result.url,
        preload: result.preload,
        app: result.app,
      });
    }).catch((err) => {
      if (!cancelled) {
        setError(err?.message || String(err));
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      if (embedIdToClose) {
        void window.agentDesktop.closeEmbeddedApp({ embedId: embedIdToClose });
      }
    };
  }, [appName, reloadKey]);

  React.useEffect(() => {
    if (!session) return;
    const webview = webviewRef.current;
    if (!webview) return;

    const handleLoad = () => setLoading(false);
    const handleFail = (event: any) => {
      if (event?.errorCode === -3) return;
      setError(event?.errorDescription || "App 页面加载失败");
      setLoading(false);
    };

    webview.addEventListener("dom-ready", handleLoad);
    webview.addEventListener("did-finish-load", handleLoad);
    webview.addEventListener("did-fail-load", handleFail);

    return () => {
      webview.removeEventListener("dom-ready", handleLoad);
      webview.removeEventListener("did-finish-load", handleLoad);
      webview.removeEventListener("did-fail-load", handleFail);
    };
  }, [session]);

  const title = session?.app?.displayName || appName;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border/80 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MonitorPlay className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {session?.app?.description || "App"}
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-xl px-2.5 text-xs" onClick={() => setReloadKey((value) => value + 1)}>
          <RefreshCcw className="h-3.5 w-3.5" />
          刷新
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 bg-background">
        {session && (
          <webview
            key={session.embedId}
            ref={webviewRef}
            src={session.url}
            preload={session.preload}
            className="h-full w-full"
          />
        )}
        {(loading || error) && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/92 px-6 text-center backdrop-blur-sm">
            <div className="max-w-md rounded-2xl border border-border/80 bg-card/95 px-5 py-4 shadow-lg">
              <div className="text-sm font-medium text-foreground">
                {error ? "App 加载失败" : "正在打开 App"}
              </div>
              <div className="mt-2 text-xs leading-6 text-muted-foreground">
                {error || title}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
