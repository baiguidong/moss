import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createResourceMonitor } from './resource-monitor.mjs';

export function buildProcessLabels({ app, webContents, getWindow, getRuntime, getAppStates, getApps }) {
  const labels = new Map();
  const names = new Map(getApps().map(app => [app.id || app.name, app.displayName || app.title || app.id || app.name]));
  for (const metric of app.getAppMetrics()) {
    const kind = metric.pid === process.pid ? 'main' : metric.type === 'Tab' ? 'renderer' : 'helper';
    labels.set(metric.pid, {
      pid: metric.pid, kind, state: 'running', startedAt: metric.creationTime,
      name: kind === 'main' ? 'Moss 主进程（含本地 Agent）' : metric.type === 'GPU' ? 'GPU 进程'
        : metric.name || metric.serviceName || (kind === 'renderer' ? '界面进程' : `Electron ${metric.type}`),
    });
  }
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;
    const pid = contents.getOSProcessId();
    const label = labels.get(pid);
    if (label?.kind !== 'renderer') continue;
    if (contents === getWindow()?.webContents) label.name = 'Moss 主界面';
    else if (label.name === '界面进程') label.name = '预览 / 浏览器 / 终端界面';
  }
  const runtime = getRuntime();
  const runtimes = new Set(runtime ? [runtime] : []);
  for (const state of getAppStates()) {
    if (state.runtime) runtimes.add(state.runtime);
    if (state.webContents?.isDestroyed()) continue;
    const pid = state.webContents?.getOSProcessId();
    if (!pid) continue;
    const name = state.manifest?.displayName || names.get(state.id) || state.id;
    labels.set(pid, {
      ...labels.get(pid), pid, kind: 'renderer', state: 'running', appId: state.id, appName: name,
      name: `${name} · ${state.source?.mode === 'preview' ? '预览界面' : '界面'}`,
    });
  }
  const stopped = [];
  let runtimeIndex = 0;
  for (const host of runtimes) {
    const ownerKey = host.currentOwner().key;
    for (const status of host.supervisor.listStatuses()) {
      const name = names.get(status.appId) || status.appId;
      const manageable = host === runtime && status.owner?.key === ownerKey;
      const installation = manageable ? host.installations.get(status.appId) : null;
      const instance = manageable ? host.instances.get(status.instanceId) : null;
      const label = {
        ...status, targetKey: `${runtimeIndex}:${status.key}`, kind: 'app', appName: name,
        name: `${name} · ${host === runtime ? '后端' : '预览后端'}`,
        canManage: Boolean(manageable && instance),
        canRestart: Boolean(manageable && installation?.enabled && instance?.enabled),
      };
      if (label.pid) labels.set(label.pid, label);
      else stopped.push(label);
    }
    runtimeIndex += 1;
  }
  return [...labels.values(), ...stopped];
}

export function registerResourceMonitorIpc(options) {
  const { ipcMain, app, getWindow, log = () => {}, createMonitor = createResourceMonitor } = options;
  const lag = monitorEventLoopDelay({ resolution: 100 });
  lag.enable();
  let appNames = [];
  let namesReadAt = 0;
  const service = createMonitor({
    getLabels: () => buildProcessLabels({ ...options, getApps: () => {
      if (!namesReadAt || Date.now() - namesReadAt >= 30_000) {
        appNames = options.getApps();
        namesReadAt = Date.now();
      }
      return appNames;
    } }),
    getLoopDelay: () => { const value = Math.max(0, lag.max / 1e6 - 100); lag.reset(); return value; },
    onAlert: event => log(event.phase === 'started' ? 'warn' : 'info', 'resource-monitor', event.message, event),
  });
  ipcMain.handle('resource-monitor:snapshot', (event, payload = {}) => {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('资源监控请求来源无效');
    }
    return service.getSnapshot({ since: Number(payload?.since) || 0, active: payload?.active !== false });
  });
  service.start();
  app.once('will-quit', () => { service.stop(); lag.disable(); });
  return service;
}
