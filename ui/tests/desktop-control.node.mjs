import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopControlSession, normalizeDesktopControlSettings } from '../../packages/app-runtime/src/desktop-control/session.mjs';
import { createDesktopControlFeature } from '../src/desktop-control/feature.mjs';
import { createSessionApps } from '../src/apps/session-apps.mjs';

const session = { id: 'one', appIds: ['test.control'], originChannel: 'desktop' };
function fixture(requestAccess = async () => 'session') {
  let settings = { enabled: true, apps: [] }, stops = 0;
  const broker = new DesktopControlSession({ getSettings: () => settings, saveSettings: v => { settings = v; }, requestAccess });
  broker.adapter = { stop: async () => { stops++; }, finish: async () => {}, status: () => ({ supported: true }) };
  return { broker, stops: () => stops };
}
test('lease rejects concurrent, unattended and remote callers', async () => {
  const { broker } = fixture();
  await broker.run(session, undefined, async () => {});
  await assert.rejects(broker.run({ id: 'two' }, undefined, async () => {}), /另一个/);
  for (const extra of [{ agentMode:'remote-direct' },{ sessionKind:'cron' },{ isSubAgent:true },{ parentSessionId:'parent' },{ activeAgentMailTurn:{} },{ originChannel:'mail' }]) {
    await assert.rejects(broker.run({ ...session, ...extra }, undefined, async () => {}), /本机交互式/);
  }
});
test('stop invalidates pending grants and stale results; a new turn is required', async () => {
  let allow; const { broker, stops } = fixture(() => new Promise(resolve => { allow = resolve; }));
  const run = broker.run(session, undefined, (signal, epoch) => broker.authorize(session, { bundleId:'com.test', name:'Test' }, false, signal, epoch));
  await broker.stop(); allow('always');
  await assert.rejects(run, /已停止/); assert.equal(stops(), 1); assert.deepEqual(broker.settings().apps, []);
  await assert.rejects(broker.run(session, undefined, async () => {}), /已停止/);
  broker.beginTurn(session.id); await broker.run(session, undefined, async () => {});
});
test('foreground grant expires on finish, session grants expire on disposal', async () => {
  const requests = []; const { broker } = fixture(async value => { requests.push(value.foreground); return 'session'; });
  const run = () => broker.run(session, undefined, async (signal, epoch) => {
    await broker.authorize(session, { bundleId:'com.test' }, true, signal, epoch);
  });
  await run(); await broker.finish(session.id); await run();
  assert.deepEqual(requests, [true,true]);
  await broker.disposeSession(session.id); assert.equal(broker.sessionGrants.size, 0);
});
test('a failed stop prevents restart even on the next turn', async () => {
  const { broker } = fixture(); broker.adapter.stop = async () => { throw new Error('driver hung'); };
  await broker.run(session, undefined, async () => {});
  await assert.rejects(broker.stop(), /hung/); broker.beginTurn(session.id);
  await assert.rejects(broker.run(session, undefined, async () => {}), /已停止/);
});
test('deselecting an App updates authorization before waiting for stop and persists on failure', async () => {
  const record = { ...session, runtime: {}, busy: true }; const events = [];
  const apps = createSessionApps({ getRuntime: () => ({}), getMcpHost: () => null, isBusy: () => true,
    disposeRuntime() {}, persist: () => events.push('persist'), emit: () => events.push('emit'),
    onRemoved: async (_record, removed) => { assert.deepEqual(record.appIds, []); assert.deepEqual(removed, ['test.control']); throw new Error('stop failed'); } });
  await assert.rejects(apps.update(record, []), /stop failed/);
  assert.deepEqual(events, ['persist','emit']); assert.deepEqual(record.appIds, []);
});
function featureFixture(permissions = { accessibility: true, screenRecording: true, hostIdentity: true }) {
  const handlers = new Map(), events = new Map(), calls = [], opened = [];
  let control, settings = { enabled: true, apps: [] };
  const installation = { enabled: true, activeVersion:'1.0.0', grants:['desktop:control'] };
  const pkg = { root:'/verified', manifest:{ id:'test.control', version:'1.0.0', nativeAdapter:{entry:'entry.mjs'} } };
  const sender = { mainFrame:{} };
  const feature = createDesktopControlFeature({
    app: { whenReady: async () => {}, getPath: () => '/test/Moss.app/Contents/MacOS/Moss' },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, powerMonitor: { on: (name, fn) => events.set(name, fn) },
    shell: { openExternal: async url => opened.push(url), showItemInFolder: path => opened.push(path) },
    getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }), getRuntime: () => ({ installations:new Map([['test.control',installation]]) }),
    getSettings: () => settings, saveSettings: value => { settings = value; }, publish() {},
    loadModule: async () => ({ createAdapter: options => {
      control = options.control;
      return { status: () => ({ supported:true, permissions }), check: async () => calls.push('check'), stop: async () => calls.push('stop'), finish: async () => {},
        requestPermissions: async () => calls.push('request'), invokeTool: async (_action, _input, session, signal) => control.run(session, signal, async () => 'ok') };
    } }),
  });
  const invoke = (operation, input = {}) => feature.settings(pkg, { operation, ...input }, { assertCurrent() {} });
  return { feature, control: () => control, pkg, handlers, sender, events, calls, opened, installation, invoke };
}
test('only the main frame can decide grants; App settings cannot issue decisions', async () => {
  const { handlers, sender, invoke } = featureFixture(); const handler = handlers.get('computer-use:status');
  assert.throws(() => handler({ sender:{}, senderFrame:sender.mainFrame }), /主窗口/);
  assert.throws(() => handler({ sender, senderFrame:{} }), /主窗口/);
  assert.equal((await handler({ sender, senderFrame:sender.mainFrame })).enabled, true);
  await assert.rejects(invoke('decide'), /不支持/);
});
test('system permission requests give feedback and reject active control', async () => {
  const f = featureFixture({ accessibility:false, screenRecording:false });
  const status = await f.invoke('request-permissions');
  assert.deepEqual(f.calls, ['request','check']); assert.match(f.opened[0], /Privacy_Accessibility/); assert.match(status.permissionNotice, /已打开/);
  await f.feature.invoke(f.pkg, 'test', {}, {sessionRecord:session});
  await assert.rejects(f.invoke('request-permissions'), /先结束/);
});
test('locking, deselection, deactivation and changed versions stop or reject control', async () => {
  const f = featureFixture(); await f.feature.invoke(f.pkg,'test',{}, {sessionRecord:session});
  f.events.get('lock-screen')(); await f.feature.stop();
  assert.ok(f.calls.includes('stop'));
  f.events.get('unlock-screen')(); f.feature.beginTurn(session.id);
  await f.feature.invoke(f.pkg,'test',{}, {sessionRecord:session});
  await f.feature.removedFromSession(session.id,['test.control']); assert.equal(f.feature.owner,null);
  await assert.rejects(f.feature.invoke(f.pkg,'test',{}, {sessionRecord:{...session,appIds:[]}}), /移出/);
  f.installation.enabled = false; await f.feature.deactivate('test.control');
  await assert.rejects(f.feature.invoke(f.pkg,'test',{}, {sessionRecord:session}), /停用/);
  f.installation.enabled = true; f.installation.activeVersion = '2.0.0';
  await assert.rejects(f.feature.invoke({...f.pkg,manifest:{...f.pkg.manifest,version:'2.0.0'}},'test',{}, {sessionRecord:session}), /重启/);
});
test('settings normalize legacy application grants without accepting arbitrary fields', () => {
  assert.deepEqual(normalizeDesktopControlSettings({ enabled:true, apps:[{bundleId:'../invalid'},{bundleId:'com.test', name:'Test', arbitrary:true}] }),
    { version:1, enabled:true, apps:[{bundleId:'com.test', name:'Test'}] });
});

test('native subservice removal stops control and cannot fall back to whole-App selection', async () => {
  const f = featureFixture(); f.pkg.manifest.toolSelection = 'services';
  const record = { ...session, appIds: [], appServiceIds: ['["test.control","windows"]'] };
  await f.feature.invoke(f.pkg, 'test', {}, { sessionRecord: record });
  const apps = createSessionApps({ getRuntime: () => ({}), getMcpHost: () => null, isBusy: () => false,
    disposeRuntime() {}, persist() {}, emit() {}, onRemoved: (record, removed) => f.feature.removedFromSession(record.id, removed) });
  await apps.update(record, { appIds: [], appServiceIds: [] });
  assert.equal(f.feature.owner, null); assert.ok(f.calls.includes('stop'));
  await assert.rejects(f.feature.invoke(f.pkg, 'test', {}, { sessionRecord: { ...record, appIds: ['test.control'] } }), /移出/);
});
