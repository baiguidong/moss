import assert from 'node:assert/strict';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { createServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { appServiceKey } from '../../packages/app-sdk/src/tool-services.mjs';
const uiRoot = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'moss-project-defaults-'));
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});
let server, window;
const timeout = setTimeout(() => { console.error('Project defaults UI timed out'); app.exit(1); }, 60_000);
async function run() {
try {
  server = await createServer({ root: uiRoot, configFile: path.join(uiRoot, 'vite.config.ts'), cacheDir: path.join(temp, 'vite'), server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  window = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: { backgroundThrottling: false } });
  const evaluate = code => window.webContents.executeJavaScript(code);
  const waitFor = async code => { for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error(`UI condition failed: ${code}`); };
  const click = async text => { await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)})).click()`); };
  const selection = async () => JSON.parse(await evaluate("document.querySelector('[data-selection]').textContent"));
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/project-defaults.html`);
  await waitFor("Boolean(document.querySelector('[aria-label=\"移除 客户服务 / 销售数据\"]'))");
  await click('选择资源');
  await waitFor("document.body.textContent.includes('已选 1 / 2')");
  await click('客户服务');
  await waitFor("document.body.textContent.includes('客户支持')");
  await click('客户支持');
  await waitFor("JSON.parse(document.querySelector('[data-selection]').textContent).appServiceIds.length === 2");
  assert.deepEqual((await selection()).appServiceIds, [appServiceKey('customer.app', 'sales'), appServiceKey('customer.app', 'support')]);
  await click('确定');
  await evaluate("document.querySelector('[aria-label=\"移除 客户服务 / 销售数据\"]').click()");
  await waitFor("JSON.parse(document.querySelector('[data-selection]').textContent).appServiceIds.length === 1");
  await click('选择资源');
  await waitFor("document.body.textContent.includes('已选 1 / 2')");
  await click('客户服务');
  await waitFor("document.body.textContent.includes('全选当前可用服务')");
  await click('全选当前可用服务');
  await waitFor("document.body.textContent.includes('清空服务选择')");
  await click('清空服务选择');
  await waitFor("JSON.parse(document.querySelector('[data-selection]').textContent).appServiceIds.length === 0");
  assert.deepEqual(await selection(), { appIds: [], appServiceIds: [] });
  console.log('PROJECT_DEFAULTS_UI_PASSED: saved selections, multi-select, remove, reopen, select-all and clear');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { clearTimeout(timeout); window?.destroy(); await server?.close(); await rm(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0); }
}
app.whenReady().then(run);
