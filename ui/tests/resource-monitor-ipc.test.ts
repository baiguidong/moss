import { expect, test } from 'bun:test';
import { buildProcessLabels, registerResourceMonitorIpc } from '../src/resource-monitor/resource-monitor-ipc.mjs';

test('monitor IPC only accepts the desktop main frame and stops sampling on quit', async () => {
  const handlers = new Map();
  const frame = {};
  const sender = { mainFrame: frame };
  let destroyed = false;
  let quit: () => void;
  let starts = 0;
  let stops = 0;
  const requests: any[] = [];
  registerResourceMonitorIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    app: { once: (_event, callback) => { quit = callback; } },
    getWindow: () => ({ webContents: sender, isDestroyed: () => destroyed }),
    createMonitor: () => ({ start: () => starts++, stop: () => stops++, getSnapshot: payload => { requests.push(payload); return {}; } }),
  });
  try {
    const handler = handlers.get('resource-monitor:snapshot');
    expect(() => handler({ sender: {}, senderFrame: frame }, {})).toThrow('来源无效');
    expect(() => handler({ sender, senderFrame: {} }, {})).toThrow('来源无效');
    destroyed = true;
    expect(() => handler({ sender, senderFrame: frame }, {})).toThrow('来源无效');
    destroyed = false;
    await handler({ sender, senderFrame: frame }, { since: 1234, pid: 99, active: false });
    expect(requests).toEqual([{ since: 1234, active: false }]);
    expect(starts).toBe(1);
  } finally { quit!(); }
  expect(stops).toBe(1);
});

test('maps App backends and renderers to names and only allows management of the current desktop owner', () => {
  const contents = { isDestroyed: () => false, getOSProcessId: () => 200 };
  const preview = {
    currentOwner: () => ({ key: 'host' }),
    supervisor: { listStatuses: () => [{ key: 'preview', pid: 300, appId: 'example', instanceId: 'preview', owner: { key: 'host' }, state: 'running' }] },
  };
  const runtime = {
    currentOwner: () => ({ key: 'host' }),
    installations: { get: () => ({ enabled: true }) }, instances: { get: () => ({ enabled: true }) },
    supervisor: { listStatuses: () => [
      { key: 'live', pid: 100, appId: 'example', instanceId: 'default', owner: { key: 'host' }, state: 'running' },
      { key: 'foreign', pid: 400, appId: 'foreign', instanceId: 'other', owner: { key: 'another-owner' }, state: 'running' },
      { key: 'stopped', pid: null, appId: 'stopped', instanceId: 'default', owner: { key: 'host' }, state: 'crash-loop' },
    ] },
  };
  const labels = buildProcessLabels({
    app: { getAppMetrics: () => [{ pid: 200, type: 'Tab', creationTime: 123 }] },
    webContents: { getAllWebContents: () => [contents] }, getWindow: () => null,
    getRuntime: () => runtime, getAppStates: () => [{ id: 'example', runtime: preview, webContents: contents, source: { mode: 'preview' } }],
    getApps: () => [{ id: 'example', displayName: 'Example App' }],
  });
  expect(labels.find(row => row.pid === 100)).toMatchObject({ name: 'Example App · 后端', canManage: true, canRestart: true });
  expect(labels.find(row => row.pid === 200)).toMatchObject({ name: 'Example App · 预览界面', kind: 'renderer', appId: 'example' });
  expect(labels.find(row => row.pid === 300)?.canManage).toBe(false);
  expect(labels.find(row => row.pid === 400)?.canManage).toBe(false);
  expect(labels.find(row => row.key === 'stopped')).toMatchObject({ pid: null, state: 'crash-loop' });
});
