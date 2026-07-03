/**
 * whisper.cpp 封装
 * - 解析打包态(asar.unpacked)与开发态的 whisper-cli 二进制路径
 * - 管理本地模型文件: 解析路径 / 检查就绪 / 首次使用时下载
 *
 * 模型下载到 ~/.moss/whisper-models, 与 thumbnails/temp/vault 同级。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// 打包后二进制被 asarUnpack 解出到 app.asar.unpacked
function unpacked(p) {
  if (!p) return p;
  return p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

let _whisperPath = null;

export function getWhisperPath() {
  if (_whisperPath) return _whisperPath;
  try {
    // 若将来引入静态二进制 npm 包, 在此 require 解析其路径
    _whisperPath = unpacked(require('whisper-cli-static'));
  } catch {
    _whisperPath = 'whisper-cli'; // 回退到系统 PATH (dev: brew install whisper-cpp)
  }
  return _whisperPath;
}

export const MODELS_DIR = path.join(os.homedir(), '.moss', 'whisper-models');

// whisper.cpp 官方 ggml 模型 (HuggingFace)
const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
export const MODELS = {
  base: { file: 'ggml-base.bin', url: `${HF_BASE}/ggml-base.bin`, minSize: 100 * 1024 * 1024 },
  medium: { file: 'ggml-medium.bin', url: `${HF_BASE}/ggml-medium.bin`, minSize: 1.2 * 1024 * 1024 * 1024 },
  'large-v3-turbo': { file: 'ggml-large-v3-turbo.bin', url: `${HF_BASE}/ggml-large-v3-turbo.bin`, minSize: 1.2 * 1024 * 1024 * 1024 },
};

export const DEFAULT_MODEL = 'medium';

export function getModelPath(name = DEFAULT_MODEL) {
  const m = MODELS[name];
  if (!m) throw new Error(`Unknown whisper model: ${name}`);
  return path.join(MODELS_DIR, m.file);
}

// 文件存在且体积达标 (排除下载残缺)
export function isModelReady(name = DEFAULT_MODEL) {
  const m = MODELS[name];
  if (!m) return false;
  try {
    const st = fs.statSync(getModelPath(name));
    return st.isFile() && st.size >= m.minSize;
  } catch {
    return false;
  }
}

/**
 * 下载模型到本地。先写入 *.part 再 rename, 避免半文件被误判为就绪。
 * @param {string} name 模型名 (MODELS 的 key)
 * @param {(p:{percent:number,received:number,total:number,speed:number})=>void} [onProgress]
 *        下载进度回调: percent(0-100)、已下载字节、总字节、瞬时速度(字节/秒)
 * @param {AbortSignal} [signal] 中断信号, 触发后销毁请求并清理 *.part
 * @returns {Promise<string>} 模型文件绝对路径
 */
export function downloadModel(name = DEFAULT_MODEL, onProgress, signal) {
  const m = MODELS[name];
  if (!m) return Promise.reject(new Error(`Unknown whisper model: ${name}`));

  const dest = getModelPath(name);
  const part = `${dest}.part`;
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));

    let req = null;
    let file = null;
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(arg);
    };
    const onAbort = () => {
      if (req) req.destroy(new Error('aborted'));
      if (file) file.destroy();       // 关闭写入流, 否则 fd 泄漏 (Windows 上还会阻塞 rmSync)
      fs.rmSync(part, { force: true });
      finish(reject, new Error('aborted'));
    };
    if (signal) signal.addEventListener('abort', onAbort);

    const doRequest = (currentUrl, redirectCount = 0) => {
      if (redirectCount > 10) return finish(reject, new Error('Too many redirects'));
      const mod = currentUrl.startsWith('https') ? https : http;
      req = mod.get(currentUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return doRequest(res.headers.location, redirectCount + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return finish(reject, new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let received = 0;
        let windowStart = Date.now();
        let windowBytes = 0;
        file = fs.createWriteStream(part);
        res.on('data', (chunk) => {
          received += chunk.length;
          windowBytes += chunk.length;
          const now = Date.now();
          const elapsed = now - windowStart;
          // 每 ~500ms 汇报一次, 用滑动窗口算瞬时速度
          if (onProgress && (elapsed >= 500 || (total > 0 && received === total))) {
            const speed = elapsed > 0 ? Math.round((windowBytes / elapsed) * 1000) : 0;
            onProgress({
              percent: total > 0 ? Math.round((received / total) * 100) : 0,
              received,
              total,
              speed,
            });
            windowStart = now;
            windowBytes = 0;
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          try {
            fs.renameSync(part, dest);
            if (onProgress) onProgress({ percent: 100, received, total, speed: 0 });
            finish(resolve, dest);
          } catch (err) {
            finish(reject, err);
          }
        }));
        file.on('error', (error) => {
          fs.rmSync(part, { force: true });
          finish(reject, error);
        });
        res.on('error', (error) => finish(reject, error));
      }).on('error', (error) => finish(reject, error));
    };
    doRequest(m.url);
  });
}

export default { getWhisperPath, getModelPath, isModelReady, downloadModel, MODELS, MODELS_DIR, DEFAULT_MODEL };
