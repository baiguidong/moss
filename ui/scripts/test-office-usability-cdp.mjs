// Real Office files, renderer, IPC and queue. Only the model response and Save As
// destination picker are controlled; byte copying and annotation preparation run normally.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchTestInstance } from '../src/app-testing/instance.mjs';
import { resizeDesktopWindow } from './helpers/desktop-viewport.mjs';

const ui = fileURLToPath(new URL('..', import.meta.url)), core = path.dirname(ui);
const output = path.join(core, 'output/office-usability-cdp');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-office-usability-'));
const profile = path.join(directory, 'profile'), workspace = path.join(profile, 'workspace'), id = randomUUID();
const sources = process.argv.slice(2).length ? process.argv.slice(2) : [
  path.join(os.homedir(), 'Downloads/销售订单模拟数据分析报告.docx'),
  path.join(os.homedir(), 'Downloads/mock_sales_orders.xlsx'),
  path.join(os.homedir(), 'Downloads/销售订单模拟数据汇报.pptx'),
];
const modules = path.resolve(core, '../moss-apps/node_modules/.bun');
const version = (await fs.readdir(modules)).filter(n => n.startsWith('playwright@')).sort((a,b) => b.localeCompare(a, undefined, { numeric: true }))[0];
const { chromium } = await import(pathToFileURL(path.join(modules, version, 'node_modules/playwright/index.mjs')));
const checks = [], errors = [], requests = [], files = [];
const mark = text => { checks.push(text); console.log('PASS', text); };
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) { res.end(); return; }
  const body = JSON.parse(Buffer.concat(chunks)); requests.push(body);
  const message = { id: randomUUID(), type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } };
  if (!body.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...message, content: [{ type: 'text', text: '已收到修改要求。' }], stop_reason: 'end_turn' })); return; }
  res.setHeader('Content-Type', 'text/event-stream');
  res.end([{ type: 'message_start', message }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '已收到修改要求。' } }, { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } }, { type: 'message_stop' }].map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const inspectorPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
