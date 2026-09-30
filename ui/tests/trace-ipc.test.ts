import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as capture from '../../src/services/api/traceCapture';
import { toTraceMessages } from '../../src/services/api/traceMessages';
import { createTraceHandlers, registerTraceIpc } from '../src/trace-ipc.mjs';
import { requestRemoteTrace, setRemoteDirectFetchImplementation } from '../src/remote-direct-client.mjs';
import { buildTraceViewModel } from '../src/renderer-react/lib/trace/viewModel';

let scope: string;
const runtime = { ...capture, toTraceMessages };
beforeEach(async () => { scope = await mkdtemp(join(tmpdir(), 'moss-trace-ipc-')); });
afterEach(async () => {
  await capture.drainTraceCaptureForTests();
  capture.clearTraceCaptureStateForTests();
  setRemoteDirectFetchImplementation(undefined);
  await rm(scope, { recursive: true, force: true });
});

function fixture() {
  const record = { id: 'desktop-1', underlyingSessionId: 'engine-1', title: '库存核对', workspace: '/fixture/inventory', agentMode: 'local', updatedAt: 1,
    history: [{ type: 'user', uuid: 'user-1', prompt: '核对库存', timestamp: 1000 }] };
  const handlers = createTraceHandlers({ mossHome: scope, getRuntime: async () => runtime, getSessions: () => [record],
    getTranscriptPath: () => null, requestRemote: async (operation, payload) => ({ operation, payload }) });
  return { record, handlers };
}

async function seed() {
  await capture.withTraceScope(scope, () => capture.traceCaptureService.recordCall({
    id: 'call-1', sessionId: 'engine-1', source: 'anthropic', model: 'fixture-model', startedAt: '2026-09-29T00:00:00Z', completedAt: '2026-09-29T00:00:01Z',
    request: { body: { messages: [{ role: 'user', content: 'x'.repeat(5000) }] } },
    response: { status: 200, body: { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 3, output_tokens: 1 } } },
  }));
}

test('local IPC maps desktop/engine IDs, searches metadata before pagination and loads full calls on demand', async () => {
  await seed();
  const { handlers } = fixture();
  const list = await handlers.list({ query: '库存' });
  expect(list.total).toBe(1);
  expect(list.traces[0].session.id).toBe('desktop-1');
  expect((await handlers.list({ query: 'no-such-title' })).traces).toEqual([]);
  const snapshot = await handlers.get({ sessionId: 'desktop-1' });
  expect(snapshot.sessionId).toBe('engine-1');
  expect(snapshot.messages[0]).toMatchObject({ id: 'user-1', content: '核对库存' });
  expect(snapshot.calls[0].request.body.preview.length).toBeLessThanOrEqual(2048);
  const call = await handlers.call({ sessionId: 'desktop-1', callId: 'call-1' });
  expect(call.request.body.preview.length).toBeGreaterThan(2048);
  expect(call.request.semantic.request.messages).toHaveLength(1);
});

test('settings persist without touching runtime, and transcript-only changes invalidate revision', async () => {
  await seed();
  const { handlers, record } = fixture();
  expect((await handlers.settings()).enabled).toBe(true);
  await handlers['update-settings']({ enabled: false });
  expect((await handlers.settings()).enabled).toBe(false);
  const revision = await handlers.revision({ sessionId: 'engine-1' });
  expect((await handlers.revision({ sessionId: 'engine-1', sinceRevisionToken: revision.revisionToken })).changed).toBe(false);
  record.history.push({ type: 'user', uuid: 'user-2', prompt: '继续', timestamp: 2000 });
  expect((await handlers.revision({ sessionId: 'engine-1', sinceRevisionToken: revision.revisionToken })).changed).toBe(true);
  await handlers.delete({ sessionId: 'desktop-1' });
  expect((await handlers.list()).total).toBe(0);
  expect(record.history).toHaveLength(2);
});

