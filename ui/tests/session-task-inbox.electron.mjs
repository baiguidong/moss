// Real desktop send, background Bash, session tasks and idle notification delivery with a local model fixture.
import assert from 'node:assert/strict';
import { app, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = await mkdtemp(path.join(tmpdir(), 'moss-task-notification-'));
process.env.MOSS_HOME = root;
process.env.MOSS_CONFIG_DIR = root;
process.env.MOSS_OPEN_DEVTOOLS = 'false';
app.setAppPath(fileURLToPath(new URL('..', import.meta.url)));
app.setPath('userData', path.join(root, 'electron'));
const handlers = new Map();
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, callback) => { handlers.set(name, callback); return register(name, callback); };
const ready = new Promise(resolve => app.once('browser-window-created', (_, window) => {
  window.show = () => {};
  window.showInactive = () => {};
  window.webContents.once('did-finish-load', () => resolve(window));
}));
let executionId, requests = 0;
const tool = (name, input) => ({ type: 'tool_use', id: 'call_' + requests, name, input });
const text = text => ({ type: 'text', text });
const steps = [
  () => tool('TaskCreate', { subject: 'Scan', description: 'Scan with a valid parameter' }),
  () => tool('TaskCreate', { subject: 'Evaluate', description: 'Evaluate the returned report' }),
  () => tool('Bash', { command: 'sh scan.sh wrong', description: 'Run scan', run_in_background: true }),
  body => {
    executionId = JSON.stringify(body.messages.at(-1)).match(/Command running in background with ID: (\w+)/)?.[1];
    assert.ok(executionId, JSON.stringify(body.messages.at(-1)));
    return tool('TaskUpdate', { taskId: '1', backgroundTaskId: executionId });
  },
  () => tool('TaskUpdate', { taskId: '1', status: 'pending' }),
  body => {
    assert.match(JSON.stringify(body.messages.at(-1)), /Keep the task in_progress/);
    return text('Waiting for scan.');
  },
  body => {
    assert.match(JSON.stringify(body.messages.at(-1)), /<status>failed<\/status>/);
    return tool('Bash', { command: 'sh scan.sh correct', description: 'Retry with corrected parameter' });
  },
  body => {
    assert.match(JSON.stringify(body.messages.at(-1)), /verified report/);
    return tool('TaskUpdate', { taskId: '1', status: 'completed' });
  },
  () => tool('TaskUpdate', { taskId: '2', status: 'in_progress' }),
  () => tool('TaskUpdate', { taskId: '2', status: 'completed' }),
  () => text('Report verified.'),
];
const failure = Promise.withResolvers();
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET') { response.end(JSON.stringify({ data: [{ id: 'test-model' }] })); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    if (!body.stream) { response.end(JSON.stringify({ type: 'message', role: 'assistant', content: [text('fixture')], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })); return; }
    const block = await steps[requests++](body);
    response.setHeader('Content-Type', 'text/event-stream');
    const emit = data => response.write('event: ' + data.type + '\ndata: ' + JSON.stringify(data) + '\n\n');
    const isTool = block.type === 'tool_use';
    emit({ type: 'message_start', message: { id: 'msg_' + requests, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
    emit({ type: 'content_block_start', index: 0, content_block: isTool ? { ...block, input: {} } : text('') });
    emit({ type: 'content_block_delta', index: 0, delta: isTool ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    emit({ type: 'content_block_stop', index: 0 });
    emit({ type: 'message_delta', delta: { stop_reason: isTool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
    emit({ type: 'message_stop' });
    response.end();
  } catch (error) { response.writeHead(400).end(String(error)); failure.reject(error); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const workspace = path.join(root, 'workspace');
const timer = setTimeout(() => failure.reject(new Error('Timed out at model request ' + requests)), 60000);
await mkdir(workspace);
await writeFile(path.join(root, 'settings.json'), JSON.stringify({
  models: { text: { model: 'gpt-5.5', baseUrl: 'http://127.0.0.1:' + server.address().port, apiKey: 'fixture', thinking: { mode: 'disabled' } } },
  autoMemory: { enabled: false }, sessionMemory: { enabled: false }, webSearch: { mode: 'disabled' },
}));
await writeFile(path.join(workspace, 'scan.sh'), 'if [ "$1" = wrong ]; then\n  while [ ! -f release ]; do sleep 0.05; done\n  echo "invalid parameter" >&2\n  exit 7\nfi\necho verified report\n');
await import('../src/main.mjs');
async function run() {
  const window = await ready;
  const invoke = (name, args) => handlers.get(name)({ sender: window.webContents }, args);
  const { summary } = await invoke('agent:create-session', { title: 'Background scan', workspace, agentMode: 'local', permissionMode: 'bypassPermissions' });
  const sessionId = summary.id;
  const result = await invoke('agent:send', { sessionId, prompt: 'Scan and evaluate.', mode: 'chat' });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(requests, 6);
  const linkedTask = JSON.parse(await readFile(path.join(root, 'tasks', sessionId, '1.json')));
  assert.equal(linkedTask.backgroundTaskId, executionId);
  const taskPanelStatuses = async () => (await invoke('agent:list-session-tasks', { sessionId })).tasks.map(task => task.status);
  assert.deepEqual(await taskPanelStatuses(), ['in_progress', 'pending']);
  await writeFile(path.join(workspace, 'release'), '');
  let detail;
  do {
    await delay(50);
    detail = await invoke('agent:get-session', { sessionId });
  } while (detail.busy || !JSON.stringify(detail.history).includes('Report verified.'));
  assert.equal(requests, steps.length);
  assert.deepEqual(await taskPanelStatuses(), ['completed', 'completed']);
  const db = new DatabaseSync(path.join(root, 'moss.db'), { readOnly: true });
  try {
    const receipts = db.prepare("SELECT id, status FROM session_turn_queue WHERE source_channel = 'runtime-task' AND session_id = ?").all(sessionId);
    assert.deepEqual(receipts.map(r => r.status), ['completed']);
    const { underlying_session_id: engine, is_coordinator_mode: coordinator } = db.prepare('SELECT underlying_session_id, is_coordinator_mode FROM sessions WHERE id = ?').get(sessionId);
    assert.equal(coordinator, 0);
    const transcript = await readFile(path.join(root, 'sessions', sessionId, 'runtime', 'engine', engine + '.jsonl'), 'utf8');
    const inputs = transcript.trim().split('\n').map(line => JSON.parse(line)).filter(m => m.type === 'user' && m.uuid === receipts[0].id);
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].origin.kind, 'task-notification');

    // Queue a new user instruction while the previous model response is still open.
    const held = Promise.withResolvers(), releaseModel = Promise.withResolvers();
    steps.push(
      () => tool('Bash', { command: 'sh scan.sh wrong', description: 'Second scan', run_in_background: true }),
      async () => { held.resolve(); await releaseModel.promise; return text('Waiting.'); },
      body => {
        assert.match(JSON.stringify(body.messages.at(-1)), /report the error without retrying/);
        return text('Understood.');
      },
      body => {
        assert.match(JSON.stringify(body.messages.at(-1)), /<status>failed<\/status>/);
        assert.match(JSON.stringify(body.messages), /report the error without retrying/);
        return text('The second scan failed.');
      },
    );
    await rm(path.join(workspace, 'release'));
    const send = prompt => invoke('agent:send', { sessionId, prompt, mode: 'chat' });
    const first = send('Start another scan.');
    await held.promise;
    const second = send('For this scan, report the error without retrying.');
    await writeFile(path.join(workspace, 'release'), '');
    const pending = db.prepare("SELECT id FROM session_turn_queue WHERE session_id = ? AND status = 'queued'");
    while (!pending.get(sessionId)) await delay(20);
    releaseModel.resolve();
    assert.ok((await first).ok);
    assert.ok((await second).ok);
    assert.equal(requests, steps.length);
    assert.equal(pending.get(sessionId), undefined);
  } finally { db.close(); }
  console.log('PASS: normal desktop chat released, failed Bash woke it once, corrected retry completed both tracked tasks.');
}
async function main() {
  try { await Promise.race([run(), failure.promise]); }
  catch (error) { console.error(error.stack || error); process.exitCode = 1; }
  finally {
    clearTimeout(timer);
    await writeFile(path.join(workspace, 'release'), '').catch(() => {});
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    app.exit(process.exitCode || 0);
  }
}
void main();
