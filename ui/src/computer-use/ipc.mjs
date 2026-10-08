import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CuaDriverHost } from './driver-host.mjs';
import { ComputerUseService } from './service.mjs';

export function createComputerUseFeature({ app, ipcMain, shell, powerMonitor, getMainWindow,
  resourcesRoot, getSettings, saveSettings, publish, expectedBundleId, sdkLoader }) {
  const pending = new Map();
  let permissionNotice = '';
  const hostApplicationPath = /^(.*\.app)\/Contents\//.exec(app.getPath?.('exe') || process.execPath)?.[1] || '';
  const settingsUrls = { accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture' };
  const decorate = value => ({ ...value, permissionNotice,
    requests: [...pending.values()].map(p => p.display) });
  // UniFFI passes the dylib path to native dlopen, which cannot resolve ASAR's
  // virtual filesystem. Load the complete SDK from its real unpacked location.
  const loadSdk = sdkLoader || ((entry = 'index') => app.isPackaged
    ? import(pathToFileURL(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@trycua', 'cua-driver', 'dist', `${entry}.js`)).href)
    : import(entry === 'electron' ? '@trycua/cua-driver/electron' : '@trycua/cua-driver'));
  const host = new CuaDriverHost({ resourcesRoot, hostBundleId: expectedBundleId, sdkLoader: () => loadSdk() });
  const service = new ComputerUseService({ host, getSettings, saveSettings, expectedBundleId,
    publish: value => publish(decorate(value)),
    requestAccess: ({ session, app: target, foreground, signal }) => new Promise((resolve, reject) => {
      const id = randomUUID();
      const abort = () => { pending.delete(id); reject(new Error('应用授权请求已取消。')); service.changed(); };
      if (signal.aborted) return abort();
      pending.set(id, { resolve: answer => { signal.removeEventListener('abort', abort); resolve(answer); },
        display: { id, sessionId: session.id, sessionTitle: session.title, app: target, foreground } });
      signal.addEventListener('abort', abort, { once: true });
      service.changed();
    }),
  });
  const status = () => decorate(service.status());
  const register = (name, handler) => ipcMain.handle(`computer-use:${name}`, (event, payload) => {
    const main = getMainWindow();
    if (!main || main.isDestroyed() || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) throw new Error('此操作只允许 Moss 主窗口调用。');
    return handler(payload);
  });
  register('status', status);
  register('enable', async ({ enabled } = {}) => {
    if (typeof enabled !== 'boolean') throw new Error('无效的开关状态。');
    permissionNotice = '';
    if (!enabled) await service.stop('disabled');
    await saveSettings({ ...service.settings(), enabled });
    service.changed();
    if (enabled) await service.check();
    return status();
  });
  register('check', async () => { permissionNotice = ''; await service.check({ restart: true }); return status(); });
  register('request-permissions', async () => {
    if (!service.settings().enabled || process.platform !== 'darwin') throw new Error('请先开启电脑操控。');
    if (service.owner || service.inFlight) throw new Error('请先结束当前控制，再申请系统权限。');
    permissionNotice = '';
    await app.whenReady();
    const { requestMacOSPermissions } = await loadSdk('electron');
    // macOS can return without a dialog (already granted, or previously denied).
    // Re-read the daemon's real status and always give a visible next step.
    await requestMacOSPermissions();
    await service.check({ restart: true });
    const permissions = service.permissions;
    if (!permissions) throw new Error(service.error || '无法读取系统权限，请点击对应的“打开系统设置”。');
    if (!permissions.accessibility || !permissions.screenRecording) {
      const permission = !permissions.accessibility ? 'accessibility' : 'screen';
      await shell.openExternal(settingsUrls[permission]);
      permissionNotice = `已打开${permission === 'accessibility' ? '辅助功能' : '屏幕录制'}设置。请允许当前应用访问，完成后返回并重新检查。`;
    } else {
      permissionNotice = permissions.hostIdentity
        ? '两项系统权限均已开启，可以在对话中操作应用。'
        : '两项系统权限已开启，但驱动身份检查未通过，请查看下方错误。';
    }
    service.changed();
    return status();
  });
  register('open-settings', async ({ permission } = {}) => {
    if (!settingsUrls[permission]) throw new Error('未知权限。');
    await shell.openExternal(settingsUrls[permission]);
  });
  register('reveal-host-app', () => {
    if (!hostApplicationPath) throw new Error('无法定位当前授权应用。');
    shell.showItemInFolder(hostApplicationPath);
  });
  register('stop', async () => { await service.stop(); return status(); });
  register('revoke', async ({ bundleId } = {}) => { await service.revoke(bundleId); return status(); });
  register('decide', ({ id, decision } = {}) => {
    const request = pending.get(id);
    if (!request || !['session', 'always', 'deny'].includes(decision)) throw new Error('授权请求已失效。');
    if (request.display.foreground && decision === 'always') throw new Error('前台控制只允许本次运行授权。');
    pending.delete(id); request.resolve(decision); service.changed();
  });
  app.whenReady().then(() => {
    for (const name of ['lock-screen', 'suspend']) powerMonitor.on(name, () => {
      service.suspended = true; void service.stop(name).catch(() => {});
    });
    for (const name of ['unlock-screen', 'resume']) powerMonitor.on(name, () => {
      service.suspended = false; service.permissions = null; service.captureVerified = false; service.changed();
    });
  });
  return service;
}
