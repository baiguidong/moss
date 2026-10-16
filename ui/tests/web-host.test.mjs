import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { startWebServer } from '../src/web/server.mjs';
import { createRequestRegistry } from '../src/host/request-registry.mjs';
import { createOperationStore } from '../src/web/operation-store.mjs';
import { createWebAuth } from '../src/web/auth.mjs';
import { createMossClient } from '../src/client/moss-client.mjs';
import { createElectronTransport } from '../src/client/electron-transport.mjs';
import { stringifyWire, parseWire } from '../src/client/wire.mjs';

const token = 'test-only-access-key-with-enough-entropy';
function request(method, ...args) { return { type: 'request', id: randomUUID(), createdAt: Date.now(), method, args }; }
function mailbox(ws) {
  const queued = [];
  const waits = [];
  ws.on('message', data => {
    const message = parseWire(String(data));
    const index = waits.findIndex(entry => entry.match(message));
    if (index >= 0) waits.splice(index, 1)[0].resolve(message);
    else queued.push(message);
  });
  return (match = () => true) => {
    const index = queued.findIndex(match);
    if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket response')), 5000);
      waits.push({ match, resolve: value => { clearTimeout(timer); resolve(value); } });
    });
  };
}

test('authenticated Host: shared handlers, reconnect without duplicate execution, files and logout', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-web-test-'));
  const renderer = path.join(home, 'renderer'); await fs.mkdir(renderer); await fs.writeFile(path.join(renderer, 'index.html'), '<h1>Moss</h1>');
  const registry = createRequestRegistry();
  let executions = 0; let finish;
  registry.handle('agent:send', async context => {
    assert.equal(context.transport, 'web'); assert.equal(context.sender, undefined);
    executions++; await new Promise(resolve => { finish = resolve; }); return { done: true };
  });
  registry.handle('agent:get-status', () => ({ local: true }));
  const server = await startWebServer({ registry, home, rendererRoot: renderer, env: { MOSS_WEB_TOKEN: token, MOSS_WEB_PORT: '0' } });
  const origin = `http://127.0.0.1:${server.address.port}`;
  const sockets = [];
  t.after(async () => { finish?.(); sockets.forEach(ws => ws.terminate()); await server.close(); await fs.rm(home, { recursive: true, force: true }); });
  assert.equal((await fetch(`${origin}/api/files?path=/etc/passwd`)).status, 401);
  assert.equal((await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: JSON.stringify({ token }) })).status, 403);
  const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin }, body: JSON.stringify({ token }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  async function connect() {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/ws', { headers: { Cookie: cookie, Origin: origin } }); sockets.push(ws);
    const next = mailbox(ws);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(stringifyWire({ type: 'hello', version: 1 })); await next(message => message.type === 'ready');
    return { ws, next };
  }
  const first = await connect();
  const send = request('agent:send', { sessionId: 'one', prompt: 'hello' });
  first.ws.send(stringifyWire(send));
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
  first.ws.terminate();
  const second = await connect(); second.ws.send(stringifyWire(send));
  finish();
  assert.equal((await second.next(message => message.id === send.id)).value.done, true);
  assert.equal(executions, 1);
  second.ws.send(stringifyWire({ ...send, args: [{ prompt: 'different' }] }));
  assert.equal((await second.next(message => message.id === send.id)).ok, false);
  const blocked = request('update:install', {}); second.ws.send(stringifyWire(blocked));
  assert.equal((await second.next(message => message.id === blocked.id)).ok, false);
  registry.publish('agent:state', { busy: false });
  assert.equal((await second.next(message => message.type === 'event')).payload.busy, false);
  const upload = await fetch(`${origin}/api/upload?name=note.html`, { method: 'POST', headers: { Origin: origin, Cookie: cookie }, body: '<script>bad()</script>' });
  const file = await upload.json(); assert.equal(upload.status, 200);
  const download = await fetch(`${origin}/api/files?path=${encodeURIComponent(file.path)}`, { headers: { Cookie: cookie, Range: 'bytes=0-6' } });
  assert.equal(download.status, 206); assert.equal(await download.text(), '<script');
  assert.match(download.headers.get('content-disposition'), /^attachment/);
  assert.match(download.headers.get('content-security-policy'), /sandbox/);
  await fetch(`${origin}/api/logout`, { method: 'POST', headers: { Cookie: cookie, Origin: origin } });
  assert.equal((await fetch(`${origin}/api/files?path=${encodeURIComponent(file.path)}`, { headers: { Cookie: cookie } })).status, 401);
});

test('operation results persist across Host restart and cannot change payload', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-web-ops-')); t.after(() => fs.rm(home, { recursive: true, force: true }));
  const file = path.join(home, 'ops.sqlite'); const principal = { userId: 'one' }; const req = request('agent:create-session', {});
  let store = createOperationStore(file); let count = 0;
  assert.deepEqual(await store.run(req, principal, () => ++count), { ok: true, value: 1 }); await store.close();
  store = createOperationStore(file);
  assert.deepEqual(await store.run(req, principal, () => ++count), { ok: true, value: 1 });
  assert.equal(count, 1); await store.close();
});

test('Moss Server authentication only accepts the configured owner', async () => {
  const routes = [];
  const auth = createWebAuth({ home: '/unused', env: { MOSS_WEB_AUTH_SERVER: 'https://auth.example', MOSS_WEB_OWNER_ID: 'owner' }, fetchImpl: async url => {
    routes.push(url);
    return Response.json(url.endsWith('/login') ? { access_token: 'token', expires_in: 100 } : { user: { id: 'another-user' } });
  } });
  await assert.rejects(auth.login({ username: 'another-user', password: 'secret' }), /不属于/);
  assert.deepEqual(routes, ['https://auth.example/api/v1/auth/login', 'https://auth.example/api/v1/auth/me']);
});

test('shared client preserves Electron subscriptions and binary document values', async () => {
  const listeners = new Map(); const calls = [];
  const client = createMossClient(createElectronTransport({
    invoke: async (...args) => { calls.push(args); return { ok: true }; },
    on: (method, fn) => listeners.set(method, fn), removeListener: method => listeners.delete(method),
  }));
  await client.createSession({ title: 'hello' }); assert.equal(calls[0][0], 'agent:create-session');
  let value; const off = client.onState(payload => { value = payload; });
  listeners.get('agent:state')({ sender: 'electron-only' }, { busy: true }); assert.deepEqual(value, { busy: true });
  off(); assert.equal(listeners.size, 0);
  const data = new Uint8Array([1, 255, 3]).buffer;
  assert.deepEqual(new Uint8Array(parseWire(stringifyWire({ data })).data), new Uint8Array(data));
});
