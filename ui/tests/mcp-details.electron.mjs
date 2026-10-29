// Isolated Desktop + DBX runtime + native Core MCP details (no App UI).
// Never opens a user's database or sends a model request.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AppRuntimeHost } from '../../packages/app-runtime/src/host/index.mjs';
import { AppMcpHost } from '../src/apps/app-mcp-host.mjs';
import { generateMcpApp } from '../../packages/app-runtime/src/packages/generate-mcp-app.mjs';

const core = fileURLToPath(new URL('../..', import.meta.url));
const source = process.env.MOSS_DBX_PACKAGE || path.join(os.homedir(), '.moss/apps/moss.dbx/versions/0.1.1');
const output = path.join(core, 'output/dbx-details');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-dbx-details-'));
process.env.MOSS_HOME = process.env.MOSS_CONFIG_DIR = root;
process.env.MOSS_RUNTIME_HOME ||= path.join(os.homedir(), '.moss/runtimes');
process.env.MOSS_OPEN_DEVTOOLS = 'false';
app.setAppPath(path.join(core, 'ui'));
app.setPath('userData', path.join(root, 'electron'));
app.on('window-all-closed', () => {});
let runtime, win, mcpHost;
let inspections = 0;
const refresh = AppMcpHost.prototype.refresh;
AppMcpHost.prototype.refresh = function (...args) { mcpHost = this; return refresh.apply(this, args); };
const handle = AppMcpHost.prototype.handle;
AppMcpHost.prototype.handle = function (method, ...args) { if (method === 'servers.inspect') inspections++; return handle.call(this, method, ...args); };
const registered = AppRuntimeHost.prototype.registerInstalled;
AppRuntimeHost.prototype.registerInstalled = function (...args) { runtime = this; return registered.apply(this, args); };
const ready = new Promise(resolve => app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; window.showInactive = () => {};
  if (!win) { win = window; win.webContents.once('did-finish-load', resolve); }
}));
const js = source => win.webContents.executeJavaScript(source);
const waitFor = async (operation, label) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { if (await operation().catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
};
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
const clickText = text => js(`[...document.querySelectorAll('button')].find(el => el.offsetParent && el.textContent.trim() === ${JSON.stringify(text)}).click()`);
const capture = async name => {
  await new Promise(resolve => setTimeout(resolve, 200));
  await fs.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
};
const checks = [], mark = message => { checks.push(message); console.log('PASS', message); };
const watchdog = setTimeout(() => { console.error('DBX details verification timed out'); app.exit(1); }, 180_000);
await fs.mkdir(output, { recursive: true });
const appSource = path.join(process.env.MOSS_APPS_ROOT || path.resolve(core, '../moss-apps'), 'tool-apps/dbx');
const definition = JSON.parse(await fs.readFile(path.join(appSource, 'app.json'), 'utf8'));
const packageRoot = path.join(root, 'package');
await generateMcpApp({ definition, resourcesDir: path.join(appSource, 'resources'), runtimeDir: path.join(source, 'runtime'), destination: packageRoot });
const { publishAppFromBuild } = await import('../src/app-platform.mjs');
await publishAppFromBuild(packageRoot);
await import('../src/main.mjs');
async function run() {
try {
  await ready;
  win.setSize(1440, 1000);
  await waitFor(() => js('Boolean(document.querySelector(\'button[title="插件"]\'))'), 'plugins navigation');
  await click('button[title="插件"]');
  await waitFor(() => js('Boolean(document.querySelector(\'[aria-label="打开 DBX MCP"]\'))'), 'Common DBX card');
  await click('[aria-label="打开 DBX MCP"]');
  await waitFor(() => js('Boolean(document.querySelector(\'[data-app-details="moss.dbx"]\'))'), 'DBX information page');
  assert.equal(await js('document.querySelectorAll("webview").length'), 0);
  assert.equal(await js('document.querySelectorAll(\'[aria-label="试用示例"] button\').length'), 3);
  await capture('overview-light');
  mark('Common opens DBX details with package examples, without opening a connection');
  await waitFor(() => js('document.querySelector("[data-mcp-status]")?.textContent === "使用时连接"'), 'native MCP details');
  assert.equal(inspections, 0, 'opening details must not start MCP');
  assert.equal(await js('document.querySelectorAll("webview, iframe").length'), 0);
  const rpc = async (method, input = {}) => js(`(async () => {
    const app = (await window.agentDesktop.listApps()).find(item => item.id === 'moss.dbx');
    return window.agentDesktop.manageAppMcp({ appId: app.id, instanceId: app.mcpServices[0].instanceId, version: app.currentVersion, method: ${JSON.stringify(method)}, input: ${JSON.stringify(input)} });
  })()`);
  const reopen = async () => {
    await click('[aria-label="应用详情导航"] button');
    await waitFor(() => js(`Boolean(document.querySelector('[aria-label="打开 DBX MCP"]'))`), 'DBX card');
    await click('[aria-label="打开 DBX MCP"]');
    await waitFor(() => js('document.querySelector("[data-mcp-status]") && document.querySelector("[data-mcp-status]").textContent !== "正在读取状态"'), 'read cached status');
  };
  const initial = (await rpc('servers.list')).servers[0];
  await rpc('servers.save', { name: initial.name, previousName: initial.name, enabled: false,
    config: { ...initial.config, disabledTools: ['dbx_execute_query'] } });
  await reopen();
  const openSettings = async () => {
    await click('[data-mcp-settings]');
    await waitFor(() => js('Boolean(document.querySelector(\'aside[aria-label="连接设置"] form\'))'), 'native connection settings side panel');
  };
  await js(`(() => { const el=document.querySelector('[aria-label="工具使用范围"]'); el.value="global-always";el.dispatchEvent(new Event("change",{bubbles:true})); })()`);
  await waitFor(() => Promise.resolve(runtime.getToolScope('moss.dbx') === 'global' && runtime.getToolLoading('moss.dbx') === 'always'), 'outer tool loading setting');
  await openSettings();
  assert.equal(await js('document.querySelectorAll(\'aside[aria-label="连接设置"] [role=switch], dialog[open]\').length'), 0);
  assert.equal(await js('document.querySelector(\'aside[aria-label="连接设置"]\').textContent.includes("排除工具")'), false);
  assert.equal(await js('document.querySelector(\'aside[aria-label="连接设置"]\').textContent.includes("工具使用范围")'), false);
  assert.ok(await js('document.querySelector(\'aside[aria-label="连接设置"]\').getBoundingClientRect().left > document.querySelector("[data-mcp-management]").getBoundingClientRect().left'));
  const profile = path.join(root, 'dbx-data');
  await fs.mkdir(profile, { mode: 0o700 });
  const keyFile = path.join(profile, 'test.key');
  await fs.writeFile(keyFile, randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
  const edit = (label, value) => js(`(() => { const el=document.querySelector('input[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const env = { DBX_DATA_DIR: profile, DBX_SECRET_KEY_FILE: keyFile, DBX_MCP_ALLOW_WRITES: '0' };
  let row = 0;
  for (const [name, value] of Object.entries(env)) {
    await clickText('添加环境变量');
    row++;
    await edit(`dbx 环境变量 ${row} 名称`, name);
    await edit(`dbx 环境变量 ${row} 值`, value);
  }
  await capture('connection-settings');
  await click('aside[aria-label="连接设置"] button[type=submit]');
  await waitFor(() => js('!document.querySelector(\'aside[aria-label="连接设置"]\')'), 'save connection settings');
  assert.equal(inspections, 0, 'saving must not start MCP');
  const preserved = (await rpc('servers.list')).servers[0];
  assert.equal(preserved.enabled, false);
  assert.deepEqual(preserved.config.disabledTools, ['dbx_execute_query']);
  assert.deepEqual(preserved.config.env, Object.fromEntries(Object.keys(env).map(name => [name, ''])));
  assert.equal(runtime.getToolScope('moss.dbx'), 'global');
  assert.equal(runtime.getToolLoading('moss.dbx'), 'always');
  await rpc('servers.save', { name: 'dbx', previousName: 'dbx', enabled: true, config: preserved.config });
  await reopen();
  assert.equal(inspections, 0);
  assert.equal(await js('document.querySelectorAll(\'[aria-label="MCP 服务"] button\').length'), 1);
  assert.equal(await js('Boolean(document.querySelector(\'[data-mcp-settings] .lucide-chevron-right\'))'), true);
  assert.equal(await js('document.querySelectorAll("[data-mcp-inspect]").length'), 0, 'inspection belongs inside the side panel');
  await openSettings();
  assert.equal(inspections, 0, 'opening a service row must not connect');
  await edit('dbx 环境变量 3 值', '0');
  await click('[data-mcp-inspect]');
  await waitFor(() => js('document.querySelector(\'aside [role="alert"]\')?.textContent.includes("请先保存修改")'), 'unsaved edits block inspection');
  assert.equal(inspections, 0, 'inspection must not silently use old settings');
  await edit('dbx 环境变量 3 值', '');
  await click('[data-mcp-inspect]');
  await waitFor(() => js('document.querySelector("[data-mcp-status]")?.textContent === "检查通过"'), 'explicit real DBX inspection');
  const toolCount = await js('document.querySelectorAll("[data-mcp-tool]").length');
  assert.ok(toolCount > 0);
  assert.deepEqual(await js('[...document.querySelectorAll("[data-app-details-section]")].map(el => el.dataset.appDetailsSection)'), ['基本信息', '应用设置', 'MCP 服务', '工具']);
  assert.equal(await js(`document.querySelectorAll('[aria-label="MCP 服务"] [data-mcp-tool]').length`), 0);
  assert.equal(inspections, 1);
  await waitFor(() => js('!document.querySelector(\'[aria-label="关闭连接设置"]\').disabled'), 'inspection completes');
  await click('[aria-label="关闭连接设置"]');
  mark(`Explicit service check discovers ${toolCount} real DBX tools with an isolated read-only profile`);
  // Discard in-memory connection checks: the persisted catalog must remain usable.
  mcpHost.checks.clear();
  await reopen();
  await waitFor(() => js('document.querySelectorAll("[data-mcp-tool]").length === ' + toolCount), 'persisted cached tools');
  assert.equal(inspections, 1, 'reopening tools must not reconnect');
  assert.equal(await js('document.querySelectorAll("webview, iframe").length'), 0);
  await js('document.querySelector("[data-mcp-management]").scrollIntoView({block:"start"})');
  await capture('mcp-tools-light');
  await js(`(() => { const el=document.querySelector('input[aria-label="搜索工具"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'dbx_execute_query');el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitFor(() => js('document.querySelectorAll("[data-mcp-tool]").length > 0 && document.querySelectorAll("[data-mcp-tool]").length < ' + toolCount), 'cached tool search');
  await openSettings();
  assert.equal(await js('document.querySelector(\'input[aria-label="dbx 环境变量 1 值"]\').value'), '');
  await click('aside[aria-label="连接设置"] button[type=submit]');
  await waitFor(() => js('!document.querySelector(\'aside[aria-label="连接设置"]\')'), 'save without starting service');
  assert.equal(inspections, 1);
  assert.equal(runtime.getToolLoading('moss.dbx'), 'always');
  await waitFor(() => js('document.querySelectorAll("[data-mcp-tool]").length > 0'), 'unchanged save retains the tool cache');
  assert.deepEqual((await rpc('servers.list')).servers[0].config.disabledTools, ['dbx_execute_query']);
  assert.equal(await js(`document.querySelectorAll('[aria-label="工具使用范围"]').length`), 1);
  assert.equal(await js('document.body.textContent.includes("在设置 → Apps")'), false);
  assert.equal(await js('document.body.textContent.includes("缓存的工具清单")'), false);
  assert.ok(await js(`document.querySelector('[data-app-introduction]').textContent.includes(${JSON.stringify(definition.presentation.usage)})`));
  await js(`document.querySelector('[data-app-introduction]').scrollIntoView({block:'center'})`);
  await capture('introduction-light');
  await js('document.querySelector("[data-mcp-management]").scrollIntoView({block:"start"})');
  mark('Opening details, searching cached tools and saving connections never start MCP; outer scope and existing policy survive');
  await js('document.documentElement.classList.add("dark");document.documentElement.dataset.theme="dark"');
  await capture('mcp-tools-dark');
  win.setMinimumSize(400, 600);
  win.setSize(650, 900);
  await waitFor(() => js('innerWidth <= 650'), 'narrow viewport');
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
  await capture('mcp-narrow');
  await openSettings();
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth && document.querySelector(\'aside[aria-label="连接设置"]\').scrollWidth <= innerWidth'), true);
  await capture('connection-settings-narrow');
  await click('[aria-label="关闭连接设置"]');
  win.setSize(1440, 1000);
  await click('[aria-label="试用示例"] button');
  await waitFor(() => js('!document.querySelector("[data-app-details]")'), 'example returns to chat');
  assert.ok(await js('document.body.textContent.includes("列出 DBX") || [...document.querySelectorAll("textarea")].some(el => el.value.includes("列出 DBX"))'));
  mark('Native Core details fit light, dark and narrow layouts; example returns to chat without sending');
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ passed: true, checks, tools: toolCount }, null, 2));
} catch (error) {
  console.error(error.stack);
  if (win && !win.isDestroyed()) {
    console.error((await js('document.body.innerText').catch(() => '')).slice(0, 2500));
    await capture('failure').catch(() => {});
  }
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await runtime?.shutdown().catch(() => {});
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  app.exit(process.exitCode || 0);
}
}
void run();
