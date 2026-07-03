/**
 * 语音转写 - IPC 桥接
 * 注册本地 whisper.cpp 转写相关的 IPC handlers
 *
 * 长耗时转写在 utilityProcess(whisper-worker.mjs) 里跑, 不阻塞主进程。
 * 模型首次使用时下载 (推送 modelDownloadProgress)。
 */

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, utilityProcess } from 'electron';
import { isModelReady, downloadModel, getModelPath, DEFAULT_MODEL, MODELS_DIR } from './whisper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_DB_PATH = path.join(os.homedir(), '.moss', 'moss.db');

// 活跃的转写任务 (fileId -> { child, controller, stopped }), 用于停止
const activeTranscriptions = new Map();
// 模型下载去重 + 引用计数 (modelName -> { promise, controller, refs })
// 多个文件可共享同一次下载: 任一消费者取消都能立即返回, 但只有最后一个取消时才真正中断下载。
const downloading = new Map();

export function registerTranscribeIpcHandlers(ipcMain, db) {
  const send = (channel, data) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  };

  // 确保模型就绪, 缺失则下载 (推进度)。返回模型文件路径。
  // signal: 该消费者的中断信号。多个文件可共享同一次下载, 只有最后一个取消时才真正中断。
  async function ensureModel(modelName, signal) {
    if (isModelReady(modelName)) return getModelPath(modelName);

    let entry = downloading.get(modelName);
    if (!entry) {
      const controller = new AbortController();
      const base = { model: modelName, dir: MODELS_DIR, path: getModelPath(modelName) };
      send('fileManager:modelDownloadProgress', { ...base, percent: 0, received: 0, total: 0, speed: 0, status: 'downloading' });
      const promise = downloadModel(modelName, ({ percent, received, total, speed }) => {
        send('fileManager:modelDownloadProgress', { ...base, percent, received, total, speed, status: 'downloading' });
      }, controller.signal)
        .then((dest) => {
          send('fileManager:modelDownloadProgress', { ...base, percent: 100, status: 'completed' });
          return dest;
        })
        .catch((err) => {
          const cancelled = err.message === 'aborted';
          send('fileManager:modelDownloadProgress', {
            ...base, percent: 0, status: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : err.message,
          });
          throw err;
        })
        .finally(() => downloading.delete(modelName));
      entry = { promise, controller, refs: 0 };
      downloading.set(modelName, entry);
    }

    // 把当前消费者挂到共享下载: 它取消时减引用, 归零才真正中断底层请求。
    entry.refs++;
    return await new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const onAbort = () => {
        cleanup();
        if (--entry.refs <= 0) {
          downloading.delete(modelName); // 抢先移除, 避免新消费者挂到将死的下载
          entry.controller.abort();
        }
        reject(new Error('aborted'));
      };
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort);
      }
      entry.promise.then(
        (dest) => { cleanup(); resolve(dest); },
        (err) => { cleanup(); reject(err); },
      );
    });
  }

  // 开始转写 (立即返回, 结果通过事件回推)
  ipcMain.handle('fileManager:transcribeFile', async (event, { fileId, model }) => {
    const modelName = model || DEFAULT_MODEL;
    const file = db.prepare('SELECT id, path, file_type FROM fm_original_files WHERE id = ?').get(fileId);
    if (!file) return { error: 'File not found' };
    if (file.file_type !== 'audio' && file.file_type !== 'video') {
      return { error: 'Not an audio/video file' };
    }
    if (activeTranscriptions.has(fileId)) return { error: 'Transcription already running' };

    // 下载阶段就登记, 让「停止」可以中断模型下载 (此时 worker 还没 fork)。
    const controller = new AbortController();
    const entry = { child: null, controller, stopped: false };
    activeTranscriptions.set(fileId, entry);

    let modelPath;
    try {
      modelPath = await ensureModel(modelName, controller.signal);
    } catch (err) {
      activeTranscriptions.delete(fileId);
      if (err.message === 'aborted' || entry.stopped) {
        send('fileManager:transcribeProgress', { fileId, progress: 0, status: 'cancelled' });
        return { success: true, cancelled: true };
      }
      return { error: 'Model download failed: ' + err.message };
    }

    // 下载完成前用户已点停止
    if (entry.stopped) {
      activeTranscriptions.delete(fileId);
      send('fileManager:transcribeProgress', { fileId, progress: 0, status: 'cancelled' });
      return { success: true, cancelled: true };
    }

    const workerPath = path.join(__dirname, 'whisper-worker.mjs');
    let child;
    try {
      child = utilityProcess.fork(workerPath, [], { serviceName: 'moss-whisper-worker' });
    } catch (err) {
      activeTranscriptions.delete(fileId);
      return { error: 'Failed to start whisper worker: ' + err.message };
    }

    entry.child = child;

    child.on('message', (msg) => {
      if (!msg || msg.fileId !== fileId) return;

      if (msg.type === 'progress') {
        send('fileManager:transcribeProgress', { fileId, progress: msg.progress, status: 'running' });
        return;
      }
      if (msg.type === 'done') {
        send('fileManager:transcribeProgress', { fileId, progress: 100, status: 'completed', length: msg.length });
        activeTranscriptions.delete(fileId);
        try { child.kill(); } catch {}
        return;
      }
      if (msg.type === 'error') {
        const cancelled = msg.error === 'stopped';
        if (!cancelled) {
          db.prepare(
            `INSERT INTO fm_transcripts (file_id, status, updated_at) VALUES (?, 'error', CURRENT_TIMESTAMP)
             ON CONFLICT(file_id) DO UPDATE SET status='error', updated_at=CURRENT_TIMESTAMP`
          ).run(fileId);
        }
        send('fileManager:transcribeProgress', {
          fileId, progress: 0, status: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : msg.error,
        });
        activeTranscriptions.delete(fileId);
        try { child.kill(); } catch {}
      }
    });

    child.on('exit', () => {
      if (activeTranscriptions.has(fileId)) {
        send('fileManager:transcribeProgress', { fileId, progress: 0, status: 'error', error: 'Whisper worker exited unexpectedly' });
        activeTranscriptions.delete(fileId);
      }
    });

    child.postMessage({ type: 'start', fileId, filePath: file.path, dbPath: SESSION_DB_PATH, modelPath, modelName });

    return { success: true, message: 'Transcription started' };
  });

  // 读取已有转写结果
  ipcMain.handle('fileManager:getTranscript', async (event, { fileId }) => {
    const row = db.prepare('SELECT text, language, model, status FROM fm_transcripts WHERE file_id = ?').get(fileId);
    return row || null;
  });

  // 停止转写 (下载阶段 -> 中断下载; 转写阶段 -> 通知 worker 停止)
  ipcMain.handle('fileManager:stopTranscribe', async (event, { fileId }) => {
    const entry = activeTranscriptions.get(fileId);
    if (entry) {
      entry.stopped = true;
      try { entry.controller?.abort(); } catch {}
      if (entry.child) {
        try { entry.child.postMessage({ type: 'stop' }); } catch {}
      }
    }
    return { success: true };
  });
}

export default { registerTranscribeIpcHandlers };
