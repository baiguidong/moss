import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComputerUseService } from '../src/computer-use/service.mjs';
import { createComputerUseFeature } from '../src/computer-use/ipc.mjs';

const session = { id: 'one', title: 'Test', agentMode: 'local', sessionKind: 'chat', originChannel: 'desktop' };
function fixture(overrides = {}) {
  const calls = []; let config = { enabled: true, apps: [] };
  let snapshot = 0;
  const host = { supported: true, client: {},
    async call(name, args) {
      calls.push({ name, args });
      const data = name === 'list_apps' ? { apps: [{ name: 'Example', kind: 'desktop', bundle_id: 'com.example.app', running: true, pid: 42 }] }
        : name === 'list_windows' ? { windows: [{ window_id: 100, pid: 42 }] }
        : name === 'get_window_state' ? { snapshot_id: `s${(++snapshot).toString(16).padStart(8, '0')}`, capture_id: `capture-${snapshot}`, screenshot_width: 600, screenshot_height: 400,
          elements: [{ element_token: `s${snapshot.toString(16).padStart(8, '0')}:1` }] }
        : name === 'check_permissions' ? { accessibility: true, screen_recording: true, source: { attribution: 'host', host_bundle_id: 'com.moss.ai' } }
        : name === 'health_report' ? { checks: [{ name: 'bundle_identity', status: 'pass', data: { bundle_identifier: 'com.moss.ai', identity_source: 'parent_application', parent_process_id: process.pid } }] } : {};
      return { content: [{ type: 'text', text: 'ok' }], structuredContent: data };
    },
    async stop() { calls.push({ name: 'STOP' }); this.client = null; },
  };
  const service = new ComputerUseService({ host, getSettings: () => config, saveSettings: v => { config = v; }, requestAccess: async () => 'session', ...overrides });
  service.permissions = { hostIdentity: true, accessibility: true, screenRecording: true };
  const observe = () => service.invoke({ action: 'get_window_state', app: 'com.example.app', window_id: '100' }, session);
  return { service, host, calls, observe, config: () => config };
}

test('app grant is required even when a caller supplies a PID or foreign target', async () => {
  const { service, calls } = fixture({ requestAccess: async () => 'deny' });
  await assert.rejects(service.invoke({ action: 'click', app: 'com.example.app', pid: 9, target: { pid: 9 }, window_id: '100' }, session), /未允许/);
  assert.equal(calls.some(c => c.name === 'click'), false);
});
test('actions bind to the authorized app and consume the observed snapshot', async () => {
  const { service, calls, observe } = fixture();
  const state = (await observe()).structuredContent;
  const input = { action: 'click', app: 'com.example.app', window_id: '100', snapshot_id: state.snapshot_id, element_token: state.elements[0].element_token, pid: 900, target: { kind: 'desktop' } };
  await service.invoke(input, session);
  const click = calls.find(c => c.name === 'click');
  assert.equal(click.args.pid, 42); assert.equal(click.args.window_id, 100); assert.equal(click.args.target, undefined);
  assert.equal(click.args.delivery_mode, 'background');
  await assert.rejects(service.invoke(input, session), /新快照/);
});
test('rejects out-of-window pixels, foreign elements and unsafe window integers', async () => {
  const { service, observe } = fixture();
  const s = (await observe()).structuredContent;
  const base = { action: 'click', app: 'com.example.app', window_id: '100', snapshot_id: s.snapshot_id };
  await assert.rejects(service.invoke({ ...base, x: 600, y: 0 }, session), /坐标/);
  await assert.rejects(service.invoke({ ...base, element_token: 's000000ff:1' }, session), /元素/);
  await assert.rejects(service.invoke({ ...base, window_id: '9007199254740993' }, session), /标识/);
});
test('foreground needs a separate grant and it expires with the control run', async () => {
  const requests = [];
  const { service, observe } = fixture({ requestAccess: async request => { requests.push(request.foreground); return 'session'; } });
  const s = (await observe()).structuredContent;
  await service.invoke({ action: 'press_key', app: 'com.example.app', window_id: '100', snapshot_id: s.snapshot_id, key: 'tab', foreground: true }, session);
  assert.deepEqual(requests, [false, true]);
  await service.finish(session.id);
  const next = (await observe()).structuredContent;
  await service.invoke({ action: 'press_key', app: 'com.example.app', window_id: '100', snapshot_id: next.snapshot_id, key: 'tab', foreground: true }, session);
  assert.deepEqual(requests, [false, true, true]);
});
test('stopping during authorization prevents all subsequent native input', async () => {
  let allow; const approval = new Promise(resolve => { allow = resolve; });
  const { service, calls } = fixture({ requestAccess: () => approval });
  const request = service.invoke({ action: 'launch_app', app: 'com.example.app' }, session);
  await new Promise(resolve => setImmediate(resolve));
  await service.stop(); allow('always');
  await assert.rejects(request, /已停止/);
  assert.equal(calls.some(c => c.name === 'launch_app'), false);
  await assert.rejects(service.invoke({ action: 'list_apps' }, session), /已停止/);
});
test('another session cannot interleave and remote/unattended sessions are denied', async () => {
  const { service, observe } = fixture(); await observe();
  await assert.rejects(service.invoke({ action: 'list_apps' }, { ...session, id: 'two' }), /另一个/);
  for (const other of [{ agentMode: 'remote-direct' }, { sessionKind: 'cron' }, { originChannel: 'app:test' }, { isSubAgent: true }]) {
    await assert.rejects(service.invoke({ action: 'list_apps' }, { ...session, ...other }), /本机交互式/);
  }
});
test('stop between permission and identity checks does not relaunch the driver', async () => {
  const { service, host, calls } = fixture(); let release;
  host.call = async name => { calls.push({ name }); return new Promise(resolve => { release = resolve; }); };
  const check = service.check(); await new Promise(resolve => setImmediate(resolve));
  await service.stop(); release({ structuredContent: {}, content: [] }); await check;
  assert.equal(calls.some(c => c.name === 'health_report'), false);
});
test('settings and approval IPC reject webviews and subframes', async () => {
  const handlers = new Map(); const mainFrame = {}; const sender = { mainFrame };
  createComputerUseFeature({ app: { whenReady: () => new Promise(() => {}) }, ipcMain: { handle: (n, h) => handlers.set(n, h) }, shell: {}, powerMonitor: {},
    getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }), resourcesRoot: '/unused', getSettings: () => ({}), saveSettings: () => {}, publish: () => {} });
  const handler = handlers.get('computer-use:status');
  assert.throws(() => handler({ sender: {}, senderFrame: mainFrame }), /主窗口/);
  assert.throws(() => handler({ sender, senderFrame: {} }), /主窗口/);
  assert.equal(handler({ sender, senderFrame: mainFrame }).enabled, false);
});

