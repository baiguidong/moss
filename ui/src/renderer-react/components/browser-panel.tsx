"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Braces,
  ExternalLink,
  Globe2,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  BrowserAuthNavigation,
  BrowserConnectorAuthContext,
  BrowserMcpAuthContext,
  BrowserState,
  BrowserTabState,
} from "@/types";

const DEFAULT_URL = "about:blank";
const FALLBACK_SESSION_KEY = "__global__";
const pendingAuthNavigationIds = new Set<string>();

function displayUrl(url: string): string {
  return url === DEFAULT_URL ? "" : url;
}

function getUrlParam(url: URL, paramName: string): string {
  const direct = url.searchParams.get(paramName);
  if (direct) return direct;
  const hash = url.hash.replace(/^#/, "");
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash;
  return new URLSearchParams(hashQuery).get(paramName) || "";
}

function isHostAllowed(hostname: string, allowedHosts?: string[]): boolean {
  if (!allowedHosts?.length) return true;
  const normalizedHost = hostname.toLowerCase();
  return allowedHosts.some((host) => {
    const normalized = String(host || "").trim().toLowerCase();
    return Boolean(normalized) && (normalizedHost === normalized || normalizedHost.endsWith(`.${normalized}`));
  });
}

function extractConnectorAuthToken(rawUrl: string, context?: BrowserConnectorAuthContext | null): string {
  if (!context) return "";
  try {
    const url = new URL(rawUrl);
    if (!isHostAllowed(url.hostname, context.allowedHosts)) return "";
    return getUrlParam(url, context.tokenParam || "access_token");
  } catch {
    return "";
  }
}

function tabIcon(tab: BrowserTabState, active: boolean) {
  if (tab.isLoading && active) {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />;
  }
  if (tab.error) {
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  }
  return <Globe2 className="h-3.5 w-3.5 shrink-0" />;
}

export function openBrowserPanelUrl(
  sessionId: string | null | undefined,
  url: string,
  connectorAuth?: BrowserConnectorAuthContext | null,
  mcpAuth?: BrowserMcpAuthContext | null,
) {
  return window.agentDesktop.browser.openTab({
    sessionId: sessionId || FALLBACK_SESSION_KEY,
    url,
    connectorAuth: connectorAuth || null,
    mcpAuth: mcpAuth || null,
  });
}

export function BrowserPanel({ sessionId }: { sessionId?: string | null }) {
  const sessionKey = sessionId || FALLBACK_SESSION_KEY;
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const editingAddressRef = React.useRef(false);
  const sessionKeyRef = React.useRef(sessionKey);
  sessionKeyRef.current = sessionKey;
  const [state, setState] = React.useState<BrowserState | null>(null);
  const [inputUrl, setInputUrl] = React.useState("");
  const [commandError, setCommandError] = React.useState<string | null>(null);
  const activeTab = state?.tabs.find((tab) => tab.id === state.activeTabId) || state?.tabs[0] || null;

  const applyState = React.useCallback(async (request: Promise<BrowserState>) => {
    try {
      const nextState = await request;
      setState(nextState);
      setCommandError(null);
      return nextState;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCommandError(message);
      return null;
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setState(null);
    setCommandError(null);
    const unsubscribe = window.agentDesktop.browser.onState((payload) => {
      if (payload.sessionId !== sessionKey) return;
      setState(payload.state);
    });
    void window.agentDesktop.browser.getState({ sessionId: sessionKey }).then((nextState) => {
      if (!cancelled) setState(nextState);
    }).catch((error: unknown) => {
      if (!cancelled) setCommandError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [sessionKey]);

  React.useEffect(() => {
    if (!activeTab || editingAddressRef.current) return;
    setInputUrl(displayUrl(activeTab.url));
  }, [activeTab?.id, activeTab?.url]);

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    const publishBounds = () => {
      frame = 0;
      const rect = host.getBoundingClientRect();
      window.agentDesktop.browser.setHost({
        sessionId: sessionKey,
        visible: rect.width > 0 && rect.height > 0,
        bounds: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
      });
    };
    const scheduleBounds = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(publishBounds);
    };
    const observer = new ResizeObserver(scheduleBounds);
    observer.observe(host);
    window.addEventListener("resize", scheduleBounds);
    window.addEventListener("scroll", scheduleBounds, true);
    scheduleBounds();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleBounds);
      window.removeEventListener("scroll", scheduleBounds, true);
      window.agentDesktop.browser.setHost({ sessionId: sessionKey, visible: false });
    };
  }, [sessionKey]);

  const processAuthNavigation = React.useCallback((navigation: BrowserAuthNavigation) => {
    if (navigation.sessionId !== sessionKey || pendingAuthNavigationIds.has(navigation.id)) return;
    pendingAuthNavigationIds.add(navigation.id);

    void (async () => {
      try {
        const connectorContext = navigation.connectorAuth;
        const mcpContext = navigation.mcpAuth;
        let nextState: BrowserState;
        if (connectorContext) {
          const token = extractConnectorAuthToken(navigation.url, connectorContext);
          if (!token) throw new Error("授权回调中缺少访问令牌");
          const result = await window.agentDesktop.saveConnectorMcpToken({
            connectorId: connectorContext.connectorId,
            serverName: connectorContext.serverName,
            token,
          });
          if (result?.error) throw new Error(result.error);
          nextState = await window.agentDesktop.browser.completeAuth({
            sessionId: navigation.sessionId,
            tabId: navigation.tabId,
            title: `${connectorContext.displayName || "连接器"}授权已完成`,
            authKind: "connector",
            serverName: connectorContext.serverName,
            eventId: navigation.id,
          });
        } else if (mcpContext) {
          await window.agentDesktop.submitMcpAuthCallback({
            name: mcpContext.serverName,
            callbackUrl: navigation.url,
          });
          nextState = await window.agentDesktop.browser.completeAuth({
            sessionId: navigation.sessionId,
            tabId: navigation.tabId,
            title: `${mcpContext.displayName || "连接器"}授权回调已提交`,
            authKind: "mcp",
            serverName: mcpContext.serverName,
            eventId: navigation.id,
          });
        } else {
          await window.agentDesktop.browser.ackAuthNavigation({
            sessionId: navigation.sessionId,
            eventId: navigation.id,
          });
          return;
        }

        if (sessionKeyRef.current === navigation.sessionId) {
          setState(nextState);
          setCommandError(null);
        }
      } catch (error) {
        if (sessionKeyRef.current === navigation.sessionId) {
          setCommandError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        pendingAuthNavigationIds.delete(navigation.id);
      }
    })();
  }, [sessionKey]);

  React.useEffect(() => {
    let cancelled = false;
    const consume = (navigation: BrowserAuthNavigation) => {
      if (!cancelled) processAuthNavigation(navigation);
    };
    const unsubscribe = window.agentDesktop.browser.onAuthNavigation(consume);
    void window.agentDesktop.browser.getPendingAuthNavigations({ sessionId: sessionKey })
      .then((navigations) => navigations.forEach(consume))
      .catch((error: unknown) => {
        if (!cancelled) setCommandError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [processAuthNavigation, sessionKey]);

  const tabTarget = activeTab ? { sessionId: sessionKey, tabId: activeTab.id } : null;
  const isSecure = Boolean(activeTab?.url.startsWith("https://"));

  const addTab = React.useCallback(() => {
    void applyState(window.agentDesktop.browser.openTab({ sessionId: sessionKey, url: DEFAULT_URL }))
      .then(() => window.setTimeout(() => inputRef.current?.focus(), 0));
  }, [applyState, sessionKey]);

  const openActiveTabInSystemBrowser = React.useCallback(async () => {
    if (!activeTab || activeTab.url === DEFAULT_URL) return;
    try {
      const result = await window.agentDesktop.shell.openExternal(activeTab.url);
      if (!result?.ok) throw new Error("系统浏览器无法打开当前网址");
      setCommandError(null);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : String(error));
    }
  }, [activeTab?.url]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-end gap-1 border-b border-border/80 bg-muted/35 px-1.5 pt-1">
        <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto" role="tablist" aria-label="浏览器标签页">
          {state?.tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            return (
              <div
                key={tab.id}
                className={cn(
                  "group flex h-8 min-w-[112px] max-w-[190px] items-center border border-b-0",
                  isActive
                    ? "rounded-t-md border-border/80 bg-background text-foreground"
                    : "rounded-t border-transparent text-muted-foreground hover:bg-background/55 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => void applyState(window.agentDesktop.browser.activateTab({ sessionId: sessionKey, tabId: tab.id }))}
                  className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 text-left text-xs"
                  title={tab.url}
                >
                  {tabIcon(tab, isActive)}
                  <span className="min-w-0 flex-1 truncate">{tab.title || "新标签页"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void applyState(window.agentDesktop.browser.closeTab({ sessionId: sessionKey, tabId: tab.id }))}
                  className="mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-colors hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                  title="关闭标签页"
                  aria-label={`关闭 ${tab.title || "新标签页"}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addTab}
          className="mb-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
          title="新建标签页"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/80 bg-background px-1.5">
        <button
          type="button"
          disabled={!activeTab?.canGoBack}
          onClick={() => tabTarget && void applyState(window.agentDesktop.browser.goBack(tabTarget))}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          title="后退"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!activeTab?.canGoForward}
          onClick={() => tabTarget && void applyState(window.agentDesktop.browser.goForward(tabTarget))}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          title="前进"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!activeTab || (activeTab.url === DEFAULT_URL && !activeTab.isNativeBlank)}
          onClick={() => {
            if (!tabTarget) return;
            void applyState(activeTab?.isLoading
              ? window.agentDesktop.browser.stop(tabTarget)
              : window.agentDesktop.browser.reload(tabTarget));
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          title={activeTab?.isLoading ? "停止" : "刷新"}
        >
          {activeTab?.isLoading ? <X className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
        <form
          className="relative min-w-[72px] flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!activeTab) return;
            editingAddressRef.current = false;
            inputRef.current?.blur();
            void applyState(window.agentDesktop.browser.navigate({ ...tabTarget!, url: inputUrl }));
          }}
        >
          {isSecure ? (
            <LockKeyhole className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Globe2 className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/70" />
          )}
          <input
            ref={inputRef}
            value={inputUrl}
            onFocus={(event) => {
              editingAddressRef.current = true;
              event.currentTarget.select();
            }}
            onBlur={() => {
              editingAddressRef.current = false;
              if (activeTab) setInputUrl(displayUrl(activeTab.url));
            }}
            onChange={(event) => setInputUrl(event.target.value)}
            placeholder="网址或 localhost:3000"
            spellCheck={false}
            className={cn(
              "h-7 w-full rounded border bg-muted/30 pl-7 pr-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus:bg-background",
              activeTab?.error ? "border-destructive/55 focus:border-destructive" : "border-border/70 focus:border-primary/55",
            )}
          />
        </form>
        <button
          type="button"
          disabled={!activeTab || (activeTab.url === DEFAULT_URL && !activeTab.isNativeBlank)}
          onClick={() => tabTarget && void applyState(window.agentDesktop.browser.toggleDevTools(tabTarget))}
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors disabled:opacity-30",
            activeTab?.devToolsOpen
              ? "bg-primary/12 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          title={activeTab?.devToolsOpen ? "关闭开发者工具" : "打开开发者工具"}
        >
          <Braces className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!activeTab || activeTab.url === DEFAULT_URL}
          onClick={() => void openActiveTabInSystemBrowser()}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          title="在系统浏览器中打开"
          aria-label="在系统浏览器中打开"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      {commandError ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          <span className="min-w-0 flex-1 break-words">{commandError}</span>
          <button
            type="button"
            onClick={() => setCommandError(null)}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-destructive/10"
            title="关闭错误提示"
            aria-label="关闭错误提示"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      <div ref={hostRef} className="relative min-h-0 flex-1 overflow-hidden bg-white dark:bg-zinc-950">
        {!state ? (
          <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : activeTab?.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
            <AlertTriangle className="h-7 w-7 text-destructive" />
            <div>
              <div className="text-sm font-medium text-foreground">无法打开页面</div>
              <div className="mt-1 break-all text-xs text-muted-foreground">{activeTab.error}</div>
            </div>
            <button
              type="button"
              onClick={() => tabTarget && void applyState(window.agentDesktop.browser.reload(tabTarget))}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-background px-3 text-xs text-foreground hover:bg-muted"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重试
            </button>
          </div>
        ) : activeTab?.url === DEFAULT_URL && !activeTab.isNativeBlank ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-background text-muted-foreground">
            <Globe2 className="h-8 w-8 opacity-35" />
            <span className="text-xs">新标签页</span>
          </div>
        ) : null}

      </div>
    </div>
  );
}
