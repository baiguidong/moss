// Actual packaged Apps in an isolated desktop profile. No external messages or desktop control.
import { app, BrowserWindow, webContents } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AppRuntimeHost } from '../../packages/app-runtime/src/host/index.mjs';
import { AppMcpHost } from '../src/apps/app-mcp-host.mjs';
const core = fileURLToPath(new URL('../..', import.meta.url));
const apps = process.env.MOSS_APPS_ROOT || path.resolve(core, '../moss-apps');
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-settings-views-'));
const output = path.join(core, 'output/app-settings-views');
process.env.MOSS_HOME = process.env.MOSS_CONFIG_DIR = home;
process.env.MOSS_RUNTIME_HOME ||= path.join(os.homedir(), '.moss/runtimes');
process.env.MOSS_OPEN_DEVTOOLS = 'false';
app.setAppPath(path.join(core, 'ui')); app.setPath('userData', path.join(home, 'electron'));
app.on('window-all-closed', () => {});
let win, runtime, inspections = 0;
const originalHandle = AppMcpHost.prototype.handle;
AppMcpHost.prototype.handle = function(method, ...args) { if (method === 'servers.inspect') inspections++; return originalHandle.call(this, method, ...args); };
const originalRegister = AppRuntimeHost.prototype.registerInstalled;
AppRuntimeHost.prototype.registerInstalled = function(...args) { runtime = this; return originalRegister.apply(this, args); };
const ready = new Promise(resolve => app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; window.showInactive = () => {};
  if (!win) { win = window; window.webContents.once('did-finish-load', resolve); }
}));
const evaluate = (target, fn, ...args) => target.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`);
const js = (fn, ...args) => evaluate(win.webContents, fn, ...args);
const until = async (read, label) => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) { if (await read().catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Timed out: ' + label);
};
const click = selector => js(selector => document.querySelector(selector).click(), selector);
const guest = async () => webContents.fromId(await js(() => document.querySelector('webview')?.getWebContentsId()));
const capture = async name => { await new Promise(resolve => setTimeout(resolve, 250)); await fs.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG()); };
const checks = [];
const definitions = [];
const watchdog = setTimeout(() => { console.error('Settings view test timed out'); app.exit(1); }, 300_000);
await fs.mkdir(output, { recursive: true });
const { publishAppFromBuild } = await import('../src/app-platform.mjs');
for (const directory of (process.env.MOSS_TEST_APPS || 'mcp,database,memory,computer-use,feishu,self-test,audit').split(',')) {
  const manifest = JSON.parse(await fs.readFile(path.join(apps, 'apps', directory, 'app.moss.json'), 'utf8'));
  const pkg = path.join(apps, 'artifacts', manifest.id, manifest.version, manifest.platforms ? `package-${process.platform}-${process.arch}` : 'package');
  await publishAppFromBuild(pkg); definitions.push(manifest);
}
await import('../src/main.mjs');
async function run() {
try {
  await ready; win.setSize(1440, 1000);
  await until(() => js(() => !!document.querySelector('button[title="插件"]')), 'plugins navigation');
  await click('button[title="插件"]');
  await js(() => [...document.querySelectorAll('[aria-label="资源分类"] [role=tab]')].find(tab => tab.textContent === 'Apps').click());
  await until(() => js(() => document.querySelector('[data-app-hub-tab="marketplace"]')?.getAttribute('aria-selected') === 'true'), 'Apps defaults to marketplace');
  await click('[data-app-hub-tab="installed"]');
  await until(() => js(() => !!document.querySelector('[data-app-open="moss.database"]')), 'installed Apps');
  assert.equal(await js(() => {
    const cards = [...document.querySelectorAll('[data-app-category]')];
    return cards.filter(card => card.getBoundingClientRect().top === cards[0].getBoundingClientRect().top).length;
  }), 3);
  assert.doesNotMatch(await js(() => document.querySelector('[data-app-open="moss.database"]').closest('section').textContent), /已启用|已停用|AI 工具|运行中|已停止/);
  await capture('apps-installed-three-columns');
  await click('[data-app-open="moss.database"]');
  await until(() => js(() => !!document.querySelector('[data-app-details="moss.database"]')), 'installed card opens details');
  await click('[aria-label="应用详情导航"] button');
  await until(() => js(() => document.querySelector('[data-app-hub-tab="installed"]')?.getAttribute('aria-selected') === 'true'), 'return preserves installed tab');
  await js(() => [...document.querySelectorAll('[aria-label="资源分类"] [role=tab]')].find(tab => tab.textContent === '常用').click());
  checks.push('App hub defaults to marketplace, installed list has three columns without status/actions, returning from details preserves the installed tab');
  for (const manifest of definitions) {
    const open = `[aria-label="打开 ${manifest.displayName}"]`;
    console.log("Checking", manifest.id);
    await until(() => js(selector => !!document.querySelector(selector), open), manifest.id + ' card'); await click(open);
    await until(() => js(id => !!document.querySelector(`[data-app-details="${id}"]`), manifest.id), 'Core details');
    assert.equal(await js(() => document.querySelectorAll('webview,iframe').length), 0);
    assert.equal(inspections, 0, 'details must not inspect MCP');
    assert.equal(await js(() => document.querySelectorAll('[data-app-view-setting]').length), 0);
    assert.equal(await js(() => document.querySelectorAll('header [data-app-ui-open]').length), 1);
    await capture(`${manifest.id}-details`);
    win.setMinimumSize(400, 600); win.setSize(650, 900);
    assert.equal(await js(() => {
      const open = document.querySelector('header [data-app-ui-open]');
      const buttons = [...open.parentElement.querySelectorAll('button')].map(button => button.getBoundingClientRect());
      return buttons.length === 2 && buttons[0].y === buttons[1].y && buttons.every(rect => rect.x >= 0 && rect.right <= innerWidth);
    }), true, 'header actions aligned at narrow width');
    await capture(`${manifest.id}-details-narrow`);
    win.setSize(1440, 1000);
    await click(`[data-app-ui-open="${manifest.id}"]`);
    if (manifest.navigation.location === 'more') {
      await until(() => js(() => !!document.querySelector('webview')?.getWebContentsId()), 'standalone guest attached');
      const page = await guest();
      await until(() => evaluate(page, () => !!window.mossApp && document.readyState === 'complete'), 'standalone loaded');
      assert.equal(new URL(page.getURL()).hash, manifest.contributes.views.find(view => view.id === manifest.navigation.viewId).route);
      await capture(`${manifest.id}-workspace`);
      await click('[aria-label="返回应用详情"]');
      await until(() => js(id => !!document.querySelector(`[data-app-details="${id}"]`), manifest.id), 'standalone returns to details');
      await click('[aria-label="应用详情导航"] button');
      checks.push(`${manifest.id}: existing standalone UI uses top entry, declared route and back to details`);
      continue;
    }
    for (const [index, setting] of manifest.contributes.settings.entries()) {
      if (index) {
        const previousId = (await guest()).id;
        await click(`[data-app-workspace-page="${setting.viewId}"]`);
        await until(async () => (await guest())?.id !== previousId, 'previous page disposed');
      }
      await until(() => js(() => !!document.querySelector('webview')?.getWebContentsId()), 'guest attached');
      const page = await guest();
      const view = manifest.contributes.views.find(view => view.id === setting.viewId);
      await until(() => evaluate(page, () => !!window.mossApp && document.readyState === 'complete'), 'guest loaded');
      assert.equal(new URL(page.getURL()).hash, view.route);
      await until(() => js(() => !document.querySelector('[aria-label="返回应用详情"]').disabled), 'initial read complete');
      assert.equal(inspections, 0, 'opening views must not inspect MCP');
      assert.doesNotMatch(await evaluate(page, () => document.body.innerText), /排除工具|工具使用范围|通用设置/);
      const webContentsId = page.id;
      assert.equal(await js(() => !!document.querySelector('[data-app-workspace]') && !document.querySelector('[data-app-details]')), true);
      if (manifest.id === 'moss.database') {
        await until(() => evaluate(page, () => [...document.querySelectorAll('button')].some(el => el.textContent === '添加连接')), 'database ready');
        await evaluate(page, () => [...document.querySelectorAll('button')].find(el => el.textContent === '添加连接').click());
        await evaluate(page, () => { const el = document.querySelector('dialog input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '未保存的测试库'); el.dispatchEvent(new Event('input', { bubbles: true })); });
        await js(() => { window.__confirms = 0; window.confirm = () => { window.__confirms++; return false; }; });
        await new Promise(resolve => setTimeout(resolve, 250));
        await click('[aria-label="返回应用详情"]');
        assert.equal(await js(() => window.__confirms), 1); assert.equal((await guest()).id, webContentsId);
        win.setMinimumSize(400, 600); win.setSize(650, 900);
        assert.equal(await evaluate(page, () => document.querySelector('dialog input').value), '未保存的测试库');
        win.setSize(1440, 1000);
        await evaluate(page, () => window.mossApp.view.setState({ dirty: true, busy: true }));
        await until(() => js(() => document.querySelector('[aria-label="返回应用详情"]').disabled), 'busy close guard');
        await js(() => { window.__alerts = 0; window.alert = () => window.__alerts++; });
        await click('button[title="插件"]'); assert.equal(await js(() => window.__alerts), 1);
        await evaluate(page, () => window.mossApp.view.setState({ dirty: true, busy: false }));
        await js(() => { window.confirm = () => true; });
        checks.push('database dirty cancel, resizing preserves form, busy blocks navigation');
      }
      if (manifest.id === 'moss.feishu') {
        const agent = setting.viewId === 'execution';
        assert.equal(await evaluate(page, () => !document.getElementById('agentPanel').hidden), agent);
        assert.equal(await evaluate(page, () => !document.getElementById('configurationPanel').hidden), !agent);
        assert.equal(await evaluate(page, () => document.querySelectorAll('[role=tablist]').length), 0);
        if (!agent) {
          await evaluate(page, () => window.mossApp.view.setState({ dirty: true, busy: true }));
          await until(() => js(() => document.querySelector('[data-app-workspace-page="execution"]').disabled), 'saving blocks page switch');
          await evaluate(page, () => window.mossApp.view.setState({ dirty: true, busy: false }));
          await until(() => js(() => !document.querySelector('[data-app-workspace-page="execution"]').disabled), 'page switch available');
          await js(() => { window.__confirms = 0; window.confirm = () => { window.__confirms++; return false; }; });
          await click('[data-app-workspace-page="execution"]');
          assert.equal(await js(() => window.__confirms), 1); assert.equal((await guest()).id, webContentsId);
          await evaluate(page, () => window.mossApp.view.setState({ dirty: false, busy: false }));
          await js(() => { window.confirm = () => true; });
          checks.push('feishu page switching respects unsaved changes and busy state');
        }
      }
      if (manifest.id === 'moss.computer-use') {
        assert.doesNotMatch(await evaluate(page, () => document.getElementById('error').innerText), /签名|trusted|失败/);
        assert.equal(await evaluate(page, () => document.getElementById('phase').textContent !== '正在连接 Moss…'), true);
      }
      win.setMinimumSize(400, 600); win.setSize(650, 900);
      await js(() => window.agentDesktop.updateSettings({ appearance: { themeMode: 'dark' } }));
      await until(() => evaluate(page, () => document.documentElement.dataset.theme === 'dark' || document.documentElement.classList.contains('dark')), 'guest dark theme');
      assert.equal(await js(() => document.documentElement.scrollWidth <= innerWidth), true);
      await capture(`${manifest.id}-${setting.id}-narrow`);
      win.setSize(1440, 1000); await js(() => window.agentDesktop.updateSettings({ appearance: { themeMode: 'light' } }));
      await until(() => evaluate(page, () => document.documentElement.dataset.theme === 'light' || !document.documentElement.classList.contains('dark')), 'guest light theme');
      await capture(`${manifest.id}-${setting.id}`);
      assert.equal((await guest()).id, webContentsId);
      checks.push(`${manifest.id}/${setting.id}: top launch, declared route, full workspace, narrow layout`);
    }
    await click('[aria-label="返回应用详情"]');
    await until(() => js(() => !document.querySelector('webview')), 'guest closed');
    checks.push(`${manifest.id}: back to Core details, clean disposal`);
    await click('[aria-label="应用详情导航"] button');
    await until(() => js(() => !document.querySelector('[data-app-details],[data-app-workspace]')), 'breadcrumb returns to plugins');
  }
  assert.equal(inspections, 0);
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ passed: true, inspections, checks }, null, 2));
  console.log('PASS ' + JSON.stringify({ inspections, checks }));
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
  if (win && !win.isDestroyed()) { console.error((await js(() => document.body.innerText).catch(() => '')).slice(-4500)); await capture('failure').catch(() => {}); }
} finally {
  clearTimeout(watchdog); await runtime?.shutdown().catch(() => {});
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); app.exit(process.exitCode || 0);
}
}
void run();
