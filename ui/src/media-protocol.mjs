/**
 * Workspace media protocol moss-media://
 *
 * 取代「整文件 base64 IPC」方案: <img>/<video>/<audio> 直接用
 *   moss-media://workspace/<encodeURIComponent(根目录)>/<相对路径>
 * 旧的 moss-media://local/<encodeURIComponent(绝对路径)> 地址继续兼容。
 * 支持 HTTP Range 请求 -> 视频边下边播 / seek 不卡。
 *
 * 安全: 仅允许读取已登记白名单根目录下的文件,
 * 拒绝目录穿越。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const MEDIA_SCHEME = 'moss-media';

// 运行期登记的根目录白名单
const allowedRoots = new Set();
const allowedFiles = new Set();

/** 登记一个允许通过协议访问的根目录 */
export function allowMediaRoot(dir) {
  if (!dir) return;
  allowedRoots.add(path.resolve(dir));
}

/** 登记一个允许通过协议读取的具体文件，不同时开放其所在目录。 */
export function allowMediaFile(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  allowedFiles.add(resolved);
  try { allowedFiles.add(fs.realpathSync(resolved)); } catch {}
}

function isPathAllowed(target) {
  const resolved = path.resolve(target);
  if (allowedFiles.has(resolved)) return true;
  for (const root of allowedRoots) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.pjpe': 'image/pjpeg',
  '.pjpeg': 'image/pjpeg', '.png': 'image/png', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.cur': 'image/x-icon',
  '.heic': 'image/heic', '.heif': 'image/heif', '.avif': 'image/avif', '.jxl': 'image/jxl',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.apng': 'image/apng',
  '.mp4': 'video/mp4', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg', '.mpe': 'video/mpeg',
  '.mpv': 'video/mpv', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.m4v': 'video/x-m4v',
  '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv', '.3gp': 'video/3gpp', '.3g2': 'video/3gpp2',
  '.m2ts': 'video/mp2t', '.ts': 'video/mp2t', '.m3u8': 'application/vnd.apple.mpegurl',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aif': 'audio/aiff', '.aiff': 'audio/aiff',
  '.aifc': 'audio/aiff', '.flac': 'audio/flac', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg', '.m4a': 'audio/mp4', '.opus': 'audio/opus', '.weba': 'audio/webm',
  '.amr': 'audio/amr', '.mid': 'audio/midi', '.midi': 'audio/midi', '.caf': 'audio/x-caf',
  '.au': 'audio/basic', '.snd': 'audio/basic', '.wma': 'audio/x-ms-wma',
};

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function decodeMediaRequestPath(requestUrl) {
  const u = new URL(requestUrl);
  const encodedPath = u.pathname.replace(/^\/+/, '');
  if (u.hostname === 'workspace') {
    const segments = encodedPath.split('/').filter(Boolean);
    if (segments.length < 2) throw new Error('Missing workspace media path.');
    const root = path.resolve(decodeURIComponent(segments.shift()));
    const target = path.resolve(root, ...segments.map((segment) => decodeURIComponent(segment)));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Workspace media path escapes its root.');
    }
    return target;
  }
  if (u.hostname !== 'local') throw new Error('Unknown media URL format.');
  return decodeURIComponent(encodedPath);
}

/**
 * 在 app.whenReady 之后调用: 安装协议处理器(支持 Range)
 * @param {import('electron').Protocol} protocol electron.protocol
 */
export function installMediaProtocol(protocol) {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let filePath;
    try {
      filePath = decodeMediaRequestPath(request.url);
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    if (!isPathAllowed(filePath)) {
      return new Response('Forbidden', { status: 403 });
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (!stat.isFile()) {
      return new Response('Not found', { status: 404 });
    }

    // 防止经由软链接逃逸出允许的根目录(lexical resolve 无法识别 symlink)
    try {
      const realPath = await fsp.realpath(filePath);
      if (!isPathAllowed(realPath)) {
        return new Response('Forbidden', { status: 403 });
      }
    } catch {
      return new Response('Not found', { status: 404 });
    }

    const total = stat.size;
    const contentType = mimeFor(filePath);
    const rangeHeader = request.headers.get('Range') || request.headers.get('range');

    // 无 Range: 返回整文件流
    if (!rangeHeader) {
      const stream = fs.createReadStream(filePath);
      return new Response(streamToWeb(stream), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // 解析 Range: bytes=start-end
    const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(streamToWeb(stream), {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(chunkSize),
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  });
}

// Node Readable -> Web ReadableStream (Electron Response 需要 Web 流)
// 施加背压: 队列满时暂停 Node 流, 消费者 pull 时恢复, 避免把整段大视频读入内存
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
      nodeStream.on('error', (err) => controller.error(err));
    },
    pull() {
      nodeStream.resume();
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}
