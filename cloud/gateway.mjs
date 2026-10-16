import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Docker } from './docker.mjs';
import { EnvironmentStore } from './store.mjs';
import { Environments } from './environments.mjs';
import { authRequest, json, readJson } from './http.mjs';

const hash = value => createHash('sha256').update(String(value || '')).digest();
const sameIdentity = (identity, row) => identity.user?.id === row.userId && (identity.organization?.id || '') === row.orgId;
const publicEnvironment = row => ({ id: row.id, userId: row.userId, orgId: row.orgId, containerId: row.containerId, state: row.state, desiredState: row.desiredState, version: row.version, error: row.error, createdAt: row.createdAt });
const number = (value, fallback, min, max) => { const n = Number(value ?? fallback); if (!Number.isFinite(n) || n < min || n > max) throw new Error('Invalid cloud resource limit'); return n; };

export async function startGateway({ env = process.env, docker = new Docker(), rendererRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ui/dist/renderer') } = {}) {
  const stateRoot = env.MOSS_CLOUD_STATE || '/state';
  const origin = env.MOSS_WEB_ORIGIN;
  if (!origin || new URL(origin).origin !== origin) throw new Error('MOSS_WEB_ORIGIN must be an exact origin');
  const authBase = env.MOSS_WEB_AUTH_SERVER?.replace(/\/$/, '');
  if (!authBase || !env.MOSS_WEB_IMAGE) throw new Error('MOSS_WEB_AUTH_SERVER and MOSS_WEB_IMAGE are required');
  const store = new EnvironmentStore(stateRoot, { maxUsers: number(env.MOSS_CLOUD_MAX_USERS, 20, 1, 10000) });
  store.acquire();
  const installationPath = path.join(stateRoot, 'installation-id');
  let installation;
  try { installation = await fsp.readFile(installationPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; installation = randomUUID().replaceAll('-', ''); await fsp.writeFile(installationPath, installation, { flag: 'wx', mode: 0o600 }); }
  if (!/^[a-f0-9]{32}$/.test(installation)) throw new Error('Invalid installation identity');
  const computers = new Environments({ store, docker, installation, gatewayContainer: env.MOSS_CLOUD_GATEWAY_CONTAINER || env.HOSTNAME,
    image: env.MOSS_WEB_IMAGE, origin, cpu: number(env.MOSS_CLOUD_CPUS, 1, 0.1, 256), memoryMb: number(env.MOSS_CLOUD_MEMORY_MB, 1024, 256, 1048576), pids: number(env.MOSS_CLOUD_PIDS, 512, 64, 65536) });
  await computers.reconnectNetworks();
  let closing = false;
  const sessions = new Map(); const sockets = new Map(); const loginAttempts = new Map();
  const getCookie = req => /(?:^|;\s*)moss_cloud=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
  function removeSession(id) { sessions.delete(id); for (const socket of sockets.get(id) || []) socket.destroy(); sockets.delete(id); }
  const cleanup = setInterval(() => {
    for (const [id, session] of sessions) if (session.expiresAt < Date.now()) removeSession(id);
    for (const [ip, attempts] of loginAttempts) if (attempts.until < Date.now()) loginAttempts.delete(ip);
  }, 10000); cleanup.unref();
  async function authenticated(req) {
    store.assertLease();
    const id = getCookie(req), session = sessions.get(id);
    if (!session || session.expiresAt < Date.now()) { if (id) removeSession(id); return null; }
    const row = store.get(session.environmentId);
    if (row?.desiredState !== 'running') { removeSession(id); return null; }
    if (session.checkedAt + 30000 < Date.now()) {
      try { const identity = await authRequest(authBase, '/api/v1/auth/me', null, session.accessToken); if (!sameIdentity(identity, row)) throw new Error('Identity changed'); session.checkedAt = Date.now(); }
      catch { removeSession(id); return null; }
    }
    return { id, session, row };
  }
  async function grant(session, row) {
    session.hostCookie = (await computers.control(row, 'login', { accessToken: session.accessToken })).cookie;
  }
  function proxyHeaders(req, session) {
    const headers = { ...req.headers, cookie: session.hostCookie, host: 'moss-host' };
    // Do not allow Connection tokens to strip credentials or smuggle control headers.
    const upgraded = req.headers.upgrade?.toLowerCase() === 'websocket';
    for (const key of String(headers.connection || '').toLowerCase().split(',').map(s => s.trim())) {
      if (key && key !== 'upgrade') delete headers[key];
    }
    delete headers['transfer-encoding']; delete headers['proxy-connection'];
    headers.connection = upgraded ? 'Upgrade' : 'close';
    headers.cookie = session.hostCookie;
    for (const key of Object.keys(headers)) if (key.startsWith('x-moss-') || key === 'authorization' || key === 'proxy-authorization') delete headers[key];
    return headers;
  }
  async function serveLoginAsset(req, res) {
    const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
    const filename = path.resolve(rendererRoot, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!filename.startsWith(path.resolve(rendererRoot) + path.sep)) return json(res, 403, { error: 'Forbidden' });
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    try { if (!(await fsp.stat(filename)).isFile()) throw new Error('Not a file'); }
    catch { return json(res, 404, { error: 'Not found' }); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    await pipeline(fs.createReadStream(filename), res);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      store.assertLease();
      if (closing) return json(res, 503, { error: 'Gateway is restarting' });
      if (!req.url.startsWith('/') || req.url.startsWith('//')) return json(res, 400, { error: 'Invalid request URL' });
      const url = new URL(req.url, origin);
      if (url.origin !== origin || url.pathname.startsWith('//')) return json(res, 400, { error: 'Invalid request URL' });
      if (url.pathname === '/healthz') return json(res, 200, { ok: true, mode: 'cloud' });
      if (url.pathname.startsWith('/_moss-auth/')) {
        const row = store.get(String(req.headers['x-moss-environment'] || ''));
        if (!row || !timingSafeEqual(hash(row.controlToken), hash(req.headers['x-moss-host-token']))) return json(res, 403, { error: 'Forbidden' });
        const endpoint = url.pathname.slice('/_moss-auth'.length);
        if (!(req.method === 'POST' && endpoint === '/api/v1/auth/login') && !(req.method === 'GET' && endpoint === '/api/v1/auth/me')) return json(res, 404, { error: 'Not found' });
        const result = await authRequest(authBase, endpoint, req.method === 'POST' ? await readJson(req) : null, req.headers.authorization?.replace(/^Bearer /, ''));
        return json(res, 200, result);
      }
      if (url.pathname.startsWith('/internal/') || url.pathname.startsWith('/_cloud/')) return json(res, 403, { error: 'Forbidden' });
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin) return json(res, 403, { error: '请求来源无效。' });
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress; let attempts = loginAttempts.get(ip);
        if (!attempts || attempts.until < Date.now()) { attempts = { count: 0, until: Date.now() + 60000 }; loginAttempts.set(ip, attempts); }
        if (++attempts.count > 100) return json(res, 429, { error: '登录尝试过多。' });
        const input = await readJson(req);
        const token = await authRequest(authBase, '/api/v1/auth/login', { username: input.username, password: input.password });
        if (!token.access_token) throw new Error('认证中心未返回凭据');
        const identity = await authRequest(authBase, '/api/v1/auth/me', null, token.access_token);
        const row = await computers.ensure(identity);
        const id = randomBytes(32).toString('base64url');
        const session = { environmentId: row.id, accessToken: token.access_token, checkedAt: Date.now(), expiresAt: Date.now() + Math.min(Number(token.expires_in) || 3600, 43200) * 1000 };
        await grant(session, row);
        if (sessions.size >= 1000) removeSession(sessions.keys().next().value);
        sessions.set(id, session);
        res.setHeader('Set-Cookie', `moss_cloud=${id}; Path=/; HttpOnly; SameSite=Strict${origin.startsWith('https:') ? '; Secure' : ''}`);
        return json(res, 200, { ok: true, reload: true });
      }
      const auth = await authenticated(req);
      if (url.pathname === '/api/auth') {
        if (auth) {
          const response = await fetch(`${await computers.target(auth.row)}/api/auth`, { headers: { cookie: auth.session.hostCookie }, signal: AbortSignal.timeout(5000) });
          if (!(await response.json()).authenticated) await grant(auth.session, auth.row);
        }
        return json(res, 200, { authenticated: !!auth, mode: 'server', environment: auth ? publicEnvironment(auth.row) : null });
      }
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        if (auth) {
          await fetch(`${await computers.target(auth.row)}/api/logout`, { method: 'POST', headers: { cookie: auth.session.hostCookie, origin }, signal: AbortSignal.timeout(5000) }).catch(() => {});
          removeSession(auth.id);
        }
        res.setHeader('Clear-Site-Data', '"cache", "storage"');
        res.setHeader('Set-Cookie', `moss_cloud=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${origin.startsWith('https:') ? '; Secure' : ''}`);
        return json(res, 200, { ok: true });
      }
      if (!auth) {
        if (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method)) return json(res, 401, { error: '请先登录。' });
        return await serveLoginAsset(req, res);
      }
      const target = new URL(await computers.target(auth.row)); target.pathname = url.pathname; target.search = url.search;
      const upstream = http.request(target, { method: req.method, headers: proxyHeaders(req, auth.session) }, response => {
        const headers = { ...response.headers }; delete headers['set-cookie']; delete headers['clear-site-data'];
        headers['cache-control'] = 'no-store';
        res.writeHead(response.statusCode, headers); response.on('error', () => res.destroy()); response.pipe(res);
        response.on('error', () => res.destroy());
      });
      upstream.setTimeout(300000, () => upstream.destroy(new Error('Upstream timed out')));
      upstream.on('error', error => { if (!res.headersSent) json(res, 503, { error: error.message }); else res.destroy(); });
      res.on('close', () => upstream.destroy());
      upstream.setTimeout(3600000, () => upstream.destroy());
      req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
    } catch (error) { if (!res.headersSent) json(res, error.status || 503, { error: error.message }); else res.destroy(); }
  });
  server.on('upgrade', async (req, socket, head) => {
    try {
      if (closing || req.url !== '/api/ws' || req.headers.origin !== origin) throw new Error('Forbidden');
      const auth = await authenticated(req); if (!auth) throw new Error('Not signed in');
      const upstream = http.request(new URL(req.url, await computers.target(auth.row)), { headers: proxyHeaders(req, auth.session) });
      upstream.on('upgrade', (response, peer, peerHead) => {
        upstream.setTimeout(0); peer.setTimeout(0);
        if (!sessions.has(auth.id) || closing) { peer.destroy(); socket.destroy(); return; }
        const headers = Object.entries(response.headers).filter(([key]) => key !== 'set-cookie').map(([key, value]) => `${key}: ${value}`).join('\r\n');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n\r\n`);
        if (peerHead.length) socket.write(peerHead); if (head.length) peer.write(head);
        if (!sockets.has(auth.id)) sockets.set(auth.id, new Set()); sockets.get(auth.id).add(socket);
        const check = setInterval(() => { void authenticated(req).then(active => { if (!active) socket.destroy(); }).catch(() => socket.destroy()); }, 30000);
        socket.on('close', () => { clearInterval(check); sockets.get(auth.id)?.delete(socket); peer.destroy(); });
        peer.on('close', () => socket.destroy()); socket.on('error', () => peer.destroy()); peer.on('error', () => socket.destroy());
        socket.pipe(peer).pipe(socket);
      });
      upstream.on('response', response => { response.resume(); socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); });
      upstream.setTimeout(10000, () => upstream.destroy());
      socket.on('error', () => upstream.destroy());
      upstream.on('error', () => socket.destroy()); upstream.end();
    } catch { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); }
  });
  const adminPath = path.join(stateRoot, 'admin.sock'); await fsp.rm(adminPath, { force: true });
  const admin = http.createServer(async (req, res) => {
    try {
      store.assertLease();
      if (closing) return json(res, 503, { error: 'Gateway is restarting' });
      if (req.method === 'GET' && req.url === '/environments') return json(res, 200, store.all().map(publicEnvironment));
      if (req.method !== 'POST') return json(res, 404, { error: 'Unknown command' });
      const { id, image } = await readJson(req);
      if (req.url === '/stop') { const result = await computers.stop(id); for (const [key, session] of sessions) if (session.environmentId === id) removeSession(key); return json(res, 200, publicEnvironment(result)); }
      if (req.url === '/upgrade') return json(res, 200, publicEnvironment(await computers.upgrade(id, image)));
      return json(res, 404, { error: 'Unknown command' });
    } catch (error) { json(res, 409, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { admin.once('error', reject); admin.listen(adminPath, resolve); });
  await fsp.chmod(adminPath, 0o600);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(env.MOSS_WEB_PORT || 43128), env.MOSS_WEB_HOST || '0.0.0.0', resolve); });
  return { server, store, computers, async close() { closing = true; clearInterval(cleanup); for (const id of sessions.keys()) removeSession(id); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => admin.close(resolve)); await Promise.allSettled([...computers.locks.values()]); store.close(); } };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gateway = await startGateway();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await gateway.close(); process.exit(0); });
  console.log('[moss-cloud] Gateway ready');
}
