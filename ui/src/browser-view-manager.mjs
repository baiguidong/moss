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

const BROWSER_AGENT_MAX_ELEMENTS = 120;
const BROWSER_AGENT_MAX_TEXT_CHARS = 16_000;
const BROWSER_AGENT_MAX_CONSOLE_MESSAGES = 100;
const BROWSER_AGENT_MAX_SCREENSHOT_BYTES = Math.floor(5 * 1024 * 1024 * 3 / 4);
const BROWSER_AGENT_MAX_FULL_PAGE_EDGE = 16_384;
const BROWSER_AGENT_MAX_FULL_PAGE_PIXELS = 32_000_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function truncateBrowserAgentText(value, maximum) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maximum ? `${text.slice(0, maximum)}...` : text;
}

function getBrowserOriginKey(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (url.protocol === 'file:') {
      url.search = '';
      url.hash = '';
      return url.href;
    }
    return url.origin === 'null' ? `${url.protocol}//` : url.origin;
  } catch {
    return String(rawUrl || '').trim();
  }
}

function collectBrowserAgentPage(maxElements, maxTextChars) {
  const body = document.body;
  const viewportWidth = Math.max(0, window.innerWidth || document.documentElement?.clientWidth || 0);
  const viewportHeight = Math.max(0, window.innerHeight || document.documentElement?.clientHeight || 0);
  const selector = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[contenteditable]:not([contenteditable="false"])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const elements = [];
  const seen = new Set();
  const elementPath = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 16) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index})`);
      current = current.parentElement;
    }
    return parts.join('>');
  };

  for (const element of document.querySelectorAll(selector)) {
    if (elements.length >= maxElements || seen.has(element)) break;
    seen.add(element);
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    if (
      rect.width < 1
      || rect.height < 1
      || rect.bottom <= 0
      || rect.right <= 0
      || rect.top >= viewportHeight
      || rect.left >= viewportWidth
      || style.display === 'none'
      || style.visibility === 'hidden'
      || style.pointerEvents === 'none'
      || Number(style.opacity || 1) === 0
    ) continue;

    const tag = element.tagName.toLowerCase();
    const type = String(element.getAttribute('type') || '').toLowerCase();
    const value = type === 'password' ? '' : String(element.value || '').trim();
    const label = element.labels?.[0]?.innerText || '';
    const editableInputTypes = new Set(['', 'text', 'email', 'search', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'time', 'week']);
    const editable = !element.disabled
      && !element.readOnly
      && (
        tag === 'textarea'
        || (tag === 'input' && editableInputTypes.has(type))
        || element.isContentEditable === true
      );
    const name = element.getAttribute('aria-label')
      || element.getAttribute('alt')
      || element.getAttribute('title')
      || label
      || element.innerText
      || element.getAttribute('name')
      || element.getAttribute('placeholder')
      || value
      || '';
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(viewportWidth, rect.right);
    const bottom = Math.min(viewportHeight, rect.bottom);
    elements.push({
      tag,
      role: element.getAttribute('role') || '',
      type,
      name: String(name).replace(/\s+/g, ' ').trim().slice(0, 240),
      editable,
      disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
      checked: typeof element.checked === 'boolean' ? element.checked : undefined,
      _path: elementPath(element),
      rect: {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(Math.max(0, right - left)),
        height: Math.round(Math.max(0, bottom - top)),
      },
    });
  }

  return {
    url: location.href,
    title: document.title || '',
    viewport: {
      width: viewportWidth,
      height: viewportHeight,
      scrollX: Math.round(window.scrollX || 0),
      scrollY: Math.round(window.scrollY || 0),
      documentWidth: Math.max(document.documentElement?.scrollWidth || 0, body?.scrollWidth || 0),
      documentHeight: Math.max(document.documentElement?.scrollHeight || 0, body?.scrollHeight || 0),
    },
    text: String(body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, maxTextChars),
    elements,
  };
}

function inspectBrowserAgentPoint(x, y) {
  const selector = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[contenteditable]:not([contenteditable="false"])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const hit = document.elementFromPoint(x, y);
  const element = hit?.closest?.(selector) || null;
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const viewportWidth = Math.max(0, window.innerWidth || document.documentElement?.clientWidth || 0);
  const viewportHeight = Math.max(0, window.innerHeight || document.documentElement?.clientHeight || 0);
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewportWidth, rect.right);
  const bottom = Math.min(viewportHeight, rect.bottom);
  const tag = element.tagName.toLowerCase();
  const type = String(element.getAttribute('type') || '').toLowerCase();
  const value = type === 'password' ? '' : String(element.value || '').trim();
  const label = element.labels?.[0]?.innerText || '';
  const editableInputTypes = new Set(['', 'text', 'email', 'search', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'time', 'week']);
  const editable = !element.disabled
    && !element.readOnly
    && (
      tag === 'textarea'
      || (tag === 'input' && editableInputTypes.has(type))
      || element.isContentEditable === true
    );
  const name = element.getAttribute('aria-label')
    || element.getAttribute('alt')
    || element.getAttribute('title')
    || label
    || element.innerText
    || element.getAttribute('name')
    || element.getAttribute('placeholder')
    || value
    || '';
  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 16) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index})`);
    current = current.parentElement;
  }
  return {
    tag,
    role: element.getAttribute('role') || '',
    type,
    name: String(name).replace(/\s+/g, ' ').trim().slice(0, 240),
    editable,
    disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
    _path: parts.join('>'),
    rect: {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(Math.max(0, right - left)),
      height: Math.round(Math.max(0, bottom - top)),
    },
  };
}

