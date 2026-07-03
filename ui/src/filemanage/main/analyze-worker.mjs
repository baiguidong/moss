/**
 * 本地照片分析 Worker (Electron utilityProcess 入口)
 *
 * 全本地、零网络, 为「AI 家庭相册」打底:
 *   1. 精确去重: 按 MD5(checksum) 分组, 保留最早一张, 其余标 is_duplicate
 *   2. 近似去重: dHash 感知哈希 + 汉明距离, 标记高度相似照片
 *   3. 质量评分: 清晰度(拉普拉斯方差) + 曝光(亮度), 归一到 0-1, 供「选优」
 *   4. 事件聚类: 按拍摄时间间隔(>EVENT_GAP)断点成事件/相册
 *
 * 消息协议:
 *   in : { type:'start', taskId, dbPath }
 *        { type:'stop' }
 *   out: { type:'progress', taskId, phase, processed, total }
 *        { type:'done', taskId, images, duplicates, events }
 *        { type:'error', taskId, error }
 */

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const EVENT_GAP_MS = 6 * 60 * 60 * 1000; // 6 小时无新照片 → 新事件
const NEAR_DUP_DISTANCE = 6;             // dHash 汉明距离阈值
let stopped = false;
const port = process.parentPort;

function post(msg) { port.postMessage(msg); }

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

// dHash: 9x8 灰度, 逐行比较相邻像素 → 64bit, 返回 16 位十六进制
async function computeDHash(sharp, filePath) {
  const buf = await sharp(filePath, { failOn: 'none' })
    .resize(9, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();
  let hash = 0n;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const left = buf[r * 9 + c];
      const right = buf[r * 9 + c + 1];
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, '0');
}

function hamming(a, b) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let count = 0;
  while (x > 0n) { count += Number(x & 1n); x >>= 1n; }
  return count;
}

// 质量评分: 清晰度(拉普拉斯方差) 0.6 + 曝光(亮度偏离中性) 0.4
async function computeQuality(sharp, filePath) {
  try {
    // 统一缩到 256, 灰度, 取原始像素 + 宽高
    const { data: px, info } = await sharp(filePath, { failOn: 'none' })
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info?.width;
    const h = info?.height;
    const n = px.length;
    if (!n) return null;

    // 亮度
    let sum = 0;
    for (let i = 0; i < n; i++) sum += px[i];
    const brightness = sum / n / 255; // 0-1
    const exposure = 1 - Math.min(1, Math.abs(brightness - 0.5) * 2);

    // 拉普拉斯方差(清晰度): 需要宽高才能做 2D 卷积; 拿不到则用一阶差分近似
    let sharpnessVar;
    if (w && h && w > 2 && h > 2) {
      let lapSum = 0, lapSqSum = 0, cnt = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const lap = 4 * px[i] - px[i - 1] - px[i + 1] - px[i - w] - px[i + w];
          lapSum += lap; lapSqSum += lap * lap; cnt++;
        }
      }
      const mean = lapSum / cnt;
      sharpnessVar = lapSqSum / cnt - mean * mean;
    } else {
      let dSum = 0, dSqSum = 0;
      for (let i = 1; i < n; i++) { const d = px[i] - px[i - 1]; dSum += d; dSqSum += d * d; }
      const mean = dSum / (n - 1);
      sharpnessVar = dSqSum / (n - 1) - mean * mean;
    }
    // 经验归一: 方差 ~ [0, 1000+], 用 500 作半饱和点
    const sharpness = sharpnessVar / (sharpnessVar + 500);

    return Math.max(0, Math.min(1, 0.6 * sharpness + 0.4 * exposure));
  } catch {
    return null;
  }
}

function dateMs(row) {
  const s = row.exif_date || row.created_at || row.modified_at;
  const t = s ? Date.parse(s) : NaN;
  return isNaN(t) ? null : t;
}

