// Isolated browser regression: real file HTTP endpoints and Web transport, no model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { startWebServer } from '../src/web/server.mjs';
import { createRequestRegistry } from '../src/host/request-registry.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-picker-browser-'));
const harness = await fs.mkdtemp(path.join(uiRoot, 'tests', '.web-picker-'));
const output = process.env.MOSS_WEB_TEST_OUTPUT;
const workspace = path.join(home, '云电脑资料');
const empty = path.join(workspace, '空 文件夹');
const errors = [];
const touched = [];
let host, vite, browser;
try {
  await fs.mkdir(empty, { recursive: true });
  await fs.mkdir(path.join(workspace, '.hidden'));
  await fs.writeFile(path.join(workspace, '报告.txt'), 'cloud file contents');
  await fs.writeFile(path.join(workspace, '技能.ZIP'), 'test archive');
  const registry = createRequestRegistry();
  registry.handle('agent:list-workspaces', () => []);
  registry.handle('agent:touch-workspace', (_context, input) => { touched.push(input.path); return { path: input.path }; });
  registry.handle('agent:get-session', () => ({ id: 'test-session', agentMode: 'local', workspace }));
  const env = { MOSS_WEB_TOKEN: 'file-browser-test-token-for-isolated-host', MOSS_WEB_PORT: '0' };
  host = await startWebServer({ registry, home, rendererRoot: harness, env });
  const target = `http://127.0.0.1:${host.address.port}`;
  await fs.writeFile(path.join(harness, 'index.html'), '<html><head></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
  await fs.writeFile(path.join(harness, 'main.tsx'), `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { initializeHostClient } from '../../src/renderer-react/web-bootstrap';
    import { WorkspaceSelector } from '../../src/renderer-react/components/workspace-selector';
    import { FilePreview } from '../../src/renderer-react/components/file-preview';
    await initializeHostClient();
    const api = window.agentDesktop;
    const record = (value) => { window.testResult = value; };
    const run = (operation) => { window.testResult = 'pending'; operation().then(record).catch(error => { window.testResult = { error: error.message }; }); };
    createRoot(document.getElementById('root')).render(<main style={{ padding: 32 }}>
      <WorkspaceSelector onChange={record} />
      <button onClick={() => run(() => api.pickDirectory())}>选目录</button>
      <button onClick={() => run(() => api.pickFiles())}>选附件</button>
      <button onClick={() => run(() => api.skillHub.openImportDialog())}>导入技能</button>
      <button onClick={() => run(() => api.openWorkspace({ sessionId: 'test-session' }))}>打开工作区</button>
      <button onClick={() => run(() => api.shell.showItemInFolder(${JSON.stringify(path.join(workspace, '报告.txt'))}))}>定位报告</button>
      <FilePreview path={${JSON.stringify(path.join(workspace, '报告.txt'))}} name="报告.txt" />
    </main>);
  `);
  vite = await createServer({ root: uiRoot, configFile: path.join(uiRoot, 'vite.config.ts'), logLevel: 'error',
    server: { port: 0, strictPort: false, hmr: false, proxy: { '/api': { target, ws: true, changeOrigin: true } } } });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  env.MOSS_WEB_ORIGIN = origin;
  browser = await chromium.launch({ channel: process.env.MOSS_WEB_TEST_BROWSER || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { errors.push(`Unexpected native ${dialog.type()}`); void dialog.dismiss(); });
  await page.goto(`${origin}/tests/${path.basename(harness)}/index.html`);
  await page.getByLabel('访问密钥', { exact: true }).fill(env.MOSS_WEB_TOKEN);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '选目录', exact: true }).waitFor();
  const dialog = () => page.getByRole('dialog').filter({ has: page.locator('#moss-file-browser-title') });
  const go = async directory => {
    await page.waitForFunction(() => document.querySelector('[aria-label="云电脑文件列表"]')?.getAttribute('aria-busy') === 'false');
    await dialog().getByRole('textbox', { name: '云电脑目录路径' }).fill(directory);
    await dialog().getByRole('button', { name: '前往', exact: true }).click();
    await page.waitForFunction(directory => document.querySelector('input[aria-label="云电脑目录路径"]')?.value === directory
      && document.querySelector('[aria-label="云电脑文件列表"]')?.getAttribute('aria-busy') === 'false', directory);
  };
  const cancel = async () => { await dialog().getByRole('button', { name: '取消', exact: true }).click(); await dialog().waitFor({ state: 'detached' }); };
  // The real Radix menu must release focus/pointer capture when the browser opens.
  await page.getByRole('button', { name: '选择工作空间', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开云电脑文件夹' }).click();
  await go(workspace);
  assert.equal(await dialog().getByRole('button', { name: '选择文件 报告.txt' }).count(), 0);
  await dialog().getByRole('button', { name: '打开文件夹 空 文件夹' }).click();
  await dialog().getByText('此目录下没有子文件夹，可选择当前文件夹。', { exact: true }).waitFor();
  await dialog().getByRole('button', { name: '选择此文件夹', exact: true }).click();
  await page.waitForFunction(expected => window.testResult === expected, empty);
  assert.equal(touched.at(-1), empty);

  await page.getByRole('button', { name: '选目录', exact: true }).click();
  await go(workspace);
  await dialog().getByRole('checkbox', { name: '显示隐藏项' }).check();
  await dialog().getByRole('button', { name: '打开文件夹 .hidden' }).waitFor();
  await dialog().getByRole('textbox', { name: '云电脑目录路径' }).fill(path.join(home, 'missing'));
  assert.equal(await dialog().getByRole('button', { name: '选择此文件夹' }).isDisabled(), true);
  await dialog().getByRole('button', { name: '前往', exact: true }).click();
  await dialog().getByRole('alert').filter({ hasText: '不存在' }).waitFor();
  assert.equal(await dialog().getByRole('button', { name: '选择此文件夹' }).isDisabled(), true);
  await go(empty);
  await dialog().getByRole('button', { name: '返回上级目录' }).click();
  await dialog().getByRole('button', { name: '打开文件夹 空 文件夹' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.testResult === null);

  // A slow directory response must not overwrite a path being edited.
  let releaseListing;
  const listingHeld = new Promise(resolve => { releaseListing = resolve; });
  let reportHeld;
  const listingRequested = new Promise(resolve => { reportHeld = resolve; });
  const holdListing = async route => {
    if (new URL(route.request().url()).searchParams.get('path') !== workspace) { await route.continue(); return; }
    reportHeld();
    await listingHeld;
    await route.continue();
  };
  await page.route('**/api/file-browser?*', holdListing);
  await page.getByRole('button', { name: '选目录', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="云电脑文件列表"]')?.getAttribute('aria-busy') === 'false');
  await dialog().getByRole('textbox', { name: '云电脑目录路径' }).fill(workspace);
  await dialog().getByRole('button', { name: '前往', exact: true }).click();
  await listingRequested;
  await dialog().getByRole('textbox', { name: '云电脑目录路径' }).fill(empty);
  releaseListing();
  await page.waitForFunction(() => document.querySelector('[aria-label="云电脑文件列表"]')?.getAttribute('aria-busy') === 'false');
  assert.equal(await dialog().getByRole('textbox', { name: '云电脑目录路径' }).inputValue(), empty);
  assert.equal(await dialog().getByRole('button', { name: '选择此文件夹' }).isDisabled(), true);
  await page.unroute('**/api/file-browser?*', holdListing);
  await cancel();

  await page.getByRole('button', { name: '选附件', exact: true }).click();
  await go(workspace);
  await dialog().getByRole('button', { name: '选择文件 报告.txt' }).click();
  await dialog().getByRole('button', { name: '选择文件 技能.ZIP' }).click();
  await dialog().getByRole('button', { name: '选择文件（2）', exact: true }).click();
  await page.waitForFunction(() => Array.isArray(window.testResult) && window.testResult.length === 2);
  const files = await page.evaluate(() => window.testResult);
  assert.ok(files.every(file => file.path.startsWith(workspace)));

  await page.getByRole('button', { name: '选附件', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await dialog().getByRole('button', { name: '从本机上传' }).click();
  await (await chooser).setFiles({ name: '本机.txt', mimeType: 'text/plain', buffer: Buffer.from('uploaded from browser') });
  await page.waitForFunction(() => Array.isArray(window.testResult) && window.testResult[0]?.name === '本机.txt');
  const uploaded = await page.evaluate(() => window.testResult[0]);
  assert.equal(await fs.readFile(uploaded.path, 'utf8'), 'uploaded from browser');
  await page.getByRole('button', { name: '选附件', exact: true }).click();
  await cancel();
  assert.deepEqual(await page.evaluate(() => window.testResult), []);

  await page.getByRole('button', { name: '导入技能', exact: true }).click();
  await go(workspace);
  assert.equal(await dialog().getByRole('button', { name: '选择文件 报告.txt' }).count(), 0);
  await dialog().getByRole('button', { name: '选择文件 技能.ZIP' }).click();
  await dialog().getByRole('button', { name: '选择文件', exact: true }).click();
  await page.waitForFunction(() => window.testResult?.success === true);
  assert.equal((await page.evaluate(() => window.testResult)).data.filePath, path.join(workspace, '技能.ZIP'));
  await page.getByRole('button', { name: '导入技能', exact: true }).click();
  await cancel();
  assert.equal((await page.evaluate(() => window.testResult)).error, 'Canceled');

  await page.getByRole('button', { name: '打开工作区', exact: true }).click();
  await dialog().getByRole('link', { name: '下载 报告.txt' }).waitFor();
  const downloadEvent = page.waitForEvent('download');
  await dialog().getByRole('link', { name: '下载 报告.txt' }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), '报告.txt');
  assert.equal(await fs.readFile(await download.path(), 'utf8'), 'cloud file contents');
  await dialog().getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '定位报告', exact: true }).click();
  await dialog().getByRole('link', { name: '下载 报告.txt' }).waitFor();
  assert.ok(await dialog().getByRole('link', { name: '下载 报告.txt' }).evaluate(node => node.parentElement.classList.contains('bg-primary/10')));
  await dialog().getByRole('textbox', { name: '搜索当前目录' }).fill('报告');
  await dialog().getByRole('link', { name: '下载 报告.txt' }).waitFor();
  assert.equal(await dialog().getByRole('textbox', { name: '云电脑目录路径' }).inputValue(), workspace);
  if (output) {
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'cloud-files.png') });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: path.join(output, 'cloud-files-dark.png') });
  }
  await dialog().getByRole('button', { name: '关闭', exact: true }).click();
  // File-card reveal opens from another Radix menu, as in normal conversations.
  await page.getByRole('button', { name: '报告.txt 操作' }).click();
  await page.getByRole('menuitem', { name: '在文件夹中显示' }).click();
  await dialog().getByRole('link', { name: '下载 报告.txt' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await dialog().boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  if (output) await page.screenshot({ path: path.join(output, 'cloud-files-mobile.png') });
  await page.setViewportSize({ width: 844, height: 390 });
  const shortBounds = await dialog().boundingBox();
  assert.ok(shortBounds.y >= 0 && shortBounds.y + shortBounds.height <= 390);
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, directorySelection: true, validation: true, cancel: true, attachments: true, upload: true, skillImport: true, workspace: true, reveal: true, download: true, mobile: true }));
} finally {
  await browser?.close();
  await vite?.close();
  await host?.close();
  await fs.rm(harness, { recursive: true, force: true });
  await fs.rm(home, { recursive: true, force: true });
}