test('IPC reconciles one desktop send into one turn while retaining background calls and repeated sends', async () => {
  const transcriptPath = join(scope, 'transcript.jsonl');
  const transcript = [
    { type: 'user', uuid: 'runtime-user', timestamp: '2026-09-29T09:12:09.167Z', message: { content: '你好啊' } },
    { type: 'assistant', uuid: 'answer', parentUuid: 'runtime-user', timestamp: '2026-09-29T09:12:12.772Z',
      message: { content: [{ type: 'text', text: '你好，我是小黑。' }] } },
  ];
  await writeFile(transcriptPath, transcript.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const record = {
    id: 'desktop-greeting', underlyingSessionId: 'engine-greeting', agentMode: 'local',
    history: [
      { type: 'user', uuid: 'desktop-user', prompt: '你好啊', timestamp: Date.parse('2026-09-29T09:12:08.970Z') },
      { type: 'assistant', uuid: 'answer', message: { content: [{ type: 'text', text: '你好，我是小黑。' }] } },
    ],
  };
  await capture.withTraceScope(scope, async () => {
    for (const [id, startedAt] of [
      ['sdk', '2026-09-29T09:12:09.225Z'],
      ['memory-1', '2026-09-29T09:12:12.919Z'],
      ['memory-2', '2026-09-29T09:12:20.807Z'],
    ]) {
      await capture.traceCaptureService.recordCall({
        id, sessionId: 'engine-greeting', source: 'anthropic', model: 'fixture-model',
        startedAt, completedAt: new Date(Date.parse(startedAt) + 1000).toISOString(),
        request: { body: { messages: [{ role: 'user', content: '你好啊' }] } },
        response: { status: 200, body: { content: [{ type: 'text', text: '你好' }] } },
      });
    }
  });
  const handlers = createTraceHandlers({ mossHome: scope, getRuntime: async () => runtime, getSessions: () => [record],
    getTranscriptPath: () => transcriptPath, requestRemote: async () => { throw new Error('unexpected remote request'); } });
  const snapshot = await handlers.get({ sessionId: record.id });
  const model = buildTraceViewModel(snapshot, snapshot.messages);
  expect(snapshot.messages.map(message => message.id)).toEqual(['runtime-user', 'answer']);
  expect(model.turns).toHaveLength(1);
  expect(model.spans.filter(span => span.message?.type === 'user')).toHaveLength(1);
  expect(model.turns[0].userSpanId).toBe('message:runtime-user');
  expect(model.spansById.get('message:answer')?.parentId).toBe(model.turns[0].id);
  expect(model.spans.filter(span => span.kind === 'llm')).toHaveLength(3);
  expect(model.spans.filter(span => span.kind === 'llm').every(span => span.parentId === model.turns[0].id)).toBe(true);

  record.history.push({ type: 'user', uuid: 'pending-user', prompt: '你好啊', timestamp: Date.parse('2026-09-29T09:12:30Z') });
  const pending = await handlers.get({ sessionId: record.id });
  const pendingModel = buildTraceViewModel(pending, pending.messages);
  expect(pendingModel.turns).toHaveLength(2);
  expect(pendingModel.turns.map(turn => turn.userSpanId)).toEqual(['message:runtime-user', 'message:pending-user']);

  transcript.push({ type: 'user', uuid: 'runtime-user-2', timestamp: '2026-09-29T09:12:30.200Z', message: { content: '你好啊' } });
  await writeFile(transcriptPath, transcript.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  record.history.push({ type: 'assistant', uuid: 'live-answer-2', message: { content: [{ type: 'text', text: '又见面了。' }] } });
  const continued = await handlers.get({ sessionId: record.id });
  const continuedModel = buildTraceViewModel(continued, continued.messages);
  expect(continuedModel.turns).toHaveLength(2);
  expect(continuedModel.turns.map(turn => turn.userSpanId)).toEqual(['message:runtime-user', 'message:runtime-user-2']);
  expect(continuedModel.spansById.get('message:live-answer-2')?.parentId).toBe(continuedModel.turns[1].id);
});

test('IPC validates caller, target and IDs before accessing private trace storage', async () => {
  const registered = new Map<string, Function>();
  const window = { isDestroyed: () => false, webContents: { mainFrame: {} } };
  registerTraceIpc({ ipcMain: { handle: (key, fn) => registered.set(key, fn) }, getWindow: () => window,
    mossHome: scope, getRuntime: async () => runtime, getSessions: () => [], getTranscriptPath: () => null, requestRemote: async () => ({}) });
  expect(() => registered.get('trace:settings')!({ sender: {}, senderFrame: {} })).toThrow('来源无效');
  const validEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  expect(() => registered.get('trace:get')!(validEvent, { sessionId: '../secrets' })).toThrow('会话 ID');
  expect(() => registered.get('trace:settings')!(validEvent, { target: 'invalid' })).toThrow('数据来源');
  expect((await registered.get('trace:settings')!(validEvent)).enabled).toBe(true);
});

test('remote requests preserve endpoint, cursor and credentials without falling back to local storage', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  setRemoteDirectFetchImplementation(async (url, init) => { requests.push({ url, init }); return Response.json({ enabled: false }); });
  const connection = { serverUrl: 'https://fixture.invalid', authToken: 'test-secret' };
  await requestRemoteTrace({ ...connection, operation: 'revision', payload: { sessionId: 'remote-1', sinceRevisionToken: 'epoch:42' } });
  const url = new URL(requests[0].url);
  expect(url.pathname).toBe('/api/v1/sessions/remote-1/trace/revision');
  expect(url.searchParams.get('sinceRevisionToken')).toBe('epoch:42');
  expect(new Headers(requests[0].init.headers).get('authorization')).toBe('Bearer test-secret');
  await requestRemoteTrace({ ...connection, operation: 'update-settings', payload: { enabled: false } });
  expect(requests[1].init.method).toBe('PUT');
  expect(JSON.parse(requests[1].init.body as string)).toEqual({ enabled: false });
  const remoteCall = { id: 'call-remote', sessionId: 'remote-1', request: { body: { preview: 'remote request' } } };
  setRemoteDirectFetchImplementation(async () => Response.json({ call: remoteCall }));
  expect(await requestRemoteTrace({ ...connection, operation: 'call', payload: { sessionId: 'remote-1', callId: 'call-remote' } })).toEqual(remoteCall);
  const { handlers } = fixture();
  expect(await handlers.get({ target: 'remote', sessionId: 'remote-1' })).toMatchObject({ operation: 'get' });
  setRemoteDirectFetchImplementation(async () => new Response('Not found', { status: 404 }));
  await expect(requestRemoteTrace({ ...connection, operation: 'settings' })).rejects.toThrow('服务器尚不支持 Trace');
});
