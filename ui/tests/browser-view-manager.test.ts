import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'bun:test';
import {
  BROWSER_DEFAULT_URL,
  BROWSER_PARTITION,
  clampBrowserBounds,
  createBrowserViewManager,
  normalizeBrowserUrl,
} from '../src/browser-view-manager.mjs';

class FakeWebContents extends EventEmitter {
  url = BROWSER_DEFAULT_URL;
  title = '';
  loads: string[] = [];
  loadOptions: Array<Record<string, unknown> | undefined> = [];
  closed = false;
  stopped = false;
  reloaded = false;
  devToolsOpen = false;
  windowOpenHandler: ((details: Record<string, unknown>) => Record<string, unknown>) | null = null;
  history = {
    back: false,
    forward: false,
    wentBack: false,
    wentForward: false,
  };
  navigationHistory = {
    canGoBack: () => this.history.back,
    canGoForward: () => this.history.forward,
    goBack: () => { this.history.wentBack = true; },
    goForward: () => { this.history.wentForward = true; },
  };

  loadURL(url: string, options?: Record<string, unknown>) {
    this.url = url;
    this.loads.push(url);
    this.loadOptions.push(options);
    return Promise.resolve();
  }

  getURL() { return this.url; }
  getTitle() { return this.title; }
  setWindowOpenHandler(handler: (details: Record<string, unknown>) => Record<string, unknown>) {
    this.windowOpenHandler = handler;
  }
  isDestroyed() { return this.closed; }
  close() { this.closed = true; this.emit('destroyed'); }
  destroyFromPage() { this.closed = true; this.emit('destroyed'); }
  stop() { this.stopped = true; }
  reload() { this.reloaded = true; }
  isDevToolsOpened() { return this.devToolsOpen; }
  openDevTools() { this.devToolsOpen = true; this.emit('devtools-opened'); }
  closeDevTools() { this.devToolsOpen = false; this.emit('devtools-closed'); }
}

class FakeView {
  webContents: FakeWebContents;
  visible = false;
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  background = '';

  constructor(webContents?: FakeWebContents) {
    this.webContents = webContents || new FakeWebContents();
  }

  setVisible(visible: boolean) { this.visible = visible; }
  setBounds(bounds: typeof this.bounds) { this.bounds = { ...bounds }; }
  setBackgroundColor(color: string) { this.background = color; }
}

function createHarness() {
  const views: Array<{ view: FakeView; options: Record<string, any> }> = [];
  const events: Array<{ channel: string; payload: any }> = [];
  const externalUrls: string[] = [];
  const children: FakeView[] = [];
  const contentView = {
    children,
    getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    addChildView: (view: FakeView) => {
      const index = children.indexOf(view);
      if (index >= 0) children.splice(index, 1);
      children.push(view);
    },
    removeChildView: (view: FakeView) => {
      const index = children.indexOf(view);
      if (index >= 0) children.splice(index, 1);
    },
  };
  const window = { contentView, isDestroyed: () => false };
  let nextId = 0;
  const manager = createBrowserViewManager({
    createView: (options: Record<string, any>) => {
      const view = new FakeView(options.webContents);
      views.push({ view, options });
      return view;
    },
    createId: () => `tab-${++nextId}`,
    getWindow: () => window,
    emit: (channel: string, payload: any) => events.push({ channel, payload }),
    openExternal: (url: string) => { externalUrls.push(url); },
  });
  return { manager, views, events, externalUrls, children };
}

describe('browser URL and bounds normalization', () => {
  it('normalizes local development URLs and clamps renderer-provided bounds', () => {
    expect(normalizeBrowserUrl('localhost:5173')).toBe('http://localhost:5173');
    expect(normalizeBrowserUrl('example.com/path')).toBe('https://example.com/path');
    expect(normalizeBrowserUrl('')).toBe(BROWSER_DEFAULT_URL);
    expect(clampBrowserBounds(
      { x: 1100, y: -20, width: 400, height: 900 },
      { width: 1200, height: 800 },
    )).toEqual({ x: 1100, y: 0, width: 100, height: 800 });
  });
});

