// Real bundled runtime and local HTTP model fixture: no paid provider requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const root = await mkdtemp(path.join(tmpdir(), 'moss-interactions-runtime-'));
process.env.MOSS_HOME = root; process.env.MOSS_CONFIG_DIR = path.join(root, 'profile');
globalThis.MACRO = { VERSION: 'test', BUILD_TIME: '', PACKAGE_URL: 'moss', FEEDBACK_CHANNEL: '', ISSUES_EXPLAINER: '', VERSION_CHANGELOG: '' };
const output = process.stdout.write.bind(process.stdout);
const requests = [], sessions = [], executions = [];
const toolName = 'app__moss_self_test__self_test';
let releaseTool, toolStarted;
const toolGate = new Promise(resolve => { releaseTool = resolve; });
const started = new Promise(resolve => { toolStarted = resolve; });
let aCalls = 0;
let holdSideStarted, releaseSide;
const sideStarted = new Promise(resolve => { holdSideStarted = resolve; });
const sideGate = new Promise(resolve => { releaseSide = resolve; });
const server = createServer(async (request, response) => {
  if (request.method === 'GET') { response.end(JSON.stringify({ data: [{ id: 'gpt-5.5', context_window: 200000 }] })); return; }
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks)); requests.push(body);
  const text = JSON.stringify(body.messages);
  const side = text.includes('This is a side question from the user');
  if (side && text.includes('HOLD_SIDE')) { holdSideStarted(); await sideGate; }
  const b = text.includes('SESSION_B_ONLY');
  if (!side && !b) aCalls++;
  const blocks = side ? [{ type: 'text', text: 'The tool is still pending.' }] : b ? [{ type: 'text', text: 'B finished.' }]
    : aCalls === 1 ? [1, 2].map(n => ({ type: 'tool_use', id: 'call_' + n, name: toolName, input: { n } }))
    : [{ type: 'text', text: 'A finished with the supplemental requirement.' }];
  response.setHeader('Content-Type', 'text/event-stream');
  const event = value => response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
  event({ type: 'message_start', message: { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  for (const [index, block] of blocks.entries()) {
    event({ type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { ...block, text: '' } });
    event({ type: 'content_block_delta', index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    event({ type: 'content_block_stop', index });
  }
  event({ type: 'message_delta', delta: { stop_reason: blocks[0].type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  event({ type: 'message_stop' }); response.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const timeout = setTimeout(() => { output('runtime test timed out\n'); process.exit(1); }, 45000);
try {
  await mkdir(process.env.MOSS_CONFIG_DIR);
  const { ClaudeSession, loadClaudeSessionSnapshot, resumeClaudeSession } = await import('../electron-direct.mjs');
  async function createSession(name) {
    const cwd = path.join(root, name); await mkdir(cwd);
    const session = new ClaudeSession({ cwd, projectDir: cwd, model: 'gpt-5.5', url: `http://127.0.0.1:${server.address().port}`, apiKey: 'fixture-key',
      permissionMode: 'bypassPermissions', allowedTools: [toolName], mcpServers: {}, addDirs: [], thinkingConfig: { type: 'disabled' },
      appToolPolicy: { appIds: ['moss.self-test'], mcpServers: {} },
      appTools: [{ id: 'moss.self-test/self_test', appId: 'moss.self-test', name: toolName, title: 'fixture tool', description: 'Test a tool boundary', effect: 'write', inputSchemaDocument: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } }],
      onAppEvent: async event => { const n = event.input.input.n; executions.push(n); if (n === 1) { toolStarted(); await toolGate; } return { ok: true, result: { actualResult: n } }; },
      environment: { MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }), MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }) },
    }); sessions.push(session); return session;
  }
  const a = await createSession('a'), b = await createSession('b');
  const drain = async (session, prompt, id) => { const result = []; for await (const message of session.send(prompt, undefined, { userMessageId: id })) result.push(message); return result; };
  const mainId = randomUUID(), inputId = randomUUID(), states = [];
  let finished = false;
  const main = drain(a, 'SESSION_A_ONLY: invoke both fixture tools.', mainId).then(result => { finished = true; return result; });
  await started;
  const { createSupplementPreparation } = await import('../src/session-supplement.mjs');
  const attachment = path.join(root, 'a', 'input.txt'); await writeFile(attachment, 'real attachment fixture');
  const prepare = createSupplementPreparation({ localizeFiles: async (_record, paths) => paths, resolveResource: async () => {}, isResourceUri: () => false, getAgentCatalog: async () => ({ agents: [] }) });
  const prepared = await prepare({ workspace: path.join(root, 'a') }, { prompt: 'SUPPLEMENT_A: use Chinese in the final answer.', details: { intent: 'chat', files: [{ name: 'input.txt', path: attachment }], skills: [{ name: 'review' }] } });
  assert.equal(a.steer(prepared, inputId, state => states.push(state)), true);
  const side = await a.askSideQuestion('Has the tool completed?');
  assert.equal(side.status, 'completed'); assert.equal(finished, false);
  const sideRequest = requests.find(body => JSON.stringify(body.messages).includes('This is a side question from the user'));
  assert.equal(sideRequest.tools?.length || 0, 0);
  assert(!sideRequest.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).some(block => ['tool_use', 'tool_result'].includes(block.type)));
  assert(JSON.stringify(sideRequest.messages).includes('outcome are unknown'));
  const cancellation = new AbortController(); cancellation.abort(new Error('cancel side only'));
  await assert.rejects(a.askSideQuestion('cancel this', cancellation.signal));
  await drain(b, 'SESSION_B_ONLY', randomUUID());
  assert(!JSON.stringify(requests.find(body => JSON.stringify(body.messages).includes('SESSION_B_ONLY'))).includes('SUPPLEMENT_A'));
  releaseTool(); const messages = await main;
  assert.deepEqual(executions, [1, 2]); assert.deepEqual(states, ['consumed']);
  const injected = messages.findIndex(message => message.type === 'user' && message.uuid === inputId);
  assert(injected >= 0);
  const receiptIds = messages.slice(0, injected).flatMap(message => message.message?.content || []).filter(block => block.type === 'tool_result').map(block => block.tool_use_id);
  assert.deepEqual(receiptIds.sort(), ['call_1', 'call_2']);
  const followup = requests.find(body => JSON.stringify(body.messages).includes('SUPPLEMENT_A'));
  assert(followup); assert(JSON.stringify(followup).includes(attachment)); assert(JSON.stringify(followup).includes('review')); assert(!JSON.stringify(followup).includes('The tool is still pending.'));
  assert.equal(a.steer('late', randomUUID(), () => {}), false);
  const heldSide = a.askSideQuestion('HOLD_SIDE'); await sideStarted;
  assert.equal(a.getIdleRetirementBlocker(), 'request-running', 'Active side question must retain its runtime');
  a.abort(); releaseSide();
  assert.equal((await heldSide).status, 'completed', 'Stopping the main engine must not abort a side question');
  await a.prepareForIdleDispose();
  const snapshot = await loadClaudeSessionSnapshot(a.sessionId, { cwdHint: path.join(root, 'a'), sourceJsonlFile: path.join(root, 'a', `${a.sessionId}.jsonl`) });
  assert.equal(snapshot.messages.filter(message => message.uuid === inputId).length, 1);
  assert(!JSON.stringify(snapshot.messages).includes('The tool is still pending.'));
  await a.dispose();
  const resumed = await resumeClaudeSession(a.sessionId, {
    cwd: path.join(root, 'a'), projectDir: path.join(root, 'a'), sourceJsonlFile: path.join(root, 'a', `${a.sessionId}.jsonl`),
    model: 'gpt-5.5', url: `http://127.0.0.1:${server.address().port}`, apiKey: 'fixture-key',
    permissionMode: 'bypassPermissions', allowedTools: [toolName], mcpServers: {}, addDirs: [], thinkingConfig: { type: 'disabled' },
    appToolPolicy: { appIds: ['moss.self-test'], mcpServers: {} },
    appTools: [{ id: 'moss.self-test/self_test', appId: 'moss.self-test', name: toolName, title: 'fixture tool', description: 'Test a tool boundary', effect: 'write', inputSchemaDocument: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } }],
    onAppEvent: async () => ({ ok: true, result: { actualResult: 1 } }),
    environment: { MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }), MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }) },
  });
  assert(resumed?.session);
  const resumedSide = await resumed.session.askSideQuestion('What was the last request?');
  assert.equal(resumedSide.status, 'completed');
  await resumed.session.dispose();
  output('PASS: side answer during held tool; no side tools; independent cancellation; two sessions isolated; two receipts before one supplement; next model request sees prepared file and skill supplement; canonical transcript preserves it once; side question restores after runtime disposal.\n');
} catch (error) { output(String(error.stack || error) + '\n'); process.exitCode = 1; }
finally { clearTimeout(timeout); releaseTool(); releaseSide(); for (const session of sessions) await session.dispose(); server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }); }
