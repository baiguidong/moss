import http from 'node:http';
import { runWithHostRequestContext } from '../host/request-registry.mjs';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { WebSocketServer } from 'ws';
import { MOSS_METHODS, MOSS_PROTOCOL_VERSION } from '../client/methods.mjs';
import { stringifyWire, parseWire } from '../client/wire.mjs';
import { createWebAuth } from './auth.mjs';
import { createOperationStore } from './operation-store.mjs';
import { createRestoreState } from './restore-state.mjs';
import { createWebLifecycle } from './lifecycle.mjs';
import { createWebResources, resourcePrefix } from './resources.mjs';
import { createWebPortPreviews } from './ports.mjs';
import { createWebPreviews } from './previews.mjs';
import { createFileBrowser } from './file-browser.mjs';
import { createHostCapabilities } from '../shared/host-capabilities.mjs';

// These operations require an Electron window or an app's restricted sender.
// Browser equivalents are installed explicitly, never by spoofing that sender.
const desktopMethods = new Set([
  'agent:pick-directory', 'agent:pick-files',
  'app:launch', 'app:embedded-open', 'app:embedded-attach', 'app:embedded-close',
  'app:open-resource', 'app:import-legacy-buddy', 'public-skillhub:open-import-dialog',
  'shell.open-file', 'shell.open-external', 'shell.show-item-in-folder', 'workspace:open',
  'preview.open', 'preview.sync', 'preview.ready', 'preview.close',
  'presentation:popout',
]);
const allowed = new Set(MOSS_METHODS.filter(method => !desktopMethods.has(method) && !method.startsWith('update:') && !method.startsWith('browser:') && !method.startsWith('computer-use:')));
const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.txt': 'text/plain', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(stringifyWire(value)); };
async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error('请求过大。');
  }
  return JSON.parse(body || '{}');
}

