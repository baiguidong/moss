import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import { prepareVisualizationAnnotation } from '../src/apps/visualization-annotations.mjs';

const ui = fileURLToPath(new URL('..', import.meta.url));
const apps = process.env.MOSS_APPS_ROOT || path.resolve(ui, '../../moss-apps');
const output = path.resolve(ui, '../output/visualization-integration');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-visualization-'));
process.env.MOSS_HOME = process.env.MOSS_CONFIG_DIR = path.join(temp, 'host');
const modulePath = process.env.PLAYWRIGHT_MODULE || path.join(apps, 'node_modules/.bun', (await fs.readdir(path.join(apps, 'node_modules/.bun'))).filter(name => name.startsWith('playwright@')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0], 'node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(modulePath));
const [runtime, installer, artifacts, local, resources, skills, files, ipc, presentation, resolver] = await Promise.all([
  import('../../packages/app-runtime/src/host/index.mjs'), import('../src/apps/app-runtime.mjs'),
  import('../src/apps/app-artifacts.mjs'), import('../src/apps/app-local-host.mjs'), import('../src/apps/app-resources.mjs'),
  import('../src/apps/app-skills.mjs'), import('../src/workspace-files.mjs'), import('../src/file-system-ipc.mjs'),
  import('../src/presentation/presentation-service.mjs'), import('../src/presentation/resource-resolver.mjs'),
]);
let host, urls, server, browser, page;
const checks = [], errors = [], blockedRequests = [], annotations = [];
let failAnnotation = false;
const previewReads = [];
const mark = value => { checks.push(value); console.log('PASS', value); };
const hash = value => createHash('sha256').update(value).digest('hex');
async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Timed out: ' + label);
}
try {
  await fs.mkdir(output, { recursive: true });
  urls = artifacts.createAppArtifactUrls();
  host = new runtime.AppRuntimeHost({ rootDir: process.env.MOSS_HOME, nodeExecutable: process.execPath,
    requireTrustedPublisher: false, credentialAdapter: new installer.AppCredentialAdapter(process.env.MOSS_HOME),
    hostCapabilityOptions: { protocols: [local.createLocalFilesProtocolDefinition(), artifacts.createAppArtifactProtocolDefinition()] } });
  host.registerHostHandler('moss.artifacts/v1', 'url.get', (input, context) => urls.url(input, context));
  const handlers = local.createLocalAppHostHandlers({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [output] }) } });
  host.registerHostHandler('moss.local-files/v1', 'pick', handlers['moss.local-files/v1'].pick);
  await host.initialize();
  const manifest = JSON.parse(await fs.readFile(path.join(apps, 'apps/visualize/app.moss.json'), 'utf8'));
  const archive = path.join(apps, 'artifacts/moss.visualize', manifest.version, `moss.visualize-${manifest.version}.zip`);
  await installer.installAppArchive(host, archive);
  const instance = await host.ensureDefaultInstance('moss.visualize');
  const invoke = (action, input = {}) => host.invoke('moss.visualize', instance.id, action, input);
  const available = await skills.resolveAppSkills(host);
  assert.equal(available.skills.length, 1); assert.equal(available.skills[0].name, 'moss-visualize');
  const globalTools = await host.listContributions({ kinds: ['tools'], selectedAppIds: [], loadSchemas: true });
  assert.equal(globalTools.tools.filter(tool => tool.appId === 'moss.visualize').length, 5);
  assert.deepEqual(globalTools.tools.map(tool => tool.name).sort(), ['visualize_create', 'visualize_export', 'visualize_list', 'visualize_status', 'visualize_templates']);
  assert.ok(globalTools.tools.filter(tool => tool.appId === 'moss.visualize').every(tool => tool.toolLoading === 'always'));
  assert.equal(manifest.navigation.location, 'none'); assert.equal(manifest.ui, undefined);
  const catalog = await invoke('catalog.get');
  assert.ok(catalog.templates[0].html.includes('mossVisualization')); assert.ok(catalog.instructions.includes('requestFollowUp'));
  mark('ZIP installs with global skill, packaged template and no standalone UI');
  async function create(input) {
    const queued = await invoke('tasks.start', input);
    const task = await until(async () => { const result = await invoke('tasks.get', { id: queued.id }); return ['succeeded','failed','canceled'].includes(result.status) && result; }, 'task completion');
    assert.equal(task.status, 'succeeded', task.message);
    return task;
  }
  const first = await create({ title: '复利增长 · 可交互演示', mode: 'html', html: catalog.templates[0].html });
  const original = await resources.resolveAppResourceFile(host, first.result.resourceUri);
  assert.equal(original.appId, 'moss.visualize'); assert.equal(original.presentation.type, 'interactive-html');
  const originalHash = hash(await fs.readFile(original.path));
  const readWorkspaceFile = files.createWorkspaceFileService({ allowMediaRoot: () => {} }).readWorkspaceFile;
  const resolveResourceFile = uri => resources.resolveAppResourceFile(host, uri);
  const session = { id: 'visualization-session', agentMode: 'local', workspace: temp };
  const callbacks = new Map();
  ipc.registerFileSystemIpcHandlers({ ipcMain: { handle: (name, fn) => callbacks.set(name, fn) }, uiRoot: ui,
    getSessionRecord: id => id === session.id ? session : null, readWorkspaceFile, resolveResourceFile });
  const service = presentation.createPresentationService({ storageRoot: path.join(temp, 'presentations'), waitMs: 0,
    getSessionRecord: id => id === session.id ? session : null,
    ...resolver.createPresentationResolver({ readWorkspaceFile, resolveResourceFile }),
    emit: (name, value) => { if (page && !page.isClosed()) void page.evaluate(([name, value]) => window.visualizationEvent?.(name, value), [name, value]).catch(error => errors.push(String(error))); } });
  const large = await create({ title: '完整脚本读取', mode: 'html', html: '<!--' + 'x'.repeat(700 * 1024) + '--><p id="end">完整</p>' });
  const largePreview = await callbacks.get('preview:read-file')({}, { sessionId: session.id, filePath: large.result.resourceUri });
  assert.equal(largePreview.truncated, false); assert.ok(largePreview.content.includes('id="end"'));
  await assert.rejects(resolveResourceFile('moss-visualize://works/../../outside'));
  mark('real provider and preview IPC read complete HTML beyond normal text limits');

  // A production build verifies that the injected bridge survives minification.
  if (!process.argv.includes('--reuse-renderer')) await build({ root: ui, configFile: false, base: './', plugins: [react()], resolve: { alias: { '@': path.join(ui, 'src/renderer-react') } }, logLevel: 'error',
    build: { outDir: path.join(output, 'site'), emptyOutDir: true, rollupOptions: { input: { visualization: path.join(ui, 'tests/fixtures/visualization.html') } } } });
  server = await preview({ root: ui, configFile: path.join(ui, 'vite.config.ts'), logLevel: 'error',
    build: { outDir: path.join(output, 'site') }, preview: { host: '127.0.0.1', port: 0, strictPort: false } });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('visualization-test.invalid')) blockedRequests.push(request.url()); });
  await page.exposeFunction('visualizationRpc', async (method, input) => {
    switch (method) {
      case 'snapshot': return service.snapshot(input.sessionId, { activate: input.activate });
      case 'load': return service.load(input.sessionId, input.artifactId);
      case 'open': return service.present(input.sessionId, input.input, { origin: 'manual' });
      case 'action': return service.action(input.sessionId, input.action);
      case 'refresh': return service.refresh(input.sessionId);
      case 'acknowledge': return service.acknowledge(input.sessionId, input);
      case 'readFile': previewReads.push(input.filePath); return callbacks.get('preview:read-file')({}, input);
      case 'annotation': {
        if (failAnnotation) { failAnnotation = false; throw new Error('模拟发送失败'); }
        const prepared = await prepareVisualizationAnnotation(input.annotation, { resolveResourceFile, session });
        annotations.push(prepared); return prepared;
      }
      default: throw new Error('Unsupported test transport method: ' + method);
    }
  });
  const address = server.httpServer.address();
  await page.goto(`http://127.0.0.1:${address.port}/tests/fixtures/visualization.html`);
  await page.waitForFunction(() => window.fixtureReady);
  const inline = page.locator('[data-inline-visualization]'), right = page.getByTestId('right-panel');
  const inlineFrame = () => inline.frameLocator('iframe'), rightFrame = () => right.frameLocator('iframe');
  // Model replies arrive incrementally: the component first mounts with an
  // incomplete reference, then receives valid JSON without a navigation/remount.
  await page.evaluate(() => window.setVisualizationMarkdown('```moss-visualization\n{"resource_uri":'));
  await page.getByText('可视化引用尚未完整。', { exact: true }).waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(previewReads, []);
  await page.evaluate(markdown => window.setVisualizationMarkdown(markdown), first.result.displayMarkdown);
  await inlineFrame().locator('#growth-total').waitFor({ timeout: 6000 });
  assert.deepEqual(previewReads, [first.result.resourceUri]);
  assert.equal(await inline.getByRole('status').count(), 0);
  mark('streamed incomplete reference loads immediately when completed, without switching sessions');
  const originalFrame = await inline.locator('iframe').elementHandle();
  await page.evaluate(markdown => window.setVisualizationMarkdown(markdown + '\n\n演示已生成。'), first.result.displayMarkdown);
  await page.getByText('演示已生成。', { exact: true }).waitFor();
  assert.equal(await originalFrame.evaluate(element => element.isConnected), true);
  assert.deepEqual(previewReads, [first.result.resourceUri]);
  mark('subsequent reply chunks preserve the loaded iframe and do not reread the resource');
  await service.beginTurn(session.id, 'turn-1');
  const present = await service.present(session.id, first.result.presentation, { turnId: 'turn-1', requestId: 'tool-1' });
  await rightFrame().locator('#growth-total').waitFor(); await inlineFrame().locator('#growth-total').waitFor();
  await until(() => present.presentation.state === 'shown', 'renderer acknowledgment');
  assert.equal(await rightFrame().locator('#growth-total').innerText(), '16.29 万元');
  assert.equal(await right.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  mark('moss_present service opens the real right panel; production renderer acknowledges display');
  await inlineFrame().locator('#growth-rate').fill('8');
  await until(async () => await rightFrame().locator('#growth-total').innerText() === '21.59 万元', 'state synchronization');
  await rightFrame().locator('#growth-years').fill('20');
  await until(async () => await inlineFrame().locator('#growth-total').innerText() === '46.61 万元', 'reverse state synchronization');
  assert.equal(await right.getByRole('button', { name: /重新载入|继续修改/ }).count(), 0);
  await page.reload(); await page.waitForFunction(() => window.fixtureReady);
  await page.evaluate(markdown => window.setVisualizationMarkdown(markdown), first.result.displayMarkdown);
  await inline.getByRole('button', { name: '在右侧展开' }).click();
  await until(async () => await rightFrame().locator('#growth-total').innerText() === '46.61 万元', 'persisted state reopen');
  mark('sliders synchronize both surfaces and survive reopening; obsolete toolbar removed');
  await page.getByRole('textbox', { name: '主会话输入', exact: true }).fill('保留我的草稿');
  await right.getByRole('button', { name: '标注修改', exact: true }).click();
  assert.equal(await rightFrame().locator('h2').evaluate(element => getComputedStyle(element).cursor), 'crosshair');
  await rightFrame().locator('h2').click();
  await right.getByRole('textbox', { name: '标注内容' }).fill('把这个标题字号调大');
  await page.screenshot({ path: path.join(output, 'annotation-element.png'), fullPage: true, animations: 'disabled' });
  failAnnotation = true;
  await right.getByRole('button', { name: '发送标注' }).click();
  await right.getByRole('alert').filter({ hasText: '模拟发送失败' }).waitFor();
  assert.equal(await right.getByRole('textbox', { name: '标注内容' }).inputValue(), '把这个标题字号调大');
  await right.getByRole('button', { name: '发送标注' }).click();
  await page.locator('[data-visualization-annotation]').waitFor();
  assert.equal(await page.getByRole('textbox', { name: '主会话输入', exact: true }).inputValue(), '保留我的草稿');
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].annotation.selection.kind, 'element');
  assert.equal(annotations[0].annotation.selection.text, '时间如何放大复利');
  assert.ok(annotations[0].instruction.includes(first.result.resourceUri));
  assert.ok(annotations[0].instruction.includes('"rate":8,"years":20'));
  assert.ok(annotations[0].instruction.includes('把这个标题字号调大'));
  assert.ok(!(await page.locator('body').innerText()).includes(first.result.resourceUri));
  assert.equal(await right.locator('[data-annotation-editor]').count(), 0);
  mark('anchored element annotation submits compact card, retains draft and carries hidden source/state; failed send keeps comment');
  await right.getByRole('button', { name: '标注修改', exact: true }).click();
  await right.getByRole('button', { name: '选择文字', exact: true }).click();
  await rightFrame().locator('h2').evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await right.getByRole('textbox', { name: '标注内容' }).fill('换个标题');
  await right.getByRole('button', { name: '发送标注' }).click();
  await until(() => annotations.length === 2, 'text annotation');
  assert.equal(annotations[1].annotation.selection.kind, 'text');
  assert.equal(annotations[1].annotation.selection.text, '时间如何放大复利');
  await right.getByRole('button', { name: '标注修改', exact: true }).click();
  await right.getByRole('button', { name: '框选区域', exact: true }).click();
  const box = await rightFrame().locator('#growth-bars').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 8 }); await page.mouse.up();
  await right.getByRole('textbox', { name: '标注内容' }).fill('把这一区域的柱形改成折线');
  await page.screenshot({ path: path.join(output, 'annotation-region.png'), fullPage: true, animations: 'disabled' });
  await right.getByRole('button', { name: '发送标注' }).click();
  await until(() => annotations.length === 3, 'region annotation');
  assert.equal(annotations[2].annotation.selection.kind, 'region');
  assert.ok(annotations[2].annotation.selection.rect.width > 100);
  mark('text selection and pointer-drag region selection produce accurate typed annotations');
  await page.screenshot({ path: path.join(output, 'conversation-light.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.dataset.theme = 'dark'; });
  await until(async () => await rightFrame().locator('html').evaluate(element => element.style.colorScheme) === 'dark', 'theme propagation');
  await page.screenshot({ path: path.join(output, 'conversation-dark.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await inlineFrame().locator('html').evaluate(element => element.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, 'conversation-narrow.png'), fullPage: true, animations: 'disabled' });
  await right.scrollIntoViewIfNeeded();
  await rightFrame().locator('#growth-total').waitFor();
  assert.ok(await rightFrame().locator('html').evaluate(element => element.scrollWidth <= innerWidth));
  await right.getByRole('button', { name: '标注修改', exact: true }).click();
  await rightFrame().locator('h2').click();
  await right.getByRole('textbox', { name: '标注内容' }).fill('窄屏标注也能输入');
  const narrowEditor = await right.locator('[data-annotation-editor]').boundingBox();
  assert.ok(narrowEditor.x >= 0 && narrowEditor.x + narrowEditor.width <= 390);
  await right.screenshot({ path: path.join(output, 'right-panel-narrow.png') });
  await right.getByRole('button', { name: '取消', exact: true }).click();
  mark('light/dark themes and 390px layout render without horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.classList.remove('dark'); document.documentElement.dataset.theme = 'light'; });

  const revised = await create({ title: '复利增长 · 第二版', mode: 'html', parentId: first.id,
    html: catalog.templates[0].html.replace('时间如何放大复利', '延长时间，再看复利') });
  assert.equal(revised.result.version, 2); assert.equal(revised.result.workId, first.id);
  assert.notEqual(revised.result.resourceUri, first.result.resourceUri);
  assert.equal(hash(await fs.readFile(original.path)), originalHash);
  await service.beginTurn(session.id, 'turn-2');
  await service.present(session.id, revised.result.presentation, { turnId: 'turn-2', requestId: 'tool-2' });
  await until(async () => await rightFrame().locator('h2').innerText() === '延长时间，再看复利', 'new version display');
  assert.equal(await inlineFrame().locator('h2').innerText(), '时间如何放大复利');
  await right.getByRole('button', { name: '固定当前内容' }).click();
  await until(async () => Boolean((await service.snapshot(session.id)).state.pinnedId), 'pin');
  await service.beginTurn(session.id, 'turn-3');
  const deferred = await service.present(session.id, first.result.presentation, { turnId: 'turn-3' });
  assert.equal(deferred.presentation.reason, 'user_pinned');
  await right.getByRole('button', { name: '取消固定内容' }).click();
  await inline.getByRole('button', { name: '在右侧展开' }).click();
  await until(async () => await rightFrame().locator('#growth-total').innerText() === '46.61 万元', 'old version reopen');
  mark('new version follows model presentation, preserves old version and honors user pin');

  const sandbox = await rightFrame().locator('body').evaluate(async () => {
    let parentBlocked = false, fetchBlocked = false;
    try { void parent.document.body; } catch { parentBlocked = true; }
    try { await fetch('https://visualization-test.invalid/blocked'); } catch { fetchBlocked = true; }
    let oversizedBlocked = false;
    try { window.mossVisualization.setState({ text: '字'.repeat(6000) }); } catch { oversizedBlocked = true; }
    return { parentBlocked, fetchBlocked, oversizedBlocked };
  });
  assert.deepEqual(sandbox, { parentBlocked: true, fetchBlocked: true, oversizedBlocked: true });
  // Even a valid token is rejected when the sender is not this surface's iframe.
  const forgedTokenPresent = await right.locator('iframe').evaluate(frame => {
    const token = frame.srcdoc.match(/\["moss.visualization\/v1","([^"]+)"/)?.[1];
    window.dispatchEvent(new MessageEvent('message', { source: window, data: { channel: 'moss.visualization/v1', token, type: 'annotation-selection', payload: { selection: { kind: 'element', text: '伪造', rect: { x: 1, y: 1, width: 20, height: 20 } } } } }));
    return Boolean(token);
  });
  assert.ok(forgedTokenPresent);
  assert.equal(await right.getByRole('textbox', { name: '标注内容' }).count(), 0);
  mark('opaque iframe blocks host DOM, network and oversized state; forged sender rejected');
  await rightFrame().locator('#growth-total').evaluate(() => window.mossVisualization.requestFollowUp('解释当前选中数值'));
  await right.getByRole('textbox', { name: '标注内容' }).waitFor();
  assert.equal(await right.getByRole('textbox', { name: '标注内容' }).inputValue(), '解释当前选中数值');
  assert.equal(annotations.length, 3);
  await right.getByRole('button', { name: '取消', exact: true }).click();
  mark('page follow-up API opens anchored confirmation without automatically sending');
  const errorTask = await create({ title: '运行错误验证', mode: 'html', html: '<script>throw new Error("intentional-visualization-test")</script>' });
  await service.beginTurn(session.id, 'turn-error');
  const failed = await service.present(session.id, errorTask.result.presentation, { turnId: 'turn-error' });
  await right.getByRole('alert').filter({ hasText: 'intentional-visualization-test' }).waitFor();
  await until(() => failed.presentation.state === 'error', 'renderer error acknowledgment');
  await right.getByRole('button', { name: '重试' }).click();
  await right.getByRole('alert').filter({ hasText: 'intentional-visualization-test' }).waitFor();
  await page.evaluate(() => window.setVisualizationMarkdown('```moss-visualization\n{"resource_uri":"moss-visualize://works/missing","title":"不可用作品"}\n```'));
  await inline.getByRole('alert').waitFor(); await inline.getByRole('button', { name: '重试' }).click(); await inline.getByRole('alert').waitFor();
  mark('script errors and missing artifacts show recoverable error UI');

  const chart = await create({ title: '数据对比', type: 'bar', csv: '名称,本期,上期\n甲,12,9\n乙,18,13' });
  await service.beginTurn(session.id, 'turn-chart');
  await service.present(session.id, chart.result.presentation, { turnId: 'turn-chart' });
  await page.evaluate(markdown => window.setVisualizationMarkdown(markdown), chart.result.displayMarkdown);
  await rightFrame().locator('#filter').fill('乙');
  await until(async () => await inlineFrame().locator('#filter').inputValue() === '乙', 'chart filter sync');
  assert.equal(await inlineFrame().locator('tbody tr:visible').count(), 1);
  await inlineFrame().locator('[data-toggle="0"]').uncheck();
  await until(async () => !await rightFrame().locator('[data-toggle="0"]').isChecked(), 'series sync');
  assert.equal(await rightFrame().locator('[data-series="0"]').isVisible(), false);
  assert.equal(await rightFrame().locator('thead th:nth-child(2)').isVisible(), false);
  mark('built-in chart filtering and series visibility synchronize across both surfaces');

  const exported = await invoke('artifacts.export', { id: first.id, index: 0 });
  assert.equal(hash(await fs.readFile(exported.path)), originalHash);
  const exportedAgain = await invoke('artifacts.export', { id: first.id, index: 0 });
  assert.notEqual(exportedAgain.path, exported.path); await fs.rm(exportedAgain.path);
  const standalone = await browser.newPage(); await standalone.goto(pathToFileURL(exported.path).href);
  await standalone.locator('#growth-rate').fill('8'); assert.equal(await standalone.locator('#growth-total').innerText(), '21.59 万元');
  assert.equal(await standalone.locator('#growth-ask').count(), 0); await standalone.close();
  mark('export is an actual non-overwriting file and works independently without Moss');
  const unexpected = errors.filter(error => !error.includes('intentional-visualization-test'));
  assert.deepEqual(unexpected, []);
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ ok: true, archive, archiveSha256: hash(await fs.readFile(archive)), checks, expectedScriptErrors: errors.length, exported: exported.path,
    scope: 'Real ZIP backend + real production React components + real presentation/preview services. Transport and surrounding conversation shell are fixtures; no live model session.' }, null, 2));
  console.log('Verified:', output);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, errors }, null, 2));
  throw error;
} finally {
  await browser?.close(); await new Promise(resolve => server ? server.httpServer.close(resolve) : resolve());
  await host?.shutdown(); await urls?.close(); await fs.rm(temp, { recursive: true, force: true });
}
