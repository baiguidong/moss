// Real bundled QueryEngine: completion drains every tool receipt and resets on the next send.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const root = await mkdtemp(path.join(tmpdir(), 'moss-completion-runtime-'));
process.env.MOSS_HOME = root;
process.env.MOSS_CONFIG_DIR = path.join(root, 'profile');
globalThis.MACRO = { VERSION: 'test', BUILD_TIME: '', PACKAGE_URL: 'moss', FEEDBACK_CHANNEL: '', ISSUES_EXPLAINER: '', VERSION_CHANGELOG: '' };
const output = process.stdout.write.bind(process.stdout);
let requests = 0, session;
const toolName = 'app__moss_self_test__self_test', executed = [];
const server = createServer(async (request, response) => {
  if (request.method === 'GET') { response.end(JSON.stringify({ data: [{ id: 'gpt-5.5', context_window: 200000 }] })); return; }
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks)); requests++;
  response.setHeader('Content-Type', 'text/event-stream');
  const event = value => response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
  event({ type: 'message_start', message: { id: `msg_${requests}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  const blocks = requests === 1 ? [1, 2].map(n => ({ type: 'tool_use', id: 'call_' + n, name: toolName, input: { n } })) : [{ type: 'text', text: 'next turn succeeds' }];
  for (const [index, block] of blocks.entries()) {
    event({ type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { ...block, text: '' } });
    event({ type: 'content_block_delta', index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    event({ type: 'content_block_stop', index });
  }
  event({ type: 'message_delta', delta: { stop_reason: requests === 1 ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  event({ type: 'message_stop' }); response.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
try {
  await mkdir(process.env.MOSS_CONFIG_DIR);
  const { ClaudeSession, loadClaudeSessionSnapshot } = await import('../electron-direct.mjs');
  session = new ClaudeSession({ cwd: root, projectDir: root, model: 'gpt-5.5', url: `http://127.0.0.1:${server.address().port}`, apiKey: 'mock-key',
    permissionMode: 'bypassPermissions', allowedTools: [toolName], mcpServers: {}, addDirs: [], thinkingConfig: { type: 'disabled' },
    appToolPolicy: { appIds: ['moss.self-test'], mcpServers: {} },
    appTools: [{ id: 'moss.self-test/self_test', appId: 'moss.self-test', name: toolName, title: 'result', description: 'Submit a result', effect: 'write', inputSchemaDocument: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } }],
    onAppEvent: async event => { executed.push(event.input.input.n); session.completeTurn(); return { ok: true, result: { recorded: event.input.input.n } }; },
    environment: { MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }), MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }) },
  });
  const firstUserId = randomUUID(), secondUserId = randomUUID();
  const drain = async userMessageId => { const messages = []; for await (const item of session.send('Submit both results.', undefined, { userMessageId })) messages.push(item); return messages; };
  const first = await drain(firstUserId);
  assert.equal(requests, 1, 'Completion must skip the follow-up model request');
  assert.deepEqual(executed.sort(), [1, 2], 'Completion must drain all tools in the model batch');
  assert(first.some(item => item.type === 'result' && !item.is_error));
  // Match desktop idle retirement: flush before loading, and supply the
  // transcript path for the explicitly configured non-default projectDir.
  await session.prepareForIdleDispose();
  const snapshot = await loadClaudeSessionSnapshot(session.sessionId, {
    cwdHint: root, sourceJsonlFile: path.join(root, `${session.sessionId}.jsonl`),
  });
  assert(snapshot, 'Finished turn must be resumable from disk');
  const transcript = snapshot.messages;
  assert(transcript.some(item => item.type === 'user' && item.uuid === firstUserId), 'The host user UUID must survive canonical transcript persistence');
  const receipts = transcript.flatMap(item => Array.isArray(item.message?.content) ? item.message.content : []).filter(item => item.type === 'tool_result');
  assert.deepEqual(receipts.map(item => item.tool_use_id).sort(), ['call_1', 'call_2']);
  assert(receipts.every(item => !item.is_error));
  const second = await drain(secondUserId); assert.equal(requests, 2); assert(second.some(item => item.type === 'result' && !item.is_error));
  await session.prepareForIdleDispose();
  const reloaded = await loadClaudeSessionSnapshot(session.sessionId, { cwdHint: root, sourceJsonlFile: path.join(root, `${session.sessionId}.jsonl`) });
  assert.deepEqual(reloaded.messages.filter(item => [firstUserId, secondUserId].includes(item.uuid)).map(item => item.uuid), [firstUserId, secondUserId], 'Repeated prompts must retain two distinct host UUIDs after reload');
  output('PASS: one request, two persisted receipts, normal completion, next send succeeds.\n');
} catch (error) { output(String(error.stack || error) + '\n'); process.exitCode = 1; }
finally { await session?.dispose(); server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }); }