export async function startWebServer({ registry, home, rendererRoot, env = process.env, overrides = new Map(), snapshot = async () => ({}), oauth, apps, onDisconnect, resources: providedResources, resolvePreviewResource, getBlockers = () => [], restoreState, onDrain, onResume }) {
  restoreState ||= createRestoreState(env);
  const auth = createWebAuth({ home, env });
  await fsp.mkdir(path.join(home, 'web'), { recursive: true, mode: 0o700 });
  const identityPath = path.join(home, 'web', 'host-id');
  try { await fsp.writeFile(identityPath, randomUUID(), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const hostId = (await fsp.readFile(identityPath, 'utf8')).trim();
  const identity = principal => principal ? { hostId: env.MOSS_ENVIRONMENT_ID || hostId, userId: principal.userId, ...(env.MOSS_ENVIRONMENT_ID ? { generation: restoreState.get().generation ?? Number(env.MOSS_ENVIRONMENT_GENERATION || 0) } : {}) } : null;
  let portEnv = env;
  if (!env.MOSS_WEB_PREVIEW_DOMAIN && env.MOSS_ENVIRONMENT_ID) {
    try {
      const response = await fetch(`${env.MOSS_WEB_AUTH_SERVER}/web-config`, { headers: { 'X-Moss-Environment': env.MOSS_ENVIRONMENT_ID, 'X-Moss-Host-Token': env.MOSS_WEB_CONTROL_TOKEN }, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (response.ok) portEnv = { ...env, MOSS_WEB_PREVIEW_DOMAIN: (await response.json()).previewDomain };
    } catch {} // Older gateways keep the capability unavailable.
  }
  const ports = createWebPortPreviews({ env: portEnv });
  for (const [method, handler] of ports.handlers) overrides.set(method, handler);
  const capabilities = createHostCapabilities({ mode: 'web', confirmations: registry.has('host:confirmations-list'),
    remoteOAuth: Boolean(oauth?.enabled), previewWindows: true, embeddedApps: Boolean(apps), portPreview: ports.enabled, appInstallation: registry.has('host:confirmations-list') && registry.has('app:install-archive') });
  const resources = providedResources || createWebResources({ env });
  const previews = createWebPreviews({ registry, resources, resolveResource: resolvePreviewResource });
  for (const [method, handler] of previews.handlers) overrides.set(method, handler);
  const fileBrowser = createFileBrowser();
  const operations = createOperationStore(path.join(home, 'web', 'requests.sqlite'));
  const epoch = randomUUID();
  let sequence = 0;
  let eventBytes = 0;
  const history = [];
  const connections = new Set();
  const activeOperations = new Set();
  let activeRequests = 0;
  const lifecycle = createWebLifecycle({ restoreState, onDrain, onResume, secret: env.MOSS_WEB_CONTROL_TOKEN, getBlockers, activeCount: () => activeRequests });
  const loginAttempts = new Map();
  const originFor = req => env.MOSS_WEB_ORIGIN || `http://${req.headers.host}`;
  const sameOrigin = req => req.headers.origin === originFor(req);
  const send = (ws, value) => {
    if (ws.readyState !== 1) return;
    if (ws.bufferedAmount > 16 * 1024 * 1024) { ws.close(1013, 'Client too slow'); return; }
    ws.send(stringifyWire(value));
  };
  const unsubscribe = registry.subscribe((method, payload) => {
    const event = { type: 'event', epoch, sequence: ++sequence, method, payload };
    const size = stringifyWire(event).length;
    history.push({ event, size }); eventBytes += size;
    while (history.length > 2000 || eventBytes > 16 * 1024 * 1024) eventBytes -= history.shift().size;
    for (const ws of connections) if (ws.initialized) send(ws, event);
  });
  async function serveFile(req, res, filename, userFile = false) {
    const stat = await fsp.stat(filename);
    if (!stat.isFile()) return json(res, 404, { error: '找不到文件。' });
    const ext = path.extname(filename).toLowerCase();
    const headers = { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': userFile ? 'no-store' : 'no-cache', 'Accept-Ranges': 'bytes' };
    if (userFile) {
      headers['Content-Security-Policy'] = "sandbox; default-src 'none'";
      const inline = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mp3'].includes(ext);
      headers['Content-Disposition'] = `${inline && !new URL(req.url, 'http://local').searchParams.has('download') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(filename))}`;
    }
    let start = 0; let end = stat.size - 1; let status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
      if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = Math.max(0, end - start + 1);
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || !stat.size) { res.end(); return; }
    await pipeline(fs.createReadStream(filename, { start, end }), res);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    let counted = false;
    try {
      const url = new URL(ports.route(req), 'http://local');
      if (url.pathname.startsWith('/_moss/port/')) return ports.serve(req, res, url);
      if (url.pathname.startsWith(resourcePrefix)) return await resources.serve(req, res, url);
      if (req.method === 'GET' && url.pathname === '/api/oauth/callback') {
        let ok = true;
        try { lifecycle.assertWorkAllowed(); if (!oauth) throw new Error('unavailable'); oauth.accept(url); } catch { ok = false; }
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
        res.end(`<meta charset="utf-8"><title>Moss 授权</title><h1>${ok ? '授权结果已接收' : '授权回调已失效'}</h1><p>请返回 Moss 查看登录结果，可以关闭此页面。</p>`); return;
      }
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true, protocol: MOSS_PROTOCOL_VERSION, version: lifecycle.version });
      if (url.pathname.startsWith('/internal/')) {
        if (!lifecycle.authorized(req)) return json(res, 403, { error: 'Forbidden' });
        if (req.method === 'GET' && url.pathname === '/internal/status') return json(res, 200, lifecycle.status());
        if (req.method === 'POST' && url.pathname === '/internal/drain') return json(res, 200, await lifecycle.drain(await readJson(req)));
        if (req.method === 'POST' && url.pathname === '/internal/resume') { await lifecycle.resume(await readJson(req)); return json(res, 200, { ok: true }); }
        if (req.method === 'POST' && url.pathname === '/internal/resume-automations') { await lifecycle.resumeAutomations(); return json(res, 200, { ok: true }); }
        if (req.method === 'POST' && url.pathname === '/internal/generation') { const { generation } = await readJson(req); if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid generation'); restoreState.update({ generation }); return json(res, 200, { ok: true }); }
        if (req.method === 'POST' && url.pathname === '/internal/login') {
          const id = await auth.login(await readJson(req), { trustedToken: true });
          return json(res, 200, { cookie: `moss_web=${id}` });
        }
        return json(res, 404, { error: 'Unknown control request' });
      }
      if (req.method === 'POST') {
        lifecycle.assertWorkAllowed();
        activeRequests++; counted = true;
      }
      if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: '请求来源无效。' });
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const key = req.socket.remoteAddress;
        const now = Date.now();
        for (const [ip, entry] of loginAttempts) if (entry.until < now) loginAttempts.delete(ip);
        const attempt = loginAttempts.get(key) || { count: 0, until: now + 60_000 };
        loginAttempts.set(key, attempt);
        if (++attempt.count > 20) return json(res, 429, { error: '登录尝试过多，请稍后重试。' });
        try {
          const id = await auth.login(await readJson(req));
          const secure = originFor(req).startsWith('https:') ? '; Secure' : '';
          res.setHeader('Set-Cookie', `moss_web=${id}; Path=/; HttpOnly; SameSite=Strict${secure}`);
          return json(res, 200, { ok: true });
        } catch (error) { return json(res, 401, { error: error.message }); }
      }
      const principal = await auth.authenticate(req);
      if (req.method === 'GET' && url.pathname === '/api/auth') return json(res, 200, { authenticated: Boolean(principal), mode: auth.mode, protocol: MOSS_PROTOCOL_VERSION, identity: identity(principal), account: principal?.account || null });
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        auth.logout(req); if (principal) { resources.revokeOwner(principal.userId); ports.revokeOwner(principal.userId); }
        for (const ws of connections) if (ws.principal?.loginId === principal?.loginId) ws.close(4401, 'Signed out');
        res.setHeader('Set-Cookie', 'moss_web=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
        return json(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!principal) return json(res, 401, { error: '请先登录。' });
        if (req.method === 'GET' && url.pathname === '/api/file-browser') {
          return json(res, 200, await fileBrowser.list({
            directory: url.searchParams.get('path') || undefined,
            reveal: url.searchParams.get('reveal') || undefined,
            kind: url.searchParams.get('kind') || 'file',
            hidden: url.searchParams.get('hidden') === 'true',
            query: url.searchParams.get('query') || '',
            offset: url.searchParams.get('offset') || 0,
            extensions: url.searchParams.getAll('extension'),
          }));
        }
        if (req.method === 'POST' && url.pathname === '/api/file-browser/selection') {
          return json(res, 200, await fileBrowser.select(await readJson(req)));
        }
        if (req.method === 'POST' && url.pathname === '/api/upload') {
          lifecycle.assertWorkAllowed();
          const dir = path.join(home, 'web', 'uploads', randomUUID());
          await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
          const name = path.basename((url.searchParams.get('name') || 'attachment').replaceAll('\\', '/')).replace(/[\x00-\x1f]/g, '_');
          const filename = path.join(dir, name === '.' || name === '..' ? 'attachment' : name);
          let bytes = 0;
          const limit = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > 100 * 1024 * 1024 ? new Error('文件不能超过 100 MB。') : null, chunk); } });
          try { await pipeline(req, limit, fs.createWriteStream(filename, { flags: 'wx', mode: 0o600 })); }
          catch (error) { await fsp.rm(dir, { recursive: true, force: true }); throw error; }
          return json(res, 200, { path: filename, name, size: bytes });
        }
        if (['GET', 'HEAD'].includes(req.method) && url.pathname === '/api/files') {
          const filename = url.searchParams.get('path');
          if (!filename || !path.isAbsolute(filename)) return json(res, 400, { error: '文件路径无效。' });
          return await serveFile(req, res, filename, true);
        }
        return json(res, 404, { error: 'Unknown API' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const filename = path.resolve(rendererRoot, relative);
      if (!filename.startsWith(path.resolve(rendererRoot) + path.sep)) return json(res, 403, { error: 'Invalid path' });
      return await serveFile(req, res, filename);
    } catch (error) {
      if (!res.headersSent) json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.message });
      else res.destroy();
    } finally { if (counted) activeRequests--; }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  server.on('upgrade', async (req, socket, head) => {
    try {
      req.url = ports.route(req);
      if (req.url.startsWith('/_moss/port/')) { ports.upgrade(req, socket, head, new URL(req.url, 'http://local')); return; }
      if (req.url !== '/api/ws' || !sameOrigin(req)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
      const principal = await auth.authenticate(req);
      if (!principal || connections.size >= 32) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
      wss.handleUpgrade(req, socket, head, ws => {
        ws.principal = principal; ws.connectionId = randomUUID(); connections.add(ws);
        ws.alive = true;
        ws.on('pong', () => { ws.alive = true; });
        ws.on('error', () => {});
        ws.on('close', () => connections.delete(ws));
        ws.on('message', async data => {
          let request;
          try {
            if (!await auth.authenticate(req)) { ws.close(4401, 'Authentication expired'); return; }
            request = parseWire(String(data));
            if (request.type === 'hello') {
              if (request.version !== MOSS_PROTOCOL_VERSION) { ws.close(4406, 'Protocol version mismatch'); return; }
              const replay = request.epoch === epoch && Number.isInteger(request.sequence) && request.sequence <= sequence && request.sequence >= (history[0]?.event.sequence || sequence) - 1;
              // Enable live events before yielding for the snapshot. The browser
              // buffers them until it has applied the snapshot/replay boundary.
              ws.initialized = true;
              ws.viewId = typeof request.viewId === 'string' && /^[\w-]{1,100}$/.test(request.viewId) ? request.viewId : ws.connectionId;
              send(ws, { type: 'hello', version: MOSS_PROTOCOL_VERSION, epoch, sequence, replay });
              if (replay) for (const entry of history) if (entry.event.sequence > request.sequence) send(ws, entry.event);
              send(ws, { type: 'ready', snapshot: { ...await snapshot(), capabilities, identity: identity(principal), viewId: ws.viewId } });
              return;
            }
            if (!ws.initialized || request.type !== 'request' || typeof request.method !== 'string' || !Array.isArray(request.args) || request.args.length > 4) throw new Error('请求格式无效。');
            const { method, args } = request;
            if (!allowed.has(method) && !overrides.has(method)) throw new Error('这项功能需要桌面客户端，当前 Web Host 尚未提供。');
            if (method === 'agent:remote-authenticate' && !capabilities.features.remoteOAuth) throw new Error('此 Host 尚未配置公开 HTTPS 登录回调。');
            if (['app:install-archive', 'app-market:install'].includes(method) && !capabilities.features.appInstallation) throw new Error('此 Host 尚未提供 Web 安装确认。');
            const context = Object.freeze({ transport: 'web', principal, requestId: request.id, connectionId: ws.connectionId, viewId: ws.viewId });
            lifecycle.assertWorkAllowed();
            activeRequests++;
            let result;
            try { result = await operations.run(request, principal, async () => {
              const key = ['agent:send', 'agent:approve-plan'].includes(method)
                ? `turn:${args[0]?.sessionId}`
                : ['agent:answer-question', 'agent:reject-question'].includes(method) ? `decision:${args[0]?.requestId}` : null;
              if (key && activeOperations.has(key)) throw new Error('这个会话或确认正在处理，请等待当前操作完成。');
              if (key) activeOperations.add(key);
              try {
                if (method === 'host:capabilities') return capabilities;
                return await (overrides.has(method) ? runWithHostRequestContext(context, () => overrides.get(method)(context, ...args)) : registry.invoke(method, context, ...args));
              } finally { if (key) activeOperations.delete(key); }
            });
            } finally { activeRequests--; }
            send(ws, { type: 'result', id: request.id, ...result });
          } catch (error) { send(ws, { type: 'result', id: request?.id, ok: false, error: error.message }); }
        });
        const check = setInterval(async () => {
          if (!await auth.authenticate(req)) ws.close(4401, 'Authentication expired');
          else if (!ws.alive) ws.terminate();
          else { ws.alive = false; ws.ping(); }
        }, 30_000);
        ws.once('close', () => {
          clearInterval(check); apps?.disconnect(ws.connectionId); onDisconnect?.(ws.connectionId);
          if (registry.has?.('preview-document:disconnect')) void registry.invoke('preview-document:disconnect', { transport: 'web', principal, connectionId: ws.connectionId }).catch(() => {});
        });
      });
    } catch { socket.destroy(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(env.MOSS_WEB_PORT || 43128), env.MOSS_WEB_HOST || '127.0.0.1', resolve); });
  return {
    address: server.address(), auth, assertWorkAllowed: () => lifecycle.assertWorkAllowed(),
    async close() {
      unsubscribe(); ports.close(); previews.close(); resources.close();
      for (const ws of connections) ws.terminate();
      await new Promise(resolve => server.close(resolve));
      wss.close();
      await operations.close();
    },
  };
}
