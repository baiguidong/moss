import electron from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { closeWindowBeforeQuit } from '../src/desktop-quit.mjs';

const { app, BrowserWindow } = electron;
const directory = mkdtempSync(path.join(os.tmpdir(), 'moss-quit-cancel-'));
app.setPath('userData', directory);
const source = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const quitSource = source.slice(source.indexOf("app.on('before-quit'"), source.indexOf("ipcMain.handle('agent:get-status'"));
const fail = error => { console.error(error); app.exit(1); };
const watchdog = setTimeout(() => fail(new Error('Quit cancellation test timed out')), 15_000);
process.on('uncaughtException', fail);
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  app.dock?.hide();
  const main = new BrowserWindow({ show: false });
  const preview = new BrowserWindow({ show: false });
  await main.loadURL('data:text/html,<title>Main</title>');
  await preview.loadURL('data:text/html,<title>Dirty preview</title>');
  await preview.webContents.executeJavaScript("window.onbeforeunload = event => { event.preventDefault(); event.returnValue = ''; }; true");
  // Keep the integration test invisible while exercising the real close veto.
  preview.show = () => {};
  preview.focus = () => {};
  let shutdowns = 0;
  const context = {
    app, appQuitting: false, appQuitPending: false, appShutdownComplete: false, isWebHost: false,
    previewWindow: preview, closeWindowBeforeQuit,
    shutdownDesktop: async () => { shutdowns++; },
    mossLog: (...args) => fail(new Error(JSON.stringify(args))),
  };
  runInNewContext(quitSource, context);
  preview.webContents.once('will-prevent-unload', () => {
    setImmediate(async () => {
      try {
        assert.equal(shutdowns, 0, 'Canceled quit must preserve running services');
        assert.equal(main.isDestroyed(), false, 'Main window must survive a canceled quit');
        assert.equal(context.appQuitting, false);
        assert.equal(context.appQuitPending, false);
        await preview.webContents.executeJavaScript('window.onbeforeunload = null; true');
        app.once('will-quit', () => {
          assert.equal(shutdowns, 1);
          assert.equal(context.appShutdownComplete, true);
          assert.equal(preview.isDestroyed(), true);
          clearTimeout(watchdog);
          rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
          console.log('Canceled quit preserves services; retry after saving shuts down once.');
        });
        app.quit();
        app.quit();
      } catch (error) { fail(error); }
    });
  });
  app.quit();
  app.quit();
}).catch(fail);
