import http from 'node:http';
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
import { createWebLifecycle } from './lifecycle.mjs';

// These operations require an Electron window or an app's restricted sender.
// Browser equivalents are installed explicitly, never by spoofing that sender.
const desktopMethods = new Set([
  'agent:pick-directory', 'agent:pick-files', 'agent:remote-authenticate', 'agent:remote-authenticate-cancel',
  'app:launch', 'app:embedded-open', 'app:embedded-attach', 'app:embedded-close', 'app:install-archive',
  'app:open-resource', 'app:import-legacy-buddy', 'app-market:install', 'public-skillhub:open-import-dialog',
  'shell.open-file', 'shell.open-external', 'shell.show-item-in-folder', 'workspace:open',
  'preview.open', 'preview.sync', 'preview.ready', 'preview.close', 'log:download',
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

export async function startWebServer({ registry, home, rendererRoot, env = process.env, overrides = new Map(), snapshot = async () => ({}), getBlockers = () => [] }) {
  const auth = createWebAuth({ home, env });
  const operations = createOperationStore(path.join(home, 'web', 'requests.sqlite'));
  const epoch = randomUUID();
  let sequence = 0;
  let eventBytes = 0;
  const history = [];
  const connections = new Set();
  const activeOperations = new Set();
  let activeRequests = 0;
  const lifecycle = createWebLifecycle({ secret: env.MOSS_WEB_CONTROL_TOKEN, getBlockers, activeCount: () => activeRequests });
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
      const url = new URL(req.url, 'http://local');
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true, protocol: MOSS_PROTOCOL_VERSION, version: lifecycle.version });
      if (url.pathname.startsWith('/internal/')) {
        if (!lifecycle.authorized(req)) return json(res, 403, { error: 'Forbidden' });
        if (req.method === 'GET' && url.pathname === '/internal/status') return json(res, 200, lifecycle.status());
        if (req.method === 'POST' && url.pathname === '/internal/drain') return json(res, 200, lifecycle.drain());
        if (req.method === 'POST' && url.pathname === '/internal/resume') { lifecycle.resume(); return json(res, 200, { ok: true }); }
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
      if (req.method === 'GET' && url.pathname === '/api/auth') return json(res, 200, { authenticated: Boolean(principal), mode: auth.mode, protocol: MOSS_PROTOCOL_VERSION });
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        auth.logout(req);
        for (const ws of connections) if (ws.principal?.loginId === principal?.loginId) ws.close(4401, 'Signed out');
        res.setHeader('Set-Cookie', 'moss_web=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
        return json(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!principal) return json(res, 401, { error: '请先登录。' });
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
      if (req.url !== '/api/ws' || !sameOrigin(req)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
      const principal = await auth.authenticate(req);
      if (!principal || connections.size >= 32) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
      wss.handleUpgrade(req, socket, head, ws => {
        ws.principal = principal; connections.add(ws);
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
              send(ws, { type: 'hello', version: MOSS_PROTOCOL_VERSION, epoch, sequence, replay });
              if (replay) for (const entry of history) if (entry.event.sequence > request.sequence) send(ws, entry.event);
              send(ws, { type: 'ready', snapshot: await snapshot() });
              return;
            }
            if (!ws.initialized || request.type !== 'request' || typeof request.method !== 'string' || !Array.isArray(request.args) || request.args.length > 4) throw new Error('请求格式无效。');
            const { method, args } = request;
            if (!allowed.has(method) && !overrides.has(method)) throw new Error('这项功能需要桌面客户端，当前 Web Host 尚未提供。');
            const context = Object.freeze({ transport: 'web', principal, requestId: request.id });
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
                return await (overrides.has(method) ? overrides.get(method)(context, ...args) : registry.invoke(method, context, ...args));
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
        ws.once('close', () => clearInterval(check));
      });
    } catch { socket.destroy(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(env.MOSS_WEB_PORT || 43128), env.MOSS_WEB_HOST || '127.0.0.1', resolve); });
  return {
    address: server.address(), auth, assertWorkAllowed: () => lifecycle.assertWorkAllowed(),
    async close() {
      unsubscribe();
      for (const ws of connections) ws.terminate();
      await new Promise(resolve => server.close(resolve));
      wss.close();
      await operations.close();
    },
  };
}
