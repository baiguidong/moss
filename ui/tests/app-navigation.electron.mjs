// Run from ui: ./node_modules/.bin/electron tests/app-navigation.electron.mjs
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { normalizeDesktopSettings } from '../src/desktop-settings.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-navigation-'));
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});
let server, win;
const errors = [];
const watchdog = setTimeout(() => app.exit(1), 60_000);
const delay = () => new Promise(resolve => setTimeout(resolve, 70));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`);
async function until(fn, message) {
  for (let i = 0; i < 100; i++) { if (await win.webContents.executeJavaScript(`(async () => { try { return await (${fn})(); } catch { return false; } })()`)) return; await delay(); }
  throw new Error(`${message}; renderer errors: ${errors.join('\n')}`);
}
const clickText = text => evaluate(text => {
  const button = [...document.querySelectorAll('button')].find(item => item.offsetParent && item.textContent.trim() === text);
  if (!button) throw new Error(`Missing button: ${text}`); button.click();
}, text);
const clickNavigation = id => evaluate(id => {
  const button = [...document.querySelectorAll('[data-settings-nav]')].find(item => item.offsetParent && item.dataset.settingsNav === id);
  if (!button) throw new Error(`Missing navigation: ${id}`);
  button.click();
}, id);
const capture = async name => {
  if (!process.env.APP_NAVIGATION_SCREENSHOTS) return;
  await new Promise(resolve => setTimeout(resolve, 250));
  await fs.mkdir(process.env.APP_NAVIGATION_SCREENSHOTS, { recursive: true });
  await fs.writeFile(path.join(process.env.APP_NAVIGATION_SCREENSHOTS, `${name}.png`), (await win.webContents.capturePage()).toPNG());
};

async function run() {
try {
  const preload = path.join(temp, 'preload.cjs'); await fs.writeFile(preload, '');
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(temp, 'vite'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['tests/fixtures/app-navigation.html'] },
    plugins: [{ name: 'navigation-fixture', configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url === '/navigation-fixture-config') {
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ settings: normalizeDesktopSettings({}), preload: pathToFileURL(preload).href }));
        } else if (req.url?.startsWith('/navigation-page')) {
          res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;padding:24px;background:#f8fafc;color:#18212f}</style><h1>应用设置</h1><label>连接名称 <input id="connection"></label><button onclick="localStorage.setItem(\'connection\',document.querySelector(\'input\').value)">保存</button><script>document.querySelector("input").value=localStorage.getItem("connection")||""</script>');
        } else next();
      });
    } }],
  });
  await server.listen();
  win = new BrowserWindow({ show: false, width: 1320, height: 850, webPreferences: { webviewTag: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) errors.push(message); });
  await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/app-navigation.html`);
  await until(() => document.querySelector('webview')?.getURL?.().includes('#/settings'), 'Initial App settings did not load');
  assert.equal(await evaluate(() => document.querySelectorAll('webview').length), 1);
  await evaluate(() => document.querySelector('webview').executeJavaScript('document.querySelector("input").value="saved configuration";document.querySelector("button").click()'));
  // App settings stay inside Apps even when their manifest group is "tools".
  for (let index = 0; index < 3; index++) {
    await clickNavigation('tools');
    await until(() => document.querySelector('#tools') && !document.querySelector('webview'), 'Built-in Tools did not return');
    assert.equal(await evaluate(() => document.querySelector('[data-settings-nav="tools"]').getAttribute('aria-current')), 'page');
    assert.equal(await evaluate(() => document.querySelectorAll('[data-app-settings-group]').length), 0, 'App settings leaked into Tools');
    if (index === 0) {
      await evaluate(() => document.querySelector('input[aria-label="connector_cli_setup 常驻"]').click());
    }
    assert.equal(await evaluate(() => document.querySelector('input[aria-label="connector_cli_setup 常驻"]').checked), true, 'Tool settings changed while switching Apps');
    await clickText('Apps');
    await until(() => document.querySelectorAll('[data-app-settings-group]').length === 6, 'Apps did not contain all settings Apps');
    await clickText('网页操控');
    await until(() => document.querySelector('webview')?.getURL?.().includes('app=browser'), 'Browser App did not open');
    assert.equal(await evaluate(() => document.querySelector('[data-settings-nav="apps"]').getAttribute('aria-current')), 'page');
    assert.equal(await evaluate(() => document.querySelector('[data-settings-nav="tools"]').getAttribute('aria-current')), null);
    assert.equal(await evaluate(() => document.querySelectorAll('[data-app-settings-header]').length), 1);
    assert.equal(await evaluate(() => document.querySelectorAll('[data-selected-app-setting] [data-app-toolbar-actions]').length), 1, 'App settings need one shared toolbar');
    assert.equal(await evaluate(() => document.querySelectorAll('[data-selected-app-setting] [data-app-settings]').length), 0, 'App settings must not repeat generic settings');
    assert.equal(await evaluate(() => [...document.querySelectorAll('[data-selected-app-setting] button')].filter(button => button.textContent.trim() === '刷新').length), 1, 'Refresh must appear once in the shared header');
    assert.equal(await evaluate(() => [...document.querySelectorAll('[data-selected-app-setting] button')].some(button => button.textContent.trim() === '迭代')), false, 'Authoring added a duplicate App toolbar');
  }
  await capture('browser-desktop');
  await clickNavigation('tools');
  await until(() => document.querySelector('#tools') && !document.querySelector('webview'), 'Tools did not remain accessible');
  if (process.env.APP_NAVIGATION_SCREENSHOTS) {
    // Repaint the hidden native window after detaching the guest webview.
    win.setSize(1318, 850); await delay();
    await capture('tools-desktop');
    win.setSize(1320, 850);
  }
  assert.equal(await evaluate(() => document.querySelector('h1').textContent), '工具与性能');
  await clickText('Apps');
  await clickText('电脑操控');
  await until(() => document.querySelector('[data-selected-app-setting]')?.getAttribute('data-selected-app-setting') === 'app:computer/preferences', 'Tool settings were not selected');
  await until(() => window.navigationEvidence.closes.length >= 1, 'Previous App was not released');
  // Searching across groups exposes the matching App by keyword, with no eager webviews.
  await evaluate(() => {
    const input = [...document.querySelectorAll('input[placeholder="搜索设置"]')].find(item => item.offsetParent);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'robot');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await until(() => !document.querySelector('webview') && [...document.querySelectorAll('[data-app-setting]')].some(item => item.textContent.includes('飞书')), 'Search did not find App keywords');
  await clickText('飞书');
  await until(() => document.querySelector('webview')?.getURL?.().includes('app=feishu'), 'Search result opened wrong App');
  assert.equal(await evaluate(() => document.querySelector('webview').executeJavaScript('document.querySelector("input").value')), 'saved configuration');
  await evaluate(() => window.navigationFixture.update('feishu', { enabled: false }));
  await until(() => !document.querySelector('webview') && !document.querySelector('[data-app-setting="app:feishu/preferences"]'), 'Disabled App kept running or remained in settings');
  await evaluate(() => window.navigationFixture.update('feishu', { enabled: true, currentVersion: '2.0.0' }));
  await clickText('Apps'); await clickText('飞书');
  await until(() => document.querySelector('webview')?.getURL?.().includes('app=feishu'), 'Re-enabled App did not recover');
  await clickText('应用管理');
  await until(() => document.querySelector('[data-app-open="feishu"]'), 'Management view did not open');
  assert.equal(await evaluate(() => document.querySelector('[data-app-open="feishu"]').getAttribute('aria-label')), '查看 飞书');
  await evaluate(() => document.querySelector('[data-app-open="feishu"]').click());
  await until(() => document.querySelector('webview')?.getURL?.().includes('app=feishu'), 'App card did not open settings');
  await until(() => document.querySelector('webview') && !document.querySelector('[data-selected-app-setting]')?.textContent.includes('正在打开 App'), 'App page stayed behind the loading overlay');
  await new Promise(resolve => setTimeout(resolve, 250));
  await capture('desktop');

  // Only enabled Apps explicitly assigned to settings appear, grouped by App.
  await clickText('Apps');
  await until(() => document.querySelectorAll('[data-app-settings-group]').length === 6, 'Apps were not grouped separately');
  assert.deepEqual(await evaluate(() => [...document.querySelectorAll('[data-app-settings-group]')].map(group => ({
    id: group.dataset.appSettingsGroup, titles: [...group.querySelectorAll('[data-app-setting]')].map(item => item.textContent),
  })).sort((a, b) => a.id.localeCompare(b.id))), [
    { id: 'browser', titles: ['网页操控'] },
    { id: 'computer', titles: ['电脑操控'] },
    { id: 'feishu', titles: ['飞书'] },
    { id: 'library', titles: ['资料助手'] },
    { id: 'preferences', titles: ['常规设置', '外观偏好'] },
    { id: 'sequential-thinking', titles: ['分步思考'] },
  ]);
  assert.equal(await evaluate(() => document.querySelector('webview')), null);
  assert.equal(await evaluate(() => /已停用应用|操作类应用|旧版应用|无效应用|未授权应用|需在应用管理中处理/.test(document.body.textContent)), false);
  await clickText('分步思考');
  await until(() => document.querySelector('webview')?.getURL?.().includes('app=sequential-thinking'), 'Sequential Thinking settings did not open');
  assert.equal(await evaluate(() => document.querySelector('[data-settings-nav="apps"]').getAttribute('aria-current')), 'page');
  await clickText('应用管理');
  await until(() => document.querySelector('[data-app-open="sequential-thinking"]'), 'Thinking management did not open');
  assert.equal(await evaluate(() => document.querySelector('[data-app-open="sequential-thinking"]').getAttribute('aria-label')), '查看 分步思考');
  await evaluate(() => document.querySelector('[data-app-open="sequential-thinking"]').click());
  await until(() => document.querySelector('webview')?.getURL?.().includes('app=sequential-thinking'), 'Thinking card did not open settings');
  await clickText('Apps');
  await until(() => document.querySelectorAll('[data-app-settings-group]').length === 6 && !document.querySelector('webview'), 'Thinking page was not released');
  await capture('apps-desktop');
  await evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await delay();
  await capture('apps-desktop-dark');
  await evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await clickText('外观偏好');
  await until(() => document.querySelector('webview')?.getURL?.().includes('#/appearance'), 'App group opened the wrong settings page');
  await evaluate(() => window.navigationFixture.update('preferences', { enabled: false }));
  await until(() => !document.querySelector('webview') && !document.querySelector('[data-selected-app-setting]'), 'Disabling a grouped App did not release its page');
  await clickText('Apps');
  await until(() => document.querySelectorAll('[data-app-settings-group]').length === 5, 'Disabled App remained in its group');
  await evaluate(() => window.navigationFixture.update('preferences', { enabled: true }));
  await until(() => document.querySelectorAll('[data-app-settings-group]').length === 6, 'Re-enabled App did not return to its group');
  win.setSize(700, 800); await delay();
  await capture('apps-narrow');
  assert.equal(await evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Narrow settings layout overflowed');
  await clickText('外观偏好');
  await until(() => document.querySelector('webview')?.getURL?.().includes('#/appearance'), 'Narrow App group did not open');
  await clickText('常规设置');
  await until(() => document.querySelector('webview')?.getURL?.().includes('#/settings'), 'Narrow App navigation did not switch settings');
  await evaluate(() => document.querySelector('[data-selected-app-setting] button').click());
  await until(() => document.querySelectorAll('[data-app-settings-group]').length === 6 && !document.querySelector('webview'), 'Back navigation did not restore the App groups');

  win.setSize(700, 800); await delay();
  await clickNavigation('tools');
  await until(() => document.querySelector('#tools') && !document.querySelector('webview'), 'Narrow layout did not return to Tools');
  assert.equal(await evaluate(() => document.querySelector('input[aria-label="connector_cli_setup 常驻"]').checked), true);
  await clickText('Apps'); await clickText('电脑操控');
  await until(() => document.querySelector('webview')?.getURL?.().includes('app=computer'), 'Narrow layout could not switch Apps');
  await until(() => document.querySelector('webview') && !document.querySelector('[data-selected-app-setting]')?.textContent.includes('正在打开 App'), 'Narrow App page stayed behind the loading overlay');
  await new Promise(resolve => setTimeout(resolve, 250));
  await capture('narrow');
  await evaluate(() => window.navigationFixture.remove('computer'));
  await until(() => !document.querySelector('[data-selected-app-setting]') && !document.querySelector('webview'), 'Uninstalled App stayed selected');
  assert.equal(await evaluate(() => window.navigationEvidence.opens.some(input => input.sessionId || input.workspace)), false);
  assert.equal(await evaluate(() => window.navigationEvidence.opens.length), await evaluate(() => window.navigationEvidence.closes.length));
  assert.deepEqual(errors.filter(message => !message.includes('Electron Security Warning')), []);
  console.log('PASS: independent Tools and Apps navigation, repeated switching, single App header with authoring enabled, visibility, search, persistence, disable/re-enable, narrow layout and embed cleanup');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { clearTimeout(watchdog); win?.destroy(); await server?.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); app.exit(process.exitCode || 0); }

}
app.whenReady().then(run);
