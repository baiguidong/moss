import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const resourcePrefix = '/_moss/resource/';
const within = (root, file) => { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const mime = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.wasm': 'application/wasm' };
export function createWebResources({ env = process.env, now = Date.now, fetchImpl = fetch } = {}) {
  const entries = new Map();
  function prune() { for (const [token, entry] of entries) if (entry.expiresAt < now()) entries.delete(token); }
  return {
    async create({ root, entryPath, read, htmlPrefix = '', ownerId, validate = () => {} }) {
      prune();
      if (entries.size >= 256) throw new Error('预览过多，请关闭旧页面后重试。');
      const resolvedRoot = read ? '/' : await fs.realpath(root);
      const relative = read ? entryPath : path.relative(resolvedRoot, await fs.realpath(entryPath));
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('预览文件不在授权目录内。');
      const token = randomBytes(32).toString('base64url'), expiresAt = now() + 24 * 3600_000;
      const base = `${resourcePrefix}${token}/`;
      const value = { resolvedRoot, read, htmlPrefix, ownerId, validate, expiresAt };
      entries.set(token, value);
      try {
        if (env.MOSS_ENVIRONMENT_ID) {
          const response = await fetchImpl(`${env.MOSS_WEB_AUTH_SERVER}/resources/register`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
            headers: { 'Content-Type': 'application/json', 'X-Moss-Environment': env.MOSS_ENVIRONMENT_ID, 'X-Moss-Host-Token': env.MOSS_WEB_CONTROL_TOKEN }, body: JSON.stringify({ token, expiresAt }) });
          if (!response.ok) throw new Error('云网关未能登记预览资源。');
        }
      } catch (error) { entries.delete(token); throw error; }
      return { token, url: base + relative.split(path.sep).map(encodeURIComponent).join('/'), base, active: () => entries.has(token) && expiresAt >= now(), revoke: () => entries.delete(token) };
    },
    async serve(req, res, url) {
      prune();
      const match = /^\/_moss\/resource\/([\w-]{43})\/(.*)$/.exec(url.pathname);
      const entry = match && entries.get(match[1]);
      if (!entry || !['GET', 'HEAD'].includes(req.method)) throw new Error('预览资源已过期，请重新打开。');
      await entry.validate();
      const relative = decodeURIComponent(match[2]);
      if (!relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => part === '..' || part === '.')) throw new Error('资源路径无效。');
      let data, type;
      if (entry.read) {
        const response = await entry.read(relative);
        if (!response.ok) throw new Error('远端预览资源不可用。');
        if (Number(response.headers.get('content-length')) > 64 * 1024 * 1024) throw new Error('预览资源过大。');
        data = Buffer.from(await response.arrayBuffer()); type = response.headers.get('content-type');
      } else {
        const target = await fs.realpath(path.resolve(entry.resolvedRoot, relative));
        if (!within(entry.resolvedRoot, target)) throw new Error('资源超出授权目录。');
        const stat = await fs.stat(target);
        if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('预览资源不是文件或超过 64 MB。');
        data = await fs.readFile(target);
      }
      if (data.length > 64 * 1024 * 1024) throw new Error('预览资源过大。');
      type = mime[path.extname(relative).toLowerCase()] || type || 'application/octet-stream';
      if (type.startsWith('text/html') && entry.htmlPrefix) data = Buffer.from(entry.htmlPrefix + data.toString('utf8'));
      // All active documents remain opaque origins, including direct navigation.
      res.removeHeader('X-Frame-Options');
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff',
        'Permissions-Policy': 'camera=(), microphone=(), display-capture=(), geolocation=()',
        'Content-Security-Policy': "sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'; object-src 'none'; base-uri 'self'" });
      res.end(req.method === 'HEAD' ? undefined : data);
    },
    revoke(token) { entries.delete(token); },
    revokeOwner(ownerId) { for (const [token, entry] of entries) if (entry.ownerId === ownerId) entries.delete(token); },
    close() { entries.clear(); },
  };
}
