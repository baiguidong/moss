import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-connector-authorization-'));
app.setPath('userData', path.join(temp, 'profile'));
let server, win;
const watchdog = setTimeout(() => app.exit(1), 45_000);
app.whenReady().then(async () => {
try {
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(temp, 'vite'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
  await server.listen();
  win = new BrowserWindow({ show: false, width: 1100, height: 800 });
  const evaluate = fn => win.webContents.executeJavaScript(`(${fn})()`);
  const until = async fn => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(fn)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('UI condition timed out: ' + fn);
  };
  await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/connector-authorization.html`);
  await until(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '重新授权' && !button.disabled));
  await evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '重新授权').click());
  await until(() => window.__authorization.calls.some(([kind, payload]) => kind === 'connector' && payload.action === 'auth'));
  let state = await evaluate(() => window.__authorization);
  assert.equal(state.activeSessionId, 'authorization-1');
  assert.equal(state.calls.find(([kind, payload]) => kind === 'connector' && payload.action === 'auth')[1].sessionId, 'authorization-1');
  assert.equal(state.calls.find(([kind]) => kind === 'create')[1].title, '百度网盘授权');
  await evaluate(() => {
    window.__authorization.activeSessionId = 'esp32-project';
    [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '管理').click();
  });
  await until(() => Boolean(document.querySelector('[data-app-connector]')));
  await evaluate(() => [...document.querySelectorAll('[data-app-connector] button')].find(button => button.textContent.trim() === '重新授权').click());
  await until(() => window.__authorization.calls.filter(([kind, payload]) => kind === 'connector' && payload.action === 'auth').length === 2);
  state = await evaluate(() => window.__authorization);
  assert.equal(state.activeSessionId, 'authorization-2');
  assert.deepEqual(state.calls.filter(([kind, payload]) => kind === 'connector' && payload.action === 'auth').map(([, payload]) => payload.sessionId), ['authorization-1', 'authorization-2']);
  assert.deepEqual(state.calls.filter(([kind]) => kind === 'status').map(([, payload]) => payload.sessionId), ['authorization-1', 'authorization-2']);
  console.log('PASS: App card and management reauthorization each create and use a new session.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  win?.destroy();
  await server?.close();
  await fs.rm(temp, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
}
});
