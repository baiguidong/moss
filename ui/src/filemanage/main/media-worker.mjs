/**
 * 媒体增强 Worker (Electron utilityProcess 入口)
 *
 * 扫描完成后在独立进程里跑, 不阻塞 UI:
 *   - 图片: sharp 生成 256 缩略图 + 宽高
 *   - 视频: ffprobe 取时长/宽高 + ffmpeg 抽帧缩略图
 *   - 音频: music-metadata 取时长 + 封面(写为缩略图)
 *
 * 消息协议:
 *   in : { type:'start', taskId, dbPath, limit? }
 *        { type:'stop' }
 *   out: { type:'progress', taskId, processed, total, currentFile }
 *        { type:'done', taskId, processed, errors }
 *        { type:'error', taskId, error }
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { probe, extractFrame } from './ffmpeg.mjs';

const THUMB_DIR = path.join(os.homedir(), '.moss', 'thumbnails');
const THUMB_SIZE = 320;
let stopped = false;
const port = process.parentPort;

function post(msg) { port.postMessage(msg); }

function thumbPathFor(originalPath) {
  const hash = crypto.createHash('md5').update(originalPath).digest('hex');
  return path.join(THUMB_DIR, `${hash}.jpg`);
}

port.on('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'stop') { stopped = true; return; }
  if (msg.type === 'start') {
    run(msg).catch((err) => post({ type: 'error', taskId: msg.taskId, error: err.message }));
  }
});

async function loadSharp() {
  try { return (await import('sharp')).default; } catch { return null; }
}
async function loadMusicMetadata() {
  try { return await import('music-metadata'); } catch { return null; }
}

async function run({ taskId, dbPath, limit = 0 }) {
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  const db = new DatabaseSync(dbPath);
  try { db.exec('PRAGMA journal_mode=WAL'); } catch {}
  try { db.exec('PRAGMA synchronous=NORMAL'); } catch {}

  // 待处理: 缩略图缺失 或 (视频/音频)时长缺失
  const where = `(thumbnail_path IS NULL OR thumbnail_path = '')
                 AND file_type IN ('image','video','audio')`;
  const rows = db.prepare(
    `SELECT id, path, file_type FROM fm_original_files WHERE ${where}${limit ? ' LIMIT ' + Number(limit) : ''}`
  ).all();

  const total = rows.length;
  const sharp = await loadSharp();
  const mm = await loadMusicMetadata();

  const updThumb = db.prepare('UPDATE fm_original_files SET thumbnail_path = ?, width = COALESCE(?, width), height = COALESCE(?, height) WHERE id = ?');
  const updMedia = db.prepare('UPDATE fm_original_files SET thumbnail_path = COALESCE(?, thumbnail_path), duration = COALESCE(?, duration), width = COALESCE(?, width), height = COALESCE(?, height) WHERE id = ?');
  const upsertAudioMeta = db.prepare(
    `INSERT INTO fm_audio_meta (file_id, title, artist, album, genre, track, year, cover_path, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(file_id) DO UPDATE SET
       title=excluded.title, artist=excluded.artist, album=excluded.album,
       genre=excluded.genre, track=excluded.track, year=excluded.year,
       cover_path=COALESCE(excluded.cover_path, fm_audio_meta.cover_path),
       updated_at=CURRENT_TIMESTAMP`
  );

  let processed = 0;
  let errors = 0;

  for (const row of rows) {
    if (stopped) break;
    processed++;
    try {
      if (!fs.existsSync(row.path)) { continue; }
      const tp = thumbPathFor(row.path);

      if (row.file_type === 'image') {
        if (sharp) {
          let width = null, height = null;
          try {
            const meta = await sharp(row.path).metadata();
            width = meta.width ?? null;
            height = meta.height ?? null;
          } catch {}
          try {
            await sharp(row.path, { failOn: 'none' })
              .rotate() // 按 EXIF 方向自动旋正
              .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toFile(tp);
            updThumb.run(tp, width, height, row.id);
          } catch (err) {
            // 缩略图失败仍写尺寸
            updThumb.run(null, width, height, row.id);
            errors++;
          }
        }
      } else if (row.file_type === 'video') {
        const info = await probe(row.path);
        let madeThumb = null;
        const at = info.duration && info.duration > 2 ? Math.min(info.duration * 0.1, 5) : 0;
        const ok = await extractFrame(row.path, tp, { time: at, width: 480 });
        if (ok) madeThumb = tp;
        updMedia.run(madeThumb, info.duration ?? null, info.width ?? null, info.height ?? null, row.id);
      } else if (row.file_type === 'audio') {
        let duration = null, cover = null;
        let title = null, artist = null, album = null, genre = null, track = null, year = null;
        if (mm) {
          try {
            const meta = await mm.parseFile(row.path, { duration: true });
            duration = meta.format?.duration ? Math.round(meta.format.duration) : null;
            const c = meta.common || {};
            title = c.title ?? null;
            artist = c.artist ?? (Array.isArray(c.artists) ? c.artists[0] : null) ?? null;
            album = c.album ?? null;
            genre = Array.isArray(c.genre) ? c.genre[0] : (c.genre ?? null);
            track = c.track?.no ?? null;
            year = c.year ?? null;
            const pic = c.picture?.[0];
            if (pic?.data) {
              await fsp.writeFile(tp, Buffer.from(pic.data));
              cover = tp;
            }
          } catch {}
        }
        if (!duration) {
          const info = await probe(row.path);
          duration = info.duration ?? null;
        }
        updMedia.run(cover, duration, null, null, row.id);
        try { upsertAudioMeta.run(row.id, title, artist, album, genre, track, year, cover); } catch {}
      }
    } catch (err) {
      errors++;
    }

    if (processed % 5 === 0 || processed === total) {
      post({ type: 'progress', taskId, processed, total, currentFile: row.path });
    }
  }

  try { db.close(); } catch {}
  post({ type: 'done', taskId, processed, errors, stopped });
}
