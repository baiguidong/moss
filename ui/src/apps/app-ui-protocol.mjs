import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const APP_UI_SCHEME = 'moss-app';

const allowedBundles = new Map();
const installedProtocols = new WeakSet();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function streamToWeb(nodeStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => {
        controller.enqueue(new Uint8Array(chunk));
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          nodeStream.pause();
        }
      });
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (error) => controller.error(error));
    },
    pull() {
      nodeStream.resume();
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

function ensureInsideRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside the App bundle root.');
  }
  return resolvedTarget;
}

function normalizeRelativeBundlePath(relativePath, fallback) {
  const value = String(relativePath || fallback || 'index.html');
  const normalized = path.normalize(value);
  if (
    !normalized ||
    normalized === '.' ||
    path.isAbsolute(normalized) ||
    normalized.startsWith('..')
  ) {
    throw new Error('Invalid App bundle path.');
  }
  return normalized;
}

function encodeBundlePath(relativePath) {
  return relativePath
    .split(path.sep)
    .join('/')
    .split('/')
    .filter(Boolean)
    .map(part => encodeURIComponent(part))
    .join('/');
}

function decodeRequest(requestUrl) {
  const url = new URL(requestUrl);
  let token = url.hostname && url.hostname !== 'app' ? url.hostname : '';
  let relativePath = '';

  if (token) {
    relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } else {
    const parts = url.pathname.split('/').filter(Boolean);
    token = parts.shift() || '';
    relativePath = decodeURIComponent(parts.join('/'));
  }

  if (!token) throw new Error('Missing App bundle token.');
  const bundle = allowedBundles.get(token);
  if (!bundle) throw new Error('Unknown App bundle token.');
  const normalizedRelativePath = normalizeRelativeBundlePath(relativePath, bundle.entry);
  return {
    bundle,
    filePath: ensureInsideRoot(bundle.root, path.join(bundle.root, normalizedRelativePath)),
  };
}

export function registerAppUiScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_UI_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

export function installAppUiProtocol(protocol) {
  if (installedProtocols.has(protocol)) return;
  installedProtocols.add(protocol);
  protocol.handle(APP_UI_SCHEME, async (request) => {
    let bundle;
    let filePath;
    try {
      ({ bundle, filePath } = decodeRequest(request.url));
    } catch (error) {
      return new Response(error.message || 'Bad request', { status: 400 });
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (!stat.isFile()) return new Response('Not found', { status: 404 });

    try {
      const realRoot = await fsp.realpath(bundle.root);
      const realPath = await fsp.realpath(filePath);
      ensureInsideRoot(realRoot, realPath);
    } catch {
      return new Response('Forbidden', { status: 403 });
    }

    return new Response(streamToWeb(fs.createReadStream(filePath)), {
      status: 200,
      headers: {
        'Content-Type': mimeFor(filePath),
        'Content-Length': String(stat.size),
        'Cache-Control': 'no-cache',
      },
    });
  });
}

export function allowAppUiBundleRoot(root, entry = 'dist/index.html') {
  const token = randomUUID();
  allowedBundles.set(token, {
    root: path.resolve(root),
    entry: normalizeRelativeBundlePath(entry, 'index.html'),
  });
  return token;
}

export function revokeAppUiBundleRoot(token) {
  if (token) allowedBundles.delete(token);
}

export function toAppUiUrl(token, entry = 'dist/index.html') {
  const normalizedEntry = normalizeRelativeBundlePath(entry, 'index.html');
  return `${APP_UI_SCHEME}://${token}/${encodeBundlePath(normalizedEntry)}`;
}

export default {
  APP_UI_SCHEME,
  registerAppUiScheme,
  installAppUiProtocol,
  allowAppUiBundleRoot,
  revokeAppUiBundleRoot,
  toAppUiUrl,
};
