// Build first: bun run build:electron-direct. Uses only a local mock model API.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(tmpdir(), 'moss-effort-runtime-'));
process.env.MOSS_CONFIG_DIR = path.join(root, 'profile');
delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
globalThis.MACRO = { VERSION: 'test', BUILD_TIME: '', PACKAGE_URL: 'moss', FEEDBACK_CHANNEL: '', ISSUES_EXPLAINER: '', VERSION_CHANGELOG: '' };
const requests = [];
const server = createServer(async (request, response) => {
  if (request.url?.startsWith('/v1/models')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'gpt-5.5', context_window: 200000 }] }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests.push(body);
  const message = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  response.setHeader('Content-Type', 'text/event-stream');
  const events = [
    { type: 'message_start', message },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Verification complete.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const sessions = [];
try {
  await mkdir(process.env.MOSS_CONFIG_DIR, { recursive: true });
  const { ClaudeSession, getAuthDebugSnapshot } = await import('../electron-direct.mjs');
  getAuthDebugSnapshot();
  const options = {
    cwd: root, projectDir: path.join(root, 'engine'), model: 'gpt-5.5', effort: null,
    url: `http://127.0.0.1:${server.address().port}`, apiKey: 'mock-key',
    permissionMode: 'dontAsk', allowedTools: [], mcpServers: {}, addDirs: [],
    thinkingConfig: { type: 'disabled' },
    environment: { MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }), MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }) },
  };
  const active = new ClaudeSession(options);
  const other = new ClaudeSession({ ...options, projectDir: path.join(root, 'other-engine') });
  sessions.push(active, other);
  async function send(session, expected) {
    const before = requests.length;
    let completed = false;
    for await (const message of session.send('Verify the configured effort.', AbortSignal.timeout(15000))) {
      if (message.type === 'result') { assert.equal(message.is_error, false, message.result); completed = true; }
    }
    assert(completed);
    assert(requests.length > before);
    assert.equal(requests.at(-1).output_config?.effort, expected);
  }
  assert.equal(active.setEffort('low').applied, 'low');
  assert.equal(requests.length, 0, 'Selecting effort must not call the model');
  await send(active, 'low');
  active.setEffort('xhigh');
  await send(active, 'xhigh');
  await send(other, undefined);
  const maxModel = new ClaudeSession({ ...options, model: 'gpt-6-astra', projectDir: path.join(root, 'max-engine') });
  sessions.push(maxModel);
  assert.deepEqual(maxModel.getEffort().levels, ['low', 'medium', 'high', 'xhigh', 'max']);
  maxModel.setEffort('max');
  await send(maxModel, 'max');
  active.setEffort(null);
  await send(active, undefined);
  const maintenance = new ClaudeSession({
    ...options,
    projectDir: path.join(root, 'maintenance'),
    environment: { MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: true, extractionEnabled: false, dreamEnabled: false }) },
  });
  sessions.push(maintenance);
  const dream = await maintenance.consolidateMemory({ signal: AbortSignal.timeout(15000), transcriptDir: path.join(root, 'sessions') });
  assert.equal(dream.summary, 'Verification complete.');
  assert(!JSON.stringify(requests.at(-1).messages).includes('Verify the configured effort.'), 'Global Dream must not inherit the active conversation');
  console.log('PASS compiled runtime: low/xhigh/max reach model requests; auto and session isolation; global Dream uses an independent context.');
} finally {
  sessions.forEach(session => session.dispose());
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
