// Run against an isolated MOSS_HOME. Uses a local model fixture; no paid model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.MOSS_WEB_TEST_URL || 'http://127.0.0.1:43128';
if (!process.env.MOSS_WEB_TEST_TOKEN_FILE) throw new Error('Set MOSS_WEB_TEST_TOKEN_FILE for the isolated test Host.');
const token = (await fs.readFile(process.env.MOSS_WEB_TEST_TOKEN_FILE, 'utf8')).trim();
let modelRequests = 0;
const fixture = createServer(async (req, res) => {
  if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'claude-sonnet-4-5', context_window: 200000 }] })); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  const text = JSON.stringify(body.messages);
  const id = ++modelRequests;
  const completed = text.includes('tool_result');
  const block = completed ? { type: 'text', text: 'WEB_PERMISSION_CONFIRMED' } : {
    type: 'tool_use', id: `web_question_${id}`, name: 'AskUserQuestion', input: {
      questions: [{ question: '继续浏览器验证？', header: '验证', options: [{ label: '继续', description: '执行验证' }, { label: '停止', description: '停止验证' }], multiSelect: false }],
    },
  };
  res.setHeader('Content-Type', 'text/event-stream');
  const event = value => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
  event({ type: 'message_start', message: { id: `msg_${id}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  event({ type: 'content_block_start', index: 0, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { ...block, text: '' } });
  event({ type: 'content_block_delta', index: 0, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
  event({ type: 'content_block_stop', index: 0 });
  event({ type: 'message_delta', delta: { stop_reason: completed ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 10 } });
  event({ type: 'message_stop' }); res.end();
});
await new Promise(resolve => fixture.listen(0, '0.0.0.0', resolve));
const browser = await chromium.launch({ channel: process.env.MOSS_WEB_TEST_BROWSER || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(); const errors = [];
page.on('pageerror', error => errors.push(error.message));
let previousSettings;
const output = process.env.MOSS_WEB_TEST_OUTPUT || path.resolve('output/webui-validation');
await fs.mkdir(output, { recursive: true });
try {
  await page.goto(baseUrl);
  await page.getByRole('heading', { name: '登录你的云电脑' }).waitFor();
  await page.screenshot({ path: path.join(output, 'login.png') });
  await page.locator('input[name=token]').fill(token);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForFunction(() => window.agentDesktop && document.querySelector('[contenteditable=true], textarea'));
  assert.equal(await page.locator('.moss-window-chrome').count(), 0);
  await page.getByRole('button', { name: /^消息中心/ }).click();
  await page.getByRole('dialog', { name: '消息中心', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  const logoutTrigger = page.locator('.moss-web-session').getByRole('button', { name: '退出登录', exact: true });
  const logoutDialog = page.getByRole('dialog', { name: '退出当前登录？' });
  await logoutTrigger.click();
  await logoutDialog.waitFor();
  await page.screenshot({ path: path.join(output, 'logout-confirm.png') });
  await logoutDialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/auth')).json()).authenticated), true);
  previousSettings = await page.evaluate(() => window.agentDesktop.getSettings());
  const basic = await page.evaluate(async () => {
    const api = window.agentDesktop;
    const created = await api.createSession({ title: 'Web validation', agentMode: 'local' });
    const sessionId = created.summary.id;
    await api.send({ sessionId, prompt: '!printf "hello cloud\\n" > web-smoke.txt' });
    const read = await api.readWorkspaceFile({ sessionId, filePath: created.detail.workspace + '/web-smoke.txt' });
    const uploaded = await api.fs.uploadFile(new File(['browser-upload'], 'upload.txt'));
    const downloaded = await (await fetch(window.mossWeb.fileUrl(uploaded.path))).text();
    return { sessionId, content: read.content, downloaded };
  });
  assert.equal(basic.content, 'hello cloud\n'); assert.equal(basic.downloaded, 'browser-upload');
  // A write accepted before network loss must run once while the browser reconnects.
  await page.evaluate(sessionId => { window.__sendResult = window.agentDesktop.send({ sessionId, prompt: '!sleep 2; printf "once\\n" >> reconnect.txt' }); }, basic.sessionId);
  await context.setOffline(true); await new Promise(resolve => setTimeout(resolve, 3000)); await context.setOffline(false);
  const reconnected = await page.evaluate(async sessionId => {
    await window.__sendResult;
    const detail = await window.agentDesktop.getSession({ sessionId });
    return (await window.agentDesktop.readWorkspaceFile({ sessionId, filePath: detail.workspace + '/reconnect.txt' })).content;
  }, basic.sessionId);
  assert.equal(reconnected, 'once\n');
  // Reuse the actual local runtime and tool-permission path with an isolated model endpoint.
  const modelUrl = `http://${process.env.MOSS_WEB_TEST_MODEL_HOST || '127.0.0.1'}:${fixture.address().port}`;
  await page.evaluate(async url => {
    await window.agentDesktop.updateSettings({ url, apiKey: 'web-test-only', model: 'claude-sonnet-4-5', fastModel: 'claude-sonnet-4-5', thinkingMode: 'disabled' });
    window.__questions = [];
    window.agentDesktop.onQuestionRequest(question => window.__questions.push(question));
    const created = await window.agentDesktop.createSession({ title: 'Web permission validation', agentMode: 'local' });
    window.__permissionResult = window.agentDesktop.send({ sessionId: created.summary.id, prompt: 'WEB_QUESTION_CHECK' });
  }, modelUrl);
  await page.waitForFunction(() => window.__questions.length > 0, null, { timeout: 60000 });
  await page.reload();
  await page.waitForFunction(() => window.mossWeb?.snapshot?.questions?.length > 0 && window.agentDesktop, null, { timeout: 30000 });
  const question = await page.evaluate(() => window.mossWeb.snapshot.questions[0]);
  await page.evaluate(async question => {
    await window.agentDesktop.answerQuestion({ requestId: question.requestId, sessionId: question.sessionId, answers: { '继续浏览器验证？': '继续' } });
  }, question);
  await page.waitForFunction(async sessionId => {
    const detail = await window.agentDesktop.getSession({ sessionId });
    return !detail.busy && JSON.stringify(detail.history).includes('WEB_PERMISSION_CONFIRMED');
  }, question.sessionId, { timeout: 30000 });
  const terminalId = await page.evaluate(async sessionId => (await window.agentDesktop.ipcInvoke('terminal:open', { sessionId, action: 'terminal' })).terminalId, basic.sessionId);
  const terminal = await context.newPage(); await terminal.goto(`${baseUrl}/?window=terminal&terminalId=${terminalId}`);
  await terminal.getByText('运行中', { exact: true }).waitFor();
  await terminal.evaluate(async () => {
    window.__terminalOutput = '';
    window.mossTerminal.onData(event => { window.__terminalOutput += event.data; });
    await window.mossTerminal.write({ requestId: 'test', data: 'printf "PTY_VERIFIED\\n"\r' });
  });
  await terminal.waitForFunction(() => window.__terminalOutput.includes('PTY_VERIFIED'));
  await terminal.screenshot({ path: path.join(output, 'terminal.png') });
  await terminal.evaluate(() => window.mossTerminal.write({ requestId: 'test', data: 'exit\r' }));
  await terminal.close();
  await page.screenshot({ path: path.join(output, 'browser.png') });
  await page.evaluate(settings => window.agentDesktop.updateSettings(settings), previousSettings);
  previousSettings = null;
  await logoutTrigger.click();
  await logoutDialog.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('heading', { name: '登录你的云电脑' }).waitFor();
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/auth')).json()).authenticated), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, browser: true, files: true, reconnect: true, permissionRecovery: true, terminal: true, logoutConfirmation: true, modelRequests }));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, pageErrors: errors, body: (await page.locator('body').innerText()).slice(-2500) }));
  await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  if (previousSettings) await page.evaluate(settings => window.agentDesktop.updateSettings(settings), previousSettings).catch(() => {});
  await browser.close(); fixture.close();
}
