import { randomUUID } from 'node:crypto';

export const BROWSER_DEFAULT_URL = 'about:blank';
export const BROWSER_FALLBACK_SESSION_ID = '__global__';
export const BROWSER_PARTITION = 'persist:moss-right-browser';

const BROWSER_WEB_PREFERENCES = Object.freeze({
  partition: BROWSER_PARTITION,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
});

function toSessionId(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : BROWSER_FALLBACK_SESSION_ID;
}

function cloneAuthContext(value) {
  return value && typeof value === 'object' ? structuredClone(value) : null;
}

function isBrowserUrl(value) {
  return /^(?:https?|file):/i.test(value) || value === BROWSER_DEFAULT_URL;
}

function getExternalNavigationHref(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return null;
  if (isBrowserUrl(url)) return null;
  if (/^(?:mailto|tel|sms):/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^(?:file|javascript|data|about):/i.test(url)) {
    return url;
  }
  return null;
}

function safeTitleFromUrl(url) {
  if (url === BROWSER_DEFAULT_URL) return '新标签页';
  try {
    const parsed = new URL(url);
    return parsed.hostname || parsed.pathname || url;
  } catch {
    return url;
  }
}

export function normalizeBrowserUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return BROWSER_DEFAULT_URL;
  if (/^(?:https?|file):/i.test(raw) || raw === BROWSER_DEFAULT_URL) return raw;
  if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(raw)) {
    return `http://${raw}`;
  }
  return `https://${raw}`;
}

function clampInteger(value, minimum, maximum) {
  const number = Math.round(Number(value) || 0);
  return Math.min(Math.max(number, minimum), maximum);
}

export function clampBrowserBounds(bounds, contentBounds) {
  const maxWidth = Math.max(0, Math.round(Number(contentBounds?.width) || 0));
  const maxHeight = Math.max(0, Math.round(Number(contentBounds?.height) || 0));
  const x = clampInteger(bounds?.x, 0, maxWidth);
  const y = clampInteger(bounds?.y, 0, maxHeight);
  const width = clampInteger(bounds?.width, 0, Math.max(0, maxWidth - x));
  const height = clampInteger(bounds?.height, 0, Math.max(0, maxHeight - y));
  return { x, y, width, height };
}

function getNavigationState(webContents) {
  const history = webContents?.navigationHistory;
  return {
    canGoBack: Boolean(history?.canGoBack?.()),
    canGoForward: Boolean(history?.canGoForward?.()),
  };
}

function getPopupLoadOptions(details) {
  const options = {};
  if (details?.referrer?.url) options.httpReferrer = details.referrer;
  if (Array.isArray(details?.postBody?.data) && details.postBody.data.length > 0) {
    options.postData = details.postBody.data;
    const contentType = String(details.postBody.contentType || '').trim();
    if (contentType) {
      const boundary = String(details.postBody.boundary || '').trim();
      options.extraHeaders = `Content-Type: ${contentType}${boundary ? `; boundary=${boundary}` : ''}`;
    }
  }
  return options;
}

function getUrlParam(url, paramName) {
  const direct = url.searchParams.get(paramName);
  if (direct) return direct;
  const hash = url.hash.replace(/^#/, '');
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash;
  return new URLSearchParams(hashQuery).get(paramName) || '';
}

function isHostAllowed(hostname, allowedHosts) {
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) return true;
  const normalizedHost = hostname.toLowerCase();
  return allowedHosts.some((host) => {
    const normalized = String(host || '').trim().toLowerCase();
    return Boolean(normalized) && (normalizedHost === normalized || normalizedHost.endsWith(`.${normalized}`));
  });
}

