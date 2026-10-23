import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

export async function bounded(promise, label, ms = 15000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function createCoordinatorStressFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-boss-stress-'));
  process.env.MOSS_HOME = root;
  process.env.MOSS_CONFIG_DIR = path.join(root, 'profile');
  globalThis.MACRO = { VERSION: 'test', BUILD_TIME: '', PACKAGE_URL: 'moss', FEEDBACK_CHANNEL: '', ISSUES_EXPLAINER: '', VERSION_CHANGELOG: '' };
  const scenarios = new Map(), sessions = [], errors = [];
  let requests = 0, activeWorkers = 0, peakWorkers = 0;
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET') {
        response.end(JSON.stringify({ data: [{ id: 'gpt-5.5', context_window: 200000 }] }));
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      const text = JSON.stringify(body.messages);
      const match = /STRESS_(?:CASE|WORKER):([a-z0-9_-]+)/.exec(text);
      const state = scenarios.get(match?.[1]);
      if (!state) throw new Error('Model request is missing an isolated test scenario');
      const coordinator = JSON.stringify(body.system).includes('You are a **coordinator**');
      const id = ++requests;
      let blocks;
      if (coordinator) {
        state.parentRequests.push(body);
        await state.onParent?.(body);
        const batch = state.batch.splice(0);
        blocks = batch.length ? batch.map((tool, i) => ({ type: 'tool_use', id: `tool_${id}_${i}`, ...tool }))
          : [{ type: 'text', text: `SUMMARY:${state.name}` }];
      } else {
        activeWorkers++;
        peakWorkers = Math.max(peakWorkers, activeWorkers);
        response.once('close', () => { activeWorkers--; });
        const index = Number(/STRESS_WORKER:[a-z0-9_-]+:(\d+)/.exec(text)?.[1] || 0);
        const run = (state.runs.get(index) || 0) + 1;
        state.runs.set(index, run);
        state.workerRequests.push({ index, run, body });
        state.onWorker?.({ index, run, body });
        const behavior = await state.worker({ index, run, body });
        if (behavior?.error) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: behavior.error } }));
          return;
        }
        // Wait after receiving the worker request so the Agent tool has already
        // returned to its caller before this worker produces its answer.
        if (behavior?.delay) await Promise.race([
          pause(behavior.delay),
          new Promise(resolve => response.once('close', resolve)),
        ]);
        if (response.destroyed) return;
        blocks = behavior?.blocks || [{ type: 'text', text: `RESULT:${state.name}:${index}:${run}` }];
      }
      response.setHeader('Content-Type', 'text/event-stream');
      const event = value => response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
      event({ type: 'message_start', message: { id: `msg_${id}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
      for (const [index, block] of blocks.entries()) {
        event({ type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { ...block, text: '' } });
        event({ type: 'content_block_delta', index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
        event({ type: 'content_block_stop', index });
      }
      event({ type: 'message_delta', delta: { stop_reason: blocks.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
      event({ type: 'message_stop' });
      response.end();
    } catch (error) {
      errors.push(String(error.stack || error));
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await mkdir(process.env.MOSS_CONFIG_DIR, { recursive: true });
  const { ClaudeSession, resumeClaudeSession } = await import('../../electron-direct.mjs');
  return {
    root, errors,
    stats: () => ({ requests, peakWorkers, activeWorkers, sessions: sessions.length }),
    async scenario(name, count = 1, worker = async () => ({}), sessionOptions = {}) {
      const workspace = path.join(root, name);
      await mkdir(workspace, { recursive: true });
      const state = {
        name, worker, batch: Array.from({ length: count }, (_, index) => ({ name: 'Agent', input: {
          name: `worker-${index}`, description: `Stress ${name} ${index}`, subagent_type: 'general-purpose', prompt: `STRESS_WORKER:${name}:${index}`,
        } })), parentRequests: [], workerRequests: [], runs: new Map(),
      };
      scenarios.set(name, state);
      const options = {
        cwd: workspace, projectDir: workspace, coordinatorMode: true, model: 'gpt-5.5',
        url: `http://127.0.0.1:${server.address().port}`, apiKey: 'mock-key',
        permissionMode: 'bypassPermissions', mcpServers: {}, addDirs: [], thinkingConfig: { type: 'disabled' },
        environment: { MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }), MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }) },
        ...sessionOptions,
      };
      let session = new ClaudeSession(options);
      sessions.push(session);
      return {
        get session() { return session; }, state, workspace,
        tasks: () => Object.values(session.getAppState()?.tasks || {}).filter(task => task.type === 'local_agent'),
        send(prompt = `STRESS_CASE:${name}`, signal, turnOptions) {
          const messages = [];
          const done = (async () => { for await (const message of session.send(prompt, signal, turnOptions)) messages.push(message); return messages; })();
          const settled = done.then(() => null, error => error);
          return { done, settled, messages };
        },
        resume(index = 0, message = 'Continue the assigned work.') {
          state.batch.push({ name: 'SendMessage', input: { to: `worker-${index}`, message, summary: 'Continue worker' } });
        },
        async restart() {
          await session.prepareForIdleDispose();
          const id = session.sessionId;
          await session.dispose();
          const restored = await resumeClaudeSession(id, { ...options, sourceJsonlFile: path.join(workspace, `${id}.jsonl`) });
          if (!restored?.session) throw new Error('Could not restore fixture session');
          session = restored.session;
          sessions.push(session);
        },
      };
    },
    async close() {
      await Promise.allSettled(sessions.map(session => session.dispose()));
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await pause(50);
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
