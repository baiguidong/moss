// Build first: bun run build:electron-direct. Model traffic and workspaces stay local.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(tmpdir(), 'moss-coordinator-runtime-'));
const report = process.stdout.write.bind(process.stdout);
process.env.MOSS_CONFIG_DIR = path.join(root, 'profile');
process.env.MOSS_HOME = root;
globalThis.MACRO = { VERSION: 'test', BUILD_TIME: '', PACKAGE_URL: 'moss', FEEDBACK_CHANNEL: '', ISSUES_EXPLAINER: '', VERSION_CHANGELOG: '' };
const sessions = [], cases = new Map();
let requestId = 0;

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Coordinator test timed out')), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET') {
    response.end(JSON.stringify({ data: [{ id: 'gpt-5.5', context_window: 200000 }] }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  const text = JSON.stringify(body.messages);
  const coordinator = JSON.stringify(body.system).includes('You are a **coordinator**');
  const name = /BOSS_(?:CASE|WORKER):([a-z]+)/.exec(text)?.[1];
  const state = cases.get(name);
  if (!state) { response.writeHead(400); response.end('Unexpected model request'); return; }
  const id = ++requestId;
  response.setHeader('Content-Type', 'text/event-stream');
  const event = value => response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
  event({ type: 'message_start', message: { id: `msg_${id}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  let block;
  if (coordinator && !state.launched) {
    state.launched = true;
    state.coordinatorTools = body.tools.map(tool => tool.name);
    block = { type: 'tool_use', id: `call_${id}`, name: 'Agent', input: {
      description: `Verify ${name}`, subagent_type: 'general-purpose', prompt: `BOSS_WORKER:${name}`, name: `worker-${name}`,
    } };
  } else if (coordinator && state.resuming && !state.resumeLaunched) {
    state.resumeLaunched = true;
    block = { type: 'tool_use', id: `call_${id}`, name: 'SendMessage', input: { to: 'worker-success', message: 'Verify the follow-up work.', summary: 'Verify follow-up' } };
  } else {
    if (!coordinator) {
      state.workerRuns = (state.workerRuns || 0) + 1;
      state.workerTools = body.tools.map(tool => tool.name);
      state.workerStarted();
    }
    block = { type: 'text', text: coordinator ? (text.includes('<task-notification>') ? 'BOSS_SYNTHESIZED' : 'Worker launched.') : 'WORKER_FINISHED' };
  }
  event({ type: 'content_block_start', index: 0, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { ...block, text: '' } });
  event({ type: 'content_block_delta', index: 0, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
  if (!coordinator && name !== 'success') return; // Keep the worker actively streaming until Stop.
  event({ type: 'content_block_stop', index: 0 });
  event({ type: 'message_delta', delta: { stop_reason: block.type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  event({ type: 'message_stop' });
  response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

try {
  await mkdir(process.env.MOSS_CONFIG_DIR, { recursive: true });
  const { ClaudeSession } = await import('../electron-direct.mjs');
  const startCase = async name => {
    const state = {};
    const started = new Promise(resolve => { state.workerStarted = resolve; });
    cases.set(name, state);
    const workspace = path.join(root, name);
    await mkdir(workspace, { recursive: true });
    const session = new ClaudeSession({
      cwd: workspace, projectDir: workspace, coordinatorMode: true,
      model: 'gpt-5.5', url: `http://127.0.0.1:${server.address().port}`, apiKey: 'mock-key',
      permissionMode: 'bypassPermissions', mcpServers: {}, addDirs: [], thinkingConfig: { type: 'disabled' },
      environment: { MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }), MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }) },
    });
    sessions.push(session);
    const controller = new AbortController();
    const messages = [];
    const turn = (async () => {
      for await (const message of session.send(`BOSS_CASE:${name}`, controller.signal)) messages.push(message);
    })();
    // Observe rejection immediately, while also waiting for the worker to start.
    const settled = turn.then(() => null, error => error);
    await bounded(Promise.race([started, turn.then(() => { if (!state.workerTools) throw new Error('No worker started'); })]));
    assert(state.coordinatorTools.includes('Agent'));
    assert(state.workerTools.includes('Read'), 'Workers must retain execution tools');
    return { session, state, workspace, messages, turn, settled, controller };
  };
  for (const name of ['success', 'abort', 'signal', 'dispose']) {
    const { session, state, workspace, messages, turn, settled, controller } = await startCase(name);
    if (name === 'success') {
      await bounded(turn);
      assert(messages.some(message => message.type === 'result' && !message.is_error && message.result.includes('BOSS_SYNTHESIZED')), 'Worker completion must drive a final coordinator response');
      state.resuming = true;
      for await (const message of session.send('Continue the same worker.')) messages.push(message);
      assert.equal(state.workerRuns, 2, 'SendMessage must continue the worker');
      const workers = Object.values(session.getAppState().tasks).filter(task => task.type === 'local_agent');
      assert.equal(workers.length, 1, 'Continuation must reuse the same worker');
      await session.prepareForIdleDispose();
      const transcript = (await readFile(path.join(workspace, session.sessionId, 'subagents', `agent-${workers[0].agentId}.jsonl`), 'utf8'))
        .trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type === 'user' || entry.type === 'assistant');
      assert.equal(new Set(transcript.map(entry => entry.uuid)).size, transcript.length, 'Continuation must not append the old transcript again');
    } else {
      const workers = Object.values(session.getAppState().tasks).filter(task => task.type === 'local_agent');
      assert.equal(workers.length, 1);
      const workerSignal = workers[0].abortController.signal;
      if (name === 'signal') controller.abort();
      else if (name === 'dispose') await session.dispose();
      else session.abort();
      const error = await bounded(settled);
      if (error && error.name !== 'AbortError' && error.name !== 'APIUserAbortError') throw error;
      assert.equal(workerSignal.aborted, true, `${name}: Stop must abort the worker, not only the coordinator`);
      assert(Object.values(session.getAppState()?.tasks || {}).every(task => task.type !== 'local_agent' || task.status !== 'running'), `${name}: no worker may remain running after Stop`);
    }
    report(`PASS: coordinator ${name}\n`);
    await session.dispose();
  }
  const [stopped, survivor] = await Promise.all([startCase('isolated'), startCase('survivor')]);
  stopped.session.abort();
  await bounded(stopped.settled);
  const survivingWorker = Object.values(survivor.session.getAppState().tasks).find(task => task.type === 'local_agent');
  assert.equal(survivingWorker.status, 'running', 'Stopping one Boss session must not stop another');
  assert.equal(survivingWorker.abortController.signal.aborted, false);
  survivor.session.abort();
  await bounded(survivor.settled);
  report('PASS: concurrent Boss sessions remain isolated\n');
} catch (error) {
  report(String(error.stack || error) + '\n');
  process.exitCode = 1;
} finally {
  for (const session of sessions) {
    for (const task of Object.values(session.getAppState()?.tasks || {})) {
      if (task.type === 'local_agent' && task.status === 'running') await session.stopTask(task.id).catch(() => {});
    }
    await session.dispose();
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
