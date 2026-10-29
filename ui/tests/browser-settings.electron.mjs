// Real packaged Apps + Desktop Core; all credentials and MCP data are isolated.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AppRuntimeHost } from '../../packages/app-runtime/src/host/index.mjs';
import { AppMcpHost } from '../src/apps/app-mcp-host.mjs';

const core = fileURLToPath(new URL('../..', import.meta.url)), apps = process.env.MOSS_APPS_ROOT || path.resolve(core, '../moss-apps');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-browser-settings-'));
const output = path.join(core, 'output/browser-settings');
process.env.MOSS_HOME = process.env.MOSS_CONFIG_DIR = temporary;
process.env.MOSS_RUNTIME_HOME ||= path.join(os.homedir(), '.moss/runtimes');
process.env.MOSS_OPEN_DEVTOOLS = 'false';
app.setAppPath(path.join(core, 'ui')); app.setPath('userData', path.join(temporary, 'electron'));
app.on('window-all-closed', () => {});
let win, runtime, mcpHost, inspections = 0;
const handle = AppMcpHost.prototype.handle;
AppMcpHost.prototype.handle = function (method, ...args) { mcpHost = this; if (method === 'servers.inspect') inspections++; return handle.call(this, method, ...args); };
const register = AppRuntimeHost.prototype.registerInstalled;
AppRuntimeHost.prototype.registerInstalled = function (...args) { runtime = this; return register.apply(this, args); };
const ready = new Promise(resolve => app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; window.showInactive = () => {};
  if (!win) { win = window; window.webContents.once('did-finish-load', resolve); }
}));
const js = fn => win.webContents.executeJavaScript(`(${fn})()`);
const waitFor = async (fn, label = String(fn)) => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) { if (await js(fn).catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Timed out: ' + label);
};
const click = selector => win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
const capture = async name => { await new Promise(resolve => setTimeout(resolve, 250)); await fs.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG()); };
const watchdog = setTimeout(() => { console.error('Browser settings test timed out'); app.exit(1); }, 180_000);
  await fs.mkdir(output, { recursive: true });
  const { publishAppFromBuild } = await import('../src/app-platform.mjs');
  for (const [directory, file] of [['browser-use', 'apps/browser-use/app.moss.json'], ['sequential-thinking', 'tool-apps/sequential-thinking/app.json']]) {
    const manifest = JSON.parse(await fs.readFile(path.join(apps, file), 'utf8'));
    const pkg = path.join(apps, 'artifacts', manifest.id, manifest.version, directory === 'browser-use' ? `package-${process.platform}-${process.arch}` : 'package');
    await publishAppFromBuild(pkg);
  }
  await import('../src/main.mjs');
