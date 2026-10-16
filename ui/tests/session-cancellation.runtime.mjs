// Build first: bun run build:electron-direct. All model traffic stays local.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = await mkdtemp(path.join(tmpdir(), 'moss-cancellation-runtime-'));
const report = process.stdout.write.bind(process.stdout);
process.env.MOSS_CONFIG_DIR = path.join(root, 'profile');
globalThis.MACRO = { VERSION: 'test', BUILD_TIME: '', PACKAGE_URL: 'moss', FEEDBACK_CHANNEL: '', ISSUES_EXPLAINER: '', VERSION_CHANGELOG: '' };
let requestCount = 0, holdStream = false, onRequest = () => {};
const server = createServer(async (request, response) => {
  if (request.url?.startsWith('/v1/models')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'gpt-5.5', context_window: 200000 }] }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requestCount++;
  response.setHeader('Content-Type', 'text/event-stream');
  const event = value => response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
  event({ type: 'message_start', message: { id: `msg_${requestCount}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } });
  event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'CANCEL_RECOVERED' } });
  onRequest();
  if (holdStream) return;
  event({ type: 'content_block_stop', index: 0 });
  event({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
  event({ type: 'message_stop' });
  response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const sessions = [];
const drain = async (session, signal) => {
  const messages = [];
  for await (const message of session.send('Verify cancellation and recovery.', signal)) messages.push(message);
  return messages;
};
const bounded = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Cancellation did not settle within 5 seconds')), 5000); })]); }
  finally { clearTimeout(timer); }
};
try {
  await mkdir(process.env.MOSS_CONFIG_DIR, { recursive: true });
  const { ClaudeSession } = await import(process.env.MOSS_CANCELLATION_RUNTIME
    ? pathToFileURL(path.resolve(process.env.MOSS_CANCELLATION_RUNTIME)).href : '../electron-direct.mjs');
  const options = {
    cwd: root, model: 'gpt-5.5', url: `http://127.0.0.1:${server.address().port}`, apiKey: 'mock-key',
    permissionMode: 'dontAsk', allowedTools: [], mcpServers: {}, addDirs: [], thinkingConfig: { type: 'disabled' },
    environment: { MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }), MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }) },
  };
  const makeSession = name => { const session = new ClaudeSession({ ...options, projectDir: path.join(root, name) }); sessions.push(session); return session; };
  const immediate = makeSession('immediate');
  const before = requestCount, pending = drain(immediate);
  immediate.abort();
  await bounded(pending);
  assert.equal(requestCount, before, 'An immediate Stop must prevent the first model request');
  const initializing = makeSession('initializing');
  const initializingTurn = drain(initializing);
  await new Promise(resolve => setImmediate(resolve));
  initializing.abort();
  await bounded(initializingTurn);
  assert.equal(requestCount, before, 'Stop during asynchronous initialization must not be cleared');
  for (const session of [immediate, initializing]) {
    const messages = await bounded(drain(session));
    assert(messages.some(message => message.type === 'result' && !message.is_error), 'A stopped session must accept a new turn');
  }
  for (const useSignal of [false, true]) {
    holdStream = true;
    const controller = new AbortController();
    const requested = new Promise(resolve => { onRequest = resolve; });
    const streaming = drain(immediate, useSignal ? controller.signal : undefined);
    await bounded(requested);
    if (useSignal) controller.abort(); else immediate.abort();
    await bounded(streaming).catch(error => { if (error.name !== 'AbortError' && error.name !== 'APIUserAbortError') throw error; });
    holdStream = false;
    const messages = await bounded(drain(immediate));
    assert(messages.some(message => message.type === 'result' && !message.is_error), 'Streaming cancellation must allow recovery');
  }
  holdStream = true;
  const requested = new Promise(resolve => { onRequest = resolve; });
  const activeTurn = drain(immediate);
  await bounded(requested);
  const countBeforeStop = requestCount, queuedTurn = drain(immediate);
  immediate.abort();
  await bounded(Promise.all([activeTurn, queuedTurn]));
  assert.equal(requestCount, countBeforeStop, 'Stop must also cancel sends already waiting in the runtime queue');
  holdStream = false;
  assert((await bounded(drain(immediate))).some(message => message.type === 'result' && !message.is_error));
  report('PASS: immediate Stop, initialization Stop, active stream abort, caller signal abort, queued cancellation, and subsequent sends.\n');
} catch (error) {
  report(String(error.stack || error) + '\n');
  process.exitCode = 1;
} finally {
  await Promise.allSettled(sessions.map(session => session.dispose()));
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
