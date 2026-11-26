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
let mailboxPulls = 0;
let modelListAuthorized = false;
const ready = new Promise(resolve => app.on('browser-window-created', (_event, created) => {
  created.show = () => {}; created.showInactive = () => {};
  if (!window) { window = created; window.webContents.once('did-finish-load', resolve); }
}));
const server = createServer(async (req, res) => {
  if (req.url === '/api/v1/bootstrap') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ capabilities: { agent_mail: { version: 1 } } }));
    return;
  }
  if (req.url === '/api/v1/agent-mail/pull') {
    mailboxPulls++;
    // Hold the long poll until the desktop disconnects.
    return;
  }
  if (req.url.startsWith('/api/v1/')) {
    const modelConfig = {
      model: 'managed-model', availableModels: ['managed-model'], fastModel: '',
      url: `http://127.0.0.1:${server.address().port}/managed`, apiKey: 'managed-key',
    };
    const response = req.url === '/api/v1/model-access' ? modelConfig
      : { token: 'device-token', mailbox: true, policy: { revision: 1, settings: {} }, modelConfig };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response));
    return;
  }
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
  if (body.model === 'managed-model') {
    assert(req.url.startsWith('/managed/'));
    assert.equal(req.headers.authorization, 'Bearer managed-key');
  }
  if (body.thinking?.type === 'disabled') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Unsupported reasoning effort "none"' } }));
  } else {
    res.setHeader('Content-Type', 'text/event-stream');
    const events = [
      { type: 'message_start', message: { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [], usage: { input_tokens: 5, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ];
    res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({
  models: { text: {
    model: 'fixture-model',
    availableModels: ['fixture-model', 'fixture-secondary', 'fixture-tertiary'],
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: 'fixture-key',
    thinking: { mode: 'auto' },
  } },
  autoMemory: { enabled: false },
  sessionMemory: { enabled: false },
  webSearch: { mode: 'disabled' },
  managedRuntimes: { node: false, python: false, git: false },
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
  const sourceSwitch = `document.querySelector('input[aria-label="使用本地模型配置"]')`;
  assert(await js(`${sourceSwitch}.checked`));
  await js(`${sourceSwitch}.click()`);
  await waitFor(() => js(`window.agentDesktop.getSettings().then(s => s.localModelEnabled === false && !s.runtimeModel.model && s.model === 'fixture-model')`), 'saved local model disabled');
  await waitFor(() => js(`document.querySelector('#model select[aria-label="默认模型"]').disabled && document.body.textContent.includes('Moss Server 暂未提供')`), 'server unavailable status');
  const beforeDisabledProbe = requests.length;
  await assert.rejects(js(`window.agentDesktop.testModel({model:'fixture-model'})`));
  assert.equal(requests.length, beforeDisabledProbe);
  await js(`${sourceSwitch}.click()`);
  await waitFor(() => js(`window.agentDesktop.getSettings().then(s => s.localModelEnabled && s.runtimeModel.model === 'fixture-model' && s.runtimeModel.apiKey === 'fixture-key')`), 'saved local model restored');
  const sessionCount = await js(`window.agentDesktop.listSessions().then(value => JSON.stringify(value))`);
  await js(`window.probeSelect = document.querySelector('#conversation select[aria-label="思考模式"]'); void 0;`);
  assert(await js(`Boolean(window.probeSelect)`), 'Thinking belongs in conversation settings');
  const contextSelector = `document.querySelector('#conversation select[aria-label="上下文上限"]')`;
  assert.deepEqual(await js(`Array.from(${contextSelector}.options, option => option.textContent)`), ['200k', '500k', '800k', '1M']);
  assert.equal(await js(`${contextSelector}.value`), '200000');
  await js(`${contextSelector}.value = '800000'; ${contextSelector}.dispatchEvent(new Event('change', { bubbles: true }));`);
  await waitFor(() => js(`window.agentDesktop.getSettings().then(result => result.contextWindowLimit === 800000)`), 'saved context limit');
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

  const call = (method, payload) => js(`window.agentDesktop.${method}(${JSON.stringify(payload)})`);
  const send = async (sessionId, prompt, expectedModel) => {
    const before = requests.length;
    const result = await call('send', { sessionId, prompt });
    assert.equal(result.ok, true, JSON.stringify(result));
    const request = requests.slice(before).find(body => JSON.stringify(body.messages?.at(-1) ?? '').includes(prompt));
    assert.equal(request?.model, expectedModel);
  };
  await call('updateSettings', { thinkingMode: 'auto' });
  const original = await call('createSession', { title: 'Model A session' });
  const sessionId = original.summary.id;
  assert.equal(original.detail.modelOverride, 'fixture-model');
  await send(sessionId, 'Start the model persistence conversation.', 'fixture-model');
  await call('updateSettings', { model: 'fixture-secondary' });

  const next = await call('createSession', { title: 'Model B session' });
  await send(next.summary.id, 'Start a new conversation after changing the default.', 'fixture-secondary');
  assert.equal((await call('getModelContext', { sessionId })).contextWindow, 800_000);
  assert.equal((await call('getModelContext', { sessionId: next.summary.id })).contextWindow, 800_000);
  assert.equal((await call('getSession', { sessionId })).model, 'fixture-model');
  await send(sessionId, 'Continue the original conversation.', 'fixture-model');
  const forked = await call('forkSession', { sessionId });
  assert.equal(forked.detail.model, 'fixture-model');

  assert.equal((await call('setSessionModel', { sessionId, model: null })).model, 'fixture-secondary');
  await call('updateSettings', { model: 'fixture-model' });
  await send(sessionId, 'Continue with the default model selected for this conversation.', 'fixture-secondary');

  const openSession = async title => {
    const selector = JSON.stringify(`[aria-label="打开“${title}”的会话设置"]`);
    await waitFor(() => js(`Boolean(document.querySelector(${selector}))`), title);
    await js(`document.querySelector(${selector}).closest('[role="button"]').click()`);
  };
  const modelSelect = `document.querySelector('button[aria-label^="选择模型："]')`;
  await openSession('Model A session');
  await waitFor(() => js(`${modelSelect}?.title.includes('fixture-secondary')`), 'original session model');
  await js(`${modelSelect}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await waitFor(() => js(`Boolean(document.querySelector('[role="menuitemradio"]'))`), 'model options');
  await js(`[...document.querySelectorAll('[role="menuitemradio"]')].find(button => button.textContent === 'fixture-tertiary').click()`);
  await waitFor(async () => (await call('getSession', { sessionId })).model === 'fixture-tertiary', 'session model change saved');
  await openSession('Model B session');
  await waitFor(() => js(`${modelSelect}?.title.includes('fixture-secondary')`), 'other session model unchanged');
  await openSession('Model A session');
  await waitFor(() => js(`${modelSelect}?.title.includes('fixture-tertiary')`), 'changed model shown on reopen');
  await send(sessionId, 'Continue after switching to the third model.', 'fixture-tertiary');
  const claims = Buffer.from(JSON.stringify({ sub: 'test-user', org_id: 'test-org', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  await call('updateSettings', {
    localModelEnabled: false,
    enterpriseAccountServerUrl: `http://127.0.0.1:${server.address().port}`,
    enterpriseAccountAccessToken: `test.${claims}.test`,
  });
  await waitFor(() => js(`window.agentDesktop.getSettings().then(s => s.runtimeModel.model === 'managed-model')`), 'model delivered by Moss Server');
  await waitFor(() => mailboxPulls > 0, 'assigned mailbox starts polling after login');
  assert.deepEqual(await js(`window.agentDesktop.agentMail.list('inbox', 1)`), { messages: [] });
  assert.deepEqual((await call('listModels', { refresh: false })).models, ['managed-model']);
  await send(sessionId, 'Continue via the server connection.', 'managed-model');
  await call('updateSettings', { localModelEnabled: true });
  await send(sessionId, 'Resume via the saved local connection.', 'fixture-tertiary');
  const signedOut = await call('updateSettings', { enterpriseAccountAccessToken: '', localModelEnabled: false });
  assert.equal(signedOut.serverSignedIn, false);
  assert.equal(signedOut.runtimeModel.model, '');
  await assert.rejects(js(`window.agentDesktop.agentMail.list('inbox', 1)`), /登录 Moss Server/);
  console.log('PASS session model selection survives reopening and default changes; new sessions and forks use the expected models.');
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
