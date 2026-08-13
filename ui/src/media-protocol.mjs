/**
 * Workspace media protocol moss-media://
 *
 * 取代「整文件 base64 IPC」方案: <img>/<video>/<audio> 直接用
 *   moss-media://local/<encodeURIComponent(绝对路径)>
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

/** 登记一个允许通过协议访问的根目录 */
export function allowMediaRoot(dir) {
  if (!dir) return;
  allowedRoots.add(path.resolve(dir));
}

function isPathAllowed(target) {
  const resolved = path.resolve(target);
  for (const root of allowedRoots) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.heic': 'image/heic',
  '.heif': 'image/heif', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
};

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function decodeRequestPath(requestUrl) {
  // moss-media://local/<encoded> -> 解出绝对路径
  const u = new URL(requestUrl);
  // pathname 形如 /<encoded>; host 为 local
  let encoded = u.pathname.replace(/^\/+/, '');
  return decodeURIComponent(encoded);
}

/**
 * 在 app.whenReady 之后调用: 安装协议处理器(支持 Range)
 * @param {import('electron').Protocol} protocol electron.protocol
 */
export function installMediaProtocol(protocol) {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let filePath;
    try {
      filePath = decodeRequestPath(request.url);
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