function getAuthNavigationContext(tab, rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const connectorAuth = tab.connectorAuth;
  const connectorToken = connectorAuth && isHostAllowed(url.hostname, connectorAuth.allowedHosts)
    ? getUrlParam(url, connectorAuth.tokenParam || 'access_token')
    : '';
  const mcpAuth = tab.mcpAuth;
  const isMcpCallback = Boolean(
    mcpAuth
    && getUrlParam(url, 'state')
    && (getUrlParam(url, 'code') || getUrlParam(url, 'error')),
  );
  if (!connectorToken && !isMcpCallback) return null;
  return {
    connectorAuth: connectorToken ? cloneAuthContext(connectorAuth) : null,
    mcpAuth: isMcpCallback ? cloneAuthContext(mcpAuth) : null,
  };
}

export function createBrowserViewManager({
  createView,
  getWindow,
  emit,
  openExternal,
  createId = randomUUID,
}) {
  if (typeof createView !== 'function') throw new TypeError('createView is required');
  if (typeof getWindow !== 'function') throw new TypeError('getWindow is required');

  const sessions = new Map();

  function serializeTab(tab) {
    const navigation = getNavigationState(tab.view?.webContents);
    return {
      id: tab.id,
      title: tab.titleOverride || tab.title || safeTitleFromUrl(tab.url),
      url: tab.url || BROWSER_DEFAULT_URL,
      isLoading: Boolean(tab.isLoading),
      canGoBack: navigation.canGoBack,
      canGoForward: navigation.canGoForward,
      devToolsOpen: Boolean(tab.view?.webContents?.isDevToolsOpened?.()),
      isNativeBlank: Boolean(tab.showNativeBlank),
      error: tab.error || null,
      connectorAuth: cloneAuthContext(tab.connectorAuth),
      mcpAuth: cloneAuthContext(tab.mcpAuth),
    };
  }

  function serializeSession(session) {
    return {
      tabs: session.tabs.map(serializeTab),
      activeTabId: session.activeTabId,
    };
  }

  function emitState(session) {
    emit?.('browser:state', {
      sessionId: session.id,
      state: serializeSession(session),
    });
  }

  function openFailedUrlExternally(session, tab, rawUrl) {
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!/^https?:\/\//i.test(url) || tab.externalFallbackUrl === url) return;
    tab.externalFallbackUrl = url;
    emit?.('browser:external-url', { sessionId: session.id, tabId: tab.id, url });
    void openExternal?.(url);
  }

  function emitAuthNavigation(session, tab, rawUrl) {
    const url = typeof rawUrl === 'string' ? rawUrl : '';
    const context = getAuthNavigationContext(tab, url);
    if (!context) return null;
    const existing = session.pendingAuthNavigations.find(
      (entry) => entry.tabId === tab.id && entry.url === url,
    );
    if (existing) return existing;

    const entry = {
      id: createId(),
      sessionId: session.id,
      tabId: tab.id,
      url,
      connectorAuth: context.connectorAuth,
      mcpAuth: context.mcpAuth,
    };
    session.pendingAuthNavigations.push(entry);
    if (session.pendingAuthNavigations.length > 20) session.pendingAuthNavigations.shift();
    emit?.('browser:auth-navigation', structuredClone(entry));
    return entry;
  }

  function detachTab(tab) {
    try {
      tab.view?.setVisible?.(false);
      tab.attachedWindow?.contentView?.removeChildView?.(tab.view);
    } catch {}
    tab.attachedWindow = null;
  }

  function shouldShowTab(session, tab) {
    return Boolean(
      session.visible
      && session.activeTabId === tab.id
      && (tab.url !== BROWSER_DEFAULT_URL || tab.showNativeBlank)
      && !tab.error
      && session.bounds?.width > 0
      && session.bounds?.height > 0,
    );
  }

  function syncViews() {
    const window = getWindow();
    const windowUsable = window && !window.isDestroyed?.() && window.contentView;

    for (const session of sessions.values()) {
      for (const tab of session.tabs) {
        if (!windowUsable || !shouldShowTab(session, tab)) {
          detachTab(tab);
          continue;
        }

        if (tab.attachedWindow !== window) {
          detachTab(tab);
          window.contentView.addChildView(tab.view);
          tab.attachedWindow = window;
        } else {
          // Re-adding an existing child raises it above any stale native view.
          window.contentView.addChildView(tab.view);
        }
        tab.view.setBounds(session.bounds);
        tab.view.setVisible(true);
      }
    }
  }

  function updateTabFromNavigation(session, tab, url) {
    const webContents = tab.view.webContents;
    const nextUrl = typeof url === 'string' && url ? url : webContents.getURL?.();
    if (nextUrl) tab.url = nextUrl;
    if (!tab.titleOverride) {
      tab.title = webContents.getTitle?.() || safeTitleFromUrl(tab.url);
    }
    emitAuthNavigation(session, tab, tab.url);
    syncViews();
    emitState(session);
  }

  function removeTabRecord(session, tab, { replaceLast = true } = {}) {
    const index = session.tabs.indexOf(tab);
    if (index < 0) return;
    detachTab(tab);
    tab.closing = true;
    if (!tab.view.webContents.isDestroyed?.()) {
      tab.view.webContents.closeDevTools?.();
      tab.view.webContents.close?.();
    }
    session.tabs.splice(index, 1);

    if (session.tabs.length === 0 && replaceLast) {
      const replacement = createTabRecord(session, BROWSER_DEFAULT_URL, {});
      session.tabs.push(replacement);
      session.activeTabId = replacement.id;
    } else if (session.activeTabId === tab.id) {
      session.activeTabId = session.tabs[index]?.id || session.tabs[index - 1]?.id || session.tabs[0]?.id || '';
    }
  }

  function configureTabWebContents(session, tab) {
    const webContents = tab.view.webContents;

    webContents.setWindowOpenHandler?.((details) => {
      const popupUrl = String(details?.url || '').trim();
      if (!isBrowserUrl(popupUrl)) {
        emitAuthNavigation(session, tab, popupUrl);
        const externalUrl = getExternalNavigationHref(popupUrl);
        if (externalUrl) {
          emit?.('browser:external-url', { sessionId: session.id, tabId: tab.id, url: externalUrl });
          void openExternal?.(externalUrl);
        }
        return { action: 'deny' };
      }

      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (windowOptions = {}) => {
          const adoptedWebContents = windowOptions.webContents || null;
          const popupTab = createTabRecord(session, popupUrl, {
            connectorAuth: tab.connectorAuth,
            mcpAuth: tab.mcpAuth,
            webContents: adoptedWebContents,
            webPreferences: windowOptions.webPreferences,
            deferLoad: Boolean(adoptedWebContents),
            loadOptions: getPopupLoadOptions(details),
            showNativeBlank: popupUrl === BROWSER_DEFAULT_URL,
          });
          session.tabs.push(popupTab);
          if (details?.disposition !== 'background-tab') {
            session.activeTabId = popupTab.id;
          }
          syncViews();
          emitState(session);
          return popupTab.view.webContents;
        },
      };
    });

    webContents.on?.('will-navigate', (event, url) => {
      if (isBrowserUrl(url)) {
        tab.externalFallbackUrl = null;
        return;
      }
      const externalUrl = getExternalNavigationHref(url);
      if (!externalUrl) return;
      event.preventDefault?.();
      emitAuthNavigation(session, tab, url);
      emit?.('browser:external-url', { sessionId: session.id, tabId: tab.id, url: externalUrl });
      void openExternal?.(externalUrl);
    });
    webContents.on?.('will-attach-webview', (event) => event.preventDefault?.());

    webContents.on?.('did-start-loading', () => {
      tab.isLoading = true;
      tab.error = null;
      tab.externalFallbackUrl = null;
      syncViews();
      emitState(session);
    });
    webContents.on?.('did-stop-loading', () => {
      tab.isLoading = false;
      updateTabFromNavigation(session, tab);
    });
    webContents.on?.('did-navigate', (_event, url) => updateTabFromNavigation(session, tab, url));
    webContents.on?.('did-navigate-in-page', (_event, url) => updateTabFromNavigation(session, tab, url));
    webContents.on?.('did-redirect-navigation', (_event, url) => updateTabFromNavigation(session, tab, url));
    webContents.on?.('page-title-updated', (_event, title) => {
      if (!tab.titleOverride && title) tab.title = title;
      emitState(session);
    });
    webContents.on?.('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      tab.isLoading = false;
      tab.url = validatedUrl || tab.url;
      tab.error = errorDescription || `页面加载失败 (${errorCode})`;
      openFailedUrlExternally(session, tab, tab.url);
      syncViews();
      emitState(session);
    });
    webContents.on?.('render-process-gone', (_event, details) => {
      tab.isLoading = false;
      tab.error = details?.reason ? `页面进程已退出：${details.reason}` : '页面进程已退出';
      syncViews();
      emitState(session);
    });
    webContents.on?.('devtools-opened', () => emitState(session));
    webContents.on?.('devtools-closed', () => emitState(session));
    webContents.on?.('destroyed', () => {
      if (tab.closing) return;
      removeTabRecord(session, tab);
      syncViews();
      emitState(session);
    });
  }

  function createTabRecord(session, rawUrl, options = {}) {
    const url = normalizeBrowserUrl(rawUrl);
    const viewOptions = {
      webPreferences: {
        ...(options.webPreferences || {}),
        ...BROWSER_WEB_PREFERENCES,
      },
    };
    if (options.webContents) viewOptions.webContents = options.webContents;
    const view = createView(viewOptions);
    view.setBackgroundColor?.('#ffffff');
    const tab = {
      id: createId(),
      title: safeTitleFromUrl(url),
      titleOverride: null,
      url,
      isLoading: url !== BROWSER_DEFAULT_URL,
      error: null,
      connectorAuth: cloneAuthContext(options.connectorAuth),
      mcpAuth: cloneAuthContext(options.mcpAuth),
      showNativeBlank: Boolean(options.showNativeBlank),
      view,
      attachedWindow: null,
      closing: false,
      externalFallbackUrl: null,
    };
    configureTabWebContents(session, tab);

    if (!options.deferLoad && url !== BROWSER_DEFAULT_URL) {
      Promise.resolve(view.webContents.loadURL(url, options.loadOptions)).catch((error) => {
        if (tab.closing) return;
        tab.isLoading = false;
        tab.error = error instanceof Error ? error.message : String(error);
        openFailedUrlExternally(session, tab, url);
        syncViews();
        emitState(session);
      });
    }
    return tab;
  }

  function getSession(rawSessionId) {
    const sessionId = toSessionId(rawSessionId);
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        tabs: [],
        activeTabId: '',
        visible: false,
        bounds: null,
        pendingAuthNavigations: [],
      };
      const tab = createTabRecord(session, BROWSER_DEFAULT_URL);
      session.tabs.push(tab);
      session.activeTabId = tab.id;
      sessions.set(sessionId, session);
    }
    return session;
  }

  function getTab(session, rawTabId) {
    const tabId = typeof rawTabId === 'string' && rawTabId ? rawTabId : session.activeTabId;
    const tab = session.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) throw new Error('Browser tab not found.');
    return tab;
  }

  function navigateTab(session, tab, rawUrl) {
    const url = normalizeBrowserUrl(rawUrl);
    tab.url = url;
    tab.title = safeTitleFromUrl(url);
    tab.titleOverride = null;
    tab.error = null;
    tab.isLoading = url !== BROWSER_DEFAULT_URL;
    tab.showNativeBlank = false;
    tab.externalFallbackUrl = null;
    syncViews();
    emitState(session);
    if (url === BROWSER_DEFAULT_URL) {
      void Promise.resolve(tab.view.webContents.loadURL(url)).catch(() => {});
      return;
    }
    Promise.resolve(tab.view.webContents.loadURL(url)).catch((error) => {
      if (tab.closing) return;
      tab.isLoading = false;
      tab.error = error instanceof Error ? error.message : String(error);
      openFailedUrlExternally(session, tab, url);
      syncViews();
      emitState(session);
    });
  }

  return {
    getState(sessionId) {
      return serializeSession(getSession(sessionId));
    },

    openTab({ sessionId, url, connectorAuth, mcpAuth } = {}) {
      const session = getSession(sessionId);
      const tab = createTabRecord(session, url, { connectorAuth, mcpAuth });
      session.tabs.push(tab);
      session.activeTabId = tab.id;
      syncViews();
      emitState(session);
      return serializeSession(session);
    },

    activateTab({ sessionId, tabId } = {}) {
      const session = getSession(sessionId);
      const tab = getTab(session, tabId);
      session.activeTabId = tab.id;
      syncViews();
      emitState(session);
      return serializeSession(session);
    },

    closeTab({ sessionId, tabId } = {}) {
      const session = getSession(sessionId);
      removeTabRecord(session, getTab(session, tabId));
      syncViews();
      emitState(session);
      return serializeSession(session);
    },

    navigate({ sessionId, tabId, url } = {}) {
      const session = getSession(sessionId);
      const externalUrl = getExternalNavigationHref(url);
      if (externalUrl) {
        emit?.('browser:external-url', { sessionId: session.id, tabId, url: externalUrl });
        void openExternal?.(externalUrl);
        return serializeSession(session);
      }
      navigateTab(session, getTab(session, tabId), url);
      return serializeSession(session);
    },

    goBack({ sessionId, tabId } = {}) {
      const session = getSession(sessionId);
      const tab = getTab(session, tabId);
      tab.view.webContents.navigationHistory?.goBack?.();
      return serializeSession(session);
    },

    goForward({ sessionId, tabId } = {}) {
      const session = getSession(sessionId);
      const tab = getTab(session, tabId);
      tab.view.webContents.navigationHistory?.goForward?.();
      return serializeSession(session);
    },

    reload({ sessionId, tabId } = {}) {
      const session = getSession(sessionId);
      const tab = getTab(session, tabId);
      tab.error = null;
      tab.isLoading = tab.url !== BROWSER_DEFAULT_URL;
      syncViews();
      emitState(session);
      tab.view.webContents.reload?.();
      return serializeSession(session);
    },

    stop({ sessionId, tabId } = {}) {
      const session = getSession(sessionId);
      const tab = getTab(session, tabId);
      tab.view.webContents.stop?.();
      tab.isLoading = false;
      emitState(session);
      return serializeSession(session);
    },

    toggleDevTools({ sessionId, tabId } = {}) {
      const session = getSession(sessionId);
      const tab = getTab(session, tabId);
      const webContents = tab.view.webContents;
      if (webContents.isDevToolsOpened?.()) {
        webContents.closeDevTools?.();
      } else {
        webContents.openDevTools?.({ mode: 'detach', activate: true });
      }
      emitState(session);
      return serializeSession(session);
    },

    completeAuth({ sessionId, tabId, title, authKind, serverName, eventId } = {}) {
      const session = getSession(sessionId);
      if (eventId) {
        session.pendingAuthNavigations = session.pendingAuthNavigations.filter((entry) => entry.id !== eventId);
      }
      const tab = session.tabs.find((candidate) => candidate.id === tabId) || null;
      const resolvedKind = authKind || (tab?.connectorAuth ? 'connector' : tab?.mcpAuth ? 'mcp' : '');
      const resolvedServerName = serverName
        || tab?.connectorAuth?.serverName
        || tab?.mcpAuth?.serverName
        || '';
      if (resolvedKind && resolvedServerName) {
        for (const candidate of session.tabs) {
          if (resolvedKind === 'connector' && candidate.connectorAuth?.serverName === resolvedServerName) {
            candidate.connectorAuth = null;
          }
          if (resolvedKind === 'mcp' && candidate.mcpAuth?.serverName === resolvedServerName) {
            candidate.mcpAuth = null;
          }
        }
      }
      if (tab) {
        tab.connectorAuth = null;
        tab.mcpAuth = null;
        tab.titleOverride = typeof title === 'string' && title.trim() ? title.trim() : '授权已完成';
        tab.title = tab.titleOverride;
        tab.url = BROWSER_DEFAULT_URL;
        tab.error = null;
        tab.isLoading = false;
        tab.showNativeBlank = false;
      }
      syncViews();
      emitState(session);
      if (tab && !tab.view.webContents.isDestroyed?.()) {
        void Promise.resolve(tab.view.webContents.loadURL(BROWSER_DEFAULT_URL)).catch(() => {});
      }
      return serializeSession(session);
    },

    getPendingAuthNavigations(sessionId) {
      return structuredClone(getSession(sessionId).pendingAuthNavigations);
    },

    ackAuthNavigation({ sessionId, eventId } = {}) {
      const session = getSession(sessionId);
      session.pendingAuthNavigations = session.pendingAuthNavigations.filter((entry) => entry.id !== eventId);
      return { ok: true };
    },

    setHost({ sessionId, bounds, visible } = {}) {
      const session = getSession(sessionId);
      for (const candidate of sessions.values()) candidate.visible = false;
      session.visible = Boolean(visible);
      const window = getWindow();
      const contentBounds = window?.contentView?.getBounds?.() || window?.getContentBounds?.() || { width: 0, height: 0 };
      session.bounds = clampBrowserBounds(bounds, contentBounds);
      syncViews();
    },

    hide(sessionId) {
      const session = sessions.get(toSessionId(sessionId));
      if (!session) return;
      session.visible = false;
      syncViews();
    },

    disposeSession(sessionId) {
      const id = toSessionId(sessionId);
      const session = sessions.get(id);
      if (!session) return;
      for (const tab of [...session.tabs]) removeTabRecord(session, tab, { replaceLast: false });
      sessions.delete(id);
      syncViews();
    },

    disposeAll() {
      for (const session of [...sessions.values()]) {
        for (const tab of [...session.tabs]) removeTabRecord(session, tab, { replaceLast: false });
      }
      sessions.clear();
    },
  };
}

