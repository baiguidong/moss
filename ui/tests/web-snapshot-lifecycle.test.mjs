import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebLifecycle } from '../src/web/lifecycle.mjs';
import { createWebTransport } from '../src/client/web-transport.mjs';

test('operation-bound maintenance cannot expire or be resumed by a different operation', async () => {
  let value = { maintenance: null, automationsPaused: true }, now = 0, resumes = 0;
  const restoreState = { get: () => value, update: patch => value = { ...value, ...patch } };
  const lifecycle = createWebLifecycle({ restoreState, now: () => now, onResume: async () => resumes++ });
  const id = 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12);
  await lifecycle.drain({ operationId: id }); now += 24 * 3600_000;
  assert.equal(lifecycle.status().maintenance, true);
  await assert.rejects(lifecycle.resume({}), /不匹配/); assert.throws(() => lifecycle.assertWorkAllowed(), /维护/);
  await lifecycle.resume({ operationId: id }); assert.equal(resumes, 0); assert.equal(lifecycle.status().automationsPaused, true);
  await lifecycle.resumeAutomations(); assert.equal(resumes, 1); assert.equal(lifecycle.status().automationsPaused, false);
});
test('a restored generation rejects pending requests without replay or draft-clearing logout', async () => {
  let ws; const statuses = [], sent = [];
  class Socket {
    constructor() { ws = this; this.listeners = {}; }
    addEventListener(event, fn) { this.listeners[event] = fn; }
    send(value) { sent.push(JSON.parse(value)); }
    close() {}
  }
  const transport = createWebTransport({ url: 'ws://test', generation: 0, WebSocketImpl: Socket, onStatus: status => statuses.push(status) });
  const pending = transport.invoke('agent:send', { text: 'old request' });
  ws.listeners.message({ data: JSON.stringify({ type: 'ready', snapshot: { identity: { generation: 1 } } }) });
  await assert.rejects(pending, /恢复/);
  assert.ok(statuses.includes('environment-changed')); assert.ok(!statuses.includes('unauthenticated'));
  assert.equal(sent.filter(message => message.type === 'request').length, 0); transport.close();
});
