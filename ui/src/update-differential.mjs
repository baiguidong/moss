import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { computeOperations, OperationKind } from 'electron-updater/out/differentialDownloader/downloadPlanBuilder.js';
import { fetchUpdateResource } from './update-release-service.mjs';

async function readMap(url, expectedSize, options) {
  const response = await fetchUpdateResource(url, options);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 4 * 1024 * 1024) throw new Error('更新分块表过大。');
    chunks.push(chunk);
  }
  const map = JSON.parse(gunzipSync(Buffer.concat(chunks), { maxOutputLength: 16 * 1024 * 1024 }));
  const file = map.files?.[0];
  if (map.version !== '2' || map.files?.length !== 1 || file?.offset !== 0 || !Array.isArray(file.sizes)
    || !Array.isArray(file.checksums) || file.checksums.length !== file.sizes.length
    || !file.checksums.every(value => typeof value === 'string' && value.length > 0)
    || !file.sizes.every(n => Number.isSafeInteger(n) && n > 0)
    || file.sizes.reduce((sum, n) => sum + n, 0) !== expectedSize) throw new Error('更新分块表与安装包不匹配。');
  return map;
}

// Return false when there is no usable plan. Once a smaller download has been
// offered, ask before consuming the bandwidth of a full package on failure.
export async function downloadDifferential({ asset, version, baseVersion, baseFile, destination, fetchImpl, signal, onProgress, touch = () => {} }) {
  if (!baseFile || !baseVersion) return false;
  const stat = await fs.lstat(baseFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!stat?.isFile()) return false;
  const oldName = asset.name.replace(`-${version}-`, `-${baseVersion}-`);
  const oldUrl = new URL(`../v${encodeURIComponent(baseVersion)}/${encodeURIComponent(oldName)}.blockmap`, asset.url);
  const options = { fetchImpl, signal };
  let operations;
  try {
    const oldMap = await readMap(oldUrl.href, stat.size, options);
    touch();
    const newMap = await readMap(asset.url + '.blockmap', asset.size, options);
    operations = computeOperations(oldMap, newMap, { info() {}, warn() {} });
  } catch (error) {
    signal?.throwIfAborted();
    return false;
  }
  const downloads = operations.filter(op => op.kind === OperationKind.DOWNLOAD);
  const total = downloads.reduce((n, op) => n + op.end - op.start, 0);
  if (total >= asset.size) return false;
  let transferred = 0;
  const started = Date.now();
  let lastProgress = 0;
  const progress = () => onProgress?.({ transferred, total, percent: total ? 100 * transferred / total : 100,
    bytesPerSecond: transferred / Math.max(1, (Date.now() - started) / 1000) });
  progress();
  let source, output;
  try {
    source = await fs.open(baseFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    output = await fs.open(destination, 'w', 0o600);
    const hash = createHash('sha512');
    async function append(chunk) {
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset);
        if (!bytesWritten) throw new Error('无法写入更新包。');
        offset += bytesWritten;
      }
      hash.update(chunk);
      touch();
    }
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let downloadUrl = asset.url;
    for (const op of operations) {
      signal?.throwIfAborted();
      if (op.kind === OperationKind.COPY) {
        for (let offset = op.start; offset < op.end;) {
          signal?.throwIfAborted();
          const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, op.end - offset), offset);
          if (!bytesRead) throw new Error('旧安装包已发生变化。');
          await append(buffer.subarray(0, bytesRead));
          offset += bytesRead;
        }
        continue;
      }
      const range = `bytes=${op.start}-${op.end - 1}`;
      const response = await fetchUpdateResource(downloadUrl, { ...options, range, onUrl: url => { downloadUrl = url; } });
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${op.start}-${op.end - 1}/${asset.size}`) {
        await response.body?.cancel();
        throw new Error('下载服务器未返回指定的数据范围。');
      }
      let position = op.start;
      for await (const chunk of response.body) {
        signal?.throwIfAborted();
        position += chunk.length;
        if (position > op.end) throw new Error('更新分块超出预期大小。');
        await append(chunk);
        transferred += chunk.length;
        if (transferred === total || Date.now() - lastProgress >= 250) {
          progress();
          lastProgress = Date.now();
        }
      }
      if (position !== op.end) throw new Error('更新分块不完整。');
    }
    if (hash.digest('base64') !== asset.sha512) throw new Error('重建的安装包未通过 SHA-512 校验。');
    return true;
  } catch (cause) {
    if (signal?.aborted && signal.reason?.name === 'AbortError') throw signal.reason;
    throw Object.assign(new Error(`增量更新未完成，可改为下载完整安装包（${(asset.size / 1048576).toFixed(1)} MiB）。`, { cause }), { code: 'FULL_DOWNLOAD_REQUIRED' });
  } finally {
    await Promise.all([source?.close(), output?.close()]);
  }
}