export function registerBrowserViewIpcHandlers({ ipcMain, manager, getWindow }) {
  const assertTrustedSender = (event) => {
    const window = getWindow();
    if (!window || window.isDestroyed?.() || event.sender !== window.webContents) {
      throw new Error('Browser IPC is only available to the main renderer.');
    }
  };
  const handle = (channel, callback) => {
    ipcMain.handle(channel, (event, payload) => {
      assertTrustedSender(event);
      return callback(payload);
    });
  };

  handle('browser:get-state', (payload) => manager.getState(payload?.sessionId));
  handle('browser:open-tab', (payload) => manager.openTab(payload));
  handle('browser:activate-tab', (payload) => manager.activateTab(payload));
  handle('browser:close-tab', (payload) => manager.closeTab(payload));
  handle('browser:navigate', (payload) => manager.navigate(payload));
  handle('browser:go-back', (payload) => manager.goBack(payload));
  handle('browser:go-forward', (payload) => manager.goForward(payload));
  handle('browser:reload', (payload) => manager.reload(payload));
  handle('browser:stop', (payload) => manager.stop(payload));
  handle('browser:toggle-devtools', (payload) => manager.toggleDevTools(payload));
  handle('browser:complete-auth', (payload) => manager.completeAuth(payload));
  handle('browser:get-pending-auth-navigations', (payload) => manager.getPendingAuthNavigations(payload?.sessionId));
  handle('browser:ack-auth-navigation', (payload) => manager.ackAuthNavigation(payload));

  ipcMain.on('browser:set-host', (event, payload) => {
    try {
      assertTrustedSender(event);
      manager.setHost(payload);
    } catch {}
  });
}
