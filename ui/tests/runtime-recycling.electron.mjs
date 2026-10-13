// Real Desktop IPC, renderer settings, model requests and transcript recovery. No cloud API.
import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { SessionRuntimePool } from '../src/session-runtime-pool.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-runtime-recycling-'));
const output = fileURLToPath(new URL('../../output/mcp-app-proof/', import.meta.url));
process.env.MOSS_HOME = root; process.env.MOSS_CONFIG_DIR = root; process.env.MOSS_OPEN_DEVTOOLS = 'false';
app.setAppPath(fileURLToPath(new URL('..', import.meta.url))); app.setPath('userData', path.join(root, 'electron'));
let pool, window, clock = Date.now(), releaseModel, modelHeld = false, failure;
const checks = [], requests = [];
const record = name => { checks.push(name); console.log(`PASS ${name}`); };
const start = SessionRuntimePool.prototype.start;
SessionRuntimePool.prototype.start = function (...args) { pool = this; this.now = () => clock; return start.apply(this, args); };
const handlers = new Map(), handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, callback) => { handlers.set(name, callback); return handle(name, callback); };
const ready = new Promise(resolve => app.on('browser-window-created', (_event, created) => {
  created.show = () => {}; created.showInactive = () => {};
  if (!window) { window = created; window.webContents.once('did-finish-load', resolve); }
}));
const waitFor = async (predicate, label) => {
  for (let i = 0; i < 500; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
};
const server = createServer(async (request, response) => {
  try {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET') { response.end(JSON.stringify({ data: [{ id: 'gpt-5.5', context_window: 200000 }] })); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const text = 'Runtime recovery verification complete.';
    const message = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } };
    if (!body.stream) { response.end(JSON.stringify({ ...message, content: [{ type: 'text', text }], stop_reason: 'end_turn' })); return; }
    requests.push(body);
    response.setHeader('Content-Type', 'text/event-stream');
    response.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message })}\n\n`);
    const last = JSON.stringify(body.messages?.at(-1));
    if (last?.includes('HOLD-RECYCLING')) { modelHeld = true; await new Promise(resolve => { releaseModel = resolve; }); }
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
      { type: 'message_stop' },
    ];
    response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  } catch (error) { failure = error; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ models: { text: { model: 'gpt-5.5', baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'local-fixture-key', thinking: { mode: 'disabled' } } },
  autoMemory: { enabled: false }, sessionMemory: { enabled: false }, webSearch: { mode: 'disabled' } }));
const timeout = setTimeout(() => { console.error('Runtime recycling test timed out'); app.exit(1); }, 150_000);
async function run() {
  try {
    await import('../src/main.mjs'); await ready; await waitFor(() => pool, 'runtime pool startup');
    const invoke = (name, input) => handlers.get(name)({ sender: window.webContents }, input);
    const js = source => window.webContents.executeJavaScript(source);
    const defaults = { sessionIdleMinutes: 60, maxSessionRuntimes: 15, mcpIdleMinutes: 60 };
    assert.deepEqual((await invoke('agent:get-settings')).runtimeLifecycle, defaults);
    const create = async title => (await invoke('agent:create-session', { title, agentMode: 'local', connectorIds: [] })).summary.id;
    const send = async (sessionId, prompt) => {
      const result = await invoke('agent:send', { sessionId, prompt });
      assert.equal(result.ok, true, JSON.stringify(result));
      if (failure) throw failure;
      return result;
    };
    const a = await create('Recovery A'); await send(a, 'Remember ORIGINAL-ALPHA-713 for the next message.');
    const originalRecord = [...pool.records].find(record => record.id === a), originalRuntime = originalRecord.runtime;
    const underlying = originalRecord.underlyingSessionId;
    clock += 59 * 60_000; await pool.sweep(); assert.equal(originalRecord.runtime, originalRuntime);
    clock += 60_000; await pool.sweep(); assert.equal(originalRecord.runtime, null);
    assert.equal(pool.stats().runtimes, 0);
    await send(a, 'Continue the same conversation and recall the original marker.');
    assert.notEqual(originalRecord.runtime, originalRuntime); assert.equal(originalRecord.underlyingSessionId, underlying);
    assert.match(JSON.stringify(requests.at(-1).messages), /ORIGINAL-ALPHA-713/);
    assert.match(JSON.stringify((await invoke('agent:get-session', { sessionId: a })).history), /ORIGINAL-ALPHA-713/);
    record('actual chat survives one-hour idle retirement and restores its original transcript/session ID');

    const active = originalRecord.runtime;
    await invoke('agent:update-settings', { runtimeLifecycle: { maxSessionRuntimes: 1 } });
    assert.equal(originalRecord.runtime, active, 'changing lifecycle settings must not reset active runtimes');
    const b = await create('Recovery B'); await send(b, 'Remember ORIGINAL-BETA-821.');
    assert.equal(originalRecord.runtime, null); assert.equal(pool.stats().runtimes, 1);
    await send(a, 'Continue A after capacity reclamation.');
    assert.match(JSON.stringify(requests.at(-1).messages), /ORIGINAL-ALPHA-713/);
    assert.doesNotMatch(JSON.stringify(requests.at(-1).messages), /ORIGINAL-BETA-821/);
    record('capacity eviction restores the right conversation and settings updates apply without resetting it');

    const heldRuntime = originalRecord.runtime;
    const pending = send(a, 'HOLD-RECYCLING'); await waitFor(() => modelHeld, 'streaming model request');
    clock += 2 * 3_600_000; await pool.sweep(); assert.equal(originalRecord.runtime, heldRuntime);
    releaseModel(); await pending;
    await pool.sweep(); assert.equal(originalRecord.runtime, heldRuntime);
    record('an in-flight model request is protected and idle time restarts when it completes');

    await invoke('agent:update-settings', { runtimeLifecycle: defaults });
    await js(`Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === '设置' || el.getAttribute('aria-label') === '设置')?.click()`);
    await waitFor(() => js(`Boolean(Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('高级')))`), 'settings navigation');
    await js(`Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('高级'))?.click()`);
    await waitFor(() => js(`Boolean(document.querySelector('input[aria-label="会话运行时空闲回收"]'))`), 'lifecycle settings inputs');
    await js(`const el=document.querySelector('input[aria-label="会话运行时空闲回收"]'); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'61'); el.dispatchEvent(new Event('input',{bubbles:true})); el.blur();`);
    await waitFor(async () => (await invoke('agent:get-settings')).runtimeLifecycle.sessionIdleMinutes === 61, 'setting saved through renderer');
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'settings.json'))).runtimeLifecycle.sessionIdleMinutes, 61);
    await waitFor(() => js(`document.querySelector('input[aria-label="会话运行时空闲回收"]').value === '61'`), 'renderer reflects saved value');
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'runtime-recycling-settings.png'), (await window.webContents.capturePage()).toPNG());
    record('renderer settings save the new policy to disk');
    clock += 61 * 60_000; await pool.sweep(); assert.equal(pool.stats().runtimes, 0);
    await fs.writeFile(path.join(output, 'runtime-recycling-verification.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), defaults, checks, stats: pool.stats() }, null, 2) + '\n');
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally {
    clearTimeout(timeout); pool?.stop(); releaseModel?.();
    for (const record of pool?.records || []) await record.runtime?.dispose?.();
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    app.exit(process.exitCode || 0);
  }
}
void run();
