// Real renderer -> preload -> IPC -> session deletion, using an isolated profile.
// Build the renderer first, then: electron tests/settings-storage.electron.mjs
import { app, BrowserWindow, nativeTheme } from 'electron';
const originalThemeSource = nativeTheme.themeSource;
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-settings-storage-'));
const ui = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(ui, '../output/settings-storage');
process.env.MOSS_HOME = process.env.MOSS_CONFIG_DIR = root;
process.env.MOSS_OPEN_DEVTOOLS = 'false';
app.setAppPath(ui); app.setPath('userData', path.join(root, 'electron'));
await fs.mkdir(output, { recursive: true });
// This fixture needs no installed Apps. Record them as previously seen so startup
// does not unpack the bundled office suites into every temporary profile.
const builtins = await fs.readFile(path.join(ui, 'dist/builtin-apps/manifest.json'), 'utf8').then(JSON.parse, () => ({ apps: [] }));
await fs.writeFile(path.join(root, 'builtin-apps.json'), JSON.stringify({ version: 1, seen: Object.fromEntries(builtins.apps.map(entry => [entry.id, entry.version])) }));
await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({
  models: { text: { model: 'fixture-model', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-key' } },
  autoMemory: { enabled: false }, sessionMemory: { enabled: false }, webSearch: { mode: 'disabled' },
  appearance: { themeMode: 'light' },
}));
const { prepareSessionStatements } = await import('../src/session-database.mjs');
const database = new DatabaseSync(path.join(root, 'moss.db'));
prepareSessionStatements(database);
const old = Date.now() - 100 * 86400000;
for (const [id, title, parent, size] of [
  ['cleanup-old', '旧会话 · 已完成的调研', null, 128 * 1024],
  ['cleanup-child', '调研子会话', 'cleanup-old', 32 * 1024],
  ['cleanup-changed', '旧会话 · 保留刚更新的文件', null, 64 * 1024],
  ['cleanup-recent', '近期会话', null, 16 * 1024],
]) {
  const workspace = path.join(root, 'sessions', id, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'result.txt'), Buffer.alloc(size, 'a'));
  database.prepare('INSERT INTO sessions (id,title,workspace,created_at,updated_at,message_count,preview,is_sub_agent,parent_session_id) VALUES (?,?,?,?,?,0,?,?,?)')
    .run(id, title, workspace, old, id === 'cleanup-recent' ? Date.now() : old, '', parent ? 1 : 0, parent);
}
database.close();
for (const [folder, size] of [['projects/demo', 256000], ['apps-data/demo', 192000], ['workspace-versions/demo', 96000], ['logs', 32000]]) {
  await fs.mkdir(path.join(root, folder), { recursive: true });
  await fs.writeFile(path.join(root, folder, 'fixture.dat'), Buffer.alloc(size));
}
let win;
const ready = new Promise(resolve => app.on('browser-window-created', (_event, created) => {
  created.show = () => {}; created.showInactive = () => {};
  if (!win) { win = created; created.webContents.once('did-finish-load', resolve); }
}));
const watchdog = setTimeout(() => { console.error('Settings storage test timed out'); app.exit(1); }, 180000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`);
async function until(fn, label) {
  for (let i = 0; i < 300; i++) { if (await js(fn)) return; await delay(100); }
  throw Error('Timed out: ' + label);
}
async function click(selector) {
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.getClientRects().length)?.click()`);
  await delay(100);
}
async function button(text) {
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el => el.getClientRects().length && el.textContent.trim() === ${JSON.stringify(text)})?.click()`);
  await delay(100);
}
async function inputValue(label, value) {
  await win.webContents.executeJavaScript(`(() => { const input = document.querySelector('input[aria-label="' + ${JSON.stringify(label)} + '"]'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await delay(100);
  await win.webContents.executeJavaScript(`(() => { const input = document.querySelector('input[aria-label="' + ${JSON.stringify(label)} + '"]'); input.focus(); input.blur(); })()`);
}
async function selectValue(label, value) {
  await win.webContents.executeJavaScript(`(() => { const select = document.querySelector('select[aria-label="' + ${JSON.stringify(label)} + '"]'); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}
async function capture(name) { await delay(150); await fs.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG()); }

async function run() {
try {
  await import('../src/main.mjs'); await ready;
  win.setSize(1440, 1000);
  await until(() => !!document.querySelector('button[aria-label="个人中心"]'), 'account menu');
  await until(() => !!document.querySelector('button[aria-label="打开“近期会话”的会话设置"]'), 'session menu');
  await js(() => document.querySelector('button[aria-label="打开“近期会话”的会话设置"]').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerType: 'mouse' })));
  await until(() => [...document.querySelectorAll('[role=menuitem]')].some(el => el.textContent.includes('归档会话')), 'archive action');
  await js(() => [...document.querySelectorAll('[role=menuitem]')].find(el => el.textContent.includes('归档会话')).click());
  await until(() => !document.querySelector('button[aria-label="打开“近期会话”的会话设置"]'), 'archive hides session');
  assert.equal(await js(async () => (await window.agentDesktop.storage.listArchives()).some(item => item.id === 'cleanup-recent')), true);
  await js(async () => {
    await window.agentDesktop.storage.setArchived({ sessionId: 'cleanup-old', archived: true });
    await window.agentDesktop.storage.setArchived({ sessionId: 'cleanup-changed', archived: true });
  });
  assert.equal(await js(async () => (await window.agentDesktop.listSessions()).some(item => item.id === 'cleanup-child')), false, 'archived descendants hidden');
  await js(() => document.querySelector('button[aria-label="个人中心"]').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerType: 'mouse' })));
  await until(() => [...document.querySelectorAll('[role=menuitem]')].some(el => el.textContent.trim() === '设置'), 'settings entry');
  await js(() => [...document.querySelectorAll('[role=menuitem]')].find(el => el.textContent.trim() === '设置').click());
  await until(() => !!document.querySelector('[data-settings-nav="basic"]'), 'settings navigation');
  await click('[data-settings-nav="basic"]'); await capture('general-light');
  assert.equal(await js(() => !!document.querySelector('#appearance')), false, 'General is a separate page');
  await click('[data-settings-nav="appearance"]');
  await until(() => !!document.querySelector('[role=radiogroup][aria-label="主题模式"]'), 'appearance');
  await capture('appearance-light');
  await click('[role=radio][aria-label="深色"]');
  await until(() => document.documentElement.dataset.theme === 'dark', 'dark theme');
  assert.equal(await js(async () => (await window.agentDesktop.getSettings()).appearance.themeMode), 'dark');
  await capture('appearance-dark');
  await js(() => document.querySelector('button[aria-label="选择主题"]').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerType: 'mouse' })));
  await until(() => [...document.querySelectorAll('[role=menuitemradio]')].some(el => el.textContent.includes('Ayu')), 'theme catalog');
  await capture('theme-menu-dark');
  await js(() => [...document.querySelectorAll('[role=menuitemradio]')].find(el => el.textContent.includes('Ayu')).click());
  await until(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim().toUpperCase() === '#10141C', 'Ayu colors');
  assert.equal(await js(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toUpperCase()), '#E6B450');
  await capture('appearance-ayu');
  await click('[role=switch][aria-label="浅色与深色独立设置"]');
  await inputValue('深色强调色', '#71B7FF');
  await until(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toUpperCase() === '#71B7FF', 'custom accent');
  await click('[role=radio][aria-label="浅色"]');
  await until(() => document.documentElement.dataset.theme === 'light', 'independent light mode');
  await js(() => document.querySelector('button[aria-label="选择主题"]').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerType: 'mouse' })));
  await until(() => [...document.querySelectorAll('[role=menuitemradio]')].some(el => el.textContent.includes('Catppuccin')), 'light themes');
  assert.equal(await js(() => [...document.querySelectorAll('[role=menuitemradio]')].some(el => el.textContent.includes('Ayu'))), false, 'dark-only themes filtered');
  await js(() => [...document.querySelectorAll('[role=menuitemradio]')].find(el => el.textContent.includes('Catppuccin')).click());
  await until(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim().toUpperCase() === '#EFF1F5', 'Catppuccin light');
  await capture('appearance-catppuccin');
  await click('[role=radio][aria-label="深色"]');
  await until(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim().toUpperCase() === '#10141C', 'dark profile preserved');
  assert.equal(await js(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toUpperCase()), '#71B7FF');
  await click('button[aria-label="重置深色强调色"]');
  await until(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toUpperCase() === '#E6B450', 'color reset');
  await inputValue('界面字号', '16');
  await until(() => parseFloat(getComputedStyle(document.documentElement).fontSize) > 18, 'UI font size applies');
  await inputValue('界面字号', '14');
  await inputValue('代码字号', '16');
  await until(() => getComputedStyle(document.documentElement).getPropertyValue('--moss-code-size').trim() === '16px', 'code font applies');
  await selectValue('减少动画', 'always');
  await until(() => parseFloat(getComputedStyle(document.querySelector('[role=switch]')).transitionDuration) < 0.001, 'reduced motion');
  await click('[role=switch][aria-label="半透明侧栏"]');
  await click('[role=switch][aria-label="使用手形光标"]');
  await until(() => getComputedStyle(document.querySelector('[role=switch]')).cursor === 'default', 'pointer cursor preference');
  assert.equal(await js(() => getComputedStyle(document.querySelector('[data-sidebar-shell]')).backdropFilter.includes('blur')), true);
  await selectValue('差异标记', 'markers');
  await until(() => getComputedStyle(document.documentElement).getPropertyValue('--color-diff-added-bg').trim() === 'transparent', 'marker-only diff');
  await click('[role=radio][aria-label="石墨"]');
  await until(async () => (await window.agentDesktop.getSettings()).appearance.dockIcon === 'graphite', 'dock icon saved');
  await selectValue('内容字体', 'serif');
  await until(() => getComputedStyle(document.querySelector('[data-message-body="user"]')).fontFamily.includes('Georgia'), 'content font applies to user messages');
  assert.equal(await js(() => getComputedStyle(document.querySelector('[aria-label="消息外观预览"] code')).fontSize), '16px');
  await js(() => document.querySelector('[role=radiogroup][aria-label="Dock 图标"]').scrollIntoView({ block: 'end' }));
  await capture('appearance-controls-dark');
  await js(async () => window.agentDesktop.preview.open({ content: 'const greeting = "Moss";', contentType: 'code', metadata: { title: 'Theme preview.ts', language: 'typescript' } }));
  const preview = BrowserWindow.getAllWindows().find(window => window !== win);
  assert.ok(preview, 'independent preview window opened');
  for (let i = 0; i < 100; i++) { if (await preview.webContents.executeJavaScript('!!document.querySelector("pre code")')) break; await delay(100); }
  assert.equal(await preview.webContents.executeJavaScript('getComputedStyle(document.querySelector("pre code")).fontSize'), '16px');
  assert.equal(await preview.webContents.executeJavaScript('getComputedStyle(document.body).color'), 'rgb(191, 189, 182)', 'preview foreground follows dark palette');
  await selectValue('代码字体', 'monaco');
  for (let i = 0; i < 50; i++) { if (await preview.webContents.executeJavaScript('getComputedStyle(document.querySelector("pre code")).fontFamily.includes("Monaco")')) break; await delay(100); }
  assert.equal(await preview.webContents.executeJavaScript('getComputedStyle(document.querySelector("pre code")).fontFamily.includes("Monaco")'), true, 'live preview font sync');
  await fs.writeFile(path.join(output, 'code-preview-ayu.png'), (await preview.webContents.capturePage()).toPNG());
  preview.destroy();
  const savedAppearance = JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8')).appearance;
  assert.equal(savedAppearance.darkProfile.themeId, 'ayu'); assert.equal(savedAppearance.lightProfile.themeId, 'catppuccin');
  assert.equal(savedAppearance.darkProfile.codeFontSize, 16); assert.equal(savedAppearance.separateLightDark, true);
  await js(async () => window.agentDesktop.updateSettings({ appearance: { separateLightDark: false, cssThemeId: 'codex', reduceMotion: 'system', pointerCursors: true, translucentSidebar: false, dockIcon: 'default' } }));

  await click('[data-settings-nav="storage"]');
  await until(() => !!document.querySelector('[data-storage-settings]') && !document.body.textContent.includes('正在计算存储占用'), 'storage scan');
  assert.equal(await js(() => document.querySelector('[data-storage-settings]').textContent.includes('项目与工作区')), true);
  await capture('storage-dark');
  await button('管理归档');
  await until(() => document.querySelector('dialog[open]')?.textContent.includes('近期会话'), 'archive manager');
  await capture('archives-dark');
  await js(() => [...document.querySelectorAll('dialog[open] button')].find(button => button.textContent === '恢复' && button.parentElement.textContent.includes('近期会话')).click());
  await until(() => !document.querySelector('dialog[open]')?.textContent.includes('近期会话'), 'archive restored');
  assert.equal(await js(async () => (await window.agentDesktop.listSessions()).some(item => item.id === 'cleanup-recent')), true);
  await click('[aria-label="关闭归档管理"]');
  await button('查看待清理会话');
  await until(() => !!document.querySelector('dialog[open]'), 'cleanup review');
  assert.equal(await js(() => document.querySelectorAll('dialog input[type=checkbox]').length), 2);
  assert.equal(await js(() => document.querySelectorAll('dialog input:checked').length), 0);
  await click('input[aria-label="选择 旧会话 · 已完成的调研"]');
  await click('input[aria-label="选择 旧会话 · 保留刚更新的文件"]');
  await fs.writeFile(path.join(root, 'sessions/cleanup-changed/workspace/result.txt'), 'updated after review');
  await capture('cleanup-review-dark');
  await button('继续');
  await until(() => document.querySelector('dialog[open]')?.textContent.includes('无法撤销'), 'explicit confirmation');
  assert.equal(await fs.readFile(path.join(root, 'sessions/cleanup-old/workspace/result.txt')).then(() => true), true, 'Nothing deleted before confirmation');
  await button('永久删除');
  await until(() => document.body.textContent.includes('已删除 1 个会话，跳过 1 个，失败 0 个'), 'cleanup result');
  await assert.rejects(fs.stat(path.join(root, 'sessions/cleanup-old')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(root, 'sessions/cleanup-child')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, 'sessions/cleanup-changed/workspace/result.txt'), 'utf8'), 'updated after review');
  assert.equal(await fs.stat(path.join(root, 'sessions/cleanup-recent')).then(() => true), true);
  await click('[data-settings-nav="appearance"]');
  await click('[role=radio][aria-label="浅色"]');
  await until(() => document.documentElement.dataset.theme === 'light', 'light theme');
  await click('[data-settings-nav="storage"]');
  await until(() => !document.body.textContent.includes('正在计算存储占用'), 'fresh overview');
  await capture('storage-light');
  win.setMinimumSize(400, 600); win.setSize(720, 920);
  await capture('storage-narrow');
  assert.equal(await js(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
  await button('查看待清理会话'); await until(() => !!document.querySelector('dialog[open]'), 'second review');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await until(() => !document.querySelector('dialog[open]'), 'escape dismisses review');
  win.setSize(1440, 1000);
  await click('[data-settings-nav="advanced"]'); await capture('system-services-light');
  assert.equal(await js(() => document.querySelector('textarea[aria-label="追加系统提示"]')?.parentElement.classList.contains('settings-section')), true, 'no nested prompt card');
  await click('[data-settings-nav="appearance"]'); await click('[role=radio][aria-label="系统"]');
  assert.equal(await js(async () => (await window.agentDesktop.getSettings()).appearance.themeMode), 'system');
  nativeTheme.themeSource = 'dark';
  await until(() => document.documentElement.dataset.theme === 'dark', 'system switches dark');
  nativeTheme.themeSource = 'light';
  await until(() => document.documentElement.dataset.theme === 'light', 'system switches light');
  await js(async () => window.agentDesktop.storage.setArchived({ sessionId: 'cleanup-recent', archived: true }));
  await click('[data-settings-nav="storage"]'); await button('管理归档');
  await until(() => document.querySelector('dialog[open]')?.textContent.includes('近期会话'), 'archive recent again');
  await js(() => [...document.querySelectorAll('dialog[open] button')].find(button => button.textContent === '删除…' && button.parentElement.textContent.includes('近期会话')).click());
  await until(() => !!document.querySelector('input[aria-label="选择 近期会话"]'), 'individual archive review');
  assert.equal(await fs.stat(path.join(root, 'sessions/cleanup-recent')).then(() => true), true);
  await click('input[aria-label="选择 近期会话"]'); await button('继续'); await button('永久删除');
  await until(() => document.body.textContent.includes('已删除 1 个会话，跳过 0 个，失败 0 个'), 'individual archive deleted');
  await assert.rejects(fs.stat(path.join(root, 'sessions/cleanup-recent')), { code: 'ENOENT' });
  console.log('PASS real settings: mode/system switching, distinct themes, custom colors/reset, independent profiles, fonts, motion, cursors, translucent sidebar, diff markers, Dock icon, live preview window; archive/restore/delete, complete storage scan, safe cleanup and narrow layouts. Screenshots: ' + output);
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
  if (win && !win.isDestroyed()) { await capture('failure'); console.error(await js(() => document.body.innerText.slice(0,3000) + document.body.innerText.slice(-3000))); }
} finally {
  nativeTheme.themeSource = originalThemeSource;
  clearTimeout(watchdog);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  app.exit(process.exitCode || 0);
}
}
void run();
