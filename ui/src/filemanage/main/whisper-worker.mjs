/**
 * 语音转写 Worker (Electron utilityProcess 入口)
 *
 * 在独立进程里跑, 不阻塞 UI:
 *   1. ffmpeg 把音频/视频转成 16kHz 单声道 WAV (whisper.cpp 要求的输入)
 *   2. whisper-cli 转写, stdout 为纯文本, stderr 解析进度
 *   3. 结果写入 fm_transcripts
 *
 * 消息协议:
 *   in : { type:'start', fileId, filePath, dbPath, modelPath, modelName }
 *        { type:'stop' }
 *   out: { type:'progress', fileId, progress }      // progress: 0-100, -1=转码中(不确定)
 *        { type:'done', fileId, length }
 *        { type:'error', fileId, error }
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { getFfmpegPath } from './ffmpeg.mjs';
import { getWhisperPath } from './whisper.mjs';

const execFileAsync = promisify(execFile);
const TEMP_DIR = path.join(os.homedir(), '.moss', 'temp');
const port = process.parentPort;

let stopped = false;
let child = null; // 当前 whisper 子进程, 用于停止

function post(msg) { port.postMessage(msg); }

port.on('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'stop') {
    stopped = true;
    try { if (child) child.kill(); } catch {}
    return;
  }
  if (msg.type === 'start') {
    run(msg).catch((err) => post({ type: 'error', fileId: msg.fileId, error: err.message }));
  }
});

function tmpWavFor(filePath) {
  const hash = crypto.createHash('md5').update(filePath + Date.now()).digest('hex');
  return path.join(TEMP_DIR, `whisper-${hash}.wav`);
}

// 把任意音视频转成 16kHz mono PCM WAV
async function toWav(input, output) {
  await execFileAsync(
    getFfmpegPath(),
    ['-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', '-y', output],
    { maxBuffer: 1024 * 1024 * 8 }
  );
}

// 运行 whisper-cli, 收集 stdout 文本, 从 stderr 解析进度
function runWhisper(modelPath, wavPath, fileId) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child = spawn(getWhisperPath(), [
      '-m', modelPath,
      '-f', wavPath,
      '-nt',            // 不输出时间戳, 纯文本
      '-l', 'auto',     // 自动语言检测
      '--print-progress',
    ]);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      // whisper.cpp: "whisper_print_progress_callback: progress = 42%"
      const matches = s.match(/progress\s*=\s*(\d+)%/g);
      if (matches && matches.length) {
        const last = matches[matches.length - 1];
        const n = parseInt(last.match(/(\d+)%/)[1], 10);
        if (Number.isFinite(n)) post({ type: 'progress', fileId, progress: n });
      }
    });

    child.on('error', (err) => { child = null; reject(err); });
    child.on('close', (code) => {
      child = null;
      if (stopped) return reject(new Error('stopped'));
      if (code !== 0) return reject(new Error(`whisper exited ${code}: ${stderr.slice(-500)}`));
      resolve(stdout.trim());
    });
  });
}

async function run({ fileId, filePath, dbPath, modelPath, modelName }) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  if (!fs.existsSync(filePath)) {
    return post({ type: 'error', fileId, error: 'File not found: ' + filePath });
  }

  const wav = tmpWavFor(filePath);
  let text = '';
  try {
    post({ type: 'progress', fileId, progress: -1 }); // 转码中
    await toWav(filePath, wav);
    if (stopped) return;
    text = await runWhisper(modelPath, wav, fileId);
  } catch (err) {
    fs.rmSync(wav, { force: true });
    if (stopped || err.message === 'stopped') {
      return post({ type: 'error', fileId, error: 'stopped' });
    }
    return post({ type: 'error', fileId, error: err.message });
  } finally {
    fs.rmSync(wav, { force: true });
  }

  // 写库
  try {
    const db = new DatabaseSync(dbPath);
    try { db.exec('PRAGMA journal_mode=WAL'); } catch {}
    db.prepare(
      `INSERT INTO fm_transcripts (file_id, text, model, status, updated_at)
       VALUES (?, ?, ?, 'done', CURRENT_TIMESTAMP)
       ON CONFLICT(file_id) DO UPDATE SET
         text=excluded.text, model=excluded.model, status='done', updated_at=CURRENT_TIMESTAMP`
    ).run(fileId, text, modelName || '');
    db.close();
  } catch (err) {
    return post({ type: 'error', fileId, error: 'DB write failed: ' + err.message });
  }

  post({ type: 'done', fileId, length: text.length });
}
