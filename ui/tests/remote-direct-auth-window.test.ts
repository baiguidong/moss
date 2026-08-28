import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import {
  isAllowedRemoteAuthNavigation,
  openRemoteDirectAuthorizationWindow,
} from '../src/remote-direct-auth-window.mjs';

const TRANSACTION_ID = 't'.repeat(43);
const AUTHORIZATION_URL = `https://moss.example.com/api/v1/auth/oauth/authorize/${TRANSACTION_ID}`;
const REDIRECT_URI = 'http://127.0.0.1:54321/callback';

function fakeWindow() {
  const session = new EventEmitter() as EventEmitter & {
    setPermissionRequestHandler: (handler: unknown) => void;
    setPermissionCheckHandler: (handler: unknown) => void;
    clearStorageData: () => Promise<void>;
    clearCache: () => Promise<void>;
  };
  session.setPermissionRequestHandler = () => {};
  session.setPermissionCheckHandler = () => {};
  session.clearStorageData = async () => {};
  session.clearCache = async () => {};

  const webContents = new EventEmitter() as EventEmitter & {
    session: typeof session;
    setWindowOpenHandler: (handler: unknown) => void;
  };
  webContents.session = session;
  webContents.setWindowOpenHandler = () => {};

  let destroyed = false;
  let visible = false;
  const window = new EventEmitter() as EventEmitter & {
    webContents: typeof webContents;
    loadURL: (url: string) => Promise<void>;
    close: () => void;
    show: () => void;
    isDestroyed: () => boolean;
    isVisible: () => boolean;
  };
  window.webContents = webContents;
  window.loadURL = async () => { window.emit('ready-to-show'); };
  window.close = () => {
    if (destroyed) return;
    destroyed = true;
    window.emit('closed');
  };
  window.show = () => { visible = true; };
  window.isDestroyed = () => destroyed;
  window.isVisible = () => visible;
  return window;
}

describe('remote direct authentication window', () => {
  it('only permits the authorization form and the exact loopback callback', () => {
    expect(isAllowedRemoteAuthNavigation(AUTHORIZATION_URL, AUTHORIZATION_URL, REDIRECT_URI)).toBe(true);
    expect(isAllowedRemoteAuthNavigation(
      'https://moss.example.com/api/v1/auth/oauth/authorize',
      AUTHORIZATION_URL,
      REDIRECT_URI,
    )).toBe(true);
    expect(isAllowedRemoteAuthNavigation(
      `${REDIRECT_URI}?code=code&state=state`,
      AUTHORIZATION_URL,
      REDIRECT_URI,
    )).toBe(true);
    expect(isAllowedRemoteAuthNavigation(
      'https://moss.example.com/admin',
      AUTHORIZATION_URL,
      REDIRECT_URI,
    )).toBe(false);
    expect(isAllowedRemoteAuthNavigation(
      'https://example.com/',
      AUTHORIZATION_URL,
      REDIRECT_URI,
    )).toBe(false);
    expect(isAllowedRemoteAuthNavigation(
      'http://127.0.0.1:54322/callback?code=code',
      AUTHORIZATION_URL,
      REDIRECT_URI,
    )).toBe(false);
  });

  it('uses an isolated sandbox and treats a user-closed window as cancellation', async () => {
    const window = fakeWindow();
    let options: Record<string, any> | null = null;
    let userClosed = false;
    await openRemoteDirectAuthorizationWindow({
      createWindow: (value: Record<string, any>) => {
        options = value;
        return window;
      },
      authorizationUrl: AUTHORIZATION_URL,
      redirectUri: REDIRECT_URI,
      onUserClosed: () => { userClosed = true; },
    });

    expect(options?.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
      javascript: false,
      webSecurity: true,
      webviewTag: false,
    });
    expect(options?.webPreferences.partition).toMatch(/^remote-auth-/);

    const blocked = { prevented: false, preventDefault() { this.prevented = true; } };
    window.webContents.emit('will-navigate', blocked, 'https://example.com/');
    expect(blocked.prevented).toBe(true);

    window.close();
    expect(userClosed).toBe(true);
  });

  it('closes on abort without reporting a user cancellation', async () => {
    const window = fakeWindow();
    const controller = new AbortController();
    let userClosed = false;
    await openRemoteDirectAuthorizationWindow({
      createWindow: () => window,
      authorizationUrl: AUTHORIZATION_URL,
      redirectUri: REDIRECT_URI,
      signal: controller.signal,
      onUserClosed: () => { userClosed = true; },
    });

    controller.abort(new Error('认证已取消。'));
    expect(window.isDestroyed()).toBe(true);
    expect(userClosed).toBe(false);
  });
});
