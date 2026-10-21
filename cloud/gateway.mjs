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
import { json, readJson } from './http.mjs';

import { adoptStandalone } from './adoption.mjs';
import { createIdentityProvider } from './identity.mjs';
import { Snapshots } from './snapshots.mjs';
import { normalizeSnapshotPolicy } from '../shared/webui-snapshot-policy.mjs';

const publicOperation = op => op ? Object.fromEntries(['id', 'environmentId', 'input', 'snapshotId', 'protectionId', 'status', 'phase', 'createdAt', 'updatedAt', 'transferredBytes', 'error', 'resumeError', 'cleanupError'].map(key => [key, op[key]])) : null;
const hash = value => createHash('sha256').update(String(value || '')).digest();
const sameIdentity = (identity, row) => identity.user?.id === row.userId && (identity.organization?.id || '') === row.orgId;
const publicAccount = identity => {
  const user = identity?.user;
  if (!user) return null;
  const userName = [user.name, user.username, user.email, user.id].find(value => typeof value === 'string' && value.trim())?.trim() || '';
  return { userName, userEmail: typeof user.email === 'string' ? user.email.trim() : '' };
};
const publicEnvironment = row => ({ id: row.id, userId: row.userId, orgId: row.orgId, containerId: row.containerId, state: row.state, desiredState: row.desiredState, version: row.version, generation: row.generation || 0, operation: row.operation, automationsPaused: row.automationsPaused, error: row.error, createdAt: row.createdAt });
const number = (value, fallback, min, max) => { const n = Number(value ?? fallback); if (!Number.isFinite(n) || n < min || n > max) throw new Error('Invalid cloud resource limit'); return n; };

