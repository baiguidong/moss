"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type BrowserTab = {
  id: string;
  title: string;
  url: string;
  connectorAuth?: ConnectorAuthContext | null;
  mcpAuth?: McpAuthContext | null;
};

type BrowserState = {
  tabs: BrowserTab[];
  activeTabId: string;
};

type ConnectorAuthContext = {
  connectorId: string;
  serverName: string;
  displayName?: string;
  tokenParam?: string;
  allowedHosts?: string[];
};

type McpAuthContext = {
  serverName: string;
  displayName?: string;
};

type WebviewLike = HTMLElement & {
  src?: string;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
  stop?: () => void;
  getURL?: () => string;
  getTitle?: () => string;
};

const DEFAULT_URL = "about:blank";
const PARTITION = "persist:moss-right-browser";
const FALLBACK_SESSION_KEY = "__global__";
const browserStates = new Map<string, BrowserState>();
const browserListeners = new Set<() => void>();
const capturedConnectorAuthUrls = new Set<string>();
const submittedMcpAuthUrls = new Set<string>();

function emitBrowserChange() {
  for (const listener of browserListeners) listener();
}

function createTab(
  url = DEFAULT_URL,
  connectorAuth?: ConnectorAuthContext | null,
  mcpAuth?: McpAuthContext | null,
): BrowserTab {
  return {
    id: `browser-tab-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: url === DEFAULT_URL ? "新标签页" : url,
    url,
    connectorAuth: connectorAuth || null,
    mcpAuth: mcpAuth || null,
  };
}

function getBrowserState(sessionKey: string): BrowserState {
  let state = browserStates.get(sessionKey);
  if (!state) {
    const tab = createTab();
    state = { tabs: [tab], activeTabId: tab.id };
    browserStates.set(sessionKey, state);
  }
  return state;
}

function normalizeBrowserUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return DEFAULT_URL;
  if (/^(about|file|https?):/i.test(raw)) return raw;
  if (/^localhost(:|\/|$)/i.test(raw) || /^127\.0\.0\.1(:|\/|$)/.test(raw)) {
    return `http://${raw}`;
  }
  return `https://${raw}`;
}

export function openBrowserPanelUrl(
  sessionId: string | null | undefined,
  rawUrl: string,
  connectorAuth?: ConnectorAuthContext | null,
  mcpAuth?: McpAuthContext | null,
) {
  const nextUrl = normalizeBrowserUrl(rawUrl);
  const sessionKey = sessionId || FALLBACK_SESSION_KEY;
  const state = getBrowserState(sessionKey);
  const tab = createTab(nextUrl, connectorAuth, mcpAuth);
  state.tabs = [...state.tabs, tab];
  state.activeTabId = tab.id;
  emitBrowserChange();
}

function displayUrl(url: string): string {
  return url === DEFAULT_URL ? "" : url;
}

function getUrlParam(url: URL, paramName: string): string {
  const normalizedParam = paramName || "access_token";
  const direct = url.searchParams.get(normalizedParam);
  if (direct) return direct;
  const hash = url.hash.replace(/^#/, "");
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash;
  const hashParams = new URLSearchParams(hashQuery);
  return hashParams.get(normalizedParam) || "";
}

function isHostAllowed(hostname: string, allowedHosts?: string[]): boolean {
  if (!allowedHosts || allowedHosts.length === 0) return true;
  const normalizedHost = hostname.toLowerCase();
  return allowedHosts.some((host) => {
    const normalized = String(host || "").trim().toLowerCase();
    return Boolean(normalized) && (normalizedHost === normalized || normalizedHost.endsWith(`.${normalized}`));
  });
}

function extractConnectorAuthToken(rawUrl: string, context?: ConnectorAuthContext | null): string {
  if (!context) return "";
  try {
    const url = new URL(rawUrl);
    if (!isHostAllowed(url.hostname, context.allowedHosts)) return "";
    return getUrlParam(url, context.tokenParam || "access_token");
  } catch {
    return "";
  }
}

function getOAuthUrlParam(url: URL, paramName: string): string {
  const direct = url.searchParams.get(paramName);
  if (direct) return direct;
  const hash = url.hash.replace(/^#/, "");
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash;
  const hashParams = new URLSearchParams(hashQuery);
  return hashParams.get(paramName) || "";
}

function isMcpOAuthCallbackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const state = getOAuthUrlParam(url, "state");
    const code = getOAuthUrlParam(url, "code");
    const error = getOAuthUrlParam(url, "error");
    return Boolean(state && (code || error));
  } catch {
    return false;
  }
}

