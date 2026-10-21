import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

export const resourcePrefix = '/_moss/resource/';
const within = (root, file) => { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const mime = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.opus': 'audio/opus',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
};
const encodeRelative = relative => relative.split('/').map(encodeURIComponent).join('/');
const signature = (secret, scope, relative) => createHmac('sha256', secret).update(scope).update('\0').update(relative).digest('base64url');
function validSignature(url, entry, relative) {
  const values = url.searchParams.getAll('sig');
  if (values.length !== 1 || [...url.searchParams.keys()].length !== 1 || !/^[\w-]{43}$/.test(values[0])) return false;
  return timingSafeEqual(Buffer.from(values[0]), Buffer.from(signature(entry.secret, entry.signedScope, relative)));
}
export function createWebResources({ env = process.env, now = Date.now, fetchImpl = fetch, maxEntries = 256 } = {}) {
  const entries = new Map();
  let creating = 0;
  function prune() { for (const [token, entry] of entries) if (entry.expiresAt < now()) entries.delete(token); }
  return {
    async create({ root, entryPath, read, htmlPrefix = '', ownerId, validate = () => {}, stream = false, signedScope = null, allowAppFrames = false }) {
      prune();
      if (entries.size + creating >= maxEntries) throw new Error('预览过多，请关闭旧页面后重试。');
      if (signedScope !== null && (!stream || read || typeof signedScope !== 'string' || !signedScope)) throw new Error('签名资源必须是本地流式资源。');
      if (allowAppFrames && signedScope === null) throw new Error('App 内嵌预览需要签名资源。');
      creating++;
      let reserved = true;
      try {
        const resolvedRoot = read ? '/' : await fs.realpath(root);
        const relative = read ? entryPath : path.relative(resolvedRoot, await fs.realpath(entryPath));
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('预览文件不在授权目录内。');
        const token = randomBytes(32).toString('base64url'), expiresAt = now() + 24 * 3600_000;
        const base = `${resourcePrefix}${token}/`;
        const value = { resolvedRoot, read, htmlPrefix, ownerId, validate, expiresAt, stream, signedScope, allowAppFrames,
          secret: signedScope === null ? null : randomBytes(32),
          allowedRelative: stream && !read && signedScope === null ? relative.split(path.sep).join('/') : null };
        entries.set(token, value);
        creating--; reserved = false;
        try {
          if (env.MOSS_ENVIRONMENT_ID) {
            const response = await fetchImpl(`${env.MOSS_WEB_AUTH_SERVER}/resources/register`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
              headers: { 'Content-Type': 'application/json', 'X-Moss-Environment': env.MOSS_ENVIRONMENT_ID, 'X-Moss-Host-Token': env.MOSS_WEB_CONTROL_TOKEN }, body: JSON.stringify({ token, expiresAt }) });
            if (!response.ok) throw new Error('云网关未能登记预览资源。');
          }
        } catch (error) { entries.delete(token); throw error; }
        const active = () => entries.get(token) === value && expiresAt >= now();
        const urlFor = signedScope === null ? undefined : async entryPath => {
          if (!active()) throw new Error('预览资源已过期，请重新打开。');
          const target = await fs.realpath(entryPath);
          if (!within(resolvedRoot, target) || !(await fs.stat(target)).isFile()) throw new Error('预览文件不在授权目录内。');
          const fileRelative = path.relative(resolvedRoot, target).split(path.sep).join('/');
          if (!fileRelative || fileRelative.includes('\\') || fileRelative.includes('\0')) throw new Error('资源路径无效。');
          if (!active()) throw new Error('预览资源已过期，请重新打开。');
          return `${base}${encodeRelative(fileRelative)}?sig=${signature(value.secret, signedScope, fileRelative)}`;
        };
        return { token, url: base + relative.split(path.sep).map(encodeURIComponent).join('/'), base, expiresAt, active,
          ...(urlFor ? { urlFor } : {}), revoke: () => entries.delete(token) };
      } finally {
        if (reserved) creating--;
      }
    },
    async serve(req, res, url) {
      prune();
      const match = /^\/_moss\/resource\/([\w-]{43})\/(.*)$/.exec(url.pathname);
      const entry = match && entries.get(match[1]);
      if (!entry || !['GET', 'HEAD', ...(entry.stream ? ['OPTIONS'] : [])].includes(req.method)) throw new Error('预览资源已过期，请重新打开。');
      await entry.validate();
      const relative = decodeURIComponent(match[2]);
      if (!relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => part === '..' || part === '.')) throw new Error('资源路径无效。');
      if (entry.signedScope !== null && encodeRelative(relative) !== match[2]) throw new Error('资源路径无效。');
      if (entry.stream && (entry.signedScope === null ? entry.allowedRelative !== relative : !validSignature(url, entry, relative))) throw new Error('资源路径未授权。');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' });
        res.end(); return;
      }
      if (entry.stream && !entry.read) {
        const target = await fs.realpath(path.resolve(entry.resolvedRoot, relative));
        if (!within(entry.resolvedRoot, target)) throw new Error('资源超出授权目录。');
        const stat = await fs.stat(target);
        if (!stat.isFile()) throw new Error('预览资源不是文件。');
        let start = 0, end = stat.size - 1, status = 200;
        const unsatisfiable = () => {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Content-Length': 0, 'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges',
            'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' });
          res.end();
        };
        if (req.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!range || (!range[1] && !range[2])) { unsatisfiable(); return; }
          if (!range[1]) start = Math.max(0, stat.size - Number(range[2]));
          else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
            unsatisfiable(); return;
          }
          status = 206;
        }
        const type = mime[path.extname(relative).toLowerCase()] || 'application/octet-stream';
        const headers = { 'Content-Type': type, 'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges', 'Cross-Origin-Resource-Policy': 'cross-origin',
          'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': `sandbox; frame-ancestors 'self'${entry.allowAppFrames ? ' moss-app:' : ''}; object-src 'none'` };
        if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
        res.writeHead(status, headers);
        if (req.method === 'HEAD' || !stat.size) { res.end(); return; }
        await pipeline(createReadStream(target, { start, end }), res);
        return;
      }
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