export async function startGateway({ env = process.env, docker = new Docker(), rendererRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ui/dist/renderer') } = {}) {
  const stateRoot = env.MOSS_CLOUD_STATE || '/state';
  const origin = env.MOSS_WEB_ORIGIN;
  if (!origin || new URL(origin).origin !== origin) throw new Error('MOSS_WEB_ORIGIN must be an exact origin');
  const authBase = env.MOSS_WEB_AUTH_SERVER?.replace(/\/$/, '');
  if (!env.MOSS_WEB_IMAGE) throw new Error('MOSS_WEB_IMAGE is required');
  const store = new EnvironmentStore(stateRoot, { maxUsers: number(env.MOSS_CLOUD_MAX_USERS, 20, 1, 10000) });
  store.acquire();
  const installationPath = path.join(stateRoot, 'installation-id');
  let installation;
  try { installation = await fsp.readFile(installationPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; installation = randomUUID().replaceAll('-', ''); await fsp.writeFile(installationPath, installation, { flag: 'wx', mode: 0o600 }); }
  if (!/^[a-f0-9]{32}$/.test(installation)) throw new Error('Invalid installation identity');
  const identityProvider = await createIdentityProvider({ stateRoot, authBase, token: env.MOSS_WEB_TOKEN });
  const authRequest = (_base, endpoint, body, token) => identityProvider.request(endpoint, body, token);
  const computers = new Environments({ store, docker, installation, gatewayContainer: env.MOSS_CLOUD_GATEWAY_CONTAINER || env.HOSTNAME,
    image: env.MOSS_WEB_IMAGE, origin, previewDomain: env.MOSS_WEB_PREVIEW_DOMAIN, cpu: number(env.MOSS_CLOUD_CPUS, 1, 0.1, 256), memoryMb: number(env.MOSS_CLOUD_MEMORY_MB, 1024, 256, 1048576), pids: number(env.MOSS_CLOUD_PIDS, 512, 64, 65536), startupTimeoutMs: number(env.MOSS_CLOUD_STARTUP_TIMEOUT_SECONDS, 300, 30, 900) * 1000 });
  await computers.reconnectNetworks();
  let closing = false;
  const portRoutes = new Map();
  const previewSockets = new Set();
  const previewHeaders = req => {
    const headers = { ...req.headers }; delete headers.authorization;
    const cookie = headers.cookie?.split(';').filter(value => !/^\s*moss_(?:web|cloud)=/i.test(value)).join(';');
    if (cookie) headers.cookie = cookie; else delete headers.cookie;
    for (const key of Object.keys(headers)) if (key.startsWith('x-moss-') || key === 'proxy-authorization') delete headers[key];
    return headers;
  };
  const previewDomain = env.MOSS_WEB_PREVIEW_DOMAIN?.toLowerCase();
  const previewRoute = req => {
    if (!previewDomain) return null;
    const hostname = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (!hostname.endsWith('.' + previewDomain)) return null;
    const token = hostname.slice(0, -(previewDomain.length + 1)), entry = portRoutes.get(token);
    if (!/^[a-f0-9]{48}$/.test(token) || !entry || entry.expiresAt < Date.now()) throw new Error('端口预览已失效');
    const row = store.get(entry.environmentId); if (!row || row.operation || row.desiredState !== 'running') throw new Error('云电脑已停止');
    return { token, row, origin: `https://${hostname}` };
  };
  const resourceRoutes = new Map();
  const oauthCallbacks = new Map();
  const activeProxies = new Map();
  function fence(id) {
    for (const [key, session] of sessions) if (session.environmentId === id) { for (const socket of sockets.get(key) || []) socket.destroy(); session.hostCookie = null; }
    for (const proxy of activeProxies.get(id) || []) proxy.destroy();
    for (const routes of [portRoutes, resourceRoutes, oauthCallbacks]) for (const [key, value] of routes) if (value.environmentId === id) routes.delete(key);
    for (const socket of previewSockets) socket.destroy();
  }
  const snapshots = new Snapshots({ computers, root: env.MOSS_CLOUD_SNAPSHOTS || path.join(stateRoot, 'snapshots'), onFence: fence, getPolicy: async accessToken => {
    if (authBase) try {
      const response = await fetch(`${authBase}/api/v1/webui/snapshot-policy`, { headers: { Authorization: `Bearer ${accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(1500) });
      if (response.ok) { const value = await response.json(); return { policy: normalizeSnapshotPolicy(value), source: value && Object.keys(normalizeSnapshotPolicy()).some(key => Number.isSafeInteger(value[key]) && value[key] > 0) ? 'server' : 'default' }; }
    } catch {}
    return { policy: normalizeSnapshotPolicy(), source: 'default' };
  } });
  const sessions = new Map(); const sockets = new Map(); const loginAttempts = new Map();
  const getCookie = req => /(?:^|;\s*)moss_cloud=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
  function removeSession(id) { sessions.delete(id); for (const socket of sockets.get(id) || []) socket.destroy(); sockets.delete(id); }
  const cleanup = setInterval(() => {
    for (const [id, session] of sessions) if (session.expiresAt < Date.now()) removeSession(id);
    for (const [token, entry] of portRoutes) if (entry.expiresAt < Date.now()) portRoutes.delete(token);
    for (const [token, entry] of resourceRoutes) if (entry.expiresAt < Date.now()) resourceRoutes.delete(token);
    for (const [state, entry] of oauthCallbacks) if (entry.expiresAt < Date.now()) oauthCallbacks.delete(state);
    for (const [ip, attempts] of loginAttempts) if (attempts.until < Date.now()) loginAttempts.delete(ip);
  }, 10000); cleanup.unref();
  async function authenticated(req) {
    store.assertLease();
    const id = getCookie(req), session = sessions.get(id);
    if (!session || session.expiresAt < Date.now()) { if (id) removeSession(id); return null; }
    const row = store.get(session.environmentId);
    if (!row) { removeSession(id); return null; }
    if (session.checkedAt + 30000 < Date.now()) {
      try { const identity = await authRequest(authBase, '/api/v1/auth/me', null, session.accessToken); if (!sameIdentity(identity, row)) throw new Error('Identity changed'); session.account = publicAccount(identity); session.checkedAt = Date.now(); }
      catch (error) { if (error.status === 401 || error.status === 403) { removeSession(id); return null; } }
    }
    return { id, session, row };
  }
  async function grant(session, row) {
    if (row.generation) await computers.control(row, 'generation', { generation: row.generation });
    session.hostCookie = (await computers.control(row, 'login', { accessToken: session.accessToken })).cookie;
    session.hostGeneration = row.generation || 0;
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
      const preview = previewRoute(req);
      if (preview) {
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== preview.origin) return json(res, 403, { error: 'Invalid preview origin' });
        const target = new URL(`/_moss/port/${preview.token}${req.url}`, await computers.target(preview.row));
        const headers = previewHeaders(req);
        const upstream = http.request(target, { method: req.method, headers }, response => { res.writeHead(response.statusCode, response.headers); response.on('error', () => res.destroy()); response.pipe(res); });
        upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'Port unavailable' }); else res.destroy(); });
        upstream.setTimeout(60000, () => upstream.destroy()); req.on('aborted', () => upstream.destroy()); res.on('close', () => upstream.destroy()); req.pipe(upstream); return;
      }
      const url = new URL(req.url, origin);
      if (url.origin !== origin || url.pathname.startsWith('//')) return json(res, 400, { error: 'Invalid request URL' });
      if (url.pathname === '/healthz') return json(res, 200, { ok: true, mode: 'cloud' });
      if (url.pathname.startsWith('/_moss-auth/')) {
        const row = store.get(String(req.headers['x-moss-environment'] || ''));
        if (!row || !timingSafeEqual(hash(row.controlToken), hash(req.headers['x-moss-host-token']))) return json(res, 403, { error: 'Forbidden' });
        const endpoint = url.pathname.slice('/_moss-auth'.length);
        if (req.method === 'GET' && endpoint === '/web-config') return json(res, 200, { previewDomain: env.MOSS_WEB_PREVIEW_DOMAIN || null });
        if (req.method === 'POST' && endpoint === '/ports/register') {
          const { token, expiresAt } = await readJson(req);
          if (!previewDomain || !/^[a-f0-9]{48}$/.test(token) || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 25 * 3600_000 || portRoutes.has(token) || portRoutes.size >= 1000) return json(res, 400, { error: 'Invalid port preview' });
          portRoutes.set(token, { environmentId: row.id, expiresAt }); return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && endpoint === '/resources/register') {
          const { token, expiresAt } = await readJson(req);
          if (!/^[\w-]{43}$/.test(token) || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 25 * 3600_000 || resourceRoutes.has(token) || resourceRoutes.size >= 10000) return json(res, 400, { error: 'Invalid resource' });
          resourceRoutes.set(token, { environmentId: row.id, expiresAt });
          return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && endpoint === '/oauth/register') {
          const { state, expiresAt } = await readJson(req);
          if (typeof state !== 'string' || !/^[\w-]{16,256}$/.test(state) || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 11 * 60_000 || oauthCallbacks.has(state) || oauthCallbacks.size >= 1000) return json(res, 400, { error: 'Invalid transaction' });
          oauthCallbacks.set(state, { environmentId: row.id, expiresAt });
          return json(res, 200, { ok: true });
        }
        if (!(req.method === 'POST' && endpoint === '/api/v1/auth/login') && !(req.method === 'GET' && endpoint === '/api/v1/auth/me')) return json(res, 404, { error: 'Not found' });
        const result = await authRequest(authBase, endpoint, req.method === 'POST' ? await readJson(req) : null, req.headers.authorization?.replace(/^Bearer /, ''));
        return json(res, 200, result);
      }
      if (url.pathname.startsWith('/_moss/resource/')) {
        const token = /^\/_moss\/resource\/([\w-]{43})\//.exec(url.pathname)?.[1], entry = resourceRoutes.get(token);
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !entry || entry.expiresAt < Date.now()) return json(res, 404, { error: 'Resource expired' });
        const row = store.get(entry.environmentId);
        if (!row || row.operation || row.desiredState !== 'running') return json(res, 410, { error: 'Host stopped' });
        const headers = req.headers.range && ['GET', 'HEAD'].includes(req.method) ? { range: req.headers.range } : {};
        const upstream = http.request(new URL(url.pathname + url.search, await computers.target(row)), { method: req.method, headers }, response => {
          res.writeHead(response.statusCode, response.headers); response.on('error', () => res.destroy()); response.pipe(res);
        });
        upstream.setTimeout(30000, () => upstream.destroy()); upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'Resource unavailable' }); else res.destroy(); });
        res.on('close', () => upstream.destroy()); upstream.end(); return;
      }
      // OAuth returns from another site without the Strict login cookie. Only an
      // opaque, pre-registered one-time state may route this exact callback.
      if (url.pathname === '/api/oauth/callback') {
        const state = url.searchParams.get('state'), entry = oauthCallbacks.get(state);
        if (req.method !== 'GET' || url.search.length > 8192 || url.searchParams.getAll('state').length !== 1 || !entry || entry.expiresAt < Date.now()) return json(res, 400, { error: '授权回调已失效。' });
        const row = store.get(entry.environmentId);
        if (!row || row.operation || row.desiredState !== 'running') return json(res, 410, { error: '云电脑已停止。' });
        oauthCallbacks.delete(state);
        const response = await fetch(new URL(url.pathname + url.search, await computers.target(row)), { redirect: 'error', signal: AbortSignal.timeout(10_000) });
        res.writeHead(response.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
        res.end(await response.text()); return;
      }
      if (url.pathname.startsWith('/internal/') || url.pathname.startsWith('/_cloud/')) return json(res, 403, { error: 'Forbidden' });
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin) return json(res, 403, { error: '请求来源无效。' });
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress; let attempts = loginAttempts.get(ip);
        if (!attempts || attempts.until < Date.now()) { attempts = { count: 0, until: Date.now() + 60000 }; loginAttempts.set(ip, attempts); }
        if (++attempts.count > 100) return json(res, 429, { error: '登录尝试过多。' });
        const input = await readJson(req);
        const token = await authRequest(authBase, '/api/v1/auth/login', { username: input.username, password: input.password, token: input.token });
        if (!token.access_token) throw new Error('认证中心未返回凭据');
        const identity = await authRequest(authBase, '/api/v1/auth/me', null, token.access_token);
        let row = store.ensure(identity);
        // The recovery page must authenticate independently of a damaged Host.
        // Only first-time users need provisioning; existing environments stay put.
        if (input.management !== true || !row.containerId) {
          try { row = await computers.ensure(identity); } catch (error) { row = store.get(row.id); store.update(row.id, { state: row.operation ? row.state : 'error', error: error.message }); }
        }
        const id = randomBytes(32).toString('base64url');
        const session = { environmentId: row.id, accessToken: token.access_token, account: publicAccount(identity), checkedAt: Date.now(), expiresAt: Date.now() + Math.min(Number(token.expires_in) || 3600, 43200) * 1000 };
        if (input.management !== true && !row.operation && row.state === 'ready') await grant(session, row).catch(() => {});
        if (sessions.size >= 1000) removeSession(sessions.keys().next().value);
        sessions.set(id, session);
        res.setHeader('Set-Cookie', `moss_cloud=${id}; Path=/; HttpOnly; SameSite=Strict${origin.startsWith('https:') ? '; Secure' : ''}`);
        return json(res, 200, { ok: true, reload: true });
      }
      const auth = await authenticated(req);
      if (url.pathname === '/api/auth') {
        let hostUnavailable = false;
        if (url.searchParams.get('management') !== '1' && auth && !auth.row.operation && auth.row.desiredState === 'running') {
          try {
            const response = auth.session.hostCookie ? await fetch(`${await computers.target(auth.row)}/api/auth`, { headers: { cookie: auth.session.hostCookie }, signal: AbortSignal.timeout(3000) }) : null;
            if (!response || !(await response.json()).authenticated || auth.session.hostGeneration !== (auth.row.generation || 0)) await grant(auth.session, auth.row);
          }
          catch { hostUnavailable = true; }
        }
        return json(res, 200, { authenticated: !!auth, mode: identityProvider.mode, managed: true, hostUnavailable,
          account: auth?.session.account || null,
          environment: auth ? publicEnvironment(auth.row) : null });
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
      if (url.pathname.startsWith('/api/cloud/')) {
        const id = auth.row.id;
        if (req.method === 'GET' && url.pathname === '/api/cloud/environment') {
          const result = await snapshots.environment(id, auth.session.accessToken); result.operation = publicOperation(result.operation);
          return json(res, 200, result);
        }
        if (req.method === 'GET' && url.pathname === '/api/cloud/snapshots') return json(res, 200, snapshots.list(id));
        const operationMatch = /^\/api\/cloud\/operations\/([a-f0-9-]{36})$/.exec(url.pathname);
        if (operationMatch && req.method === 'GET') return json(res, 200, publicOperation(snapshots.store.operation(id, operationMatch[1])));
        if (req.headers['x-moss-generation'] !== String(auth.row.generation || 0)) return json(res, 409, { code: 'ENVIRONMENT_CHANGED', error: '环境已恢复，请刷新后继续' });
        if (url.pathname === '/api/cloud/snapshots/preflight' && req.method === 'POST') return json(res, 200, await snapshots.preflight(id, await readJson(req), auth.session.accessToken));
        if (url.pathname === '/api/cloud/operations/retry' && req.method === 'POST') return json(res, 200, publicOperation(await snapshots.retry(id)));
        if (url.pathname === '/api/cloud/automations/resume' && req.method === 'POST') {
          if (auth.row.operation) throw new Error('请先完成环境恢复');
          await computers.control(auth.row, 'resume-automations', {});
          store.update(id, { automationsPaused: false }); return json(res, 200, { ok: true });
        }
        const match = /^\/api\/cloud\/snapshots\/([a-f0-9-]{36})(\/restore)?$/.exec(url.pathname);
        if ((url.pathname === '/api/cloud/snapshots' && req.method === 'POST') || (match && (req.method === 'DELETE' && !match[2] || req.method === 'POST' && match[2]))) {
          const input = await readJson(req);
          const op = await snapshots.submit(id, { ...input, action: match ? match[2] ? 'restore' : 'delete' : 'create', snapshotId: match?.[1] }, auth.session.accessToken);
          return json(res, 202, publicOperation(op));
        }
        return json(res, 404, { error: 'Unknown management operation' });
      }
      if (url.pathname === '/' && (url.searchParams.get('window') === 'cloud-environment' || auth.row.operation || auth.row.state !== 'ready')) return await serveLoginAsset(req, res);
      if (url.pathname.startsWith('/assets/') && await fsp.stat(path.join(rendererRoot, url.pathname.slice(1))).then(info => info.isFile(), () => false)) return await serveLoginAsset(req, res);
      if (auth.row.operation || auth.row.desiredState !== 'running') return json(res, 503, { code: 'ENVIRONMENT_MAINTENANCE', error: '云电脑正在维护，请在环境快照页面查看进度' });
      if (!['GET', 'HEAD'].includes(req.method) && String(req.headers['x-moss-generation'] ?? '0') !== String(auth.row.generation || 0)) return json(res, 409, { code: 'ENVIRONMENT_CHANGED', error: '环境已恢复，请刷新页面；旧请求不会重放' });
      if (!auth.session.hostCookie) await grant(auth.session, auth.row);
      const target = new URL(await computers.target(auth.row)); target.pathname = url.pathname; target.search = url.search;
      const upstream = http.request(target, { method: req.method, headers: proxyHeaders(req, auth.session) }, response => {
        const headers = { ...response.headers }; delete headers['set-cookie']; delete headers['clear-site-data'];
        headers['cache-control'] = 'no-store';
        res.writeHead(response.statusCode, headers); response.on('error', () => res.destroy()); response.pipe(res);
        response.on('error', () => res.destroy());
      });
      if (!activeProxies.has(auth.row.id)) activeProxies.set(auth.row.id, new Set());
      activeProxies.get(auth.row.id).add(upstream); upstream.on('close', () => activeProxies.get(auth.row.id)?.delete(upstream));
      upstream.setTimeout(300000, () => upstream.destroy(new Error('Upstream timed out')));
      upstream.on('error', error => { if (!res.headersSent && req.method === 'GET' && url.pathname === '/') { res.writeHead(303, { Location: '/?window=cloud-environment' }); res.end(); } else if (!res.headersSent) json(res, 503, { error: error.message }); else res.destroy(); });
      res.on('close', () => upstream.destroy());
      upstream.setTimeout(3600000, () => upstream.destroy());
      req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
    } catch (error) { if (!res.headersSent) json(res, error.status || 503, { error: error.message }); else res.destroy(); }
  });
  server.on('upgrade', async (req, socket, head) => {
    try {
      const preview = previewRoute(req);
      if (preview) {
        if (closing || req.headers.origin !== preview.origin || !req.url.startsWith('/') || req.url.startsWith('//')) throw new Error('Forbidden');
        const headers = previewHeaders(req);
        const upstream = http.request(new URL(`/_moss/port/${preview.token}${req.url}`, await computers.target(preview.row)), { headers });
        upstream.on('upgrade', (response, peer, peerHead) => {
          upstream.setTimeout(0); peer.setTimeout(0);
          if (closing || socket.destroyed) { peer.destroy(); socket.destroy(); return; }
          previewSockets.add(socket);
          socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(value => `${key}: ${value}`)).join('\r\n')}\r\n\r\n`);
          if (peerHead.length) socket.write(peerHead); if (head.length) peer.write(head);
          const timer = setInterval(() => { if (closing || !portRoutes.has(preview.token) || store.get(preview.row.id)?.desiredState !== 'running') socket.destroy(); }, 30000);
          socket.on('close', () => { clearInterval(timer); previewSockets.delete(socket); peer.destroy(); }); peer.on('close', () => socket.destroy()); socket.on('error', () => peer.destroy()); peer.on('error', () => socket.destroy()); socket.pipe(peer).pipe(socket);
        });
        socket.on('close', () => upstream.destroy()); socket.on('error', () => upstream.destroy());
        upstream.on('response', response => { response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); }); upstream.on('error', () => socket.destroy()); upstream.setTimeout(10000, () => upstream.destroy()); upstream.end(); return;
      }
      if (closing || new URL(req.url, origin).pathname !== '/api/ws' || req.headers.origin !== origin) throw new Error('Forbidden');
      const auth = await authenticated(req); if (!auth) throw new Error('Not signed in');
      if (auth.row.operation || auth.row.desiredState !== 'running' || (new URL(req.url, origin).searchParams.get('generation') || '0') !== String(auth.row.generation || 0)) throw new Error('Environment changed or in maintenance');
      if (!auth.session.hostCookie) await grant(auth.session, auth.row);
      const upstream = http.request(new URL('/api/ws', await computers.target(auth.row)), { headers: proxyHeaders(req, auth.session) });
      upstream.on('upgrade', (response, peer, peerHead) => {
        upstream.setTimeout(0); peer.setTimeout(0);
        if (!sessions.has(auth.id) || closing || store.get(auth.row.id)?.operation || (store.get(auth.row.id)?.generation || 0) !== (auth.row.generation || 0)) { peer.destroy(); socket.destroy(); return; }
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
  await snapshots.recover();
  await snapshots.collectRetired();
  await snapshots.reapHelpers().catch(error => console.error('[snapshot helpers]', error.message));
  const garbageCollection = setInterval(() => { if (!closing) void snapshots.collectRetired().catch(error => console.error('[snapshot cleanup]', error.message)); }, 3600_000); garbageCollection.unref();
  const adminPath = path.join(stateRoot, 'admin.sock'); await fsp.rm(adminPath, { force: true });
  const admin = http.createServer(async (req, res) => {
    try {
      store.assertLease();
      if (closing) return json(res, 503, { error: 'Gateway is restarting' });
      if (req.method === 'GET' && req.url === '/environments') return json(res, 200, store.all().map(publicEnvironment));
      if (req.method !== 'POST') return json(res, 404, { error: 'Unknown command' });
      const { id, image } = await readJson(req);
      if (req.url === '/adopt') {
        if (identityProvider.mode !== 'token') throw new Error('接管命令只用于明确的本地单用户部署');
        return json(res, 200, publicEnvironment(await adoptStandalone(computers, id)));
      }
      if (req.url === '/stop') { const result = await computers.stop(id); for (const [key, session] of sessions) if (session.environmentId === id) removeSession(key); return json(res, 200, publicEnvironment(result)); }
      if (req.url === '/upgrade') return json(res, 200, publicEnvironment(await computers.upgrade(id, image)));
      return json(res, 404, { error: 'Unknown command' });
    } catch (error) { json(res, 409, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { admin.once('error', reject); admin.listen(adminPath, resolve); });
  await fsp.chmod(adminPath, 0o600);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(env.MOSS_WEB_PORT || 43128), env.MOSS_WEB_HOST || '0.0.0.0', resolve); });
  return { server, store, computers, snapshots, identityProvider, async close() { closing = true; clearInterval(cleanup); clearInterval(garbageCollection); for (const socket of previewSockets) socket.destroy(); for (const id of sessions.keys()) removeSession(id); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => admin.close(resolve)); await Promise.allSettled([...computers.locks.values()]); store.close(); } };
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gateway = await startGateway();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await gateway.close(); process.exit(0); });
  console.log('[moss-cloud] Gateway ready');
}
