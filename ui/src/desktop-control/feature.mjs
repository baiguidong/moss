import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DesktopControlSession } from '../../../packages/app-runtime/src/desktop-control/session.mjs';
import { parseAppServiceKey } from '../../../packages/app-sdk/src/tool-services.mjs';

export function createDesktopControlFeature({ app, ipcMain, shell, powerMonitor, getMainWindow,
  getRuntime, getSettings, saveSettings, publish, expectedBundleId, loadModule = url => import(url) }) {
  const pending = new Map();
  let pinned, loading, generation = 0, permissionNotice = '';
  const settingsUrls = { accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture' };
  const hostApplicationPath = /^(.*\.app)\/Contents\//.exec(app.getPath?.('exe') || process.execPath)?.[1] || '';
  const current = session => {
    const installation = pinned && getRuntime()?.installations.get(pinned.appId);
    return installation?.enabled && installation.activeVersion === pinned.version && installation.grants?.includes('desktop:control')
      && (!session || (pinned.toolSelection === 'services'
        ? session.appServiceIds?.some(id => parseAppServiceKey(id)?.appId === pinned.appId)
        : session.appIds?.includes(pinned.appId)));
  };
  const decorate = value => ({ ...value, provider: pinned?.appId, permissionNotice, requests: [...pending.values()].map(p => p.display) });
  const control = new DesktopControlSession({ getSettings, saveSettings, isCurrent: current,
    publish: value => publish(decorate(value)),
    requestAccess: ({ session, app: target, foreground, signal }) => new Promise((resolve, reject) => {
      const id = randomUUID();
      const abort = () => { pending.delete(id); reject(new Error('应用授权请求已取消。')); control.changed(); };
      if (signal.aborted) return abort();
      pending.set(id, { resolve: decision => { signal.removeEventListener('abort', abort); resolve(decision); },
        display: { id, sessionId: session.id, sessionTitle: session.title, app: target, foreground } });
      signal.addEventListener('abort', abort, { once: true }); control.changed();
    }),
  });
  async function load(pkg) {
    const identity = { appId: pkg.manifest.id, version: pkg.manifest.version, root: pkg.root, toolSelection: pkg.manifest.toolSelection };
    if (pinned && (pinned.appId !== identity.appId || pinned.version !== identity.version || pinned.root !== identity.root)) {
      throw new Error('原生控制驱动已加载。请重启 Moss 后使用新版本或其他控制 App。');
    }
    pinned ||= identity;
    if (!current()) throw new Error('原生控制 App 已停用或撤销授权。');
    if (control.failedStop) throw new Error('上次驱动停止失败，请重启 Moss。');
    if (!loading) {
      const epoch = generation;
      loading = (async () => {
        await app.whenReady();
        const module = await loadModule(pathToFileURL(path.join(pkg.root, pkg.manifest.nativeAdapter.entry)).href);
        if (typeof module.createAdapter !== 'function') throw new Error('Native adapter must export createAdapter');
        if (epoch !== generation || !current()) throw new Error('原生控制 App 加载已取消。');
        const adapter = await module.createAdapter({ packageRoot: pkg.root, control, expectedBundleId });
        for (const name of ['invokeTool','status','check','stop','finish','requestPermissions']) {
          if (typeof adapter?.[name] !== 'function') throw new Error(`Native adapter is missing ${name}`);
        }
        control.adapter = adapter;
        if (epoch !== generation || !current()) { await control.stop('load-canceled'); throw new Error('原生控制 App 加载已取消。'); }
        control.changed(); return adapter;
      })();
    }
    return loading;
  }
  const status = () => decorate(control.status());
  async function operate(operation, payload = {}) {
    if (operation === 'status') return status();
    if (operation === 'stop') { await control.stop(); return status(); }
    if (operation === 'revoke') { await control.revoke(payload.bundleId); return status(); }
    if (operation === 'open-settings') {
      if (process.platform !== 'darwin') throw new Error('此平台没有 macOS 权限设置。');
      if (!settingsUrls[payload.permission]) throw new Error('未知权限。');
      await shell.openExternal(settingsUrls[payload.permission]); return status();
    }
    if (operation === 'reveal-host-app') {
      if (!hostApplicationPath) throw new Error('无法定位当前授权应用。');
      shell.showItemInFolder(hostApplicationPath); return status();
    }
    permissionNotice = '';
    if (control.suspended) throw new Error('电脑已锁定或休眠，请解锁后继续。');
    if (operation === 'enable') {
      if (typeof payload.enabled !== 'boolean') throw new Error('无效的开关状态。');
      if (!payload.enabled) await control.stop('disabled');
      await saveSettings({ ...control.settings(), enabled: payload.enabled });
      if (payload.enabled) await control.adapter.check();
    } else if (operation === 'check') {
      await control.adapter.check({ restart: true });
    } else if (operation === 'request-permissions') {
      if (!control.settings().enabled || !control.adapter.status().supported) throw new Error('请先在支持的设备上开启电脑操控。');
      if (control.owner || control.inFlight) throw new Error('请先结束当前控制，再申请系统权限。');
      await control.adapter.requestPermissions();
      await control.adapter.check({ restart: true });
      const permissions = control.adapter.status().permissions;
      if (!permissions) throw new Error(control.adapter.status().error || '无法读取系统权限，请打开系统设置。');
      if (process.platform !== 'darwin') {
        permissionNotice = control.adapter.status().phase === 'ready' ? '系统能力检查已通过。' : (control.adapter.status().error || '系统能力检查未通过，请确认桌面已解锁。');
      } else if (!permissions.accessibility || !permissions.screenRecording) {
        const permission = !permissions.accessibility ? 'accessibility' : 'screen';
        await shell.openExternal(settingsUrls[permission]);
        permissionNotice = '已打开系统设置。请允许当前应用访问，完成后返回并重新检查。';
      } else permissionNotice = permissions.hostIdentity ? '两项系统权限均已开启。' : '驱动身份检查未通过。';
    } else throw new Error('不支持的原生 App 设置操作。');
    control.changed(); return status();
  }
  // Only the trusted main window can decide grants or invoke emergency stop.
  for (const name of ['status','stop','revoke','decide']) ipcMain.handle(`computer-use:${name}`, (event, payload = {}) => {
    const main = getMainWindow();
    if (!main || main.isDestroyed() || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) throw new Error('此操作只允许 Moss 主窗口调用。');
    if (name !== 'decide') return operate(name, payload);
    const request = pending.get(payload.id);
    if (!request || !['session','always','deny'].includes(payload.decision)) throw new Error('授权请求已失效。');
    if (request.display.foreground && payload.decision === 'always') throw new Error('前台控制只允许本次运行授权。');
    pending.delete(payload.id); request.resolve(payload.decision); control.changed();
  });
  app.whenReady().then(() => {
    for (const name of ['lock-screen','suspend']) powerMonitor.on(name, () => {
      control.suspended = true; void control.stop(name).catch(() => {});
    });
    for (const name of ['unlock-screen','resume']) powerMonitor.on(name, () => {
      control.suspended = false; control.adapter?.invalidate?.(); control.changed();
    });
  });
  return {
    get owner() { return control.owner; }, get inFlight() { return control.inFlight; }, status,
    beginTurn: id => control.beginTurn(id), finish: id => control.finish(id),
    stop: (reason, id) => control.stop(reason, id), disposeSession: id => control.disposeSession(id),
    isLoaded: id => pinned?.appId === id,
    async deactivate(id) { if (pinned?.appId === id) { generation++; await control.stop('app-deactivated'); control.sessionGrants.clear(); control.changed(); } },
    async removedFromSession(id, removed) { if (removed.includes(pinned?.appId)) await control.disposeSession(id); },
    async invoke(pkg, action, input, options) {
      control.assertLocal(options.sessionRecord);
      const adapter = await load(pkg);
      if (!current(options.sessionRecord)) throw new Error('控制 App 已移出当前会话。');
      options.signal?.throwIfAborted();
      return adapter.invokeTool(action, input, options.sessionRecord, options.signal);
    },
    async settings(pkg, input, context) {
      await load(pkg); context.assertCurrent();
      const result = await operate(input.operation, input);
      context.assertCurrent(); return result;
    },
  };
}
