/**
 * 扫描 Worker (Electron utilityProcess 入口)
 *
 * 在独立进程里跑, 不阻塞主进程/UI。
 * - 流式递归遍历目录(边走边写, 内存有界)
 * - 事务批量 INSERT OR IGNORE (复用 prepared statement)
 * - 实时回报进度, 支持中途停止
 *
 * 消息协议:
 *   in : { type:'start', taskId, sourcePaths, config, dbPath }
 *        { type:'stop' }
 *   out: { type:'progress', taskId, processed, inserted, currentFile, phase }
 *        { type:'done', taskId, total, inserted, errors }
 *        { type:'error', taskId, error }
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getFileType, getMimeType } from './scanner.mjs';

const BATCH_SIZE = 200;
let stopped = false;

const port = process.parentPort;

function post(msg) {
  port.postMessage(msg);
}

port.on('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'stop') {
    stopped = true;
    return;
  }
  if (msg.type === 'start') {
    runScan(msg).catch((err) => {
      post({ type: 'error', taskId: msg.taskId, error: err.message });
    });
  }
});

async function runScan({ taskId, sourcePaths, config = {}, dbPath }) {
  const db = new DatabaseSync(dbPath);
  // WAL: 允许 worker 与主进程并发读写同一个库
  try { db.exec('PRAGMA journal_mode=WAL'); } catch {}
  try { db.exec('PRAGMA synchronous=NORMAL'); } catch {}

  const insert = db.prepare(`
    INSERT OR IGNORE INTO fm_original_files
    (path, filename, extension, file_type, mime_type, size, created_at, modified_at, scan_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let processed = 0;
  let inserted = 0;
  let errors = 0;
  let batch = [];
  const scanDate = new Date().toISOString();

  const flush = () => {
    if (batch.length === 0) return;
    db.exec('BEGIN');
    try {
      for (const f of batch) {
        const r = insert.run(
          f.path, f.filename, f.extension, f.file_type, f.mime_type,
          f.size, f.created_at, f.modified_at, scanDate
        );
        if (r.changes > 0) inserted++;
      }
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch {}
      errors += batch.length;
    }
    batch = [];
  };

  const fileTypes = Array.isArray(config.fileTypes) && config.fileTypes.length ? config.fileTypes : null;
  const recursive = config.recursive !== false;
  const maxSize = config.maxSize || 0;

  async function walk(dir) {
    if (stopped) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      errors++;
      return;
    }
    for (const entry of entries) {
      if (stopped) return;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (recursive) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name);
      const fileType = getFileType(ext);
      if (fileTypes && !fileTypes.includes(fileType)) continue;

      let stats;
      try {
        stats = await fsp.stat(full);
      } catch {
        errors++;
        continue;
      }
      if (maxSize && stats.size > maxSize) continue;

      batch.push({
        path: full,
        filename: entry.name,
        extension: ext,
        file_type: fileType,
        mime_type: getMimeType(ext),
        size: stats.size,
        created_at: stats.birthtime.toISOString(),
        modified_at: stats.mtime.toISOString(),
      });
      processed++;

      if (batch.length >= BATCH_SIZE) {
        flush();
        post({ type: 'progress', taskId, processed, inserted, currentFile: full, phase: 'scanning' });
      }
    }
  }

  for (const sourcePath of sourcePaths) {
    if (stopped) break;
    try {
      const st = await fsp.stat(sourcePath);
      if (st.isDirectory()) await walk(sourcePath);
    } catch {
      errors++;
    }
  }

  flush();

  try { db.close(); } catch {}

  post({
    type: 'done',
    taskId,
    total: processed,
    inserted,
    errors,
    stopped,
  });
}
