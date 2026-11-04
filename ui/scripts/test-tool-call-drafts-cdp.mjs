// Actual main conversation -> Core -> ordinary native App/MCP -> edited confirmation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppRuntimeHost, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs';
import { generateMcpApp } from '../../packages/app-runtime/src/packages/generate-mcp-app.mjs';
import { normalizeAppToolName } from '../../packages/app-sdk/src/tool-names.mjs';
import { launchTestInstance } from '../src/app-testing/instance.mjs';

const ui = fileURLToPath(new URL('..', import.meta.url)), root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-tool-review-'));
const home = path.join(root, 'profile'), output = path.resolve(ui, '../output/tool-call-drafts-cdp');
const checks = [], exceptions = [], mcpCalls = [], modelResults = [];
let runtime, target, browser, page, pending;
const schema = JSON.parse(await fs.readFile(path.join(ui, 'tests/fixtures/apps/tool-call-review/input.json')));
const mark = label => { checks.push(label); console.log('PASS', label); };
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET') { res.writeHead(req.url.startsWith('/mcp') ? 405 : 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'review-fixture' }] })); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    if (req.url.startsWith('/mcp')) {
      if (body.id === undefined) { res.writeHead(202); res.end(); return; }
      if (body.method === 'tools/call' && body.params.arguments.message === 'ERROR_AFTER_DISPATCH') { mcpCalls.push(body.params.arguments); res.destroy(); return; }
      const result = body.method === 'initialize' ? { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'review-fixture', version: '1' } }
        : body.method === 'tools/list' ? { tools: [{ name: 'record', description: 'Record a local test message', inputSchema: schema }] }
          : body.method === 'tools/call' ? (() => { mcpCalls.push(body.params.arguments); return { content: [{ type: 'text', text: JSON.stringify({ status: 'needs_confirmation', confirmation_token: 'fixture-only', arguments: body.params.arguments }) }] }; })() : {};
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result })); return;
    }
    let call, message = '本地工具返回结果已收到。';
    if (pending && !pending.sent) {
      assert.ok(body.tools?.some(tool => tool.name === pending.name), 'Missing model tool: ' + pending.name);
      pending.sent = true; pending.toolId = randomUUID(); call = pending;
    } else if (pending?.sent) {
      const result = body.messages.flatMap(item => Array.isArray(item.content) ? item.content : []).find(item => item.type === 'tool_result' && item.tool_use_id === pending.toolId);
      assert.ok(result, 'Original tool call did not receive a result'); pending.result = result; pending.done = true; modelResults.push(result);
    }
    const events = [
      { type: 'message_start', message: { id: randomUUID(), type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: call ? { type: 'tool_use', id: call.toolId, name: call.name, input: {} } : { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } : { type: 'text_delta', text: message } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
      { type: 'message_stop' },
    ];
    res.setHeader('Content-Type', 'text/event-stream'); res.end(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  } catch (error) { exceptions.push(String(error)); if (pending) pending.failure = String(error); res.statusCode = 500; res.end(String(error)); }
});
async function until(check, label) {
  for (let i = 0; i < 450; i++) { if (pending?.failure) throw new Error(pending.failure); if (await check()) return; if (pending?.done && label.endsWith('draft')) throw new Error('Expected draft but tool completed: ' + JSON.stringify(pending.result)); await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Timed out: ' + label);
}
const drafts = () => page.evaluate(() => window.agentDesktop.operationDrafts.list());
const nativeCalls = () => page.evaluate(() => window.agentDesktop.invokeAppContribution({ kind: 'commands', id: 'fixture.tool-review/inspect', input: {} }));
async function openDetails(title, appId) {
  await page.locator('button[title="插件"]').click();
  await page.getByRole('button', { name: `打开 ${title}`, exact: true }).click();
  await page.locator(`[data-app-details="${appId}"]`).waitFor();
}
async function send(appId, name, title, input = { recipient: '演示收件人', message: '确认前的内容', tags: ['demo'] }) {
  const detail = await page.evaluate(async ({ appId, title }) => {
    const created = await window.agentDesktop.createSession({ title, agentMode: 'local' });
    const selected = await window.agentDesktop.setSessionApps({ sessionId: created.summary.id, appIds: [appId] });
    if (selected.error) throw new Error(selected.error); return created;
  }, { appId, title });
  pending = { name, input };
  await page.evaluate(({ sessionId, title }) => { window.toolReviewTurn = null; void window.agentDesktop.send({ sessionId, prompt: title }).then(value => { window.toolReviewTurn = { value }; }, error => { window.toolReviewTurn = { error: String(error) }; }); }, { sessionId: detail.summary.id, title });
  return detail.summary.id;
}
async function finished() {
  await until(() => pending.done, 'tool result back to original model call');
  const result = pending.result; pending = null; return result;
}
try {
  await fs.mkdir(output, { recursive: true }); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const source = path.join(root, 'native'); await fs.cp(path.join(ui, 'tests/fixtures/apps/tool-call-review'), source, { recursive: true }); await writePackageChecksums(source);
  runtime = await new AppRuntimeHost({ rootDir: path.join(root, 'source-profile') }).initialize(); await runtime.installFromDirectory(source);
  const mcpRoot = path.join(root, 'mcp');
  await generateMcpApp({ definition: { schemaVersion: 1, id: 'fixture.mcp-review', version: '1.0.0', displayName: 'MCP 调用演示', mcpServers: { review: { type: 'http', url: `http://127.0.0.1:${server.address().port}/mcp` } } }, destination: mcpRoot });
  await runtime.installFromDirectory(mcpRoot);
  const modules = path.resolve(ui, '../../moss-apps/node_modules/.bun');
  const version = (await fs.readdir(modules)).filter(n => n.startsWith('playwright@')).sort().at(-1);
  const { chromium } = await import(pathToFileURL(path.join(modules, version, 'node_modules/playwright/index.mjs')));
  const id = randomUUID();
  const launchOptions = { run: { id, directory: root, home }, executable: path.join(ui, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [ui], cwd: ui,
    appRuntime: runtime, runtimeHome: path.join(output, 'runtime-cache'), signal: new AbortController().signal, timeoutMs: 120000,
    settings: { language: 'chinese', agentMode: 'local', model: 'review-fixture', apiKey: 'fixture', url: `http://127.0.0.1:${server.address().port}/v1`, appearance: { themeMode: 'light' }, autoMemory: { enabled: false, extractionEnabled: false } } };
  target = await launchTestInstance(launchOptions);
  browser = await chromium.connectOverCDP(target.endpoint); page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes(id)); assert.ok(page);
  page.setDefaultTimeout(20000); page.on('pageerror', e => exceptions.push(e.message)); await page.waitForSelector('button');
  const nativeName = normalizeAppToolName('record', 'fixture.tool-review');
  await send('fixture.tool-review', nativeName, '正常调用演示'); assert.equal((await finished()).is_error || false, false);
  assert.equal((await nativeCalls()).length, 1); assert.equal((await drafts()).length, 0);
  mark('Default normal call executes through real model/Core/App; no draft protocol is declared');

  await openDetails('工具调用演示', 'fixture.tool-review');
  const setting = page.getByRole('combobox', { name: `${nativeName} 调用方式`, exact: true });
  await setting.selectOption('draft'); await until(() => setting.isEnabled(), 'native policy saved'); assert.equal(await setting.inputValue(), 'draft');
  await setting.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'tool-settings.png') });
  await page.reload(); await page.waitForSelector('button'); await openDetails('工具调用演示', 'fixture.tool-review');
  assert.equal(await setting.inputValue(), 'draft');
  mark('Native App tool setting is in Plugins/Common/details; saves and survives reload');
  const sessionId = await send('fixture.tool-review', nativeName, '主会话草稿演示');
  await until(async () => (await drafts()).some(d => d.toolCall?.sessionId === sessionId), 'native draft');
  const draft = (await drafts()).find(d => d.toolCall?.sessionId === sessionId); assert.equal((await nativeCalls()).length, 1);
  await page.getByRole('button', { name: /^待处理/ }).click(); await page.locator(`[data-pending-work-item="operation:${draft.id}"]`).click();
  const card = page.locator(`[data-operation-draft="${draft.id}"]`); await card.waitFor(); assert.equal(await page.locator('[data-operation-draft-panel]').count(), 0);
  await card.getByRole('button', { name: '修改参数', exact: true }).click();
  await card.getByLabel('收件人 *', { exact: true }).fill('修改后的收件人'); await card.getByLabel('内容 *', { exact: true }).fill('修改后的内容');
  await card.getByRole('button', { name: '保存修改', exact: true }).click(); await until(async () => (await drafts()).find(d => d.id === draft.id).revision === 2, 'edited native params');
  await page.screenshot({ path: path.join(output, 'conversation-draft.png') });
  await page.reload(); await page.getByRole('button', { name: /^待处理/ }).click();
  await page.locator(`[data-pending-work-item="operation:${draft.id}"]`).click(); await card.waitFor();
  assert.equal((await nativeCalls()).length, 1);
  await card.getByRole('button', { name: '确认执行', exact: true }).click(); assert.equal((await finished()).is_error || false, false);
  assert.deepEqual((await nativeCalls()).at(-1), { recipient: '修改后的收件人', message: '修改后的内容', tags: ['demo'] }); assert.equal((await nativeCalls()).length, 2);
  await card.getByText('工具已返回', { exact: true }).waitFor(); await page.screenshot({ path: path.join(output, 'conversation-result.png') });
  mark('Bypass mode still waits; pending work opens main chat; schema fields edit; reload keeps wait; confirmation executes edited parameters once and resumes original model call');

  const cancelSession = await send('fixture.tool-review', nativeName, '取消草稿演示');
  await until(async () => (await drafts()).some(d => d.toolCall?.sessionId === cancelSession), 'cancel draft');
  const cancelled = (await drafts()).find(d => d.toolCall?.sessionId === cancelSession);
  await page.evaluate(draft => window.agentDesktop.operationDrafts.cancel({ draftId: draft.id, expectedRevision: draft.revision }), cancelled);
  assert.equal((await finished()).is_error, true); assert.equal((await nativeCalls()).length, 2);
  mark('Cancel returns an error to the original model tool call and performs zero side effects');

  const mcpApp = await page.evaluate(async () => (await window.agentDesktop.listApps()).find(a => a.id === 'fixture.mcp-review'));
  const service = mcpApp.mcpServices[0]; assert.ok(service);
  await page.evaluate(async ({ app, service }) => window.agentDesktop.manageAppMcp({ appId: app.id, instanceId: service.instanceId, version: app.currentVersion, method: 'servers.inspect', input: { name: service.name } }), { app: mcpApp, service });
  await openDetails('MCP 调用演示', 'fixture.mcp-review');
  const mcpName = normalizeAppToolName('record', 'fixture.mcp-review'), mcpSetting = page.getByRole('combobox', { name: `${mcpName} 调用方式`, exact: true });
  await mcpSetting.selectOption('draft'); await until(() => mcpSetting.isEnabled(), 'MCP policy saved'); assert.equal(await mcpSetting.inputValue(), 'draft');
  const mcpSession = await send('fixture.mcp-review', mcpName, 'MCP 草稿演示');
  await until(async () => (await drafts()).some(d => d.toolCall?.sessionId === mcpSession), 'MCP draft');
  assert.equal(mcpCalls.length, 0);
  const mcpDraft = (await drafts()).find(d => d.toolCall?.sessionId === mcpSession);
  await page.getByRole('button', { name: /^待处理/ }).click(); await page.locator(`[data-pending-work-item="operation:${mcpDraft.id}"]`).click();
  const mcpCard = page.locator(`[data-operation-draft="${mcpDraft.id}"]`); await mcpCard.waitFor();
  await mcpCard.getByRole('button', { name: '修改参数', exact: true }).click(); await mcpCard.getByLabel('内容 *', { exact: true }).fill('MCP 修改后的内容');
  await mcpCard.getByRole('button', { name: '保存修改', exact: true }).click();
  await until(async () => (await drafts()).find(d => d.id === mcpDraft.id).revision === 2, 'MCP edits saved');
  await mcpCard.getByRole('button', { name: '确认执行', exact: true }).click(); assert.equal((await finished()).is_error || false, false);
  assert.equal(mcpCalls.length, 1); assert.equal(mcpCalls[0].message, 'MCP 修改后的内容');
  assert.equal((await drafts()).find(d => d.id === mcpDraft.id).status, 'returned');
  assert.match(JSON.stringify(modelResults.at(-1)), /confirmation_token/);
  await mcpCard.getByText('工具已返回', { exact: true }).waitFor(); await page.screenshot({ path: path.join(output, 'mcp-result.png') });
  mark('Ordinary MCP tool uses same setting/flow; exact edited params sent once; two-stage response remains a tool result, never business success');
  const failedSession = await send('fixture.mcp-review', mcpName, 'MCP 调用异常演示', { recipient: 'demo', message: 'ERROR_AFTER_DISPATCH' });
  await until(async () => (await drafts()).some(d => d.toolCall?.sessionId === failedSession), 'MCP failure draft');
  const failedDraft = (await drafts()).find(d => d.toolCall?.sessionId === failedSession);
  const failed = await page.evaluate(draft => window.agentDesktop.operationDrafts.confirm({ draftId: draft.id, expectedRevision: draft.revision }), failedDraft);
  assert.equal(failed.status, 'unknown'); assert.equal((await finished()).is_error, true); assert.equal(mcpCalls.length, 2);
  assert.equal(await page.evaluate(async draft => { try { await window.agentDesktop.operationDrafts.confirm({ draftId: draft.id, expectedRevision: draft.revision }); return 'executed'; } catch { return 'rejected'; } }, failed), 'rejected');
  mark('MCP transport failure after dispatch becomes unknown and neither automatic retry nor repeated confirmation sends again');

  const restartSession = await send('fixture.mcp-review', mcpName, '重启草稿演示');
  await until(async () => (await drafts()).some(d => d.toolCall?.sessionId === restartSession), 'restart draft');
  const restartDraft = (await drafts()).find(d => d.toolCall?.sessionId === restartSession);
  pending = null; process.kill(target.pid, 'SIGKILL'); await target.exited; await browser.close();
  target = await launchTestInstance({ ...launchOptions, prepareEnvironment: false });
  browser = await chromium.connectOverCDP(target.endpoint); page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes(id));
  page.setDefaultTimeout(20000); page.on('pageerror', e => exceptions.push(e.message)); await page.waitForSelector('button');
  const restored = await drafts(); assert.equal(restored.find(d => d.id === restartDraft.id).status, 'expired'); assert.equal(restored.find(d => d.id === failed.id).status, 'unknown');
  assert.equal(mcpCalls.length, 2);
  await openDetails('MCP 调用演示', 'fixture.mcp-review');
  const restoredSetting = page.getByRole('combobox', { name: `${mcpName} 调用方式`, exact: true });
  await until(() => restoredSetting.isEnabled(), 'restored MCP policy'); assert.equal(await restoredSetting.inputValue(), 'draft');
  mark('Abrupt Host restart preserves user settings and receipts, expires lost waiting calls, and never replays pending or unknown operations');
  assert.deepEqual(exceptions, []);
  await fs.rm(path.join(output, 'failure.json'), { force: true }); await fs.rm(path.join(output, 'failure.png'), { force: true });
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ ok: true, checks, exceptions, externalSideEffects: false }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), pending, checks, exceptions, body: await page?.locator('body').innerText().catch(() => '') }, null, 2)); throw error;
} finally {
  await target?.close(); await browser?.close(); await runtime?.shutdown(); server.closeAllConnections(); server.close();
  await fs.copyFile(path.join(root, 'instance.log'), path.join(output, 'instance.log')).catch(() => {}); await fs.rm(root, { recursive: true, force: true });
}