export function BrowserPanel({ sessionId }: { sessionId?: string | null }) {
  const sessionKey = sessionId || FALLBACK_SESSION_KEY;
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);
  const webviewRef = React.useRef<WebviewLike | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const state = getBrowserState(sessionKey);
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) || state.tabs[0]!;
  const [inputUrl, setInputUrl] = React.useState(displayUrl(activeTab.url));
  const [isLoading, setIsLoading] = React.useState(false);
  const [canGoBack, setCanGoBack] = React.useState(false);
  const [canGoForward, setCanGoForward] = React.useState(false);

  React.useEffect(() => {
    browserListeners.add(forceUpdate);
    return () => {
      browserListeners.delete(forceUpdate);
    };
  }, []);

  React.useEffect(() => {
    setInputUrl(displayUrl(activeTab.url));
    setCanGoBack(false);
    setCanGoForward(false);
  }, [activeTab.id, activeTab.url]);

  const updateActiveTab = React.useCallback(
    (patch: Partial<BrowserTab>) => {
      const nextState = getBrowserState(sessionKey);
      nextState.tabs = nextState.tabs.map((tab) =>
        tab.id === nextState.activeTabId ? { ...tab, ...patch } : tab,
      );
      emitBrowserChange();
    },
    [sessionKey],
  );

  const navigate = React.useCallback(
    (rawUrl: string) => {
      const nextUrl = normalizeBrowserUrl(rawUrl);
      updateActiveTab({ url: nextUrl, title: nextUrl === DEFAULT_URL ? "新标签页" : nextUrl });
      setInputUrl(displayUrl(nextUrl));
      setIsLoading(nextUrl !== DEFAULT_URL);
    },
    [updateActiveTab],
  );

  const syncNavigation = React.useCallback(() => {
    const webview = webviewRef.current;
    setCanGoBack(Boolean(webview?.canGoBack?.()));
    setCanGoForward(Boolean(webview?.canGoForward?.()));
  }, []);

  const captureConnectorAuth = React.useCallback((currentUrl: string) => {
    const context = activeTab.connectorAuth;
    const token = extractConnectorAuthToken(currentUrl, context);
    if (!context || !token || capturedConnectorAuthUrls.has(currentUrl)) {
      return false;
    }
    capturedConnectorAuthUrls.add(currentUrl);
    void window.agentDesktop.saveConnectorMcpToken({
      connectorId: context.connectorId,
      serverName: context.serverName,
      token,
    });
    updateActiveTab({
      url: DEFAULT_URL,
      title: `${context.displayName || "连接器"}授权已完成`,
      connectorAuth: null,
    });
    setInputUrl("");
    return true;
  }, [activeTab.connectorAuth, updateActiveTab]);

  const submitMcpAuthCallback = React.useCallback((currentUrl: string) => {
    const context = activeTab.mcpAuth;
    if (!context || !isMcpOAuthCallbackUrl(currentUrl)) {
      return false;
    }
    const key = `${context.serverName}:${currentUrl}`;
    if (submittedMcpAuthUrls.has(key)) {
      return true;
    }
    submittedMcpAuthUrls.add(key);
    void window.agentDesktop.submitMcpAuthCallback({
      name: context.serverName,
      callbackUrl: currentUrl,
    }).then(() => {
      updateActiveTab({
        url: DEFAULT_URL,
        title: `${context.displayName || "连接器"}授权回调已提交`,
        mcpAuth: null,
      });
      setInputUrl("");
    }).catch((error: unknown) => {
      submittedMcpAuthUrls.delete(key);
      console.warn("[browser] failed to submit MCP auth callback:", error instanceof Error ? error.message : error);
    });
    return true;
  }, [activeTab.mcpAuth, updateActiveTab]);

  const selectTab = React.useCallback(
    (tabId: string) => {
      const nextState = getBrowserState(sessionKey);
      nextState.activeTabId = tabId;
      emitBrowserChange();
    },
    [sessionKey],
  );

  const addTab = React.useCallback(() => {
    const nextState = getBrowserState(sessionKey);
    const tab = createTab();
    nextState.tabs = [...nextState.tabs, tab];
    nextState.activeTabId = tab.id;
    emitBrowserChange();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [sessionKey]);

  const closeTab = React.useCallback(
    (tabId: string) => {
      const nextState = getBrowserState(sessionKey);
      if (nextState.tabs.length <= 1) {
        nextState.tabs = [{ ...nextState.tabs[0]!, url: DEFAULT_URL, title: "新标签页" }];
        nextState.activeTabId = nextState.tabs[0]!.id;
        emitBrowserChange();
        return;
      }

      const index = nextState.tabs.findIndex((tab) => tab.id === tabId);
      nextState.tabs = nextState.tabs.filter((tab) => tab.id !== tabId);
      if (nextState.activeTabId === tabId) {
        const nextActive = nextState.tabs[Math.max(0, index - 1)] || nextState.tabs[0];
        if (nextActive) nextState.activeTabId = nextActive.id;
      }
      emitBrowserChange();
    },
    [sessionKey],
  );

  React.useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleStartLoading = () => setIsLoading(true);
    const handleStopLoading = () => {
      setIsLoading(false);
      syncNavigation();
    };
    const handleNavigate = () => {
      const currentUrl = webview.getURL?.() || webview.src || activeTab.url;
      if (captureConnectorAuth(currentUrl)) return;
      if (submitMcpAuthCallback(currentUrl)) return;
      updateActiveTab({
        url: currentUrl,
        title: webview.getTitle?.() || currentUrl,
      });
      setInputUrl(displayUrl(currentUrl));
      syncNavigation();
    };
    const handleTitleUpdated = (event: Event) => {
      const title = (event as CustomEvent<{ title?: string }>).detail?.title || webview.getTitle?.();
      if (title) updateActiveTab({ title });
    };

    webview.addEventListener("did-start-loading", handleStartLoading);
    webview.addEventListener("did-stop-loading", handleStopLoading);
    webview.addEventListener("did-navigate", handleNavigate);
    webview.addEventListener("did-navigate-in-page", handleNavigate);
    webview.addEventListener("did-redirect-navigation", handleNavigate);
    webview.addEventListener("page-title-updated", handleTitleUpdated as EventListener);
    webview.addEventListener("did-finish-load", handleNavigate);

    return () => {
      webview.removeEventListener("did-start-loading", handleStartLoading);
      webview.removeEventListener("did-stop-loading", handleStopLoading);
      webview.removeEventListener("did-navigate", handleNavigate);
      webview.removeEventListener("did-navigate-in-page", handleNavigate);
      webview.removeEventListener("did-redirect-navigation", handleNavigate);
      webview.removeEventListener("page-title-updated", handleTitleUpdated as EventListener);
      webview.removeEventListener("did-finish-load", handleNavigate);
    };
  }, [activeTab.id, activeTab.url, captureConnectorAuth, submitMcpAuthCallback, syncNavigation, updateActiveTab]);

  React.useEffect(() => {
    const unsubscribe = window.agentDesktop.browser.onExternalUrl((payload) => {
      if (!payload?.url) return;
      submitMcpAuthCallback(payload.url);
    });
    return unsubscribe;
  }, [submitMcpAuthCallback]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/80 bg-muted/25 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {state.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => selectTab(tab.id)}
              className={cn(
                "group flex h-7 min-w-[104px] max-w-[180px] items-center gap-1.5 rounded-md border px-2 text-left text-xs transition-colors",
                tab.id === activeTab.id
                  ? "border-border bg-background text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
              title={tab.url}
            >
              <Globe2 className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{tab.title || "新标签页"}</span>
              <span
                role="button"
                tabIndex={-1}
                className="rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={addTab}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="新建标签页"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/80 px-2">
        <button
          type="button"
          disabled={!canGoBack}
          onClick={() => webviewRef.current?.goBack?.()}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
          title="后退"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canGoForward}
          onClick={() => webviewRef.current?.goForward?.()}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
          title="前进"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => (isLoading ? webviewRef.current?.stop?.() : webviewRef.current?.reload?.())}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={isLoading ? "停止" : "刷新"}
        >
          {isLoading ? <X className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(inputUrl);
          }}
        >
          <input
            ref={inputRef}
            value={inputUrl}
            onChange={(event) => setInputUrl(event.target.value)}
            placeholder="输入网址或 localhost:3000"
            className="h-7 w-full rounded-md border border-border/70 bg-muted/35 px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/55 focus:bg-background"
          />
        </form>
        <button
          type="button"
          disabled={activeTab.url === DEFAULT_URL}
          onClick={() => void window.agentDesktop.shell.openExternal(activeTab.url)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
          title="外部浏览器打开"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 bg-white">
        {activeTab.url === DEFAULT_URL ? (
          <div className="flex h-full items-center justify-center bg-background px-5 text-center text-xs text-muted-foreground">
            输入网址后在右侧工作区打开页面。
          </div>
        ) : (
          <webview
            key={activeTab.id}
            ref={(node) => {
              node?.setAttribute?.("allowpopups", "true");
              webviewRef.current = node as unknown as WebviewLike | null;
            }}
            src={activeTab.url}
            partition={PARTITION}
            allowpopups={true}
            className="h-full w-full"
          />
        )}
        {isLoading && activeTab.url !== DEFAULT_URL ? (
          <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-border/70 bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              加载中
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
