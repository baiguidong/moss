// Build first: bun run build:electron-direct. Isolated real HTTP, no cloud API.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(tmpdir(), 'moss-model-probe-'));
process.env.MOSS_HOME = root;
process.env.MOSS_CONFIG_DIR = root;
process.env.CLAUDE_CODE_DISABLE_THINKING = '1';
globalThis.MACRO = { VERSION: 'test' };
let behavior = 'ok';
const requests = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests.push({ url: req.url, authorization: req.headers.authorization, body });
  if (behavior === 'error') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'probe-model does not support reasoning effort "none"; probe-secret' } }));
    return;
  }
  if (behavior === 'hang') return;
  res.setHeader('Content-Type', 'text/event-stream');
  const events = [
    { type: 'message_start', message: { id: 'probe', type: 'message', role: 'assistant', model: body.model, content: [], usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    ...(behavior === 'truncated' ? [] : behavior === 'stream-error'
      ? [{ type: 'error', error: { type: 'overloaded_error', message: 'Stream failed' } }]
      : [{ type: 'message_stop' }]),
  ];
  res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { probeModelConfiguration } = await import('../electron-direct.mjs');
const options = { model: 'probe-model', url: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'probe-secret' };
try {
  for (const thinkingConfig of [{ type: 'auto' }, { type: 'adaptive' }, { type: 'enabled', budgetTokens: 2048 }, { type: 'disabled' }]) {
    const result = await probeModelConfiguration({ ...options, thinkingConfig });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.status, 200);
    const { body, url, authorization } = requests.at(-1);
    assert.match(url, /\/v1\/messages\?beta=true/);
    assert.equal(authorization, 'Bearer probe-secret');
    assert.equal(body.model, 'probe-model');
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply with OK only.' }]);
    assert.equal(body.tools, undefined);
    assert.equal(body.output_config, undefined);
    if (thinkingConfig.type === 'auto') assert.equal(Object.hasOwn(body, 'thinking'), false);
    else assert.deepEqual(body.thinking, thinkingConfig.type === 'enabled' ? { type: 'enabled', budget_tokens: 2048 } : thinkingConfig);
  }
  behavior = 'error';
  const before = requests.length;
  const rejected = await probeModelConfiguration({ ...options, thinkingConfig: { type: 'disabled' } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 400);
  assert.match(rejected.message, /reasoning effort/);
  assert.doesNotMatch(JSON.stringify(rejected), /probe-secret/);
  assert.equal(requests.length, before + 1, 'Do not hide unsupported modes behind retries or fallbacks');
  for (const mode of ['truncated', 'stream-error', 'hang']) {
    behavior = mode;
    const result = await probeModelConfiguration({ ...options, timeoutMs: mode === 'hang' ? 100 : 1000 });
    assert.equal(result.ok, false, mode);
    if (mode === 'hang') assert.match(result.message, /超时/);
  }
  assert.equal(process.env.CLAUDE_CODE_DISABLE_THINKING, '1', 'Testing must not change running-session settings');
  console.log('PASS model test: Messages URL/auth, four thinking modes, omitted effort, errors without retry, secret redaction, stream completion and timeout.');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
