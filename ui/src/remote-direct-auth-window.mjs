import { randomUUID } from 'node:crypto';

const AUTHORIZE_PATH = '/api/v1/auth/oauth/authorize';

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isAllowedRemoteAuthNavigation(targetUrl, authorizationUrl, redirectUri) {
  const target = parseUrl(targetUrl);
  const authorization = parseUrl(authorizationUrl);
  const callback = parseUrl(redirectUri);
  if (!target || !authorization || !callback || target.username || target.password || target.hash) {
    return false;
  }

  if (target.origin === authorization.origin) {
    return !target.search && (
      target.pathname === authorization.pathname
      || target.pathname === AUTHORIZE_PATH
    );
  }

  return target.origin === callback.origin && target.pathname === callback.pathname;
}

export async function openRemoteDirectAuthorizationWindow({
  createWindow,
  parentWindow,
  authorizationUrl,
  redirectUri,
  signal,
  onUserClosed,
}) {
  if (typeof createWindow !== 'function') {
    throw new Error('Unable to create the Moss authentication window.');
  }

  const authorization = parseUrl(authorizationUrl);
  const callback = parseUrl(redirectUri);
  const loopbackCallback = callback
    && callback.protocol === 'http:'
    && (callback.hostname === '127.0.0.1' || callback.hostname === '[::1]')
    && Boolean(callback.port)
    && callback.pathname === '/callback'
    && !callback.search
    && !callback.hash
    && !callback.username
    && !callback.password;
  if (
    !authorization
    || !loopbackCallback
    || !/^\/api\/v1\/auth\/oauth\/authorize\/[A-Za-z0-9_-]{43}$/.test(authorization.pathname)
    || authorization.search
    || authorization.hash
    || authorization.username
    || authorization.password
  ) {
    throw new Error('Moss Server returned an invalid authorization URL.');
  }

  const authWindow = createWindow({
    title: '登录到 Moss Server',
    width: 520,
    height: 680,
    minWidth: 420,
    minHeight: 560,
    parent: parentWindow && !parentWindow.isDestroyed?.() ? parentWindow : undefined,
    modal: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: {
      partition: `remote-auth-${randomUUID()}`,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
      javascript: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  const authSession = authWindow.webContents.session;

  let closedByClient = false;
  const close = () => {
    if (authWindow.isDestroyed()) return;
    closedByClient = true;
    authWindow.close();
  };
  const handleAbort = () => close();
  const guardNavigation = (event, url) => {
    if (!isAllowedRemoteAuthNavigation(url, authorization.href, callback.href)) {
      event.preventDefault();
    }
  };
  const blockDownload = (event) => event.preventDefault();

  authWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  authWindow.webContents.on('will-navigate', guardNavigation);
  authWindow.webContents.on('will-redirect', guardNavigation);
  authWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  authSession.setPermissionRequestHandler(
    (_webContents, _permission, callbackHandler) => callbackHandler(false),
  );
  authSession.setPermissionCheckHandler(() => false);
  authSession.on('will-download', blockDownload);

  authWindow.once('ready-to-show', () => {
    if (!authWindow.isDestroyed()) authWindow.show();
  });
  authWindow.on('closed', () => {
    signal?.removeEventListener('abort', handleAbort);
    authSession.removeListener('will-download', blockDownload);
    try {
      authSession.setPermissionRequestHandler(null);
      authSession.setPermissionCheckHandler(null);
    } catch {
      // The isolated session may already be disposed during application shutdown.
    }
    void Promise.allSettled([
      Promise.resolve().then(() => authSession.clearStorageData?.()),
      Promise.resolve().then(() => authSession.clearCache?.()),
    ]);
    if (!closedByClient && !signal?.aborted) onUserClosed?.();
  });
  if (signal?.aborted) {
    close();
    throw signal.reason instanceof Error ? signal.reason : new Error('认证已取消。');
  }
  signal?.addEventListener('abort', handleAbort, { once: true });

  try {
    await authWindow.loadURL(authorization.href);
    if (!authWindow.isDestroyed() && !authWindow.isVisible?.()) authWindow.show();
    return close;
  } catch (error) {
    close();
    throw error;
  }
}
