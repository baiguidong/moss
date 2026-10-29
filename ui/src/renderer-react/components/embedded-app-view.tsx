"use client";
import { WebAppFrame } from './web-app-frame';
import { isWebUI, supportsHostFeature } from '@/lib/host-environment';

import * as React from "react";
import { ArrowLeft, CircleAlert, Loader2, MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppToolbarActions } from '@/components/app-settings';
import type { StoredApp } from '@/types';

type EmbeddedAppSession = {
  embedId: string;
  url: string;
  preload: string;
  app?: {id:string;name:string;displayName:string;description:string};
};

export function EmbeddedAppView({
  appName,
  app,
  route = '',
  sessionId, workspace, previewRef, compact = false, widget = false, miniWidget = false,
  settingId, version, onViewState, onBack,
}: {
  appName: string;
  app?: StoredApp;
  route?: string;
  sessionId?: string;
  workspace?: string;
  previewRef?: string;
  compact?: boolean;
  widget?: boolean;
  miniWidget?: boolean;
  settingId?: string;
  version?: string;
  onBack?: () => void;
  onViewState?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const webviewRef = React.useRef<any>(null);
  const [session, setSession] = React.useState<EmbeddedAppSession | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);
  const viewStateCallback = React.useRef(onViewState); viewStateCallback.current = onViewState;
  React.useEffect(() => {
    if (!session || !settingId) return;
    const handler = window.agentDesktop.ipcOn('app:embedded-state', (event: any) => {
      if (event.embedId === session.embedId) viewStateCallback.current?.({ dirty: event.dirty === true, busy: event.busy === true });
    });
    return () => { window.agentDesktop.ipcOff('app:embedded-state', handler); viewStateCallback.current?.({ dirty: false, busy: false }); };
  }, [session, settingId]);

  React.useEffect(() => {
    let cancelled = false;
    let embedIdToClose = "";
    setSession(null);
    setError("");
    setLoading(true);

    if (!supportsHostFeature('embeddedApps')) {
      setLoading(false);
      setError('此 App 页面尚未适配 WebUI。');
      return;
    }

    window.agentDesktop.openEmbeddedApp({ name: appName, sessionId, workspace, previewRef, settingId, version }).then((result) => {
      if (!result?.ok || !result.embedId || !result.url || !result.preload) {
        if (!cancelled) {
          setError(result?.error || "App 加载失败");
          setLoading(false);
        }
        return;
      }
      embedIdToClose = result.embedId;
      if (cancelled) {
        void window.agentDesktop.closeEmbeddedApp({ embedId: result.embedId }).catch(() => {});
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
        void window.agentDesktop.closeEmbeddedApp({ embedId: embedIdToClose }).catch(() => {});
      }
    };
  }, [appName, reloadKey, sessionId, workspace, previewRef, settingId, version]);

  React.useEffect(() => {
    const reconnect = () => setReloadKey(value => value + 1);
    window.addEventListener('moss:reconnected', reconnect);
    return () => window.removeEventListener('moss:reconnected', reconnect);
  }, []);

  React.useEffect(() => {
    if (!session || isWebUI()) return;
    const webview = webviewRef.current;
    if (!webview) return;

    const handleLoad = () => { setLoading(false); };
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

  // Keep the guest's requested URL in sync even while a previous navigation is
  // loading. Comparing getURL() would miss a quick return to the current route.
  const activeRoute = settingId ? '' : route;
  const viewUrl = session && activeRoute ? `${session.url.split('#', 1)[0]}${activeRoute}` : session?.url;
  const title = app?.displayName || app?.title || session?.app?.displayName || appName;

  return (
    <div className={`flex h-full min-h-0 flex-col ${widget ? 'bg-transparent' : 'bg-background'}`}>
      {!widget && !compact && <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border/80 px-4">
        {onBack && <Button variant="ghost" size="icon" aria-label="返回应用详情" className="h-8 w-8 shrink-0" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>}
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MonitorPlay className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {session?.app?.description || "App"}
          </div>
        </div>
        <AppToolbarActions onRefresh={() => setReloadKey(value => value + 1)} />
      </div>
      }
      <div className={`relative min-h-0 flex-1 ${widget ? 'bg-transparent' : 'bg-background'}`}>
        {session && (isWebUI() ? <WebAppFrame key={session.embedId} embedId={session.embedId} url={viewUrl!} onReady={() => setLoading(false)} onError={message => { setLoading(false); setError(message); }} /> :
          <webview
            key={session.embedId}
            ref={webviewRef}
            src={viewUrl}
            preload={session.preload}
            className="h-full w-full"
          />
        )}
        {miniWidget && (loading || error) ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-full border border-border bg-card text-muted-foreground" role="status" title={error || '正在打开 App'} aria-label={error || '正在打开 App'}>
            {error ? <CircleAlert className="h-5 w-5 text-destructive" /> : <Loader2 className="h-5 w-5 animate-spin" />}
          </div>
        ) : (loading || error) && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/92 px-6 text-center backdrop-blur-sm">
            <div className="max-w-md rounded-2xl border border-border/80 bg-card/95 px-5 py-4 shadow-lg">
              <div className="text-sm font-medium text-foreground">
                {error ? "App 加载失败" : "正在打开 App"}
              </div>
              <div className="mt-2 text-xs leading-6 text-muted-foreground">
                {error || title}
              </div>
              {error && <Button variant="outline" size="sm" onClick={() => setReloadKey(value => value + 1)}>重新加载</Button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
