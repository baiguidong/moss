// Run after build:renderer: electron tests/renderer-startup.electron.mjs
import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-renderer-startup-'));
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'moss-media', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
} }]);
const windows = [];
const failures = [];
const watchdog = setTimeout(() => { console.error('Renderer startup timed out', failures); app.exit(1); }, 60_000);

async function until(window, expression, message) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`${message}: ${await window.webContents.executeJavaScript('document.body.innerText')}\n${failures.join('\n')}`);
}

async function open(kind, preload = `${kind === 'terminal' ? 'terminal-' : ''}preload.mjs`) {
  const window = new BrowserWindow({ show: false, width: 1080, height: 760, webPreferences: {
    ...(preload ? { preload: path.join(root, 'src', preload) } : {}),
    contextIsolation: true, nodeIntegration: false, sandbox: false,
  } });
  windows.push(window);
  window.webContents.on('preload-error', (_event, _path, error) => failures.push(String(error)));
  window.webContents.on('console-message', ({ level, message }) => { if (level === 'error') failures.push(message); });
  await window.loadFile(path.join(root, 'dist/renderer/index.html'), { query: { window: kind } });
  return window;
}

app.whenReady().then(async () => {
  let starts = 0;
  ipcMain.handle('terminal:start', () => {
    starts++;
    return { title: 'Startup fixture', cwd: temp, shell: '/bin/sh', status: 'running', buffer: 'terminal bridge connected\r\n' };
  });
  for (const method of ['write', 'resize', 'stop']) ipcMain.handle(`terminal:${method}`, () => ({ ok: true }));
  ipcMain.handle('agent:get-settings', () => ({}));
  const zip = new JSZip();
  zip.file('preview-regression.txt', 'Archive preview loaded successfully.');
  const archive = await zip.generateAsync({ type: 'nodebuffer' });
  let archiveReads = 0;
  protocol.handle('moss-media', () => {
    archiveReads++;
    return new Response(archive, { headers: { 'Content-Type': 'application/zip', 'Access-Control-Allow-Origin': '*' } });
  });
  ipcMain.handle('preview.ready', event => {
    event.sender.send('preview.open', { file: {
      path: path.join(temp, 'preview.zip'), relativePath: 'preview.zip', content: '',
      contentType: 'ofv', mimeType: 'application/zip', metadata: { previewEditable: false },
    } });
    return { ok: true };
  });

  const terminal = await open('terminal');
  await until(terminal, 'document.querySelector(".xterm-screen") && document.body.innerText.includes("运行中")', 'Terminal did not start');
  assert.equal(starts, 1);
  assert.deepEqual(await terminal.webContents.executeJavaScript('({ desktop: !!window.agentDesktop, terminal: !!window.mossTerminal, web: !!window.mossWeb })'),
    { desktop: false, terminal: true, web: false });

  const preview = await open('preview');
  await until(preview, 'document.body.innerText.includes("preview-regression.txt")', 'ZIP preview did not load');
  assert.ok(archiveReads > 0);
  assert.equal(await preview.webContents.executeJavaScript('!!window.agentDesktop && !window.mossWeb'), true);
  assert.deepEqual(failures, []);

  const missingBridge = await open('preview', null);
  await until(missingBridge, 'document.body.innerText.includes("桌面连接未初始化")', 'Missing bridge error was not explained');
  assert.equal(await missingBridge.webContents.executeJavaScript('document.body.innerText.includes("Failed to fetch")'), false);
  console.log('PASS: desktop terminal startup, ZIP preview, and missing desktop bridge diagnostics');
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); }).finally(() => {
  clearTimeout(watchdog);
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
});
app.on('quit', () => { void fs.rm(temp, { recursive: true, force: true }); });
