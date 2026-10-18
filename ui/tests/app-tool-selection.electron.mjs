// Run from ui: env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron tests/app-tool-selection.electron.mjs
import { app, BrowserWindow } from 'electron';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-selection-'));
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => app.exit(1), 60_000);
let server, win;
const wait = () => new Promise(resolve => setTimeout(resolve, 80));
async function run() {
try {
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(temp, 'vite'), server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  win = new BrowserWindow({ show: false, width: 1100, height: 850 });
  const evaluate = code => win.webContents.executeJavaScript(code);
  const press = async keyCode => {
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode });
    await wait();
  };
  const openMention = async () => {
    await evaluate("document.querySelector('textarea').focus()");
    win.webContents.sendInputEvent({ type: 'char', keyCode: '@' }); await wait();
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'App').dispatchEvent(new MouseEvent('mousedown', {bubbles:true,cancelable:true}))"); await wait();
  };
  const mentionState = () => evaluate(`(() => {
    const active = document.querySelector('button[data-active="true"]');
    const list = active.closest('.overflow-y-auto');
    const item = active.getBoundingClientRect(), viewport = list.getBoundingClientRect();
    return { title: active.textContent, count: list.querySelectorAll('button[data-active]').length,
      scrollTop: list.scrollTop, pageScroll: window.scrollY, visible: item.top >= viewport.top - 1 && item.bottom <= viewport.bottom + 1,
      focused: document.activeElement === document.querySelector('textarea'), text: list.textContent };
  })()`);
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/app-tool-selection.html`);
  for (let i = 0; i < 100 && !await evaluate("Boolean(document.querySelector('textarea'))"); i++) await wait();
  await evaluate("document.querySelector('[data-picker]').click()"); await wait();
  assert(await evaluate("document.body.textContent.includes('连接时加载工具')"));
  assert(!await evaluate("document.body.textContent.includes('纯页面')"));
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-app-category]')].map(group => group.dataset.appCategory)"), ['knowledge', 'ai', 'other']);
  await evaluate("{ const select = document.querySelector('select[aria-label=\"App 分类\"]'); select.value = 'knowledge'; select.dispatchEvent(new Event('change', {bubbles:true})); }"); await wait();
  assert.equal(await evaluate("document.querySelectorAll('button[aria-pressed]').length"), 1);
  await evaluate("[...document.querySelectorAll('button[aria-pressed]')].find(b => b.textContent.includes('目录工具')).click()"); await wait();
  assert.equal(await evaluate("document.querySelector('[data-selected]').textContent"), 'native');
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '确定').click()"); await wait();
  assert(await evaluate("Boolean(document.querySelector('[aria-label=\"移除 App：目录工具\"]'))"));
  await openMention();
  assert.equal((await mentionState()).count, 20);
  for (const title of ['文件系统', '未授权工具', '空工具服务', '纯页面']) {
    assert(!(await mentionState()).text.includes(title), `${title} must not appear in @ suggestions`);
  }
  // Category headers are not selectable rows; ArrowDown + Enter must select
  // the second App in the same order shown in the grouped @ menu.
  await evaluate("document.querySelector('textarea').focus()");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await wait();
  assert.equal(await evaluate("document.querySelector('[data-selected]').textContent"), 'native,mcp');
  assert.equal(await evaluate("document.querySelector('textarea').value"), '');
  await evaluate("document.querySelector('[data-switch]').click()"); await wait();
  assert.equal(await evaluate("document.querySelector('[data-selected]').textContent"), '');
  await evaluate("document.querySelector('[data-switch]').click()"); await wait();
  assert.equal(await evaluate("document.querySelector('[data-selected]').textContent"), 'native,mcp');

  await openMention();
  const initial = await mentionState();
  assert(initial.title.includes('目录工具'));
  // More than one viewport of Apps, with category headers between rows.
  for (const key of ['Down', 'Up']) {
    for (let index = 1; index < initial.count; index++) {
      await press(key);
      const state = await mentionState();
      assert(state.visible, `${key}: active App scrolled out of view at row ${index}`);
      assert(state.focused, 'arrow navigation must keep focus in the composer');
      assert.equal(state.pageScroll, initial.pageScroll, 'only the suggestion list should scroll');
    }
    const state = await mentionState();
    assert(state.title.includes(key === 'Down' ? '测试工具 18' : '目录工具'));
    if (key === 'Down') assert(state.scrollTop > initial.scrollTop);
  }
  for (let i = 1; i < initial.count; i++) await press('Down');
  for (const char of 'MCP') {
    win.webContents.sendInputEvent({ type: 'char', keyCode: char }); await wait();
  }
  assert.equal((await mentionState()).count, 1);
  assert((await mentionState()).title.includes('MCP 工具'));
  assert((await mentionState()).visible, 'search must reset the active row and scroll');
  for (let i = 0; i < 3; i++) await press('Backspace');
  assert((await mentionState()).title.includes('目录工具'));
  for (let i = 1; i < initial.count; i++) await press('Down');
  await press('Return');
  assert.equal(await evaluate("document.querySelector('[data-selected]').textContent"), 'native,mcp,extra-18');
  assert.equal(await evaluate("document.querySelector('textarea').value"), '');

  await evaluate("document.querySelector('[data-disable-native]').click()"); await wait();
  await openMention();
  assert.equal((await mentionState()).count, 19);
  assert(!(await mentionState()).text.includes('目录工具'), 'even selected disabled Apps must be hidden from @');
  assert(await evaluate("document.querySelector('[aria-label=\"移除 App：目录工具\"]').textContent.includes('不可用')"));
  await press('Escape');
  await evaluate("document.querySelector('[aria-label=\"移除 App：目录工具\"]').click()"); await wait();
  assert.equal(await evaluate("document.querySelector('[data-selected]').textContent"), 'mcp,extra-18');
  console.log('PASS available App filtering, arrow scrolling, search, Enter selection, removal and session isolation');
} catch (error) {
  console.error(error);
  if (win) { const screenshot = '/tmp/moss-app-tool-selection-failure.png'; await fs.writeFile(screenshot, (await win.webContents.capturePage()).toPNG()); console.error(screenshot); }
  process.exitCode = 1;
} finally {
  win?.destroy(); await server?.close(); clearTimeout(watchdog); await fs.rm(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0);
}

}
app.whenReady().then(run);
