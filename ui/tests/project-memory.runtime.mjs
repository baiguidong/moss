// Run after build:direct. Exercises the compiled runtime against a local mock API.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectMemoryQuery } from '../src/project-memory-query.mjs';
import { createProjectMemoryService } from '../src/project-memory-service.mjs';
import { createProjectStore } from '../src/project-store.mjs';
import { createDesktopDataPaths } from '../src/desktop-data-layout.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'moss-project-memory-runtime-'));
process.env.MOSS_CONFIG_DIR = path.join(root, 'profile');
globalThis.MACRO = { VERSION: 'test', BUILD_TIME: '', PACKAGE_URL: 'moss', FEEDBACK_CHANNEL: '', ISSUES_EXPLAINER: '', VERSION_CHANGELOG: '' };
const requests = [];
let invalidConsolidation = false, service, sourceRuntime;
const server = createServer(async (request, response) => {
  if (request.url?.startsWith('/v1/models')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'gpt-6.1-sol', context_window: 200000 }] }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const text = JSON.stringify(body.messages || []);
  const stage = text.includes('Extract a faithful') ? 'extract' : text.includes('Consolidate the supplied project') ? 'consolidate' : 'session';
  requests.push({ stage, body });
  if (stage !== 'session' && body.thinking?.type === 'disabled') {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { type: 'invalid_request_error',
      message: 'gpt-6.1-sol does not support reasoning effort "none"; use low, medium, high, xhigh or max; mock-key' } }));
    return;
  }
  const reply = stage === 'extract' ? '{"summary":"Verified fixture output [source]"}'
    : stage === 'consolidate' ? invalidConsolidation ? 'broken JSON' : '{"overview":"Project fixture knowledge [source]"}' : 'Ordinary session is still usable.';
  const message = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } };
  response.setHeader('Content-Type', 'text/event-stream');
  const events = [
    { type: 'message_start', message },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 15 } },
    { type: 'message_stop' },
  ];
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const watchdog = setTimeout(() => { console.error('Project memory runtime test timed out'); process.exit(1); }, 60_000);
try {
  await mkdir(process.env.MOSS_CONFIG_DIR, { recursive: true });
  const { ClaudeSession, getAuthDebugSnapshot } = await import('../electron-direct.mjs');
  getAuthDebugSnapshot();
  const settings = { model: 'gpt-6.1-sol', fastModel: 'gpt-6.1-sol', thinkingMode: 'adaptive', language: 'chinese', url: `http://127.0.0.1:${server.address().port}`, apiKey: 'mock-key' };
  const store = createProjectStore({ DESKTOP_DATA_PATHS: createDesktopDataPaths(root), projectRecordQueues: new Map(), mossLog() {} });
  await store.ensureProjectStructure('p');
  await store.writeProject({ id: 'p', name: 'Fixture', createdAt: 1, updatedAt: 1 });
  await writeFile(store.getProjectMemoryOverviewPath('p'), 'INITIAL_PROJECT_MEMORY_FIXTURE');
  const initialMemory = (await store.getProjectMemory('p')).overview;
  sourceRuntime = new ClaudeSession({ ...settings, cwd: store.getProjectWorkspaceDir('p'), projectDir: path.join(root, 'source-runtime'),
    appendSystemPrompt: initialMemory,
    permissionMode: 'dontAsk', allowedTools: [], mcpServers: {}, addDirs: [], thinkingConfig: { type: 'disabled' },
    environment: { MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }), MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }) } });
  async function ordinaryTurn(prompt) {
    let completed;
    for await (const message of sourceRuntime.send(prompt, AbortSignal.timeout(15000))) {
      if (message.type === 'result') { assert.equal(message.is_error, false, message.result); completed = message; }
    }
    assert(completed);
    return completed.session_id;
  }
  const originalSessionId = await ordinaryTurn('Create a fixture report.');
  assert.equal(typeof originalSessionId, 'string');
  assert.ok(originalSessionId.length > 0);
  const query = createProjectMemoryQuery({ prepareRuntime: async () => {}, getSessionConstructor: async () => ClaudeSession,
    getSettings: () => settings, getProjectRunsDir: store.getProjectRunsDir, getProjectWorkspaceDir: store.getProjectWorkspaceDir, mossHome: root });
  service = createProjectMemoryService({ getProjectDir: store.getProjectDir, readProject: store.readProject,
    getMemory: store.getProjectMemory, listSources: async () => [{ id: 'source', updatedAt: 1, title: 'Fixture session' }],
    readSource: async () => 'USER: Create a fixture report.\nASSISTANT: Verified fixture output.', query });
  await service.run('p', { force: true });
  assert.equal((await store.getProjectMemory('p')).version, 1);
  assert.equal((await service.read('p', { sourceId: 'source' })).summary, 'Verified fixture output [source]');
  assert.deepEqual(requests.filter(item => item.stage !== 'session').map(item => item.stage), ['extract', 'consolidate']);
  for (const request of requests.filter(item => item.stage !== 'session')) {
    assert.equal(request.body.tools?.length || 0, 0, 'Maintenance must have no tools');
    assert.deepEqual(request.body.thinking, { type: 'adaptive' }, 'Maintenance must respect the configured thinking mode');
  }
  assert.deepEqual(await readdir(store.getProjectRunsDir('p')), [], 'Disposable maintenance runtime files must be removed');
  invalidConsolidation = true;
  await service.addNote('p', { text: 'Correct fixture knowledge.' });
  await assert.rejects(service.run('p', { force: true }), /JSON/);
  assert.equal((await store.getProjectMemory('p')).version, 1);
  assert.equal((await service.read('p')).correctionCount, 1);
  invalidConsolidation = false;
  await service.run('p', { force: true });
  assert.equal((await store.getProjectMemory('p')).version, 2);
  assert.equal(await ordinaryTurn('Continue the same ordinary session.'), originalSessionId);
  for (const { body } of requests.filter(item => item.stage === 'session')) {
    assert.equal(JSON.stringify(body.system).split('INITIAL_PROJECT_MEMORY_FIXTURE').length - 1, 1, 'Project memory belongs in one initial system prefix');
    assert(!JSON.stringify(body.messages).includes('INITIAL_PROJECT_MEMORY_FIXTURE'), 'Project memory must never become conversation messages');
  }
  assert.equal(requests.filter(item => item.stage === 'extract').length, 1, 'Retry should reuse extraction');
  settings.thinkingMode = 'disabled';
  await service.addNote('p', { text: 'Keep confirmed findings.' });
  await assert.rejects(service.run('p', { force: true }), /记忆模型请求失败：.*400.*does not support reasoning effort/);
  const failed = await service.getStatus('p');
  assert.match(failed.error, /reasoning effort "none"/);
  assert(!failed.error.includes(settings.apiKey), 'Provider errors must redact the configured API key');
  assert.equal((await store.getProjectMemory('p')).version, 2, 'A rejected model request must retain the previous memory');
  settings.thinkingMode = 'auto';
  await service.run('p', { force: true });
  assert.equal(Object.hasOwn(requests.at(-1).body, 'thinking'), false, 'Automatic thinking must use the endpoint default');
  assert.equal((await service.getStatus('p')).error, '');
  assert.equal((await store.getProjectMemory('p')).version, 3);
  console.log('PROJECT_MEMORY_RUNTIME_PASSED: configured/default thinking, reasoning-only model rejection and recovery, redacted errors, independent maintenance and source session continuity');
} finally {
  clearTimeout(watchdog);
  await service?.stop();
  await sourceRuntime?.dispose();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
