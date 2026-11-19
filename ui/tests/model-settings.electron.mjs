// Build runtime + renderer first. Exercise the model selector and settings against a local provider.
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-model-settings-'));
process.env.MOSS_HOME = root; process.env.MOSS_CONFIG_DIR = root; process.env.MOSS_OPEN_DEVTOOLS = 'false';
app.setAppPath(fileURLToPath(new URL('..', import.meta.url))); app.setPath('userData', path.join(root, 'electron'));
let window;
const requests = [];
const modelListRequests = [];
let modelListAuthorized = false;
const ready = new Promise(resolve => app.on('browser-window-created', (_event, created) => {
  created.show = () => {}; created.showInactive = () => {};
  if (!window) { window = created; window.webContents.once('did-finish-load', resolve); }
}));
const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    modelListRequests.push(req.headers.authorization);
    res.setHeader('Content-Type', 'application/json');
    if (!modelListAuthorized) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: 'Invalid token' } }));
    } else {
      res.end(JSON.stringify({ data: [{ id: 'fixture-discovered' }] }));
    }
    return;
  }
  if (req.method === 'GET') { res.end(JSON.stringify({ data: [] })); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
  if (body.thinking?.type === 'disabled') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Unsupported reasoning effort "none"' } }));
  } else {
    res.setHeader('Content-Type', 'text/event-stream');
    res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({
  models: { text: {
    model: 'fixture-model',
    availableModels: ['fixture-model', 'fixture-secondary'],
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: 'fixture-key',
    thinking: { mode: 'auto' },
  } },
  autoMemory: { enabled: false },
  sessionMemory: { enabled: false },
  webSearch: { mode: 'disabled' },
}));
const watchdog = setTimeout(() => app.exit(1), 90_000);
const waitFor = async (condition, label) => {
  for (let i = 0; i < 150; i++) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error('Timed out: ' + label);
};
async function run() {
try {
  await import('../src/main.mjs'); await ready;
  const js = source => window.webContents.executeJavaScript(source);
  await waitFor(() => js(`Boolean(document.querySelector('button[title="新会话"]'))`), 'new chat button');
  await js(`document.querySelector('button[title="新会话"]').click()`);
  await waitFor(() => js(`Boolean(document.querySelector('select[aria-label="选择模型"] option[value="fixture-secondary"]'))`), 'configured session model list');
  assert.equal(await js(`document.querySelector('select[aria-label="选择模型"] option[value="default"]').textContent`), '默认模型（fixture-model）');
  await waitFor(() => js(`Boolean(document.querySelector('button[aria-label="个人中心"]'))`), 'profile button');
  await js(`document.querySelector('button[aria-label="个人中心"]').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerType: 'mouse' }))`);
  await waitFor(() => js(`Boolean([...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim() === '设置'))`), 'settings menu item');
  await js(`[...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim() === '设置')?.click()`);
  await waitFor(() => js(`Boolean([...document.querySelectorAll('button')].find(el => el.textContent.trim() === '模型与搜索'))`), 'settings view');
  await js(`[...document.querySelectorAll('button')].find(el => el.textContent.trim() === '模型与搜索')?.click()`);
  await waitFor(() => js(`Boolean([...document.querySelectorAll('button')].find(el => el.textContent === '测试当前配置'))`), 'model settings');
  const sessionCount = await js(`window.agentDesktop.listSessions().then(value => JSON.stringify(value))`);
  await js(`window.probeSelect = [...document.querySelectorAll('select')].find(el => [...el.options].some(o => o.value === 'adaptive')); void 0;`);
  assert(await js(`window.probeSelect.closest('section').textContent.includes('默认模型')`), 'Thinking belongs in model settings');
  assert(await js(`!window.probeSelect.closest('section').textContent.includes('文本模型')`), 'Model settings no longer show the redundant text-model heading');
  const modelSelectLabels = await js(`Array.from(document.querySelectorAll('#model select'), element => element.getAttribute('aria-label'))`);
  for (const label of ['默认模型', '快速模型', '图片模型名称']) {
    assert.ok(modelSelectLabels.includes(label), `${label} selector is present`);
  }
  assert(await js(`Boolean([...document.querySelectorAll('button')].find(el => el.textContent.trim() === '获取模型列表'))`), 'Model list button is present');
  assert.equal(modelListRequests.length, 0, 'Opening a composer or the settings page must not fetch the provider catalog');
  const clickModelList = () => js(`[...document.querySelectorAll('button')].find(el => el.textContent.trim() === '获取模型列表').click()`);
  await clickModelList();
  await waitFor(() => js(`document.querySelector('#model [role="alert"]')?.textContent.includes('HTTP 401')`), 'model list authorization error');
  assert.deepEqual(modelListRequests, ['Bearer fixture-key']);
  modelListAuthorized = true;
  await clickModelList();
  await waitFor(() => js(`document.querySelector('#model').textContent.includes('fixture-discovered')`), 'discovered model shown in settings');
  assert.deepEqual(modelListRequests, ['Bearer fixture-key', 'Bearer fixture-key']);
  const clickTest = () => js(`[...document.querySelectorAll('button')].find(el => el.textContent === '测试当前配置').click()`);
  await clickTest();
  await waitFor(() => js(`document.body.textContent.includes('测试成功')`), 'successful probe');
  assert.equal(requests.length, 1); assert.equal(requests[0].thinking, undefined);
  await js(`window.probeSelect.value = 'disabled'; window.probeSelect.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor(() => js(`!document.body.textContent.includes('测试成功')`), 'stale result cleared');
  await clickTest();
  await waitFor(() => js(`document.body.textContent.includes('HTTP 400') && document.body.textContent.includes('Unsupported reasoning effort')`), 'original error shown');
  assert.equal(requests.length, 2); assert.deepEqual(requests[1].thinking, { type: 'disabled' });
  assert.equal(await js(`window.agentDesktop.listSessions().then(value => JSON.stringify(value))`), sessionCount, 'Testing must not create sessions');
  await js(`window.probeSelect.scrollIntoView({block:'center'});`);
  await new Promise(resolve => setTimeout(resolve, 200));
  await fs.writeFile('/tmp/moss-model-settings-test.png', (await window.webContents.capturePage()).toPNG());
  console.log('PASS real model UI: configured choices without startup discovery, manual catalog authorization and retry, model probe and HTTP 400. Screenshot /tmp/moss-model-settings-test.png');
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
  if (window && !window.isDestroyed()) await fs.writeFile('/tmp/moss-model-settings-failure.png', (await window.webContents.capturePage()).toPNG());
} finally {
  clearTimeout(watchdog);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  app.exit(process.exitCode || 0);
}
}
void run();
