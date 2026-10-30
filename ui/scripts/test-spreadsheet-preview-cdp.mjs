// Real Electron/CDP validation. An optional path accepts the reported sales
// workbook; without it, use our synthetic namespaced OOXML regression fixture.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchTestInstance } from '../src/app-testing/instance.mjs';
import { resizeDesktopWindow } from './helpers/desktop-viewport.mjs';
import { styledWorkbook } from '../tests/fixtures/styled-workbook.mjs';

const ui = fileURLToPath(new URL('..', import.meta.url)), core = path.dirname(ui);
const source = process.argv[2] && path.resolve(process.argv[2]);
const output = path.join(core, 'output/compact-preview-cdp', source ? 'sales' : 'fixture');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-spreadsheet-cdp-'));
const home = path.join(directory, 'profile'), workspace = path.join(home, 'self-test-workspace'), id = randomUUID();
const modules = path.resolve(core, '../moss-apps/node_modules/.bun');
const version = (await fs.readdir(modules)).filter(name => name.startsWith('playwright@')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
const { chromium } = await import(pathToFileURL(path.join(modules, version, 'node_modules/playwright/index.mjs')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [], errors = [];
const mark = message => { checks.push(message); console.log('PASS', message); };
let target, browser, page, cdp, geometry;
const capture = async name => {
  // Let menus finish fading before capturing; keep continuous loading indicators running.
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
};
try {
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  const bytes = source ? await fs.readFile(source) : await styledWorkbook(), originalHash = sha(bytes);
  const file = path.join(workspace, source ? path.basename(source) : 'styled-workbook.xlsx');
  await fs.writeFile(file, bytes);
  // This test only previews a local workbook; no creation Apps are needed.
  const manifest = JSON.parse(await fs.readFile(path.join(ui, 'dist/builtin-apps/manifest.json'), 'utf8'));
  await fs.writeFile(path.join(home, 'builtin-apps.json'), JSON.stringify({ version: 1, seen: Object.fromEntries(manifest.apps.map(app => [app.id, app.version])) }));
  target = await launchTestInstance({ run: { id, directory, home }, executable: path.join(ui, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [ui], cwd: ui,
    settings: { language: 'chinese', agentMode: 'local', model: 'preview-test', url: 'http://127.0.0.1:9/v1', apiKey: 'test-key', appearance: { themeMode: 'light' }, autoMemory: { enabled: false, extractionEnabled: false } },
    prepareEnvironment: false, runtimeHome: path.join(core, 'output/builtin-skills-cdp/runtime-cache'), signal: new AbortController().signal, timeoutMs: 90000 });
  browser = await chromium.connectOverCDP(target.endpoint);
  page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes(id));
  assert.ok(page); page.setDefaultTimeout(45000);
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
  await page.getByRole('button', { name: '插件', exact: true }).first().waitFor();
  geometry = await resizeDesktopWindow(target, page, { width: 1440, height: 900 });
  const created = await page.evaluate(workspace => window.agentDesktop.createSession({ title: '表格样式验证', workspace, permissionMode: 'bypassPermissions' }), workspace);
  const sessionId = created.summary.id;
  await page.evaluate(() => localStorage.setItem('ui.panelLayout.v1', JSON.stringify({ leftWidth: 240, leftCollapsed: false, rightWidth: 650, rightCollapsed: false, rightExpanded: false })));
  await page.reload(); await page.getByText('表格样式验证', { exact: true }).first().click();
  await page.evaluate(({ sessionId, file }) => window.agentDesktop.presentation.open({ sessionId, input: { items: [{ path: file }] } }), { sessionId, file });
  await page.getByRole('button', { name: '预览模式', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '工作表', exact: true }).click();
  await page.locator('[data-cell="A1"]').waitFor();
  assert.equal(await page.locator('[data-cell-details]').count(), 0);
  assert.equal(await page.locator('[data-preview-header-row]').count(), 1);
  const compactHeader = await page.locator('[data-preview-header-row]').boundingBox();
  const gridBox = await page.locator('[data-spreadsheet-grid]').boundingBox();
  assert.ok(Math.abs(gridBox.y - compactHeader.y - compactHeader.height) < 1);
  mark('One file toolbar replaces three stacked rows; formula bar starts collapsed');
  await capture('01-split');
  const separator = page.getByRole('separator', { name: '调整会话与内容宽度' });
  target.focus(); await page.bringToFront();
  await separator.hover();
  const divider = await separator.boundingBox();
  if (divider) {
    await page.evaluate(() => {
      window.previewDragTrace = [];
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'lostpointercapture', 'blur']) window.addEventListener(type, event => {
        if (window.previewDragTrace.length < 30) window.previewDragTrace.push({ type, x: event.clientX, target: event.target?.getAttribute?.('role'), resizing: document.body.classList.contains('layout-resizing'), layout: localStorage.getItem('ui.panelLayout.v1') });
      });
    });
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => document.body.classList.contains('layout-resizing'));
    await page.mouse.move(40, divider.y + divider.height / 2, { steps: 16 }); await page.mouse.up();
  }
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('ui.panelLayout.v1')).rightExpanded === true, null, { timeout: 5000 }).catch(async error => { console.error('DRAG', await page.evaluate(() => window.previewDragTrace)); throw error; });
  mark('Dragging expands the actual preview to tabbed full width');
  assert.equal(await page.locator('[data-preview-header-row]').getByText(path.basename(file), { exact: true }).count(), 0);
  await page.getByRole('tab', { name: `内容：${path.basename(file)}`, exact: true }).waitFor();
  await capture('02-full-collapsed');
  await page.getByRole('button', { name: '更多预览操作', exact: true }).click();
  for (const name of ['刷新预览', '用系统应用打开', '在独立窗口打开', '关闭当前内容']) await page.getByRole('menuitem', { name, exact: true }).waitFor();
  await capture('03-actions-menu');
  await page.keyboard.press('Escape');
  mark('Full-width preview shows filename only in its top tab; actions share one menu');
  const style = cell => page.locator(`[data-cell="${cell}"]`).evaluate(element => {
    const s = getComputedStyle(element), r = element.getBoundingClientRect();
    return { color: s.color, background: s.backgroundColor, size: s.fontSize, weight: s.fontWeight, width: r.width, height: r.height, top: r.top };
  });
  assert.equal((await style('A1')).color, 'rgb(31, 78, 120)');
  assert.equal((await style('A1')).weight, '700');
  assert.ok(Math.abs(parseFloat((await style('A1')).size) - 16 * 4 / 3) < 0.1);
  const header = source ? 'A10' : 'A3', stripe = source ? 'A11' : 'A4', canceled = source ? 'J51' : 'D4', pending = source ? 'J13' : 'D5';
  assert.equal((await style(header)).background, 'rgb(31, 78, 120)');
  assert.equal((await style(header)).color, 'rgb(255, 255, 255)');
  assert.equal((await style(stripe)).background, 'rgb(193, 229, 245)');
  assert.equal((await style(canceled)).background, 'rgb(254, 226, 226)');
  assert.equal((await style(pending)).background, 'rgb(254, 243, 199)');
  assert.equal(await page.locator('[data-cell-data-bar]').count(), source ? 60 : 3);
  mark('Original fonts, header fills, theme bands, status colors and data bars render through real IPC');
  const formulaCell = source ? 'B5' : 'C4';
  await page.locator(`[data-cell="${formulaCell}"] button`).click();
  await page.getByRole('button', { name: '公式栏', exact: true }).click();
  assert.match(await page.locator('[data-cell-details]').innerText(), /=/);
  await capture('04-formula-expanded');
  const frozenBefore = await style(header);
  if (source) {
    await page.locator('[data-spreadsheet-grid]').evaluate(element => {
      const first = element.querySelector('[data-cell="A11"]'), target = element.querySelector('[data-cell="A51"]');
      element.scrollTop = target.getBoundingClientRect().top - first.getBoundingClientRect().top;
    });
    await page.waitForFunction(() => document.querySelector('[data-spreadsheet-grid]').scrollTop > 500);
    const frozenAfter = await style(header);
    assert.ok(Math.abs(frozenBefore.top - frozenAfter.top) < 1);
    assert.ok((await style('A51')).top >= frozenAfter.top + frozenAfter.height - 1);
    assert.ok((await style('A51')).top < frozenAfter.top + frozenAfter.height + 2);
    await capture('03-frozen-row-51');
    mark('Scrolling to row 51 preserves all ten frozen rows, matching the reference');
  }
  await page.getByRole('combobox', { name: '工作表缩放' }).selectOption('75');
  assert.ok((await style('A1')).height < frozenBefore.height);
  await capture('04-zoom-75');
  await page.getByRole('combobox', { name: '工作表缩放' }).selectOption('100');
  geometry = await resizeDesktopWindow(target, page, { width: 1000, height: 800 });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.dataset.theme = 'dark'; });
  assert.equal((await style(header)).color, 'rgb(255, 255, 255)');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture('05-narrow-dark');
  mark('Zoom, formula selection and narrow dark desktop preserve readability');
  await page.getByRole('button', { name: '公式栏', exact: true }).click();
  await page.getByRole('button', { name: '恢复左右分栏', exact: true }).click();
  await separator.focus();
  for (let step = 0; step < 16; step++) await separator.press('ArrowRight');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('ui.panelLayout.v1')).rightWidth === 320);
  const narrowHeader = page.locator('[data-preview-header-row]');
  assert.ok(await narrowHeader.evaluate(element => element.scrollWidth <= element.clientWidth));
  for (const label of ['预览模式', '工作表缩放', '公式栏', '更多预览操作']) {
    const control = page.getByLabel(label, { exact: true });
    const box = await control.boundingBox(), headerBox = await narrowHeader.boundingBox();
    assert.ok(box.x >= headerBox.x && box.x + box.width <= headerBox.x + headerBox.width + 1);
    assert.ok(box.y >= headerBox.y && box.y + box.height <= headerBox.y + headerBox.height + 1);
  }
  await capture('06-narrow-320');
  mark('All controls fit a 320px pane in one row without overflow');
  await page.reload();
  await page.getByText('表格样式验证', { exact: true }).first().click();
  await page.getByRole('button', { name: '预览模式', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '工作表', exact: true }).click();
  await page.locator('[data-cell="A1"]').waitFor();
  assert.equal(await page.locator('[data-cell-details]').count(), 0);
  await page.getByRole('button', { name: '公式栏', exact: true }).click();
  await page.reload();
  await page.getByText('表格样式验证', { exact: true }).first().click();
  await page.getByRole('button', { name: '预览模式', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '工作表', exact: true }).click();
  await page.locator('[data-cell-details]').waitFor();
  mark('Both expanded and collapsed formula bar preferences survive desktop reload');
  const secondFile = path.join(workspace, '销售订单_用于验证很长文件名在窄面板中的显示与已打开文件切换.xlsx');
  await fs.writeFile(secondFile, bytes);
  await page.evaluate(({ sessionId, file }) => window.agentDesktop.presentation.open({ sessionId, input: { items: [{ path: file }] } }), { sessionId, file: secondFile });
  await page.getByRole('button', { name: '切换已打开内容', exact: true }).waitFor();
  await page.locator('[data-cell="A1"]').waitFor();
  assert.ok(await narrowHeader.evaluate(element => element.scrollWidth <= element.clientWidth));
  await capture('07-long-filename');
  await page.getByRole('button', { name: '切换已打开内容', exact: true }).click();
  await page.getByRole('menuitemradio').filter({ has: page.getByText(path.basename(file), { exact: true }) }).click();
  await page.getByRole('button', { name: '切换已打开内容', exact: true }).filter({ hasText: path.basename(file) }).waitFor();
  await page.getByRole('button', { name: '更多预览操作', exact: true }).click();
  const popupPromise = page.context().waitForEvent('page');
  await page.getByRole('menuitem', { name: '在独立窗口打开', exact: true }).click();
  const popup = await popupPromise;
  await popup.getByRole('button', { name: '更多预览操作', exact: true }).waitFor();
  assert.equal(await popup.locator('[data-preview-header-row]').count(), 1);
  await popup.getByRole('button', { name: '更多预览操作', exact: true }).click();
  await popup.getByRole('menuitem', { name: '关闭预览窗口', exact: true }).click();
  mark('Long filenames, switching open files and the independent preview window remain usable');
  if (source) assert.equal(sha(await fs.readFile(source)), originalHash);
  assert.equal(sha(await fs.readFile(file)), originalHash);
  assert.deepEqual(errors, []);
  const log = await fs.readFile(path.join(directory, 'instance.log'), 'utf8');
  assert.doesNotMatch(log, /\[xmldom (?:error|fatalError)\]/);
  mark('Original file hash unchanged; no renderer exceptions or xmldom errors');
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ ok: true, source: source || 'synthetic fixture', originalHash, checks, errors, geometry, scope: 'Real isolated Electron window, native resizing, main-process conversion and CDP screenshots. No model calls.' }, null, 2));
} catch (error) {
  console.error('BROWSER_ERRORS', errors);
  console.error('BODY', (await page?.locator('body').innerText())?.slice(0, 2500));
  await capture('failure').catch(() => {});
  throw error;
} finally {
  await browser?.close(); await target?.close();
  await fs.copyFile(path.join(directory, 'instance.log'), path.join(output, 'instance.log')).catch(() => {});
  await fs.rm(directory, { recursive: true, force: true });
}