function permissionFixture(permissions) {
  const handlers = new Map(); const mainFrame = {}; const sender = { mainFrame };
  const opened = []; const revealed = []; const calls = [];
  const service = createComputerUseFeature({
    app: { isPackaged: false, getPath: () => '/test/Electron.app/Contents/MacOS/Electron', whenReady: async () => {} },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, powerMonitor: { on() {} },
    shell: { openExternal: async url => opened.push(url), showItemInFolder: file => revealed.push(file) },
    getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }), resourcesRoot: '/unused',
    getSettings: () => ({ enabled: true }), saveSettings: () => {}, publish: () => {},
    sdkLoader: async entry => { calls.push(entry); return { requestMacOSPermissions: () => { calls.push('request'); } }; },
  });
  service.check = async options => { calls.push(options); service.permissions = permissions; };
  const invoke = (name, payload) => handlers.get(`computer-use:${name}`)({ sender, senderFrame: mainFrame }, payload);
  return { service, invoke, opened, revealed, calls };
}
test('permission request opens the missing settings pane when macOS returns without a dialog', async () => {
  for (const accessibility of [false, true]) {
    const { invoke, opened, calls } = permissionFixture({ accessibility, screenRecording: false, hostIdentity: true });
    const result = await invoke('request-permissions');
    assert.deepEqual(calls, ['electron', 'request', { restart: true }]);
    assert.match(opened[0], accessibility ? /Privacy_ScreenCapture$/ : /Privacy_Accessibility$/);
    assert.match(result.permissionNotice, /已打开/);
    assert.doesNotMatch(result.permissionNotice, /Electron|开发模式|截图自检/);
  }
});
test('already-granted permissions give explicit feedback and do not reopen system settings', async () => {
  const { invoke, opened, revealed } = permissionFixture({ accessibility: true, screenRecording: true, hostIdentity: true });
  const result = await invoke('request-permissions');
  assert.equal(opened.length, 0);
  assert.match(result.permissionNotice, /两项系统权限均已开启/);
  assert.match(result.permissionNotice, /对话中操作应用/);
  await invoke('reveal-host-app', { path: '/untrusted.app' });
  assert.deepEqual(revealed, ['/test/Electron.app']);
});
test('permission request cannot restart the driver during active control', async () => {
  const { service, invoke, calls } = permissionFixture(null);
  service.owner = { id: 'active' };
  await assert.rejects(invoke('request-permissions'), /先结束当前控制/);
  assert.equal(calls.length, 0);
});
