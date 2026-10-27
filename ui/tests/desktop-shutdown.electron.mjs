import electron from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { AppEventBroker } from '../../packages/app-runtime/src/events/index.mjs';
import { registerProcessOutputErrorHandlers } from '../src/process-output.mjs';

const { app, BrowserWindow } = electron;
const directory = mkdtempSync(path.join(os.tmpdir(), 'moss-shutdown-'));
app.setPath('userData', directory);
registerProcessOutputErrorHandlers();
const source = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const runtimeEventStart = source.indexOf('    onEvent: (event) => {', source.indexOf('appRuntime = await createAppRuntime('));
const runtimeEventEnd = source.indexOf('\n    },\n  });\n  appRuntime.setAppToolBridge', runtimeEventStart);
const runtimeEventSource = source.slice(runtimeEventStart + '    onEvent: '.length, runtimeEventEnd) + '\n    }';
const quitSource = source.slice(source.indexOf("app.on('window-all-closed'"), source.indexOf("ipcMain.handle('agent:get-status'"));
const emitSource = source.slice(source.indexOf('function emitToRenderer('), source.indexOf('function emitSessionMeta('));
const watchdog = setTimeout(() => { console.error('Desktop shutdown smoke test timed out'); app.exit(1); }, 15_000);
const failures = [];
process.on('uncaughtException', error => { console.error(error); app.exit(1); });

app.whenReady().then(async () => {
  app.dock?.hide();
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
  await window.loadURL('data:text/html,<title>Shutdown test</title>');
  await window.webContents.executeJavaScript(`require('electron').ipcRenderer.on('shutdown-test', (_event, value) => require('electron').ipcRenderer.send('shutdown-test-reply', value)); true`);
  let shutdowns = 0;
  const context = {
    app, appQuitting: false, appQuitPending: false, appShutdownComplete: false, isWebHost: false, previewWindow: null,
    mainWindow: window, ipcMain: { publish() {} },
    mossLog: (...args) => failures.push(args),
    shutdownDesktop: async () => {
      shutdowns++;
      events.publish({ type: 'status', appId: 'test.app', state: 'stopping' });
      context.emitToRenderer('app:runtime-event', { state: 'stopping' });
      await new Promise(resolve => setImmediate(resolve));
      window.destroy();
      events.publish({ type: 'status', appId: 'test.app', state: 'stopped' });
      context.emitToRenderer('app:runtime-event', { state: 'stopped' });
    },
  };
  context.emitToRenderer = runInNewContext(`${emitSource}\nemitToRenderer`, context);
  const events = new AppEventBroker();
  events.on('event', runInNewContext(`(${runtimeEventSource})`, context));
  const reply = new Promise(resolve => window.webContents.once('ipc-message', (_event, channel, value) => {
    assert.equal(channel, 'shutdown-test-reply');
    resolve(value);
  }));
  context.emitToRenderer('shutdown-test', 'delivered');
  assert.equal(await reply, 'delivered');
  for (const stream of [process.stdout, process.stderr]) {
    for (const code of ['EIO', 'EPIPE']) stream.emit('error', Object.assign(new Error(`write ${code}`), { code }));
  }
  runInNewContext(quitSource, context);
  app.once('will-quit', () => {
    assert.equal(shutdowns, 1);
    assert.equal(context.appShutdownComplete, true);
    assert.equal(window.isDestroyed(), true);
    assert.deepEqual(failures, []);
    clearTimeout(watchdog);
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    console.log('Desktop shutdown verified: live IPC, repeated quit, destroyed renderer and detached output errors.');
  });
  app.quit();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
