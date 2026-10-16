import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startGateway } from '../gateway.mjs';
const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
const respond = (res, data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
test('gateway authenticates routing, strips client credentials, closes WS on logout, persists mapping', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-gateway-'));
  await fs.mkdir(path.join(dir, 'renderer')); await fs.writeFile(path.join(dir, 'renderer/index.html'), '<h1>Login</h1>');
  const identity = user => ({ user: { id: user }, organization: { id: 'org' } });
  const auth = http.createServer(async (req, res) => {
    if (req.url.endsWith('/login')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      if (input.password !== 'test' || !['alice','bob'].includes(input.username)) { res.writeHead(401); res.end('{}'); return; }
      respond(res, { access_token: input.username, expires_in: 3600 });
    } else respond(res, identity(req.headers.authorization?.replace('Bearer ', '')));
  });
  const upstreamSockets = new Set();
  const host = http.createServer((req, res) => {
    if (req.url === '/api/auth') return respond(res, { authenticated: true });
    if (req.url === '/api/logout') return respond(res, { ok: true });
    res.setHeader('Set-Cookie', 'must-not-leak=1'); respond(res, { cookie: req.headers.cookie, control: req.headers['x-moss-control'] || null, authorization: req.headers.authorization || null });
  });
  host.on('upgrade', (req, socket) => { upstreamSockets.add(socket); socket.on('error', () => {}); socket.on('close', () => upstreamSockets.delete(socket)); socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'); });
  const authBase = await listen(auth), hostBase = await listen(host);
  const env = { MOSS_CLOUD_STATE: dir, MOSS_WEB_ORIGIN: 'https://portal.example', MOSS_WEB_AUTH_SERVER: authBase, MOSS_WEB_IMAGE: 'test', MOSS_WEB_HOST: '127.0.0.1', MOSS_WEB_PORT: '0' };
  let gateway = await startGateway({ env, docker: {}, rendererRoot: path.join(dir, 'renderer') });
  const adapters = () => {
    gateway.computers.ensure = async id => { const row = gateway.store.ensure(id); return gateway.store.update(row.id, { containerId: row.id, state: 'ready' }); };
    gateway.computers.target = async () => hostBase;
    gateway.computers.control = async row => ({ cookie: `moss_web=${row.userId}` });
  }; adapters();
  t.after(async () => { for (const s of upstreamSockets) s.destroy(); await gateway.close(); await Promise.all([new Promise(r => host.close(r)), new Promise(r => auth.close(r))]); await fs.rm(dir, { recursive: true, force: true }); });
  const base = () => `http://127.0.0.1:${gateway.server.address().port}`;
  const post = (route, body, cookie) => fetch(base() + route, { method: 'POST', headers: { Origin: env.MOSS_WEB_ORIGIN, Cookie: cookie || '' }, body: JSON.stringify(body) });
  assert.match(await (await fetch(base())).text(), /Login/);
  assert.equal((await fetch(base() + '/api/private')).status, 401);
  assert.equal((await fetch(base() + '/internal/status')).status, 403);
  assert.equal((await fetch(base() + '/_moss-auth/api/v1/auth/me')).status, 403);
  assert.equal((await fetch(base() + '/api/login', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await post('/api/login', { username: 'alice', password: 'bad' })).status, 401);
  const loginA = await post('/api/login', { username: 'alice', password: 'test' });
  assert.equal(loginA.status, 200); assert.match(loginA.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Secure/);
  const ca = loginA.headers.get('set-cookie').split(';')[0];
  const loginB = await post('/api/login', { username: 'bob', password: 'test' }); const cb = loginB.headers.get('set-cookie').split(';')[0];
  assert.equal(gateway.store.all().length, 2);
  const response = await fetch(base() + '/api/private?environmentId=bob', { headers: { Cookie: ca, 'X-Moss-Control': 'spoof', Authorization: 'Bearer spoof' } });
  assert.deepEqual(await response.json(), { cookie: 'moss_web=alice', control: null, authorization: null });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await (await fetch(base() + '/api/private', { headers: { Cookie: cb } })).json()).cookie, 'moss_web=bob');
  const socket = await new Promise((resolve, reject) => {
    const req = http.request(base() + '/api/ws', { headers: { Cookie: ca, Origin: env.MOSS_WEB_ORIGIN, Connection: 'Upgrade', Upgrade: 'websocket' } });
    req.on('upgrade', (_res, socket) => resolve(socket)); req.on('error', reject); req.end();
  });
  socket.on('error', () => {}); socket.resume();
  const closed = new Promise(resolve => socket.once('close', resolve));
  assert.equal((await post('/api/logout', {}, ca)).status, 200); await closed;
  assert.equal((await fetch(base() + '/api/private', { headers: { Cookie: ca } })).status, 401);
  assert.equal(gateway.store.all().length, 2);
  const ids = gateway.store.all().map(r => r.containerId);
  await gateway.close();
  gateway = await startGateway({ env, docker: {}, rendererRoot: path.join(dir, 'renderer') }); adapters();
  assert.deepEqual(gateway.store.all().map(r => r.containerId), ids);
  assert.equal((await fetch(base() + '/api/auth', { headers: { Cookie: cb } })).status, 200);
  assert.equal((await (await fetch(base() + '/api/auth', { headers: { Cookie: cb } })).json()).authenticated, false);
});

test('gateway executable starts through the versioned image symlink', async t => {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-gateway-launch-'));
  const launcher = path.join(dir, 'gateway.mjs');
  await fs.symlink(fileURLToPath(new URL('../gateway.mjs', import.meta.url)), launcher);
  const child = spawn(process.execPath, [launcher], { env: { ...process.env, MOSS_CLOUD_STATE: path.join(dir, 'state'), MOSS_WEB_ORIGIN: 'http://localhost', MOSS_WEB_AUTH_SERVER: 'http://localhost', MOSS_WEB_IMAGE: 'unused-test-image', MOSS_WEB_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { child.kill(); await fs.rm(dir, { recursive: true, force: true }); });
  let errors = ''; child.stderr.on('data', data => errors += data);
  const exited = new Promise(resolve => child.once('exit', resolve));
  await new Promise((resolve, reject) => {
    child.stdout.on('data', data => { if (String(data).includes('Gateway ready')) resolve(); });
    child.once('error', reject); child.once('exit', code => reject(new Error(`Exited before listening: ${code}: ${errors}`)));
  });
  child.kill('SIGTERM'); assert.equal(await exited, 0);
});
