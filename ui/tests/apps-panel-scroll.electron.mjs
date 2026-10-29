// Run from ui: ./node_modules/.bin/electron tests/apps-panel-scroll.electron.mjs
// Native card focus and scroll geometry require Chromium, not static markup.
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const uiRoot = fileURLToPath(new URL('..', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-apps-scroll-'));
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});
const delay = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
let server;
let win;
const watchdog = setTimeout(() => app.exit(1), 60_000);
const capture = async name => {
  if (!process.env.APPS_PANEL_SCROLL_SCREENSHOTS || !win) return;
  await fs.mkdir(process.env.APPS_PANEL_SCROLL_SCREENSHOTS, { recursive: true });
  await fs.writeFile(path.join(process.env.APPS_PANEL_SCROLL_SCREENSHOTS, `${name}.png`), (await win.webContents.capturePage()).toPNG());
};

async function run() {
  try {
    server = await createServer({
      root: uiRoot,
      configFile: path.join(uiRoot, 'vite.config.ts'),
      cacheDir: path.join(temp, 'vite'),
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    });
    await server.listen();
    win = new BrowserWindow({ show: false, width: 1400, height: 800, useContentSize: true });
    const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`);
    await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/apps-panel-scroll.html`);
    for (let i = 0; i < 100; i++) {
      if (await evaluate(() => document.querySelectorAll('[data-app-market-open]').length === 24)) break;
      await delay();
    }
    assert.equal(await evaluate(() => document.querySelector('[data-app-hub-tab="marketplace"]').getAttribute('aria-selected')), 'true');
    assert.equal(await evaluate(() => document.querySelectorAll('[data-app-market-open]').length), 24);
    assert.equal(await evaluate(() => {
      const cards = [...document.querySelectorAll('[data-app-category]')];
      return cards.filter(card => card.getBoundingClientRect().top === cards[0].getBoundingClientRect().top).length;
    }), 3, 'desktop marketplace has three cards per row');
    assert.equal(await evaluate(() => [...document.querySelectorAll('[data-app-category]')].every(card => card.querySelectorAll('button').length === 1 && !card.querySelector('input, select'))), true);
    assert.doesNotMatch(await evaluate(() => document.querySelector('[data-app-category]').textContent), /已启用|已安装|1\.0\.0|AI 工具|按需运行/);
    await capture('marketplace-default');
    await evaluate(() => document.querySelector('[data-app-hub-tab="installed"]').click());
    await delay();
    assert.equal(await evaluate(() => document.querySelectorAll('[data-app-open]').length), 24);

    const geometry = () => evaluate(() => {
      const scroller = document.querySelector('main .overflow-y-auto');
      const rect = element => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom });
      const ancestors = [];
      for (let element = scroller.parentElement; element; element = element.parentElement) {
        ancestors.push({ tag: element.tagName, scrollTop: element.scrollTop, scrollLeft: element.scrollLeft });
      }
      return {
        ancestors, scrollTop: scroller.scrollTop,
        viewport: rect(scroller), chrome: rect(document.querySelector('[data-window-chrome]')),
        header: rect(document.querySelector('[data-app-header]')), first: rect(document.querySelector('section')),
        last: rect([...document.querySelectorAll('section')].at(-1)), height: innerHeight,
      };
    });
    const assertShell = state => {
      for (const ancestor of state.ancestors) {
        assert.equal(ancestor.scrollTop, 0, `${ancestor.tag} scrolled outside the App list`);
        assert.equal(ancestor.scrollLeft, 0, `${ancestor.tag} shifted horizontally`);
      }
      assert.equal(state.chrome.top, 0, 'window chrome moved above the window');
      assert(state.header.top >= state.chrome.bottom, 'Apps header was clipped');
      assert.equal(state.viewport.bottom, state.height, 'App list no longer fills the window');
    };

    for (const width of [1400, 900]) {
      win.setContentSize(width, 800);
      await delay();
      assert.equal(await evaluate(() => {
        const cards = [...document.querySelectorAll('[data-app-category]')];
        return cards.filter(card => card.getBoundingClientRect().top === cards[0].getBoundingClientRect().top).length;
      }), width === 1400 ? 3 : 2);
      for (const position of ['middle', 'bottom']) {
        await evaluate(position => {
          const scroller = document.querySelector('main .overflow-y-auto');
          scroller.scrollTop = position === 'middle' ? 500 : scroller.scrollHeight;
        }, position);
        await delay();
        const before = await geometry();
        assertShell(before);
        const target = await evaluate(() => {
          const bounds = document.querySelector('main .overflow-y-auto').getBoundingClientRect();
          const buttons = [...document.querySelectorAll('[data-app-open]')];
          const button = buttons.find(button => { const rect = button.getBoundingClientRect(); return rect.top >= bounds.top + 20 && rect.bottom <= bounds.bottom - 20; });
          const rect = button.getBoundingClientRect();
          return { index: buttons.indexOf(button), name: button.dataset.appOpen, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        });
        win.webContents.focus();
        for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: target.x, y: target.y, button: 'left', clickCount: 1 });
        await delay();
        assert.equal(await evaluate(() => document.querySelector('[data-launched]').textContent), target.name);
        assertShell(await geometry());
        assert.equal((await geometry()).scrollTop, before.scrollTop, 'opening a visible card jumped the list');
        await evaluate(index => document.querySelectorAll('[data-app-open]')[index].focus(), target.index);
        for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Enter' });
        await delay();
        assert.equal(await evaluate(() => document.querySelector('[data-launched]').textContent), target.name);
        assertShell(await geometry());
        assert.equal((await geometry()).scrollTop, before.scrollTop, 'keyboard activation jumped the list');
        console.log(`PASS ${width}px ${position}: display-only cards open details with mouse and keyboard without shifting content`);

      }
      for (const bottom of [true, false]) {
        await evaluate(bottom => {
          const scroller = document.querySelector('main .overflow-y-auto');
          scroller.scrollTop = bottom ? scroller.scrollHeight : 0;
        }, bottom);
        await delay();
        const state = await geometry();
        assertShell(state);
        if (bottom) assert(state.last.bottom <= state.viewport.bottom, 'last App is cut off');
        else assert(state.first.top >= state.viewport.top, 'first App is cut off');
        await capture(`${width}-${bottom ? 'bottom' : 'top'}`);
      }
      console.log(`PASS ${width}px: first and last Apps remain fully reachable`);
    }
    assert(await evaluate(() => document.querySelector('[data-app-header]').getBoundingClientRect().height <= 90), 'App toolbar wraps without clipping');
    assert.equal(await evaluate(() => document.querySelectorAll('main input[aria-label="搜索应用"]').length), 1);
    assert.deepEqual(await evaluate(() => [...document.querySelectorAll('[aria-label="App 分类"] [role="tab"]')].map(tab => tab.textContent)),
      ['全部24', '沟通协作4', '文档与知识4', '开发工具4', '自动化4', 'AI 与智能体4', '诊断与安全4']);
    await evaluate(() => document.getElementById('installed-apps-automation').click());
    await delay();
    assert.equal(await evaluate(() => document.querySelectorAll('[data-app-open]').length), 4);
    assert.deepEqual(await evaluate(() => [...new Set([...document.querySelectorAll('main [data-app-category]')].map(card => card.dataset.appCategory))]), ['automation']);
    await capture('category-automation');
    await evaluate(() => document.getElementById('installed-apps-automation').focus());
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Right' });
    await delay();
    assert.equal(await evaluate(() => document.activeElement.id), 'installed-apps-ai');
    assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-selected')), 'true');
    assert.deepEqual(await evaluate(() => [...new Set([...document.querySelectorAll('main [data-app-category]')].map(card => card.dataset.appCategory))]), ['ai']);
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Home' });
    await delay();
    assert.equal(await evaluate(() => document.querySelectorAll('[data-app-open]').length), 24);
    assert.equal(await evaluate(() => document.activeElement.id), 'installed-apps-all');
    console.log('PASS compact header, category tabs and keyboard navigation with App search');

    const search = async value => {
      await evaluate(value => {
        const input = document.querySelector('main input[aria-label="搜索应用"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
      await delay();
    };
    const categoryLabels = () => evaluate(() => [...document.querySelectorAll('[aria-label="App 分类"] [role="tab"]')].map(tab => tab.textContent));
    await search('Chrome');
    assert.deepEqual(await categoryLabels(), ['全部1', '自动化1']);
    assert.equal(await evaluate(() => document.querySelectorAll('main [data-app-category]').length), 1);
    await evaluate(() => document.getElementById('installed-apps-automation').click());
    await search('scroll.app-0');
    assert.deepEqual(await categoryLabels(), ['全部1', '沟通协作1']);
    assert.equal(await evaluate(() => document.querySelector('[aria-label="App 分类"] [aria-selected="true"]')?.id), 'installed-apps-all');
    assert.equal(await evaluate(() => document.querySelectorAll('main [data-app-category]').length), 1);
    await search('');
    assert.equal(await evaluate(() => document.querySelectorAll('main [data-app-category]').length), 24);
    console.log('PASS installed App search updates category counts and resets an absent category');

    const moreTrigger = await evaluate(() => {
      const rect = document.querySelector('[aria-label="更多功能"]').getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    });
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...moreTrigger, button: 'left', clickCount: 1 });
    await delay();
    assert.equal(await evaluate(() => document.querySelectorAll('[role="menuitem"][data-app-id]').length), 24);
    assert.equal(await evaluate(() => document.querySelectorAll('[role="menu"] input').length), 0);
    assert(await evaluate(() => ['沟通协作', '文档与知识', '开发工具', '自动化', 'AI 与智能体', '诊断与安全'].every(label => document.querySelector('[role="menu"]').textContent.includes(label))));
    await capture('more-categories');
    await evaluate(() => document.querySelector('[role="menuitem"][data-app-id="scroll.app-2"]').click());
    await delay();
    assert.equal(await evaluate(() => document.querySelector('[data-launched]').textContent), 'scroll.app-2');
    console.log('PASS More category headings, no search field and launching an App');

    await evaluate(() => document.querySelector('[data-app-hub-tab=marketplace]').click());
    await delay();
    assert.equal(await evaluate(() => document.querySelectorAll('main [data-app-category]').length), 24);
    assert(await evaluate(() => document.querySelector('[data-app-header]').getBoundingClientRect().height <= 90), 'Marketplace toolbar wraps without clipping');
    assert.equal(await evaluate(() => document.querySelectorAll('main input[aria-label="搜索应用"]').length), 1);
    await search('Chrome');
    assert.deepEqual(await categoryLabels(), ['全部1', '自动化1']);
    assert.equal(await evaluate(() => document.querySelectorAll('main [data-app-category]').length), 1);
    await search('');
    await evaluate(() => document.getElementById('marketplace-apps-development').click());
    await delay();
    assert.deepEqual(await evaluate(() => [...new Set([...document.querySelectorAll('main [data-app-category]')].map(card => card.dataset.appCategory))]), ['development']);
    assert.equal(await evaluate(() => document.querySelectorAll('main section').length), 4);
    await capture('marketplace-category');
    await evaluate(() => { const card = document.querySelector('[data-app-market-open="scroll.app-4"]'); card.focus(); card.click(); });
    for (let i = 0; i < 100; i++) { if (await evaluate(() => !!document.querySelector('[data-app-market-details] select'))) break; await delay(); }
    assert.equal(await evaluate(() => document.activeElement === document.querySelector('[aria-label="市场详情导航"] button')), true);
    assert(await evaluate(() => document.querySelector('[data-app-market-details]').textContent.includes('本地版本和源码仍保留')));
    assert.equal(await evaluate(() => [...document.querySelectorAll('[data-app-market-details] button')].find(button => button.textContent === '安装市场版')?.disabled), false);
    await capture('marketplace-details');
    await evaluate(() => [...document.querySelectorAll('[data-app-market-details] button')].find(button => button.textContent === '安装市场版').click());
    await delay();
    assert(await evaluate(() => document.querySelector('[data-app-market-details]').textContent.includes('已安装版本1.0.0')));
    assert.equal(await evaluate(() => [...document.querySelectorAll('[data-app-market-details] button')].find(button => button.textContent === '已安装')?.disabled), true);
    await evaluate(() => document.querySelector('[aria-label="市场详情导航"] button').click());
    await delay();
    assert.equal(await evaluate(() => document.getElementById('marketplace-apps-development').getAttribute('aria-selected')), 'true');
    assert.equal(await evaluate(() => document.activeElement.dataset.appMarketOpen), 'scroll.app-4');
    assert.equal(await evaluate(() => document.querySelectorAll('main section').length), 4);
    console.log('PASS market detail install preserves local rollback, updates the installed version and returns to the filtered list');
    console.log('PASS marketplace uses category tabs and a compact header with App search');
  } catch (error) {
    console.error(error);
    await capture('failure');
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    win?.destroy();
    await server?.close();
    await fs.rm(temp, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
}

app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