async function run() {
try {
  await ready;
  win.setSize(1440, 1000);
  await waitFor(() => Boolean(document.querySelector('button[title="插件"]')));
  await click('button[title="插件"]');
  await waitFor(() => Boolean(document.querySelector('[aria-label="打开 分步思考"]')));
  await click('[aria-label="打开 分步思考"]');
  await waitFor(() => Boolean(document.querySelector('[data-app-details="moss.sequential-thinking"] [data-mcp-settings]:not(:disabled)')));
  assert.equal(await js(() => document.querySelectorAll('webview, iframe').length), 0);
  assert.equal(inspections, 0);
  await click('[data-mcp-settings]');
  await waitFor(() => Boolean(document.querySelector('aside form')));
  assert.equal(inspections, 0);
  await capture('thinking-settings');
  await click('[aria-label="关闭连接设置"]');
  await click('[aria-label="应用详情导航"] button');
  await waitFor(() => Boolean(document.querySelector('[aria-label="打开 网页操控"]')));
  await click('[aria-label="打开 网页操控"]');
  await waitFor(() => Boolean(document.querySelector('[data-app-details="moss.browser-use"]')));
  const openForm = async () => {
    await js(() => [...document.querySelectorAll('[data-app-details-entry]')].find(node => node.textContent === '浏览器连接设置').click());
    await waitFor(() => Boolean(document.querySelector('aside select[aria-label="浏览器模式"]')));
  };
  const changeMode = value => win.webContents.executeJavaScript(`(() => { const el = document.querySelector('aside select[aria-label="浏览器模式"]'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await openForm();
  assert.equal(await js(() => document.querySelector('aside select').value), 'managed');
  assert.equal(inspections, 0);
  await capture('managed-light');
  await changeMode('extension');
  await waitFor(() => Boolean(document.querySelector('input[aria-label="扩展连接令牌（可选）"]')));
  assert.equal(await js(() => document.querySelector('aside input[type=password]').value), '');
  await js(() => {
    const el = document.querySelector('aside input[type=password]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'isolated-fixture-token'); el.dispatchEvent(new Event('input', {bubbles:true}));
  });
  await capture('extension-light');
  await click('aside button[type=submit]');
  await waitFor(() => !document.querySelector('aside'));
  assert.equal(inspections, 0);
  await openForm();
  assert.equal(await js(() => document.querySelector('aside select').value), 'extension');
  assert.equal(await js(() => document.querySelector('aside input[type=password]').value), '');
  assert.equal(await js(() => document.querySelector('aside input[type=password]').placeholder), '已保存，留空保留');
  await changeMode('cdp');
  await waitFor(() => Boolean(document.querySelector('input[aria-label="CDP 地址"]')));
  await js(() => { const el = document.querySelector('input[aria-label="CDP 地址"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'http://127.0.0.1:9444'); el.dispatchEvent(new Event('input', {bubbles:true})); });
  await click('aside button[type=submit]');
  await waitFor(() => !document.querySelector('aside'));
  await openForm();
  assert.equal(await js(() => document.querySelector('input[aria-label="CDP 地址"]').value), 'http://127.0.0.1:9444');
  await changeMode('managed');
  await click('aside button[type=submit]');
  await waitFor(() => !document.querySelector('aside'));
  assert.equal(inspections, 0, 'opening or saving any browser mode must not connect MCP');
  const browserService = mcpHost.toolCatalog('moss.browser-use')[0];
  assert.equal(mcpHost.findServer(browserService.runtimeName).config.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN, 'isolated-fixture-token', 'mode switches retain the encrypted extension token');
  await click('[aria-label="MCP 服务"] [data-app-details-entry]');
  await waitFor(() => Boolean(document.querySelector('aside [data-mcp-inspect]')));
  await click('aside [data-mcp-inspect]');
  await waitFor(() => document.querySelectorAll('[data-mcp-tool]').length > 0, 'real Playwright tool catalog');
  assert.equal(inspections, 1);
  assert.equal(await fs.stat(path.join(temporary, 'browser-profiles')).then(() => true, () => false), false, 'inspection must not launch Chrome');
  const tools = await js(() => document.querySelectorAll('[data-mcp-tool]').length);
  await waitFor(() => !document.querySelector('[aria-label="关闭MCP 服务"]').disabled);
  await click('[aria-label="关闭MCP 服务"]');
  await openForm();
  await click('aside button[type=submit]');
  await waitFor(() => !document.querySelector('aside'));
  assert.equal(inspections, 1);
  assert.equal(await js(() => document.querySelectorAll('[data-mcp-tool]').length), tools, 'unchanged save retains the tool catalog');
  await openForm();
  win.setMinimumSize(400, 600); win.setSize(650, 900);
  await js(() => window.agentDesktop.updateSettings({ appearance: { themeMode: 'dark' } }));
  await waitFor(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await js(() => document.documentElement.scrollWidth <= innerWidth), true);
  await capture('managed-narrow');
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ passed: true, thinking: 'Core detail and settings, no connection on view', browser: 'managed/extension/CDP save and reload, token masked, explicit real inspection only', tools }, null, 2));
  console.log(`PASS: Sequential Thinking uses Core; browser modes and credentials persist without connecting; explicit check discovers ${tools} tools without launching Chrome.`);
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
  if (win && !win.isDestroyed()) { console.error((await js(() => document.body.innerText).catch(() => '')).slice(-5000)); await capture('failure').catch(() => {}); }
} finally {
  clearTimeout(watchdog); await runtime?.shutdown().catch(() => {});
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  app.exit(process.exitCode || 0);
}
}
void run();
