import http from 'node:http';
import { randomBytes } from 'node:crypto';

export function createWebPortPreviews({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const entries = new Map(), peers = new Set();
  const domain = env.MOSS_WEB_PREVIEW_DOMAIN?.toLowerCase();
  const enabled = Boolean(domain && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain) && env.MOSS_WEB_ORIGIN?.startsWith('https:'));
  const lookup = url => {
    const match = /^\/_moss\/port\/([a-f0-9]{48})(\/.*)$/.exec(url.pathname), entry = match && entries.get(match[1]);
    if (!entry || entry.expiresAt < now()) throw new Error('端口预览已过期，请重新打开。');
    return { entry, pathname: match[2] + url.search };
  };
  const reservedCookie = name => /^moss_(?:web|cloud)$/i.test(name.trim());
  const responseHeaders = response => {
    const result = { ...response.headers, 'referrer-policy': 'no-referrer' };
    delete result['clear-site-data'];
    if (result['set-cookie']) result['set-cookie'] = result['set-cookie'].filter(cookie => !reservedCookie(cookie.split('=')[0])).map(cookie => {
      const parts = cookie.split(';').filter((part, index) => !index || !/^\s*(?:domain|secure)(?:=|\s*$)/i.test(part));
      return parts.join(';') + '; Secure';
    });
    return result;
  };
  function headers(req, entry, upgrade = false) {
    if (req.headers.host !== new URL(entry.origin).host) throw new Error('端口预览必须在独立域名打开。');
    if ((upgrade || !['GET', 'HEAD'].includes(req.method)) && req.headers.origin !== entry.origin) throw new Error('端口预览请求来源无效。');
    const result = { ...req.headers, host: `127.0.0.1:${entry.port}`, origin: `http://127.0.0.1:${entry.port}`, connection: upgrade ? 'Upgrade' : 'close' };
    for (const key of Object.keys(result)) if (key.startsWith('x-moss-') || ['authorization', 'proxy-authorization', 'proxy-connection', 'transfer-encoding'].includes(key)) delete result[key];
    if (result.cookie) result.cookie = result.cookie.split(';').filter(cookie => !reservedCookie(cookie.split('=')[0])).join(';');
    return result;
  }
  return {
    enabled,
    route(req) {
      if (!enabled) return req.url;
      const host = String(req.headers.host || '').split(':')[0];
      if (!host.endsWith('.' + domain)) return req.url;
      const token = host.slice(0, -(domain.length + 1));
      if (!entries.has(token)) throw new Error('端口预览已失效');
      const prefix = `/_moss/port/${token}`;
      return req.url.startsWith(prefix + '/') ? req.url : prefix + req.url;
    },
    handlers: new Map([['web:port-open', async ({ principal }, { url: input }) => {
      if (!enabled) throw new Error('端口预览需要管理员配置 MOSS_WEB_PREVIEW_DOMAIN 及独立的泛域名 HTTPS 入口。');
      const url = new URL(input.includes('://') ? input : `http://${input}`);
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password) throw new Error('请输入云电脑的 http://localhost:端口 地址。');
      const port = Number(url.port);
      if (port < 1024 || port === Number(env.MOSS_WEB_PORT || 43128)) throw new Error('不能预览 Host 管理端口或系统端口。');
      for (const [key, entry] of entries) if (entry.expiresAt < now()) entries.delete(key);
      if (entries.size >= 32) throw new Error('打开的端口预览过多。');
      const token = randomBytes(24).toString('hex'), expiresAt = now() + 24 * 3600_000;
      const entry = { userId: principal.userId, port, expiresAt, origin: `https://${token}.${domain}`, peers: new Set() };
      if (env.MOSS_ENVIRONMENT_ID) {
        const response = await fetchImpl(`${env.MOSS_WEB_AUTH_SERVER}/ports/register`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
          headers: { 'Content-Type': 'application/json', 'X-Moss-Environment': env.MOSS_ENVIRONMENT_ID, 'X-Moss-Host-Token': env.MOSS_WEB_CONTROL_TOKEN }, body: JSON.stringify({ token, expiresAt }) });
        if (!response.ok) throw new Error('云网关未能登记端口预览。');
      }
      entries.set(token, entry);
      return { url: entry.origin + url.pathname + url.search + url.hash };
    }]]),
    serve(req, res, url) {
      const { entry, pathname } = lookup(url);
      const upstream = http.request({ hostname: '127.0.0.1', port: entry.port, path: pathname, method: req.method, headers: headers(req, entry) }, response => {
        const outgoing = responseHeaders(response);
        if (outgoing.location) {
          try {
            const next = new URL(outgoing.location, `http://127.0.0.1:${entry.port}`);
            if (['localhost', '127.0.0.1', '[::1]'].includes(next.hostname) && Number(next.port) === entry.port) outgoing.location = entry.origin + next.pathname + next.search + next.hash;
          } catch { delete outgoing.location; }
        }
        res.writeHead(response.statusCode, outgoing); response.on('error', () => res.destroy()); response.pipe(res);
      });
      upstream.setTimeout(60000, () => upstream.destroy());
      upstream.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('云电脑端口尚未启动或无法连接。'); } else res.destroy(); });
      req.on('aborted', () => upstream.destroy()); res.on('close', () => upstream.destroy()); req.pipe(upstream);
    },
    upgrade(req, socket, head, url) {
      const { entry, pathname } = lookup(url);
      const upstream = http.request({ hostname: '127.0.0.1', port: entry.port, path: pathname, headers: headers(req, entry, true) });
      upstream.on('upgrade', (response, peer, peerHead) => {
        upstream.setTimeout(0); peer.setTimeout(0);
        if (socket.destroyed || entry.expiresAt < now()) { peer.destroy(); return; }
        peers.add(peer); peers.add(socket);
        entry.peers.add(socket);
        const timer = setInterval(() => { if (entry.expiresAt < now()) socket.destroy(); }, 30000); timer.unref?.();
        const safeHeaders = Object.entries(responseHeaders(response)).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(value => `${key}: ${value}`)).join('\r\n');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${safeHeaders}\r\n\r\n`);
        if (peerHead.length) socket.write(peerHead); if (head.length) peer.write(head);
        socket.on('close', () => { clearInterval(timer); entry.peers.delete(socket); peers.delete(socket); peer.destroy(); }); peer.on('close', () => { peers.delete(peer); socket.destroy(); });
        socket.on('error', () => peer.destroy()); peer.on('error', () => socket.destroy()); socket.pipe(peer).pipe(socket);
      });
      upstream.on('response', response => { response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
      socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
      upstream.on('error', () => socket.destroy()); upstream.setTimeout(10000, () => upstream.destroy()); upstream.end();
    },
    revokeOwner(userId) { for (const [token, entry] of entries) if (entry.userId === userId) { entries.delete(token); for (const peer of entry.peers) peer.destroy(); } },
    close() { entries.clear(); for (const peer of peers) peer.destroy(); peers.clear(); },
  };
}