function readBrowserAgentWaitState(expectedText, expectedUrl) {
  const url = location.href;
  const text = String(document.body?.innerText || '');
  return {
    url,
    title: document.title || '',
    textMatched: !expectedText || text.includes(expectedText),
    urlMatched: !expectedUrl || url.includes(expectedUrl),
  };
}

function toSessionId(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : BROWSER_FALLBACK_SESSION_ID;
}

function cloneAuthContext(value) {
  return value && typeof value === 'object' ? structuredClone(value) : null;
}

function isBrowserUrl(value) {
  return /^(?:https?|file|moss-remote-workspace):/i.test(value) || value === BROWSER_DEFAULT_URL;
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
  if (/^(?:https?|file|moss-remote-workspace):/i.test(raw) || raw === BROWSER_DEFAULT_URL) return raw;
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

  function invalidateAutomationSnapshot(tab, { clearConsole = false } = {}) {
    tab.navigationGeneration += 1;
    tab.automationSnapshot = null;
    if (clearConsole) tab.consoleMessages = [];
  }

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
        const authNavigation = emitAuthNavigation(session, tab, popupUrl);
        if (authNavigation) return { action: 'deny' };
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
      const authNavigation = emitAuthNavigation(session, tab, url);
      if (authNavigation) return;
      emit?.('browser:external-url', { sessionId: session.id, tabId: tab.id, url: externalUrl });
      void openExternal?.(externalUrl);
    });
    webContents.on?.('will-attach-webview', (event) => event.preventDefault?.());

    webContents.on?.('did-start-loading', () => {
      invalidateAutomationSnapshot(tab, { clearConsole: true });
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
    webContents.on?.('did-navigate', (_event, url) => {
      invalidateAutomationSnapshot(tab, { clearConsole: true });
      updateTabFromNavigation(session, tab, url);
    });
    webContents.on?.('did-navigate-in-page', (_event, url) => {
      invalidateAutomationSnapshot(tab, { clearConsole: true });
      updateTabFromNavigation(session, tab, url);
    });
    webContents.on?.('did-redirect-navigation', (_event, url) => {
      invalidateAutomationSnapshot(tab, { clearConsole: true });
      updateTabFromNavigation(session, tab, url);
    });
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
      invalidateAutomationSnapshot(tab, { clearConsole: true });
      tab.isLoading = false;
      tab.error = details?.reason ? `页面进程已退出：${details.reason}` : '页面进程已退出';
      syncViews();
      emitState(session);
    });
    webContents.on?.('devtools-opened', () => emitState(session));
    webContents.on?.('devtools-closed', () => emitState(session));
    webContents.on?.('console-message', (_event, details = {}) => {
      const entry = {
        level: String(details.level || 'info'),
        message: truncateBrowserAgentText(details.message, 1_000),
        line: Number(details.lineNumber || 0),
        source: truncateBrowserAgentText(details.sourceId, 300),
        timestamp: Date.now(),
      };
      if (!entry.message) return;
      tab.consoleMessages.push(entry);
      if (tab.consoleMessages.length > BROWSER_AGENT_MAX_CONSOLE_MESSAGES) {
        tab.consoleMessages.splice(0, tab.consoleMessages.length - BROWSER_AGENT_MAX_CONSOLE_MESSAGES);
      }
    });
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
      navigationGeneration: 0,
      automationSnapshot: null,
      consoleMessages: [],
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
    invalidateAutomationSnapshot(tab, { clearConsole: true });
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

  function getAutomationTarget({ sessionId, tabId } = {}) {
    const session = getSession(sessionId);
    const tab = getTab(session, tabId);
    const webContents = tab.view?.webContents;
    if (!webContents || webContents.isDestroyed?.()) {
      throw new Error('Browser tab is no longer available.');
    }
    if (tab.error) throw new Error(`Browser page is unavailable: ${tab.error}`);
    if (tab.connectorAuth || tab.mcpAuth) {
      throw new Error('Authorization pages cannot be controlled by browser automation. Complete authorization manually.');
    }
    return { session, tab, webContents };
  }

  function getAutomationPageInfo(tab) {
    const liveUrl = tab.view?.webContents?.getURL?.();
    return {
      tabId: tab.id,
      url: liveUrl || tab.url || BROWSER_DEFAULT_URL,
      title: tab.titleOverride || tab.title || safeTitleFromUrl(tab.url),
      isLoading: Boolean(tab.isLoading),
    };
  }

  async function captureDebuggerScreenshot(webContents, { fullPage }) {
    const browserDebugger = webContents.debugger;
    if (!browserDebugger?.sendCommand) {
      throw new Error('Browser screenshot is unavailable because the page has no capture surface.');
    }
    let attachedHere = false;
    try {
      if (!browserDebugger.isAttached?.()) {
        browserDebugger.attach('1.3');
        attachedHere = true;
      }
      await browserDebugger.sendCommand('Page.enable');
      const metrics = await browserDebugger.sendCommand('Page.getLayoutMetrics');
      const size = fullPage
        ? (metrics?.cssContentSize || metrics?.contentSize)
        : (metrics?.cssVisualViewport || metrics?.visualViewport || metrics?.cssLayoutViewport || metrics?.layoutViewport);
      const width = Math.ceil(Number(size?.clientWidth || size?.width || 0));
      const height = Math.ceil(Number(size?.clientHeight || size?.height || 0));
      if (
        width < 1
        || height < 1
        || (fullPage && (
          width > BROWSER_AGENT_MAX_FULL_PAGE_EDGE
          || height > BROWSER_AGENT_MAX_FULL_PAGE_EDGE
          || width * height > BROWSER_AGENT_MAX_FULL_PAGE_PIXELS
        ))
      ) {
        throw new Error(`${fullPage ? 'Full-page' : 'Viewport'} screenshot exceeds the safety limit (${width}x${height}).`);
      }
      const options = {
        format: 'jpeg',
        quality: 82,
        fromSurface: true,
        captureBeyondViewport: fullPage,
        ...(fullPage ? { clip: { x: 0, y: 0, width, height, scale: 1 } } : {}),
      };
      const screenshot = await browserDebugger.sendCommand('Page.captureScreenshot', options);
      const byteLength = Buffer.byteLength(String(screenshot?.data || ''), 'base64');
      if (!screenshot?.data || byteLength > BROWSER_AGENT_MAX_SCREENSHOT_BYTES) {
        throw new Error(`${fullPage ? 'Full-page' : 'Viewport'} screenshot is too large.`);
      }
      return {
        imageBase64: screenshot.data,
        imageMediaType: 'image/jpeg',
        imageWidth: width,
        imageHeight: height,
        fullPage,
      };
    } finally {
      if (attachedHere) {
        try { browserDebugger.detach(); } catch {}
      }
    }
  }

  async function captureViewportScreenshot(webContents) {
    try {
      const image = await webContents.capturePage();
      const size = image.getSize?.() || {};
      let mediaType = 'image/png';
      let buffer = image.toPNG();
      if (buffer.length === 0) throw new Error('Browser capture returned an empty image.');
      if (buffer.length > BROWSER_AGENT_MAX_SCREENSHOT_BYTES && typeof image.toJPEG === 'function') {
        mediaType = 'image/jpeg';
        buffer = image.toJPEG(78);
      }
      if (buffer.length > BROWSER_AGENT_MAX_SCREENSHOT_BYTES) {
        throw new Error('Browser screenshot is too large. Resize the browser panel or capture the viewport instead.');
      }
      return {
        imageBase64: buffer.toString('base64'),
        imageMediaType: mediaType,
        imageWidth: Number(size.width) || null,
        imageHeight: Number(size.height) || null,
        fullPage: false,
      };
    } catch {
      return captureDebuggerScreenshot(webContents, { fullPage: false });
    }
  }

  async function captureFullPageScreenshot(webContents) {
    return captureDebuggerScreenshot(webContents, { fullPage: true });
  }

  function resolveAutomationElement(tab, snapshotId, ref) {
    const snapshot = tab.automationSnapshot;
    if (!snapshot || snapshot.id !== snapshotId) {
      throw new Error(`Browser snapshot is missing or stale (expected ${snapshot?.id || 'none'}, received ${String(snapshotId || 'none')}). Take a new browser_snapshot first.`);
    }
    if (snapshot.navigationGeneration !== tab.navigationGeneration) {
      tab.automationSnapshot = null;
      throw new Error('The page changed after the snapshot. Take a new browser_snapshot first.');
    }
    const element = snapshot.elements.get(String(ref || ''));
    if (!element) throw new Error(`Element reference not found: ${String(ref || '')}`);
    if (element.disabled) throw new Error(`Element ${ref} is disabled.`);
    return element;
  }

  async function verifyAutomationElement(webContents, element) {
    const x = Math.round(element.rect.x + element.rect.width / 2);
    const y = Math.round(element.rect.y + element.rect.height / 2);
    const actual = await webContents.executeJavaScript(
      `(${inspectBrowserAgentPoint.toString()})(${x}, ${y})`,
      true,
    );
    const geometryMatches = actual?.rect
      && Math.abs(Number(actual.rect.x) - element.rect.x) <= 2
      && Math.abs(Number(actual.rect.y) - element.rect.y) <= 2
      && Math.abs(Number(actual.rect.width) - element.rect.width) <= 2
      && Math.abs(Number(actual.rect.height) - element.rect.height) <= 2;
    if (
      !actual
      || actual._path !== element._path
      || actual.tag !== element.tag
      || actual.role !== element.role
      || actual.type !== element.type
      || actual.name !== element.name
      || actual.editable !== element.editable
      || !geometryMatches
    ) {
      throw new Error('The referenced element moved or changed after the snapshot. Take a new browser_snapshot first.');
    }
    if (actual.disabled) throw new Error('The referenced element is now disabled.');
    return element;
  }

  function sendElementClick(webContents, element, clickCount = 1) {
    const x = Math.round(element.rect.x + element.rect.width / 2);
    const y = Math.round(element.rect.y + element.rect.height / 2);
    webContents.sendInputEvent({ type: 'mouseMove', x, y });
    for (let currentClick = 1; currentClick <= clickCount; currentClick += 1) {
      webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: currentClick });
      webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: currentClick });
    }
    return { x, y };
  }

  return {
    getAgentPageInfo({ sessionId, tabId } = {}) {
      const { tab } = getAutomationTarget({ sessionId, tabId });
      return getAutomationPageInfo(tab);
    },

    async agentSnapshot({ sessionId, tabId, fullPage = false } = {}) {
      const { tab, webContents } = getAutomationTarget({ sessionId, tabId });
      const originAtStart = getBrowserOriginKey(webContents.getURL?.() || tab.url);
      const page = await webContents.executeJavaScript(
        `(${collectBrowserAgentPage.toString()})(${BROWSER_AGENT_MAX_ELEMENTS}, ${BROWSER_AGENT_MAX_TEXT_CHARS})`,
        true,
      );
      if (getBrowserOriginKey(page?.url) !== originAtStart) {
        throw new Error('The browser navigated to a different site during the snapshot. Permission is required for the new site.');
      }
      const snapshotId = createId();
      const elements = new Map();
      const serializedElements = (Array.isArray(page?.elements) ? page.elements : [])
        .slice(0, BROWSER_AGENT_MAX_ELEMENTS)
        .map((element, index) => {
          const ref = `e${index + 1}`;
          const serialized = {
            ref,
            tag: truncateBrowserAgentText(element?.tag, 32),
            role: truncateBrowserAgentText(element?.role, 64),
            type: truncateBrowserAgentText(element?.type, 64),
            name: truncateBrowserAgentText(element?.name, 240),
            editable: Boolean(element?.editable),
            disabled: Boolean(element?.disabled),
            ...(typeof element?.checked === 'boolean' ? { checked: element.checked } : {}),
            rect: {
              x: Math.max(0, Math.round(Number(element?.rect?.x) || 0)),
              y: Math.max(0, Math.round(Number(element?.rect?.y) || 0)),
              width: Math.max(0, Math.round(Number(element?.rect?.width) || 0)),
              height: Math.max(0, Math.round(Number(element?.rect?.height) || 0)),
            },
          };
          elements.set(ref, {
            ...serialized,
            _path: truncateBrowserAgentText(element?._path, 2_000),
          });
          return serialized;
        });
      tab.automationSnapshot = {
        id: snapshotId,
        navigationGeneration: tab.navigationGeneration,
        elements,
      };
      let screenshot;
      try {
        screenshot = fullPage
          ? await captureFullPageScreenshot(webContents)
          : await captureViewportScreenshot(webContents);
      } catch (error) {
        tab.automationSnapshot = null;
        throw error;
      }
      if (getBrowserOriginKey(webContents.getURL?.() || tab.url) !== originAtStart) {
        tab.automationSnapshot = null;
        throw new Error('The browser navigated to a different site during the snapshot. Permission is required for the new site.');
      }
      return {
        ...getAutomationPageInfo(tab),
        snapshotId,
        viewport: page?.viewport || null,
        text: truncateBrowserAgentText(page?.text, BROWSER_AGENT_MAX_TEXT_CHARS),
        elements: serializedElements,
        consoleMessages: tab.consoleMessages.slice(-20),
        ...screenshot,
      };
    },

    async agentClick({ sessionId, tabId, snapshotId, ref, clickCount = 1 } = {}) {
      const { tab, webContents } = getAutomationTarget({ sessionId, tabId });
      const element = resolveAutomationElement(tab, snapshotId, ref);
      await verifyAutomationElement(webContents, element);
      const point = sendElementClick(webContents, element, clickCount === 2 ? 2 : 1);
      await delay(80);
      return { ...getAutomationPageInfo(tab), ref, point };
    },

    async agentType({ sessionId, tabId, snapshotId, ref, text, clear = true, submit = false } = {}) {
      const { tab, webContents } = getAutomationTarget({ sessionId, tabId });
      const element = resolveAutomationElement(tab, snapshotId, ref);
      if (element.type === 'password') {
        throw new Error('Browser automation cannot type into password fields. Enter the password manually.');
      }
      if (!element.editable) {
        throw new Error(`Element ${ref} is not an editable text field.`);
      }
      await verifyAutomationElement(webContents, element);
      const point = sendElementClick(webContents, element, 1);
      await delay(30);
      if (clear) {
        const modifiers = process.platform === 'darwin' ? ['meta'] : ['control'];
        webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers });
        webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers });
      }
      await Promise.resolve(webContents.insertText(String(text ?? '')));
      if (submit) {
        webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      }
      await delay(80);
      return {
        ...getAutomationPageInfo(tab),
        ref,
        point,
        charactersEntered: String(text ?? '').length,
        submitted: Boolean(submit),
      };
    },

    async agentPress({ sessionId, tabId, key } = {}) {
      const { tab, webContents } = getAutomationTarget({ sessionId, tabId });
      const keyCodes = {
        Enter: 'Enter',
        Tab: 'Tab',
        Escape: 'Escape',
        ArrowUp: 'Up',
        ArrowDown: 'Down',
        ArrowLeft: 'Left',
        ArrowRight: 'Right',
        Backspace: 'Backspace',
        Delete: 'Delete',
        Space: 'Space',
      };
      const keyCode = keyCodes[key];
      if (!keyCode) throw new Error(`Unsupported browser key: ${String(key || '')}`);
      webContents.sendInputEvent({ type: 'keyDown', keyCode });
      webContents.sendInputEvent({ type: 'keyUp', keyCode });
      await delay(60);
      return { ...getAutomationPageInfo(tab), key };
    },

    async agentScroll({ sessionId, tabId, deltaX = 0, deltaY = 600 } = {}) {
      const { tab, webContents } = getAutomationTarget({ sessionId, tabId });
      const x = clampInteger(deltaX, -4_000, 4_000);
      const y = clampInteger(deltaY, -4_000, 4_000);
      const position = await webContents.executeJavaScript(
        `(() => { window.scrollBy(${x}, ${y}); return { scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) }; })()`,
        true,
      );
      tab.automationSnapshot = null;
      await delay(80);
      return { ...getAutomationPageInfo(tab), position };
    },

    async agentWait({ sessionId, tabId, text, urlContains, timeoutMs = 3_000 } = {}) {
      const { tab, webContents } = getAutomationTarget({ sessionId, tabId });
      const originAtStart = getBrowserOriginKey(webContents.getURL?.() || tab.url);
      const expectedText = truncateBrowserAgentText(text, 1_000);
      const expectedUrl = truncateBrowserAgentText(urlContains, 2_000);
      const timeout = clampInteger(timeoutMs, 100, 15_000);
      if (!expectedText && !expectedUrl) {
        await delay(timeout);
        if (getBrowserOriginKey(webContents.getURL?.() || tab.url) !== originAtStart) {
          throw new Error('The browser navigated to a different site while waiting. Permission is required for the new site.');
        }
        return { ...getAutomationPageInfo(tab), matched: true };
      }
      const deadline = Date.now() + timeout;
      let state = null;
      do {
        state = await webContents.executeJavaScript(
          `(${readBrowserAgentWaitState.toString()})(${JSON.stringify(expectedText)}, ${JSON.stringify(expectedUrl)})`,
          true,
        );
        if (getBrowserOriginKey(state?.url) !== originAtStart) {
          throw new Error('The browser navigated to a different site while waiting. Permission is required for the new site.');
        }
        if (state?.textMatched && state?.urlMatched) {
          return { ...getAutomationPageInfo(tab), matched: true, state };
        }
        await delay(Math.min(150, Math.max(0, deadline - Date.now())));
      } while (Date.now() < deadline);
      return { ...getAutomationPageInfo(tab), matched: false, state };
    },

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

    async openTabAndWait({ sessionId, url, connectorAuth, mcpAuth } = {}) {
      const session = getSession(sessionId);
      const normalizedUrl = normalizeBrowserUrl(url);
      const tab = createTabRecord(session, normalizedUrl, {
        connectorAuth,
        mcpAuth,
        deferLoad: true,
      });
      session.tabs.push(tab);
      session.activeTabId = tab.id;
      syncViews();
      emitState(session);

      if (normalizedUrl !== BROWSER_DEFAULT_URL) {
        try {
          await tab.view.webContents.loadURL(normalizedUrl);
          if (!tab.closing) {
            tab.isLoading = false;
            updateTabFromNavigation(session, tab);
          }
        } catch (error) {
          if (!tab.closing) {
            tab.isLoading = false;
            tab.error = error instanceof Error ? error.message : String(error);
            openFailedUrlExternally(session, tab, normalizedUrl);
            syncViews();
            emitState(session);
          }
          throw error;
        }
      }

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