describe('BrowserViewManager', () => {
  it('owns tab navigation and attaches only the active WebContentsView', async () => {
    const { manager, views, children } = createHarness();
    const initial = manager.getState('session-1');
    expect(initial.tabs).toHaveLength(1);

    const opened = manager.openTab({ sessionId: 'session-1', url: 'example.com' });
    const activeTab = opened.tabs.find((tab: any) => tab.id === opened.activeTabId)!;
    const activeView = views[1]!.view;
    expect(activeTab.url).toBe('https://example.com');
    expect(views[1]!.options.webPreferences.partition).toBe(BROWSER_PARTITION);
    expect(views[1]!.options.webPreferences.sandbox).toBe(true);

    manager.setHost({
      sessionId: 'session-1',
      visible: true,
      bounds: { x: 700, y: 120, width: 500, height: 680 },
    });
    expect(children).toEqual([activeView]);
    expect(activeView.visible).toBe(true);
    expect(activeView.bounds).toEqual({ x: 700, y: 120, width: 500, height: 680 });

    activeView.webContents.history.back = true;
    activeView.webContents.title = 'Example';
    activeView.webContents.emit('did-navigate', {}, 'https://example.com/docs');
    const navigated = manager.getState('session-1');
    expect(navigated.tabs.find((tab: any) => tab.id === activeTab.id)).toMatchObject({
      url: 'https://example.com/docs',
      title: 'Example',
      canGoBack: true,
    });

    manager.goBack({ sessionId: 'session-1', tabId: activeTab.id });
    expect(activeView.webContents.history.wentBack).toBe(true);
    await Promise.resolve();
  });

  it('adopts popup web contents into a managed tab and routes custom protocols externally', () => {
    const { manager, views, externalUrls } = createHarness();
    const opened = manager.openTab({
      sessionId: 'session-2',
      url: 'https://auth.example.test',
      mcpAuth: { serverName: 'demo' },
    });
    const opener = views[1]!.view.webContents;
    const popupResponse = opener.windowOpenHandler!({
      url: 'https://login.example.test/callback',
      disposition: 'foreground-tab',
      referrer: { url: 'https://auth.example.test', policy: 'strict-origin' },
      postBody: {
        contentType: 'application/x-www-form-urlencoded',
        data: [{ type: 'rawData', bytes: Buffer.from('code=demo') }],
      },
    });

    expect(popupResponse.action).toBe('allow');
    const adoptedWebContents = new FakeWebContents();
    expect((popupResponse.createWindow as (options: Record<string, unknown>) => FakeWebContents)({
      webContents: adoptedWebContents,
      webPreferences: { openerId: 42, nodeIntegration: true },
    })).toBe(adoptedWebContents);
    expect(views[2]!.options.webPreferences).toMatchObject({ nodeIntegration: false, sandbox: true });
    expect(views[2]!.options.webContents).toBe(adoptedWebContents);
    expect(adoptedWebContents.loads).toEqual([]);
    const popupState = manager.getState('session-2');
    expect(popupState.tabs).toHaveLength(3);
    expect(popupState.tabs.find((tab: any) => tab.id === popupState.activeTabId)).toMatchObject({
      url: 'https://login.example.test/callback',
      mcpAuth: { serverName: 'demo' },
    });

    const externalResponse = opener.windowOpenHandler!({
      url: 'moss-auth://callback?code=abc',
      disposition: 'foreground-tab',
    });
    expect(externalResponse.action).toBe('deny');
    expect(externalUrls).toEqual(['moss-auth://callback?code=abc']);
    expect(opened.tabs).toHaveLength(2);
  });

  it('loads deferred background popups with their referrer and POST body', () => {
    const { manager, views } = createHarness();
    manager.openTab({ sessionId: 'session-popup', url: 'https://auth.example.test' });
    const opener = views[1]!.view.webContents;
    const response = opener.windowOpenHandler!({
      url: 'https://login.example.test/callback',
      disposition: 'background-tab',
      referrer: { url: 'https://auth.example.test', policy: 'strict-origin' },
      postBody: {
        contentType: 'application/x-www-form-urlencoded',
        data: [{ type: 'rawData', bytes: Buffer.from('code=demo') }],
      },
    });

    expect(response.action).toBe('allow');
    const popupWebContents = (response.createWindow as (options: Record<string, unknown>) => FakeWebContents)({
      webPreferences: { nodeIntegration: true },
    });
    expect(popupWebContents.loads).toEqual(['https://login.example.test/callback']);
    expect(popupWebContents.loadOptions[0]).toMatchObject({
      httpReferrer: { url: 'https://auth.example.test', policy: 'strict-origin' },
      extraHeaders: 'Content-Type: application/x-www-form-urlencoded',
    });
    expect(manager.getState('session-popup').activeTabId).not.toBe(
      manager.getState('session-popup').tabs.at(-1)?.id,
    );
  });

  it('keeps adopted about:blank popups visible as native tabs', () => {
    const { manager, views, children } = createHarness();
    manager.openTab({ sessionId: 'session-blank-popup', url: 'https://opener.test' });
    const opener = views[1]!.view.webContents;
    const response = opener.windowOpenHandler!({
      url: BROWSER_DEFAULT_URL,
      disposition: 'foreground-tab',
    });
    const adoptedWebContents = new FakeWebContents();
    (response.createWindow as (options: Record<string, unknown>) => FakeWebContents)({
      webContents: adoptedWebContents,
    });

    manager.setHost({
      sessionId: 'session-blank-popup',
      visible: true,
      bounds: { x: 700, y: 120, width: 500, height: 680 },
    });
    const state = manager.getState('session-blank-popup');
    expect(state.tabs.find((tab: any) => tab.id === state.activeTabId)).toMatchObject({
      url: BROWSER_DEFAULT_URL,
      isNativeBlank: true,
    });
    expect(children).toEqual([views[2]!.view]);
  });

  it('persists OAuth callbacks after a popup closes itself', () => {
    const { manager, views, events } = createHarness();
    const opened = manager.openTab({
      sessionId: 'session-oauth-popup',
      url: 'https://auth.example.test',
      mcpAuth: { serverName: 'demo', displayName: 'Demo' },
    });
    const openerId = opened.activeTabId;
    const opener = views[1]!.view.webContents;
    const response = opener.windowOpenHandler!({
      url: 'https://login.example.test',
      disposition: 'foreground-tab',
    });
    const popupWebContents = new FakeWebContents();
    (response.createWindow as (options: Record<string, unknown>) => FakeWebContents)({
      webContents: popupWebContents,
    });
    const popupId = manager.getState('session-oauth-popup').activeTabId;
    const callbackUrl = 'https://callback.example.test/?state=oauth-state&code=oauth-code';

    popupWebContents.emit('did-navigate', {}, callbackUrl);
    const [authNavigation] = manager.getPendingAuthNavigations('session-oauth-popup');
    expect(authNavigation).toMatchObject({
      sessionId: 'session-oauth-popup',
      tabId: popupId,
      url: callbackUrl,
      mcpAuth: { serverName: 'demo' },
    });
    expect(events.some((event) => event.channel === 'browser:auth-navigation')).toBe(true);

    popupWebContents.destroyFromPage();
    expect(manager.getState('session-oauth-popup').tabs.some((tab: any) => tab.id === popupId)).toBe(false);
    expect(manager.getPendingAuthNavigations('session-oauth-popup')).toHaveLength(1);

    manager.completeAuth({
      sessionId: 'session-oauth-popup',
      tabId: popupId,
      authKind: 'mcp',
      serverName: 'demo',
      eventId: authNavigation.id,
    });
    expect(manager.getPendingAuthNavigations('session-oauth-popup')).toHaveLength(0);
    expect(manager.getState('session-oauth-popup').tabs.find((tab: any) => tab.id === openerId)?.mcpAuth).toBeNull();
  });

  it('opens address-bar external protocols without rewriting the active tab URL', () => {
    const { manager, externalUrls } = createHarness();
    const opened = manager.openTab({ sessionId: 'session-external', url: 'https://example.test' });
    const tabId = opened.activeTabId;

    manager.navigate({ sessionId: 'session-external', tabId, url: 'mailto:hello@example.test' });
    expect(externalUrls).toEqual(['mailto:hello@example.test']);
    expect(manager.getState('session-external').tabs.find((tab: any) => tab.id === tabId)?.url).toBe('https://example.test');
  });

  it('keeps address-bar web URLs internal and falls back only after load failure', () => {
    const { manager, views, externalUrls } = createHarness();
    const opened = manager.openTab({ sessionId: 'session-web', url: 'https://start.test' });
    const tabId = opened.activeTabId;
    const view = views[1]!.view;

    let clickPrevented = false;
    view.webContents.emit('will-navigate', {
      preventDefault: () => { clickPrevented = true; },
    }, 'https://clicked.test/page');
    expect(clickPrevented).toBe(false);
    expect(externalUrls).toEqual([]);

    manager.navigate({ sessionId: 'session-web', tabId, url: 'https://inside.test/path' });
    expect(view.webContents.loads.at(-1)).toBe('https://inside.test/path');
    expect(externalUrls).toEqual([]);

    view.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://inside.test/path', true);
    expect(externalUrls).toEqual([]);

    view.webContents.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://inside.test/path', true);
    expect(externalUrls).toEqual(['https://inside.test/path']);

    view.webContents.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://inside.test/path', true);
    expect(externalUrls).toEqual(['https://inside.test/path']);
  });

  it('keeps main-frame load failures visible after loading stops', () => {
    const { manager, views, externalUrls, children } = createHarness();
    const opened = manager.openTab({ sessionId: 'session-error', url: 'https://unreachable.test' });
    const tabId = opened.activeTabId;
    const view = views[1]!.view;
    manager.setHost({
      sessionId: 'session-error',
      visible: true,
      bounds: { x: 700, y: 120, width: 500, height: 680 },
    });

    view.webContents.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://unreachable.test', true);
    expect(manager.getState('session-error').tabs.find((tab: any) => tab.id === tabId)?.error).toBe('NAME_NOT_RESOLVED');
    expect(externalUrls).toEqual(['https://unreachable.test']);
    expect(children).toHaveLength(0);

    view.webContents.emit('did-stop-loading');
    expect(manager.getState('session-error').tabs.find((tab: any) => tab.id === tabId)?.error).toBe('NAME_NOT_RESOLVED');
    expect(children).toHaveLength(0);
  });

  it('switches, closes, and disposes native views without leaking children', () => {
    const { manager, views, children } = createHarness();
    const first = manager.openTab({ sessionId: 'session-3', url: 'https://one.test' });
    const firstId = first.activeTabId;
    const second = manager.openTab({ sessionId: 'session-3', url: 'https://two.test' });
    const secondId = second.activeTabId;
    manager.setHost({
      sessionId: 'session-3',
      visible: true,
      bounds: { x: 600, y: 100, width: 500, height: 600 },
    });
    expect(children).toEqual([views[2]!.view]);

    manager.activateTab({ sessionId: 'session-3', tabId: firstId });
    expect(children).toEqual([views[1]!.view]);
    manager.closeTab({ sessionId: 'session-3', tabId: firstId });
    expect(views[1]!.view.webContents.closed).toBe(true);
    expect(manager.getState('session-3').activeTabId).toBe(secondId);
    expect(children).toEqual([views[2]!.view]);

    manager.disposeSession('session-3');
    expect(children).toHaveLength(0);
    expect(views[2]!.view.webContents.closed).toBe(true);
  });

  it('toggles DevTools on the tab web contents and clears completed auth pages', () => {
    const { manager, views } = createHarness();
    const opened = manager.openTab({
      sessionId: 'session-4',
      url: 'https://auth.test/callback?code=secret',
      connectorAuth: { connectorId: 'demo', serverName: 'demo' },
    });
    const tabId = opened.activeTabId;
    manager.toggleDevTools({ sessionId: 'session-4', tabId });
    expect(manager.getState('session-4').tabs.find((tab: any) => tab.id === tabId)?.devToolsOpen).toBe(true);
    manager.toggleDevTools({ sessionId: 'session-4', tabId });
    expect(views[1]!.view.webContents.devToolsOpen).toBe(false);

    manager.completeAuth({ sessionId: 'session-4', tabId, title: '授权完成' });
    expect(manager.getState('session-4').tabs.find((tab: any) => tab.id === tabId)).toMatchObject({
      title: '授权完成',
      url: BROWSER_DEFAULT_URL,
      connectorAuth: null,
    });
  });
});
