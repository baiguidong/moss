import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'vite';
import { normalizeDesktopSettings } from '../src/desktop-settings.mjs';
const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'moss-login-ui-'));
app.setPath('userData', path.join(temp, 'profile')); app.on('window-all-closed', () => {});
let server, window;
const timeout = setTimeout(() => { console.error('Login UI timed out'); app.exit(1); }, 60000);
async function run() {
try {
  await app.whenReady();
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(temp, 'vite'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['tests/fixtures/server-login.html'] },
    plugins: [{ name: 'login-fixture', configureServer(vite) { vite.middlewares.use('/login-fixture-settings', (_req, res) => {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(normalizeDesktopSettings({ enterpriseEnabled: true, enterpriseAccountServerUrl: '' })));
    }); } }],
  });
  await server.listen();
  window = new BrowserWindow({ show: false, width: 1320, height: 900, webPreferences: { backgroundThrottling: false } });
  const evaluate = code => window.webContents.executeJavaScript(code);
  const until = async code => { for (let i = 0; i < 150; i++) { if (await evaluate(code)) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error(`Missing UI: ${code}`); };
  const click = text => evaluate(`[...document.querySelectorAll('button,[role="menuitem"]')].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/server-login.html`);
  await until("!!document.querySelector('[aria-label=\"个人中心\"]')");
  await evaluate("document.querySelector('[aria-label=\"个人中心\"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }))");
  await until("!!document.querySelector('[role=menuitem]')");
  await click('登录 Moss Server');
  await until("!!document.querySelector('dialog[open] #server-login-address')");
  assert.equal(await evaluate('loginEvidence.calls'), 0);
  await click('继续登录');
  await until("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('请先填写')");
  assert.equal(await evaluate('loginEvidence.calls'), 0);
  await evaluate("{ const input = document.querySelector('#server-login-address'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'moss.example.test'); input.dispatchEvent(new Event('input', { bubbles: true })); }");
  await click('继续登录');
  await until("!!document.querySelector('dialog[open] [role=status]')");
  assert.equal(await evaluate('loginEvidence.calls'), 1);
  assert.equal(await evaluate('loginEvidence.address'), 'https://moss.example.test');
  await evaluate("loginEvidence.reject(new Error(\"Error invoking remote method 'agent:remote-authenticate': Error: net::ERR_CONNECTION_REFUSED\"))");
  await until("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('无法连接 Moss Server')");
  await writeFile('/tmp/moss-server-login-error.png', (await window.webContents.capturePage()).toPNG());
  await evaluate("{ const input = document.querySelector('#server-login-address'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '10.0.1.181'); input.dispatchEvent(new Event('input', { bubbles: true })); }");
  await click('继续登录');
  await until('loginEvidence.calls === 2');
  assert.equal(await evaluate('loginEvidence.address'), 'https://10.0.1.181');
  await click('取消登录');
  await until("!document.querySelector('dialog[open]')");
  assert.equal(await evaluate('loginEvidence.cancels'), 1);
  // The settings entry must use the same state, cancellation and error dialog.
  await click('开始认证');
  await until("!!document.querySelector('dialog[open] #server-login-address')");
  await evaluate("{ const input = document.querySelector('#server-login-address'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'https://moss.example.test'); input.dispatchEvent(new Event('input', { bubbles: true })); }");
  await click('继续登录');
  await until('loginEvidence.calls === 3');
  await evaluate("loginEvidence.reject(new Error('登录页面加载超时，请检查网络后重试。'))");
  await until("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('超时')");
  await click('重新登录');
  await until('loginEvidence.calls === 4');
  await evaluate("loginEvidence.resolve({ enterpriseAccountServerUrl: 'https://moss.example.test', enterpriseAccountApiKey: 'test', enterpriseAccountUserName: 'Test User' })");
  await until("!document.querySelector('dialog[open]') && document.querySelector('[data-auth-state]').textContent === 'success'");
  console.log('PASS: unconfigured personal center and settings open a login page with an editable address, then show progress, visible errors, retry, cancel, and success');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { clearTimeout(timeout); window?.destroy(); await server?.close(); await rm(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0); }
}
void run();