let target, browser, page, cdp, inspector;
const capture = async name => {
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
};
try {
  await fs.mkdir(output, { recursive: true }); await fs.mkdir(workspace, { recursive: true });
  for (const source of sources) {
    const file = path.join(workspace, path.basename(source)); await fs.copyFile(source, file);
    files.push({ source, file, hash: await hash(file), ext: path.extname(file) });
  }
  const manifest = JSON.parse(await fs.readFile(path.join(ui, 'dist/builtin-apps/manifest.json'), 'utf8'));
  await fs.writeFile(path.join(profile, 'builtin-apps.json'), JSON.stringify({ version: 1, seen: Object.fromEntries(manifest.apps.map(a => [a.id, a.version])) }));
  target = await launchTestInstance({ run: { id, directory, home: profile }, executable: path.join(ui, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [`--inspect=127.0.0.1:${inspectorPort}`, ui], cwd: ui,
    settings: { language: 'chinese', agentMode: 'local', model: 'office-fixture', url: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'test-key', appearance: { themeMode: 'light' }, autoMemory: { enabled: false, extractionEnabled: false } },
    prepareEnvironment: false, runtimeHome: path.join(core, 'output/builtin-skills-cdp/runtime-cache'), signal: new AbortController().signal, timeoutMs: 90000 });
  browser = await chromium.connectOverCDP(target.endpoint);
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes(id)); assert.ok(page); page.setDefaultTimeout(45000);
  cdp = await page.context().newCDPSession(page); await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  cdp.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text));
  const inspection = await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json();
  inspector = new WebSocket(inspection[0].webSocketDebuggerUrl);
  await new Promise(resolve => inspector.addEventListener('open', resolve, { once: true }));
  let seq = 0; const pending = new Map();
  inspector.addEventListener('message', event => { const data = JSON.parse(event.data); if (pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); } });
  const evaluateMain = async expression => {
    const requestId = ++seq;
    const result = await new Promise(resolve => { pending.set(requestId, resolve); inspector.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
    assert.ok(!result.error && !result.result.exceptionDetails, JSON.stringify(result)); return result.result.result.value;
  };
  await evaluateMain(`globalThis.officeElectron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron'); globalThis.officeSaveOriginal = officeElectron.dialog.showSaveDialog; officeElectron.dialog.showSaveDialog = async (win, options) => { globalThis.officeSaveOptions = options || win; return globalThis.officeSaveChoice; }; true`);
  await page.getByRole('button', { name: '插件', exact: true }).first().waitFor();
  await resizeDesktopWindow(target, page, { width: 1440, height: 900 });
  const created = await page.evaluate(workspace => window.agentDesktop.createSession({ title: 'Office 易用性验证', workspace, permissionMode: 'bypassPermissions' }), workspace);
  const sessionId = created.summary.id;
  await page.evaluate(() => localStorage.setItem('ui.panelLayout.v1', JSON.stringify({ leftWidth: 240, leftCollapsed: false, rightWidth: 650, rightExpanded: true, rightCollapsed: false })));
  await page.reload(); await page.getByText('Office 易用性验证', { exact: true }).first().click();
  const pdf = () => page.locator('[data-pdf-preview]').filter({ visible: true });
  const mode = async value => { await page.getByRole('button', { name: '预览模式', exact: true }).click(); await page.getByRole('menuitemradio', { name: value, exact: true }).click(); };
  const open = async file => {
    await page.evaluate(({ sessionId, file }) => window.agentDesktop.presentation.open({ sessionId, input: { items: [{ path: file }] } }), { sessionId, file });
    await page.getByRole('button', { name: '请求修改', exact: true }).waitFor();
    if (file.endsWith('.xlsx')) { await mode('工作表'); await page.locator('[data-cell="A1"]').waitFor(); }
    else await pdf().locator('canvas[data-painted="true"]').first().waitFor();
  };
  for (const [index, item] of files.entries()) {
    await open(item.file);
    assert.equal(await page.locator('[data-preview-header-row]').count(), 1);
    await capture(`0${index + 1}-${item.ext.slice(1)}-preview`);
    await page.getByRole('button', { name: '下载文件', exact: true }).click();
    await page.getByRole('menuitem', { name: '用系统应用打开', exact: true }).waitFor();
    await page.getByRole('menuitem', { name: '在文件夹中显示', exact: true }).waitFor();
    await capture(`0${index + 1}-${item.ext.slice(1)}-download-menu`);
    const saved = path.join(directory, 'saved-' + index + item.ext);
    await evaluateMain(`globalThis.officeSaveChoice = ${JSON.stringify({ canceled: false, filePath: saved })}`);
    await page.getByRole('menuitem', { name: /另存为原文件/ }).click();
    await page.getByText('文件已另存为。', { exact: true }).waitFor();
    assert.equal(await hash(saved), item.hash);
    assert.equal((await evaluateMain('globalThis.officeSaveOptions')).defaultPath, path.basename(item.file));
    if (item.ext === '.docx') assert.equal(await page.getByRole('combobox', { name: '页面缩放' }).inputValue(), 'auto');
    if (item.ext === '.pptx') assert.equal(await page.getByRole('combobox', { name: '页面缩放' }).inputValue(), 'page');
    if (item.ext === '.xlsx') await page.locator('[data-cell="B5"] button').click();
    await page.getByRole('button', { name: '请求修改', exact: true }).click();
    if (item.ext === '.docx') await page.getByRole('combobox', { name: '修改范围' }).selectOption('document');
    const comment = `验证 ${item.ext} 修改要求 ${index}：保持其余内容。`;
    await page.getByRole('textbox', { name: '修改要求' }).fill(comment); await capture(`0${index + 1}-${item.ext.slice(1)}-request-edit`);
    await page.getByRole('button', { name: '发送修改请求', exact: true }).click();
    await page.locator('[data-office-edit-request]').waitFor({ state: 'detached' });
    await page.waitForFunction(sessionId => !document.querySelector('[data-office-edit-request]'), sessionId);
    const end = Date.now() + 60000;
    while (Date.now() < end && !requests.some(r => JSON.stringify(r.messages).includes(comment))) await new Promise(resolve => setTimeout(resolve, 200));
    const sent = requests.find(r => JSON.stringify(r.messages).includes(comment)); assert.ok(sent, 'Request reached model fixture');
    const body = JSON.stringify(sent.messages); assert.ok(body.includes(item.file));
    if (item.ext === '.xlsx') { assert.ok(body.includes('B5')); assert.ok(body.includes('Orders')); }
    if (item.ext === '.pptx') assert.ok(body.includes('pageNumber'));
    await page.waitForFunction(async sessionId => !(await window.agentDesktop.getSession({ sessionId })).busy, sessionId);
    mark(`${item.ext}: original bytes saved; contextual edit request reached the main session`);
  }
  const deck = files.find(f => f.ext === '.pptx'); await open(deck.file);
  await pdf().getByRole('button', { name: '下一页', exact: true }).click();
  // DOM fullscreen starts before macOS completes its native Space animation.
  // Wait for the real window event so screenshots and exit clicks use settled coordinates.
  await evaluateMain(`globalThis.officeMainWindow = officeElectron.BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes(${JSON.stringify(id)})); globalThis.officeFullscreenReady = new Promise(resolve => officeMainWindow.once('enter-full-screen', resolve)); true`);
  await page.getByRole('button', { name: '全屏播放', exact: true }).click();
  await page.waitForFunction(() => document.fullscreenElement?.matches('[data-pdf-preview]'));
  await evaluateMain(`Promise.race([officeFullscreenReady.then(() => true), new Promise((_, reject) => setTimeout(() => reject(new Error('Native fullscreen transition did not complete')), 15000))])`);
  await pdf().locator('[data-pdf-page="2"] canvas[data-painted="true"]').waitFor();
  assert.equal(await pdf().locator('[data-pdf-page]').count(), 1);
  await page.keyboard.press('ArrowRight'); await pdf().locator('[data-pdf-page="3"] canvas[data-painted="true"]').waitFor();
  assert.ok(await pdf().locator('[data-pdf-page]').evaluate(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }));
  await capture('04-pptx-fullscreen');
  await page.getByRole('button', { name: '退出全屏播放' }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  assert.equal(await pdf().getByRole('textbox', { name: '页码' }).inputValue(), '3');
  mark('PPT enters real fullscreen, shows one fitted slide, responds to arrow keys and retains position on exit');
  await page.getByRole('button', { name: '请求修改', exact: true }).click();
  await page.getByRole('button', { name: '在页面上框选区域' }).click();
  const region = await pdf().locator('[data-pdf-page="3"]').boundingBox();
  await page.mouse.move(region.x + region.width * .1, region.y + region.height * .15); await page.mouse.down();
  await page.mouse.move(region.x + region.width * .5, region.y + region.height * .45, { steps: 8 }); await page.mouse.up();
  await page.getByRole('textbox', { name: '标注内容' }).waitFor(); await capture('05-pptx-region-edit');
  await page.getByRole('button', { name: '取消', exact: true }).click(); await page.keyboard.press('Escape');
  mark('Existing page region annotations remain reachable from Request edits');
  const word = files.find(f => f.ext === '.docx'); await open(word.file);
  const before = await pdf().locator('[data-pdf-page="1"]').boundingBox();
  await page.getByRole('button', { name: '恢复左右分栏', exact: true }).click();
  const separator = page.getByRole('separator', { name: '调整会话与内容宽度' });
  for (let i = 0; i < 16; i++) await separator.press('ArrowRight');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('ui.panelLayout.v1')).rightWidth === 320);
  const after = await pdf().locator('[data-pdf-page="1"]').boundingBox(); assert.ok(after.width < before.width);
  assert.equal(await page.getByRole('combobox', { name: '页面缩放' }).inputValue(), 'auto');
  await capture('06-word-narrow-auto');
  for (const item of files) {
    await open(item.file);
    assert.ok(Math.abs((await page.locator('[data-preview-header-row]').boundingBox()).width - 320) < 2, 'Opening another file preserves the manually chosen panel width');
    assert.ok(await page.locator('[data-preview-header-row]').evaluate(el => el.scrollWidth <= el.clientWidth));
    if (item.ext === '.pptx') {
      const slide = await pdf().locator('[data-pdf-page="3"]').boundingBox(), viewport = await pdf().locator('[data-pdf-scroll]').boundingBox();
      assert.ok(Math.abs(slide.y + slide.height / 2 - viewport.y - viewport.height / 2) < 2, 'Fitted slide remains vertically centered when reopened in a narrow panel');
    }
    await capture(`07-${item.ext.slice(1)}-narrow`);
  }
  mark('Word adapts automatically to panel width; all three toolbars fit 320px without wrapping');
  await open(files.find(f => f.ext === '.xlsx').file);
  await page.getByRole('combobox', { name: '工作表缩放' }).selectOption('fit');
  assert.ok(await page.locator('[data-spreadsheet-grid]').evaluate(el => el.scrollWidth <= el.clientWidth + 2));
  await page.getByRole('combobox', { name: '工作表缩放' }).selectOption('100');
  await page.getByRole('button', { name: '更多预览操作' }).click();
  await page.getByRole('menuitemcheckbox', { name: '公式栏', exact: true }).click();
  await page.locator('[data-cell-details]').waitFor();
  await page.getByRole('button', { name: '更多预览操作' }).click();
  await page.getByRole('menuitemcheckbox', { name: '公式栏', exact: true }).click();
  await page.locator('[data-cell-details]').waitFor({ state: 'detached' });
  await evaluateMain(`globalThis.officeSaveChoice = { canceled: true }`);
  await page.getByRole('button', { name: '下载文件' }).click(); await page.getByRole('menuitem', { name: /另存为原文件/ }).click();
  const rejected = await page.evaluate(async sessionId => {
    const snapshot = await window.agentDesktop.presentation.snapshot({ sessionId });
    const artifact = snapshot.resources.find(item => item.source.type === 'file');
    try {
      await window.agentDesktop.send({ sessionId, prompt: 'stale edit', visualizationAnnotation: { id: crypto.randomUUID(), artifactId: artifact.id, revision: 'stale', comment: '不应提交过期修改', selection: { kind: 'document', rect: { x: 0, y: 0, width: 1, height: 1 } } } });
      return '';
    } catch (error) { return String(error.message || error); }
  }, sessionId);
  assert.ok(rejected.includes('文件已更新'));
  mark('Requests for stale file revisions are rejected before reaching the model');

  const popupReady = page.context().waitForEvent('page');
  await page.getByRole('button', { name: '更多预览操作' }).click();
  await page.getByRole('menuitem', { name: '在独立窗口打开', exact: true }).click();
  const popup = await popupReady;
  await popup.getByRole('button', { name: '请求修改', exact: true }).waitFor();
  const standaloneCopy = path.join(directory, 'standalone.xlsx');
  await evaluateMain(`globalThis.officeSaveChoice = ${JSON.stringify({ canceled: false, filePath: standaloneCopy })}`);
  await popup.getByRole('button', { name: '下载文件' }).click();
  await popup.getByRole('menuitem', { name: /另存为原文件/ }).click();
  await popup.getByText('文件已另存为。', { exact: true }).waitFor();
  assert.equal(await hash(standaloneCopy), files.find(f => f.ext === '.xlsx').hash);
  await popup.getByRole('button', { name: '请求修改', exact: true }).click();
  await popup.getByRole('textbox', { name: '修改要求' }).fill('独立窗口的修改要求，请保留原文件。');
  await popup.getByRole('button', { name: '发送修改请求', exact: true }).click();
  await popup.locator('[data-office-edit-request]').waitFor({ state: 'detached' });
  assert.ok(requests.some(r => JSON.stringify(r.messages).includes('独立窗口的修改要求')));
  await popup.screenshot({ path: path.join(output, '08-independent-preview.png') });
  await popup.evaluate(() => window.agentDesktop.preview.close());
  mark('Independent preview windows can save the original and submit edits to the originating session');
  for (const item of files) { assert.equal(await hash(item.source), item.hash); assert.equal(await hash(item.file), item.hash); }
  assert.deepEqual(errors, []);
  mark('Fit-width remains optional for sheets; saving and edit requests preserve all originals');
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ ok: true, checks, errors, files, scope: 'Actual isolated Electron/CDP + Office conversions, real IPC save and model context; destination picker and model response controlled.' }, null, 2));
  await fs.rm(path.join(output, 'failure.png'), { force: true });
} catch (error) {
  console.error('RENDERER_ERRORS', errors); console.error('BODY', (await page?.locator('body').innerText())?.slice(-3500));
  await capture('failure').catch(() => {}); throw error;
} finally {
  inspector?.close(); await browser?.close(); await target?.close();
  await fs.copyFile(path.join(directory, 'instance.log'), path.join(output, 'instance.log')).catch(() => {});
  await fs.rm(directory, { recursive: true, force: true }); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
