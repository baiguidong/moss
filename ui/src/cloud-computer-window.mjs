import { createHash, randomUUID } from 'node:crypto';
import { normalizeAppearance } from './appearance-settings.mjs';

export function cloudComputerOrigin(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('请输入 Moss 的统一入口地址，例如 https://moss.example.com');
  }
  return url.origin;
}

// Only presentation preferences cross this bridge. Business IPC stays on the
// cloud Host; its sandboxed view shares the existing Desktop window frame.
export function createCloudComputerWindow({ WebContentsView, session, shell, ipcMain, getLocalWindow, resolveConnection,
  certificateVerifyProc, preload, appVersion, getAppearance = () => ({}), updateAppearance = async () => {} }) {
  let cloudView, parentWindow, opening, connectionKey, cloudPartition;
  let generation = 0, clearing = Promise.resolve(), panelLayout = null;
  const external = url => { if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url); };
  const assertCloud = event => {
    if (!cloudView || event.sender !== cloudView.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Forbidden');
  };
  const presentation = () => ({ appearance: normalizeAppearance(getAppearance()), panelLayout });
  const readLayout = async contents => {
    try { return await contents.executeJavaScript('localStorage.getItem("ui.panelLayout.v1")'); } catch { return null; }
  };
  const resize = () => {
    if (!cloudView || !parentWindow || parentWindow.isDestroyed()) return;
    const [width, height] = parentWindow.getContentSize();
    cloudView.setBounds({ x: 0, y: 0, width, height });
  };
  const detach = () => {
    if (parentWindow && !parentWindow.isDestroyed() && cloudView) parentWindow.contentView.removeChildView(cloudView);
    parentWindow?.removeListener('resize', resize);
  };
  const dispose = () => {
    detach();
    if (cloudView?.webContents && !cloudView.webContents.isDestroyed()) cloudView.webContents.close();
    cloudView = null;
  };
  const show = () => {
    parentWindow = getLocalWindow();
    if (!parentWindow || parentWindow.isDestroyed()) throw new Error('Desktop window is closed');
    parentWindow.contentView.addChildView(cloudView);
    parentWindow.removeListener('resize', resize);
    parentWindow.on('resize', resize);
    resize(); cloudView.webContents.focus();
  };
  const syncAppearance = (includeLayout = false) => {
    if (cloudView?.webContents && !cloudView.webContents.isDestroyed()) cloudView.webContents.send('desktop:presentation', {
      appearance: presentation().appearance, ...(includeLayout ? { panelLayout } : {}),
    });
  };
  ipcMain.handle('desktop:cloud-presentation', event => { assertCloud(event); return presentation(); });
  ipcMain.handle('desktop:cloud-appearance', async (event, value) => {
    assertCloud(event);
    await updateAppearance(normalizeAppearance(value, getAppearance()));
    syncAppearance();
    return presentation().appearance;
  });
  ipcMain.handle('desktop:return-local', async event => {
    assertCloud(event);
    const view = cloudView, current = generation;
    const layout = await readLayout(view.webContents);
    if (current !== generation || cloudView !== view) return;
    if (parentWindow && !parentWindow.isDestroyed()) {
      parentWindow.webContents.send('desktop:presentation', { panelLayout: layout });
      // Let the local renderer apply the shared layout before revealing it.
      await Promise.race([
        parentWindow.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'),
        new Promise(resolve => setTimeout(resolve, 100)),
      ]);
      if (current !== generation || cloudView !== view) return;
      detach(); parentWindow.webContents.focus();
    }
  });
  async function fetchIdentity(origin, token) {
    const partition = session.fromPartition(`moss-cloud-identity-${randomUUID()}`);
    partition.setCertificateVerifyProc(certificateVerifyProc);
    const response = await partition.fetch(`${origin}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('请先登录 Moss 账号。');
    return response.json();
  }
  async function open() {
    const current = generation;
    const { serverUrl, authToken } = await resolveConnection();
    const origin = cloudComputerOrigin(serverUrl);
    const identity = await fetchIdentity(origin, authToken);
    if (current !== generation) throw new Error('账号已变更，请重新连接。');
    const key = createHash('sha256').update(`${origin}:${identity.organization?.id}:${identity.user.id}`).digest('hex');
    panelLayout = await readLayout(getLocalWindow().webContents);
    if (cloudView && (!cloudView.webContents || cloudView.webContents.isDestroyed() || connectionKey !== key)) dispose();
    if (cloudView) { syncAppearance(true); show(); return { ok: true }; }
    const partition = session.fromPartition(`moss-cloud-${key}-${randomUUID()}`);
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
    const view = new WebContentsView({ webPreferences: { session: partition, preload, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false } });
    cloudView = view;
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
    protect(view.webContents);
    const owner = getLocalWindow();
    const onClosed = () => { if (cloudView === view) dispose(); };
    owner.once('closed', onClosed);
    view.webContents.once('destroyed', () => owner.removeListener('closed', onClosed));
    try {
      await view.webContents.loadURL(origin);
      // Keep the existing content visible until the cloud UI has mounted.
      for (let attempt = 0; attempt < 600; attempt++) {
        if (current !== generation || cloudView !== view) throw new Error('账号已变更，请重新连接。');
        if (await view.webContents.executeJavaScript('Boolean(document.querySelector(".app-shell, h1, [data-cloud-environment]"))')) break;
        if (attempt === 599) throw new Error('云电脑界面加载超时，请重试。');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      show();
    } catch (error) { if (cloudView === view) dispose(); throw error; }
    return { ok: true, version: appVersion };
  }
  ipcMain.handle('desktop:open-cloud', event => {
    if (event.sender !== getLocalWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Forbidden');
    return opening ||= open().finally(() => { opening = null; });
  });
  return { syncAppearance, close: () => { generation++; dispose(); clearing = cloudPartition?.clearStorageData() || Promise.resolve(); } };
}
