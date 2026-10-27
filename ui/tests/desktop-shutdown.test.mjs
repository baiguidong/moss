import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { AppEventBroker } from '../../packages/app-runtime/src/events/index.mjs';

const source = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const emitSource = source.slice(source.indexOf('function emitToRenderer('), source.indexOf('function emitSessionMeta('));
const quitSource = source.slice(source.indexOf("app.on('before-quit'"), source.indexOf("ipcMain.handle('agent:get-status'"));
const runtimeEventStart = source.indexOf('    onEvent: (event) => {', source.indexOf('appRuntime = await createAppRuntime('));
const runtimeEventEnd = source.indexOf('\n    },\n  });\n  appRuntime.setAppToolBridge', runtimeEventStart);
assert.ok(runtimeEventStart > 0 && runtimeEventEnd > runtimeEventStart);
const runtimeEventSource = source.slice(runtimeEventStart + '    onEvent: '.length, runtimeEventEnd) + '\n    }';

function fixture() {
  const sent = [];
  const published = [];
  const context = {
    appQuitting: false,
    appQuitPending: false, isWebHost: false, previewWindow: null,
    mainWindow: {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        mainFrame: { isDestroyed: () => false },
        send: (...args) => sent.push(args),
      },
    },
    ipcMain: { publish: (...args) => published.push(args) },
    mossLog: () => {},
  };
  context.emitToRenderer = runInNewContext(`${emitSource}\nemitToRenderer`, context);
  return { context, sent, published };
}

test('renderer events reach the live window and the host event subscribers', () => {
  const { context, sent, published } = fixture();
  const payload = { state: 'running' };
  context.emitToRenderer('app:runtime-event', payload);
  assert.deepEqual(sent, [['app:runtime-event', payload]]);
  assert.deepEqual(published, sent);
});

for (const state of ['quitting', 'no-window', 'window-destroyed', 'contents-destroyed', 'frame-destroyed', 'send-throws']) {
  test(`renderer events skip an unavailable desktop (${state}) and preserve host publishing`, () => {
    const { context, sent, published } = fixture();
    if (state === 'quitting') context.appQuitting = true;
    if (state === 'no-window') context.mainWindow = null;
    if (state === 'window-destroyed') context.mainWindow.isDestroyed = () => true;
    if (state === 'contents-destroyed') {
      context.mainWindow.webContents.isDestroyed = () => true;
      Object.defineProperty(context.mainWindow.webContents, 'mainFrame', { get() { throw new Error('Object has been destroyed'); } });
    }
    if (state === 'frame-destroyed') context.mainWindow.webContents.mainFrame.isDestroyed = () => true;
    if (state === 'send-throws') context.mainWindow.webContents.send = () => { throw Object.assign(new Error('Object has been destroyed'), { code: 'ERR_IPC_CHANNEL_CLOSED' }); };
    context.emitToRenderer('app:runtime-event', { state: 'stopped' });
    assert.deepEqual(sent, []);
    assert.equal(published.length, 1);
  });
}

test('quit suppresses runtime UI events before cleanup starts, during cleanup and after it completes', async () => {
  const { context, sent } = fixture();
  const runtimeEvents = new AppEventBroker();
  runtimeEvents.on('event', runInNewContext(`(${runtimeEventSource})`, context));
  let finish;
  const cleanup = new Promise(resolve => { finish = resolve; });
  let didQuit;
  const quit = new Promise(resolve => { didQuit = resolve; });
  let beforeQuit;
  let shutdowns = 0;
  let quits = 0;
  let prevented = 0;
  const stopping = () => runtimeEvents.publish({ type: 'status', appId: 'test.app', state: 'stopping' });
  Object.assign(context, {
    appShutdownComplete: false,
    app: {
      on: (_name, listener) => { beforeQuit = listener; },
      quit: () => {
        quits++;
        beforeQuit({ preventDefault: () => { prevented++; } });
        didQuit();
      },
    },
    shutdownDesktop: async () => {
      shutdowns++;
      stopping();
      context.emitToRenderer('agent:state', { phase: 'stopping' });
      await cleanup;
      stopping();
    },
    mossLog: () => assert.fail('Shutdown should not fail'),
  });
  runInNewContext(quitSource, context);
  beforeQuit({ preventDefault: () => { prevented++; } });
  beforeQuit({ preventDefault: () => { prevented++; } });
  assert.equal(context.appQuitting, true);
  assert.equal(context.appShutdownComplete, false);
  assert.deepEqual(sent, []);
  finish();
  await quit;
  stopping();
  context.emitToRenderer('agent:state', { phase: 'stopped' });
  assert.deepEqual(sent, []);
  assert.equal(shutdowns, 1);
  assert.equal(quits, 1);
  assert.equal(prevented, 2);
  assert.equal(context.appShutdownComplete, true);
});

test('new work is rejected while quitting even before update installation begins', () => {
  const guardSource = source.slice(source.indexOf('function assertUpdateWorkAllowed()'), source.indexOf('function shutdownDesktop()'));
  const context = { appQuitting: false, appQuitPending: false, webServer: null, updateInstallPreparation: { isPreparing: () => false } };
  const assertAllowed = runInNewContext(`${guardSource}\nassertUpdateWorkAllowed`, context);
  assert.doesNotThrow(assertAllowed);
  context.appQuitting = true;
  assert.throws(assertAllowed, /退出/);
  context.appQuitting = false;
  context.appQuitPending = true;
  assert.throws(assertAllowed, /退出/);
  context.appQuitPending = false;
  assert.doesNotThrow(assertAllowed);
});

test('a failed desktop shutdown stays alive and allows a clean retry', async () => {
  let beforeQuit;
  let shutdowns = 0;
  let quits = 0;
  const context = {
    appQuitting: false,
    appQuitPending: false,
    appShutdownComplete: false,
    isWebHost: false,
    previewWindow: null,
    app: {
      on: (_name, listener) => { beforeQuit = listener; },
      quit: () => { quits++; },
    },
    closeWindowBeforeQuit: async () => true,
    shutdownDesktop: async () => {
      shutdowns++;
      if (shutdowns === 1) throw new Error('backend did not stop');
    },
    mossLog: () => {},
  };
  runInNewContext(quitSource, context);
  beforeQuit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shutdowns, 1);
  assert.equal(quits, 0);
  assert.equal(context.appQuitting, false);
  assert.equal(context.appShutdownComplete, false);
  beforeQuit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shutdowns, 2);
  assert.equal(quits, 1);
  assert.equal(context.appShutdownComplete, true);
});

for (const phase of ['pending', 'quitting']) test(`closing all windows while ${phase} does not start a second round of session cleanup`, () => {
  const closeSource = source.slice(source.indexOf("app.on('window-all-closed'"), source.indexOf("app.on('before-quit'"));
  let onClose;
  runInNewContext(closeSource, {
    appQuitting: phase === 'quitting', appQuitPending: phase === 'pending', isWebHost: false, selfTestTarget: null,
    app: { on: (_name, listener) => { onClose = listener; } },
    computerUseService: { stop: () => assert.fail('Cleanup is already owned by shutdownDesktop') },
  });
  assert.doesNotThrow(() => onClose());
});