async function run({ taskId, dbPath }) {
  const sharp = await loadSharp();
  const db = new DatabaseSync(dbPath);
  try { db.exec('PRAGMA journal_mode=WAL'); } catch {}
  try { db.exec('PRAGMA synchronous=NORMAL'); } catch {}

  const images = db.prepare(
    `SELECT id, path, checksum, exif_date, created_at, modified_at, phash, quality_score
     FROM fm_original_files WHERE file_type = 'image' ORDER BY id`
  ).all();

  const total = images.length;
  let duplicates = 0;

  // ---- 1. 精确去重(checksum) ----
  const markDup = db.prepare('UPDATE fm_original_files SET is_duplicate = 1, duplicate_of = ? WHERE id = ?');
  const clearDup = db.prepare('UPDATE fm_original_files SET is_duplicate = 0, duplicate_of = NULL WHERE id = ?');
  const seenChecksum = new Map();
  for (const row of images) {
    if (row.checksum) {
      if (seenChecksum.has(row.checksum)) {
        try { markDup.run(seenChecksum.get(row.checksum), row.id); duplicates++; row._dup = true; } catch {}
      } else {
        seenChecksum.set(row.checksum, row.id);
      }
    }
  }

  // ---- 2. dHash 感知哈希 + 近似去重 ----
  const updPhash = db.prepare('UPDATE fm_original_files SET phash = ? WHERE id = ?');
  const updQuality = db.prepare('UPDATE fm_original_files SET quality_score = ? WHERE id = ?');
  const hashed = []; // { id, phash }
  let processed = 0;

  if (sharp) {
    for (const row of images) {
      if (stopped) break;
      processed++;
      if (row._dup) { /* 已是精确重复, 跳过昂贵计算 */ }
      else if (fs.existsSync(row.path)) {
        try {
          const ph = await computeDHash(sharp, row.path);
          updPhash.run(ph, row.id);
          row.phash = ph;
          // 近似去重: 与已有 hash 比较
          let near = null;
          for (const h of hashed) {
            if (hamming(ph, h.phash) <= NEAR_DUP_DISTANCE) { near = h.id; break; }
          }
          if (near) { markDup.run(near, row.id); duplicates++; row._dup = true; }
          else hashed.push({ id: row.id, phash: ph });

          const q = await computeQuality(sharp, row.path);
          if (q != null) { updQuality.run(q, row.id); row.quality_score = q; }
        } catch {}
      }
      if (processed % 10 === 0 || processed === total) {
        post({ type: 'progress', taskId, phase: 'analyze', processed, total });
      }
    }
  }

  // ---- 3. 事件聚类(仅非重复照片, 按时间) ----
  const nonDup = images.filter((r) => !r._dup);
  const withDate = nonDup.filter((r) => dateMs(r) != null).sort((a, b) => dateMs(a) - dateMs(b));

  // 重建事件: 清空旧 event_id 与 fm_events
  try { db.exec('UPDATE fm_original_files SET event_id = NULL'); } catch {}
  try { db.exec('DELETE FROM fm_events'); } catch {}
  const insEvent = db.prepare(
    'INSERT INTO fm_events (name, start_date, end_date, photo_count, cover_file_id) VALUES (?, ?, ?, ?, ?)'
  );
  const setEventId = db.prepare('UPDATE fm_original_files SET event_id = ? WHERE id = ?');

  let events = 0;
  let bucket = [];
  let lastMs = null;

  const flush = () => {
    if (bucket.length === 0) return;
    const startMs = dateMs(bucket[0]);
    const endMs = dateMs(bucket[bucket.length - 1]);
    // 封面: 质量最高的一张
    let cover = bucket[0];
    for (const r of bucket) if ((r.quality_score ?? 0) > (cover.quality_score ?? 0)) cover = r;
    const d = new Date(startMs);
    const name = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    const info = insEvent.run(name, new Date(startMs).toISOString(), new Date(endMs).toISOString(), bucket.length, cover.id);
    const eid = Number(info.lastInsertRowid);
    for (const r of bucket) setEventId.run(eid, r.id);
    events++;
    bucket = [];
  };

  for (const row of withDate) {
    const t = dateMs(row);
    if (lastMs != null && t - lastMs > EVENT_GAP_MS) flush();
    bucket.push(row);
    lastMs = t;
  }
  flush();

  try { db.close(); } catch {}
  post({ type: 'done', taskId, images: total, duplicates, events, stopped });
}
