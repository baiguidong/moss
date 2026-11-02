import { createHash } from 'node:crypto';

export function cloudComputerOrigin(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('请输入 Moss 的统一入口地址，例如 https://moss.example.com');
  }
  return url.origin;
}

// Remote pages receive only the return-to-local bridge. They never receive the
// local Host's IPC client. All business data and resources stay on that origin.
export function createCloudComputerWindow({ BrowserWindow, session, shell, ipcMain, getLocalWindow, resolveConnection,
  certificateVerifyProc, preload, appVersion }) {
  let cloudWindow;
  let opening;
  let connectionKey;
  let generation = 0;
  let cloudPartition;
  let clearing = Promise.resolve();
  const local = () => { const window = getLocalWindow(); if (window && !window.isDestroyed()) { window.show(); window.focus(); } };
  const external = url => { if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url); };
  ipcMain.handle('desktop:return-local', event => {
    if (!cloudWindow || event.sender !== cloudWindow.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Forbidden');
    cloudWindow.hide(); local();
  });
  async function open() {
    const current = generation;
    const { serverUrl, authToken } = await resolveConnection();
    const origin = cloudComputerOrigin(serverUrl);
    const identityResponse = await fetchIdentity(origin, authToken);
    if (current !== generation) throw new Error('账号已变更，请重新连接。');
    const identity = identityResponse.user;
    const key = createHash('sha256').update(`${origin}:${identityResponse.organization?.id}:${identity.id}`).digest('hex');
    if (cloudWindow && !cloudWindow.isDestroyed() && connectionKey !== key) cloudWindow.close();
    if (cloudWindow && !cloudWindow.isDestroyed()) { cloudWindow.show(); cloudWindow.focus(); getLocalWindow()?.hide(); return { ok: true }; }
    const partition = session.fromPartition(`moss-cloud-${key}`);
    cloudPartition = partition;
    partition.setCertificateVerifyProc(certificateVerifyProc);
    await clearing;
    if (current !== generation) throw new Error('账号已变更，请重新连接。');
    const response = await partition.fetch(`${origin}/api/desktop/login`, {
      method: 'POST', credentials: 'include', headers: { Origin: origin, Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: '{}', redirect: 'error', signal: AbortSignal.timeout(330_000),
    });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || '云电脑连接失败，请检查统一入口和账号。'); }
    const authenticated = await response.json();
    if (current !== generation) { await partition.clearStorageData(); throw new Error('账号已变更，请重新连接。'); }
    if (!authenticated.ok) throw new Error('云电脑连接未完成。');
    connectionKey = key;
    const window = new BrowserWindow({ title: `Moss · 我的云电脑`, width: 1440, height: 900, minWidth: 900, minHeight: 650, show: false,
      autoHideMenuBar: true, webPreferences: { session: partition, preload, sandbox: true, contextIsolation: true, nodeIntegration: false,
        webviewTag: false, webSecurity: true, allowRunningInsecureContent: false } });
    cloudWindow = window;
    const protect = contents => {
      contents.on('will-navigate', (event, url) => {
        if (url === 'about:blank' || new URL(url).origin === origin) return;
        event.preventDefault(); external(url);
      });
      contents.setWindowOpenHandler(({ url }) => {
        if (url === 'about:blank' || new URL(url).origin === origin) return { action: 'allow', overrideBrowserWindowOptions: {
          autoHideMenuBar: true, webPreferences: { session: partition, preload: undefined, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
        } };
        external(url); return { action: 'deny' };
      });
      contents.on('did-create-window', child => protect(child.webContents));
    };
    protect(window.webContents);
    window.on('closed', () => { if (cloudWindow === window) cloudWindow = null; local(); });
    try { await window.loadURL(origin); window.show(); getLocalWindow()?.hide(); }
    catch (error) { window.close(); throw error; }
    return { ok: true, version: appVersion };
  }
  async function fetchIdentity(origin, token) {
    const partition = session.fromPartition('moss-cloud-identity');
    partition.setCertificateVerifyProc(certificateVerifyProc);
    const response = await partition.fetch(`${origin}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('请先登录 Moss 账号。');
    return response.json();
  }
  ipcMain.handle('desktop:open-cloud', event => {
    if (event.sender !== getLocalWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Forbidden');
    return opening ||= open().finally(() => { opening = null; });
  });
  return { close: () => { generation++; cloudWindow?.close(); clearing = cloudPartition?.clearStorageData() || Promise.resolve(); } };
}
