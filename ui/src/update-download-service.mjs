import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fetchUpdateResource } from './update-release-service.mjs';

export async function verifyUpdateFile(filePath, asset, signal) {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.size) throw new Error('安装包已丢失或大小不匹配，请重新下载。');
  const hash = createHash('sha512');
  const stream = fs.createReadStream(filePath, { flags: fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0), signal });
  for await (const chunk of stream) hash.update(chunk);
  if (hash.digest('base64') !== asset.sha512) throw new Error('安装包校验失败，请重新下载。');
}

export function createDownloadService({ directory, fetchImpl = fetch, idleTimeout = 60_000 }) {
  return {
    async download(candidate, { signal, onProgress, onVerifying } = {}) {
      const { asset, id } = candidate;
      if (!/^[a-f0-9]{64}$/.test(id) || !/^Moss-[A-Za-z0-9.+-]+\.(dmg|exe)$/.test(asset.name)) throw new Error('安装包名称无效。');
      const dir = path.join(directory, id);
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      for (const entry of [directory, dir]) {
        const stat = await fsp.lstat(entry);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('更新目录无效。');
      }
      const filePath = path.join(dir, asset.name);
      try {
        await verifyUpdateFile(filePath, asset, signal);
        return filePath;
      } catch { signal?.throwIfAborted(); }
      const part = path.join(dir, `${randomUUID()}.part`);
      const controller = new AbortController();
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      let timer;
      const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(new Error('下载长时间无响应，请重试。')), idleTimeout);
        timer.unref?.();
      };
      const hash = createHash('sha512');
      let transferred = 0;
      let lastProgress = 0;
      const started = Date.now();
      try {
        touch();
        const response = await fetchUpdateResource(asset.url, { fetchImpl, signal: combined });
        if (!response.body) throw new Error('下载内容为空。');
        const length = response.headers.get('content-length');
        if (length && Number(length) !== asset.size) {
          await response.body.cancel();
          throw new Error('服务器返回的安装包大小不匹配。');
        }
        const progress = new Transform({
          transform(chunk, _encoding, callback) {
            touch();
            transferred += chunk.length;
            if (transferred > asset.size) return callback(new Error('安装包超过预期大小。'));
            hash.update(chunk);
            if (Date.now() - lastProgress >= 250 || transferred === asset.size) {
              lastProgress = Date.now();
              onProgress?.({ transferred, total: asset.size, percent: transferred / asset.size * 100, bytesPerSecond: transferred / Math.max(1, (Date.now() - started) / 1000) });
            }
            callback(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(part, { flags: 'wx', mode: 0o600 }), { signal: combined });
        onVerifying?.();
        if (transferred !== asset.size || hash.digest('base64') !== asset.sha512) throw new Error('安装包大小或 SHA-512 校验失败，请重新下载。');
        combined.throwIfAborted();
        // Only this updater's version-specific cache may be replaced.
        await fsp.rm(filePath, { force: true });
        await fsp.rename(part, filePath);
        return filePath;
      } finally {
        clearTimeout(timer);
        await fsp.rm(part, { force: true });
      }
    },
    verify: verifyUpdateFile,
  };
}
