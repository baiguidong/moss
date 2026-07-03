/**
 * 文件管理模块 - IPC 桥接
 * 注册所有文件管理相关的 IPC handlers
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, utilityProcess, shell } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { scanFile, scanDirectory, detectDuplicates } from './scanner.mjs';
import { organizeFiles, previewOrganize, organizeByDate } from './organizer.mjs';
import { analyzeFile, analyzeFilesBatch, recommendCategory, generateDescription } from './ai-analyzer.mjs';
import { allowMediaRoot } from './media-protocol.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 活跃的扫描任务 (用于停止)
const activeScans = new Map();
// 活跃的媒体增强 worker (缩略图/时长)
const activeMediaWorkers = new Map();
// 活跃的本地分析 worker (去重/质量/事件聚类)
const activeAnalyzeWorkers = new Map();
// 活跃的集锦短视频渲染 worker
const activeSlideshowWorkers = new Map();

// 文件类型映射
const FILE_TYPE_MAP = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif', '.heic', '.heif', '.raw', '.cr2', '.nef'],
  video: ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm', '.m4v', '.3gp', '.mpg', '.mpeg'],
  audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.ape', '.alac'],
  document: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.rtf', '.odt', '.ods', '.odp']
};

// MIME 类型映射
const MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown'
};

/**
 * 初始化文件管理数据库表
 */
const SESSION_DB_PATH = path.join(os.homedir(), '.moss', 'moss.db');

export function initFileManagerDatabase(db) {
  // 开启 WAL: 允许扫描 worker 与主进程并发读写同一个库
  try { db.exec('PRAGMA journal_mode=WAL'); } catch {}
  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    // 分割并执行每个语句
    const statements = schema.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      try {
        db.exec(stmt.trim());
      } catch (err) {
        // 忽略已存在的表错误
        if (!err.message.includes('already exists')) {
          console.error('[FileManager] Schema error:', err.message);
        }
      }
    }
  }
  // 增量迁移: 为已存在的 fm_original_files 补充分析列(幂等)
  migrateAddColumns(db, 'fm_original_files', {
    phash: 'TEXT',                // 感知哈希(近似去重)
    quality_score: 'REAL',        // 质量评分 0-1(选优用)
    event_id: 'INTEGER',          // 所属事件/相册
  });
}

// 幂等地为表补充缺失列
function migrateAddColumns(db, table, columns) {
  let existing;
  try {
    existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  } catch {
    return;
  }
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) {
      try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`); } catch (err) {
        console.error(`[FileManager] Migration add ${table}.${name} failed:`, err.message);
      }
    }
  }
}

/**
 * 获取文件类型
 */
function getFileType(extension) {
  const ext = extension.toLowerCase();
  for (const [type, extensions] of Object.entries(FILE_TYPE_MAP)) {
    if (extensions.includes(ext)) {
      return type;
    }
  }
  return 'other';
}

/**
 * 获取 MIME 类型
 */
function getMimeType(extension) {
  return MIME_MAP[extension.toLowerCase()] || 'application/octet-stream';
}

/**
 * 注册所有 IPC handlers
 */
export function registerFileManagerIpcHandlers(ipcMain, db) {
  console.log('[FileManager] Registering IPC handlers...');

  // 启动时把历史扫描根目录登记进流媒体协议白名单, 重启后媒体仍可访问
  try {
    const prevTasks = db.prepare('SELECT source_paths FROM fm_scan_tasks').all();
    for (const t of prevTasks) {
      try {
        for (const p of JSON.parse(t.source_paths || '[]')) allowMediaRoot(p);
      } catch {}
    }
  } catch (err) {
    console.warn('[FileManager] Failed to restore media roots:', err.message);
  }

  // ===== 扫描相关 =====

  // 开始扫描
  ipcMain.handle('fileManager:startScan', async (event, { paths, config }) => {
    // 登记扫描根目录到流媒体协议白名单
    for (const p of paths || []) allowMediaRoot(p);
    const stmt = db.prepare(`
      INSERT INTO fm_scan_tasks (name, source_paths, target_path, status, config)
      VALUES (?, ?, ?, 'pending', ?)
    `);
    stmt.run(
      config?.name || `Scan ${new Date().toLocaleString()}`,
      JSON.stringify(paths),
      config?.targetPath || '',
      JSON.stringify(config || {})
    );

    // 返回任务信息
    const task = db.prepare('SELECT * FROM fm_scan_tasks ORDER BY id DESC LIMIT 1').get();
    return task;
  });

  // 获取扫描进度
  ipcMain.handle('fileManager:getScanProgress', async (event, { taskId }) => {
    const task = db.prepare('SELECT * FROM fm_scan_tasks WHERE id = ?').get(taskId);
    return task;
  });

  // 执行扫描 (在 utilityProcess 里跑, 不阻塞主进程; 立即返回)
  ipcMain.handle('fileManager:executeScan', async (event, { taskId }) => {
    const task = db.prepare('SELECT * FROM fm_scan_tasks WHERE id = ?').get(taskId);
    if (!task) return { error: 'Task not found' };
    if (activeScans.has(taskId)) return { error: 'Scan already running' };

    const sourcePaths = JSON.parse(task.source_paths);
    const config = JSON.parse(task.config || '{}');

    db.prepare('UPDATE fm_scan_tasks SET status = ?, started_at = ? WHERE id = ?')
      .run('running', new Date().toISOString(), taskId);

    const sendProgress = (data) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send('fileManager:scanProgress', data);
      }
    };

    const workerPath = path.join(__dirname, 'scan-worker.mjs');
    let child;
    try {
      child = utilityProcess.fork(workerPath, [], { serviceName: 'moss-scan-worker' });
    } catch (err) {
      db.prepare('UPDATE fm_scan_tasks SET status = ? WHERE id = ?').run('error', taskId);
      return { error: 'Failed to start scan worker: ' + err.message };
    }

    activeScans.set(taskId, { child, stopped: false });

    child.on('message', (msg) => {
      if (!msg || msg.taskId !== taskId) return;

      if (msg.type === 'progress') {
        // 遍历阶段无法预知总数 -> indeterminate, UI 显示已处理计数
        sendProgress({
          taskId,
          progress: -1,
          indeterminate: true,
          totalFiles: 0,
          processedFiles: msg.processed,
          insertedFiles: msg.inserted,
          errorFiles: 0,
          currentFile: msg.currentFile,
          status: 'running',
        });
        db.prepare('UPDATE fm_scan_tasks SET processed_files = ? WHERE id = ?').run(msg.processed, taskId);
        return;
      }

      if (msg.type === 'done') {
        const status = msg.stopped ? 'cancelled' : 'completed';
        db.prepare('UPDATE fm_scan_tasks SET status = ?, progress = 100, total_files = ?, processed_files = ?, error_files = ?, completed_at = ? WHERE id = ?')
          .run(status, msg.total, msg.total, msg.errors || 0, new Date().toISOString(), taskId);
        sendProgress({
          taskId,
          progress: 100,
          indeterminate: false,
          totalFiles: msg.total,
          processedFiles: msg.total,
          insertedFiles: msg.inserted,
          errorFiles: msg.errors || 0,
          status,
        });
        activeScans.delete(taskId);
        try { child.kill(); } catch {}
        // 扫描完成后自动生成缩略图/时长(后台 worker, 不阻塞)
        if (!msg.stopped) startMediaEnrichment(taskId);
        return;
      }

      if (msg.type === 'error') {
        db.prepare('UPDATE fm_scan_tasks SET status = ? WHERE id = ?').run('error', taskId);
        sendProgress({ taskId, progress: 0, totalFiles: 0, processedFiles: 0, errorFiles: 0, status: 'error', error: msg.error });
        activeScans.delete(taskId);
        try { child.kill(); } catch {}
      }
    });

    child.on('exit', () => {
      // worker 异常退出时兜底清理
      if (activeScans.has(taskId)) {
        const t = db.prepare('SELECT status FROM fm_scan_tasks WHERE id = ?').get(taskId);
        if (t && t.status === 'running') {
          db.prepare('UPDATE fm_scan_tasks SET status = ? WHERE id = ?').run('error', taskId);
          sendProgress({ taskId, progress: 0, totalFiles: 0, processedFiles: 0, errorFiles: 0, status: 'error', error: 'Scan worker exited unexpectedly' });
        }
        activeScans.delete(taskId);
      }
    });

    child.postMessage({ type: 'start', taskId, sourcePaths, config, dbPath: SESSION_DB_PATH });

    return { success: true, message: 'Scan started' };
  });

  // 停止扫描
  ipcMain.handle('fileManager:stopScan', async (event, { taskId }) => {
    const entry = activeScans.get(taskId);
    if (entry?.child) {
      entry.stopped = true;
      try { entry.child.postMessage({ type: 'stop' }); } catch {}
      console.log('[FileManager] Stopping scan:', taskId);
    }
    db.prepare('UPDATE fm_scan_tasks SET status = ? WHERE id = ?').run('cancelling', taskId);
    return { success: true };
  });

  // ===== 缩略图 / 媒体增强 =====

  const sendThumbProgress = (data) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) win.webContents.send('fileManager:thumbnailProgress', data);
  };

  // 启动媒体增强 worker (缩略图 + 时长/尺寸 + 音频封面)
  function startMediaEnrichment(taskId) {
    if (activeMediaWorkers.has('global')) return; // 同一时刻只跑一个
    const workerPath = path.join(__dirname, 'media-worker.mjs');
    let child;
    try {
      child = utilityProcess.fork(workerPath, [], { serviceName: 'moss-media-worker' });
    } catch (err) {
      console.error('[FileManager] Failed to start media worker:', err.message);
      return;
    }
    activeMediaWorkers.set('global', child);

    child.on('message', (msg) => {
      if (!msg) return;
      if (msg.type === 'progress') {
        sendThumbProgress({ processed: msg.processed, total: msg.total, currentFile: msg.currentFile, status: 'running' });
      } else if (msg.type === 'done') {
        sendThumbProgress({ processed: msg.processed, total: msg.processed, status: 'completed' });
        activeMediaWorkers.delete('global');
        try { child.kill(); } catch {}
        // 缩略图就绪后, 自动跑本地分析(去重/质量/事件)
        startAnalysis(taskId);
      } else if (msg.type === 'error') {
        sendThumbProgress({ status: 'error', error: msg.error });
        activeMediaWorkers.delete('global');
        try { child.kill(); } catch {}
      }
    });
    child.on('exit', () => { activeMediaWorkers.delete('global'); });

    child.postMessage({ type: 'start', taskId: taskId ?? 0, dbPath: SESSION_DB_PATH });
  }

  // 手动触发缩略图生成(补缺/重试)
  ipcMain.handle('fileManager:generateThumbnails', async () => {
    startMediaEnrichment(0);
    return { success: true };
  });

  // ===== 本地照片分析 (去重 / 质量 / 事件聚类) =====

  const sendAnalyzeProgress = (data) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) win.webContents.send('fileManager:analyzeProgress', data);
  };

  function startAnalysis(taskId) {
    if (activeAnalyzeWorkers.has('global')) return;
    const workerPath = path.join(__dirname, 'analyze-worker.mjs');
    let child;
    try {
      child = utilityProcess.fork(workerPath, [], { serviceName: 'moss-analyze-worker' });
    } catch (err) {
      console.error('[FileManager] Failed to start analyze worker:', err.message);
      return;
    }
    activeAnalyzeWorkers.set('global', child);

    child.on('message', (msg) => {
      if (!msg) return;
      if (msg.type === 'progress') {
        sendAnalyzeProgress({ processed: msg.processed, total: msg.total, phase: msg.phase, status: 'running' });
      } else if (msg.type === 'done') {
        sendAnalyzeProgress({ status: 'completed', images: msg.images, duplicates: msg.duplicates, events: msg.events });
        activeAnalyzeWorkers.delete('global');
        try { child.kill(); } catch {}
      } else if (msg.type === 'error') {
        sendAnalyzeProgress({ status: 'error', error: msg.error });
        activeAnalyzeWorkers.delete('global');
        try { child.kill(); } catch {}
      }
    });
    child.on('exit', () => { activeAnalyzeWorkers.delete('global'); });

    child.postMessage({ type: 'start', taskId: taskId ?? 0, dbPath: SESSION_DB_PATH });
  }

  // 手动触发本地分析
  ipcMain.handle('fileManager:analyzePhotos', async () => {
    startAnalysis(0);
    return { success: true };
  });

  // 获取事件/相册列表 (含封面)
  ipcMain.handle('fileManager:getEvents', async () => {
    return db.prepare(
      `SELECT e.id, e.name, e.start_date, e.end_date, e.photo_count, e.cover_file_id, e.ai_named,
              c.path AS cover_path, c.thumbnail_path AS cover_thumbnail
       FROM fm_events e
       LEFT JOIN fm_original_files c ON c.id = e.cover_file_id
       ORDER BY e.start_date DESC`
    ).all();
  });

  // 获取某事件下的照片
  ipcMain.handle('fileManager:getEventFiles', async (event, { eventId }) => {
    return db.prepare(
      `SELECT * FROM fm_original_files WHERE event_id = ? AND is_duplicate = 0
       ORDER BY COALESCE(exif_date, created_at)`
    ).all(eventId);
  });

  // 获取重复照片分组
  ipcMain.handle('fileManager:getDuplicates', async () => {
    return db.prepare(
      `SELECT id, path, filename, thumbnail_path, duplicate_of, quality_score
       FROM fm_original_files WHERE is_duplicate = 1 AND duplicate_of IS NOT NULL
       ORDER BY duplicate_of, id`
    ).all();
  });

  // ===== 集锦短视频导出 =====

  const sendSlideshowProgress = (data) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) win.webContents.send('fileManager:slideshowProgress', data);
  };

  // 渲染一段集锦短视频 (ffmpeg: Ken Burns + 转场 + 背景音乐)
  ipcMain.handle('fileManager:renderSlideshow', async (event, options = {}) => {
    const taskId = `slideshow-${Date.now()}`;

    // 解析待渲染照片: 优先用显式 fileIds, 否则用某事件下的选优照片
    let images = Array.isArray(options.images) ? options.images.slice() : [];
    if (images.length === 0 && Array.isArray(options.fileIds) && options.fileIds.length > 0) {
      const rows = db.prepare(
        `SELECT path FROM fm_original_files WHERE id IN (${options.fileIds.map(() => '?').join(',')})`
      ).all(...options.fileIds);
      images = rows.map((r) => r.path);
    } else if (images.length === 0 && options.eventId != null) {
      const rows = db.prepare(
        `SELECT path FROM fm_original_files
         WHERE event_id = ? AND is_duplicate = 0 AND file_type = 'image'
         ORDER BY quality_score DESC NULLS LAST, COALESCE(exif_date, created_at)
         LIMIT ?`
      ).all(options.eventId, options.maxPhotos || 30);
      images = rows.map((r) => r.path);
    }

    images = images.filter((p) => p && fs.existsSync(p));
    if (images.length === 0) {
      return { error: '没有可用于渲染的照片' };
    }

    // 背景音乐: 显式 audio 路径, 或从音频库取一首
    let audio = options.audio;
    if (!audio && options.audioId != null) {
      const a = db.prepare('SELECT path FROM fm_original_files WHERE id = ?').get(options.audioId);
      if (a?.path && fs.existsSync(a.path)) audio = a.path;
    }

    // 输出目录: ~/.moss/exports
    const exportsDir = path.join(os.homedir(), '.moss', 'exports');
    try { fs.mkdirSync(exportsDir, { recursive: true }); } catch {}
    const output = options.output || path.join(exportsDir, `highlight-${Date.now()}.mp4`);

    const workerPath = path.join(__dirname, 'slideshow.mjs');
    let child;
    try {
      child = utilityProcess.fork(workerPath, [], { serviceName: 'moss-slideshow-worker' });
    } catch (err) {
      return { error: '无法启动渲染进程: ' + err.message };
    }
    activeSlideshowWorkers.set(taskId, child);

    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        activeSlideshowWorkers.delete(taskId);
        try { child.kill(); } catch {}
        resolve(result);
      };

      child.on('message', (msg) => {
        if (!msg || msg.taskId !== taskId) return;
        if (msg.type === 'progress') {
          sendSlideshowProgress({ taskId, percent: msg.percent, outTime: msg.outTime, status: 'running' });
        } else if (msg.type === 'done') {
          sendSlideshowProgress({ taskId, percent: 100, status: 'completed', output: msg.output });
          finish({ success: true, output: msg.output });
        } else if (msg.type === 'error') {
          sendSlideshowProgress({ taskId, status: 'error', error: msg.error });
          finish({ error: msg.error });
        }
      });
      child.on('exit', () => {
        if (!settled) {
          sendSlideshowProgress({ taskId, status: 'error', error: '渲染进程意外退出' });
          finish({ error: '渲染进程意外退出' });
        }
      });

      child.postMessage({
        type: 'start',
        taskId,
        options: {
          images,
          audio,
          output,
          width: options.width,
          height: options.height,
          perImage: options.perImage,
          transition: options.transition,
          fps: options.fps,
        },
      });
    });
  });

  // 列出已生成的集锦视频 (~/.moss/exports/*.mp4), 最新在前
  ipcMain.handle('fileManager:listSlideshows', async () => {
    const exportsDir = path.join(os.homedir(), '.moss', 'exports');
    let entries;
    try {
      entries = await fsp.readdir(exportsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.mp4')) continue;
      const full = path.join(exportsDir, e.name);
      try {
        const st = await fsp.stat(full);
        files.push({ path: full, name: e.name, size: st.size, mtime: st.mtimeMs });
      } catch {}
    }
    files.sort((a, b) => b.mtime - a.mtime);
    return files;
  });

  // 取消渲染
  ipcMain.handle('fileManager:cancelSlideshow', async (event, { taskId } = {}) => {
    const child = taskId ? activeSlideshowWorkers.get(taskId) : null;
    if (child) {
      try { child.postMessage({ type: 'stop' }); } catch {}
      return { success: true };
    }
    // 无 taskId 时取消全部
    for (const c of activeSlideshowWorkers.values()) {
      try { c.postMessage({ type: 'stop' }); } catch {}
    }
    return { success: true };
  });

  // ===== 文件操作 =====

  // 读取文件内容 (返回 base64 或 data URL)
  ipcMain.handle('fileManager:readFile', async (event, { filePath, asDataUrl }) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { error: 'File not found' };
      }

      const MAX_READ_BYTES = 100 * 1024 * 1024; // 100MB
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) {
        return { error: 'Not a file' };
      }
      if (stat.size > MAX_READ_BYTES) {
        return { error: `File too large to load (${Math.round(stat.size / 1024 / 1024)}MB, max 100MB)` };
      }

      const content = await fsp.readFile(filePath);

      if (asDataUrl) {
        // 获取 MIME 类型
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.bmp': 'image/bmp',
          '.webp': 'image/webp',
          '.svg': 'image/svg+xml',
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
        };
        const mimeType = mimeTypes[ext] || 'application/octet-stream';
        return { dataUrl: `data:${mimeType};base64,${content.toString('base64')}` };
      }

      return { data: content.toString('base64') };
    } catch (err) {
      return { error: err.message };
    }
  });

  // 在系统文件管理器中定位文件 (Finder/资源管理器高亮该文件)
  ipcMain.handle('fileManager:revealInFolder', async (event, { filePath }) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在: ' + (filePath || '') };
    }
    try {
      shell.showItemInFolder(path.resolve(filePath));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 用系统默认程序打开文件
  ipcMain.handle('fileManager:openFile', async (event, { filePath }) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在: ' + (filePath || '') };
    }
    try {
      const err = await shell.openPath(path.resolve(filePath));
      if (err) return { success: false, error: err };
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 获取文件列表
  ipcMain.handle('fileManager:getFiles', async (event, { filter }) => {
    let query = 'SELECT * FROM fm_original_files WHERE 1=1';
    const params = [];

    if (filter?.fileType) {
      query += ' AND file_type = ?';
      params.push(filter.fileType);
    }

    if (filter?.category) {
      query += ' AND id IN (SELECT original_id FROM fm_organized_files WHERE category = ?)';
      params.push(filter.category);
    }

    if (filter?.isEncrypted) {
      query += ' AND is_encrypted = 1';
    }

    const MAX_LIMIT = 10000;
    const DEFAULT_LIMIT = 5000;
    const rawLimit = Number(filter?.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;
    query += ' LIMIT ?';
    params.push(limit);

    const rawOffset = Number(filter?.offset);
    if (Number.isFinite(rawOffset) && rawOffset > 0) {
      query += ' OFFSET ?';
      params.push(rawOffset);
    }

    const stmt = db.prepare(query);
    return stmt.all(...params);
  });

  // 获取文件详情
  ipcMain.handle('fileManager:getFileDetail', async (event, { fileId }) => {
    const file = db.prepare('SELECT * FROM fm_original_files WHERE id = ?').get(fileId);
    return file;
  });

  // 获取音频曲目(含 ID3 元数据 + 封面)
  ipcMain.handle('fileManager:getAudioTracks', async () => {
    return db.prepare(
      `SELECT f.id, f.path, f.filename, f.duration, f.thumbnail_path,
              m.title, m.artist, m.album, m.genre, m.track, m.year, m.cover_path
       FROM fm_original_files f
       LEFT JOIN fm_audio_meta m ON m.file_id = f.id
       WHERE f.file_type = 'audio'
       ORDER BY m.artist, m.album, m.track, f.filename
       LIMIT 10000`
    ).all();
  });

  // 获取分类列表
  ipcMain.handle('fileManager:getCategories', async (event) => {
    const categories = db.prepare('SELECT * FROM fm_categories ORDER BY sort_order').all();
    return categories;
  });

  // 获取扫描任务列表
  ipcMain.handle('fileManager:getScanTasks', async (event) => {
    const tasks = db.prepare('SELECT * FROM fm_scan_tasks ORDER BY created_at DESC').all();
    return tasks;
  });

  // 获取统计信息
  ipcMain.handle('fileManager:getStats', async (event) => {
    const totalFiles = db.prepare('SELECT COUNT(*) as count FROM fm_original_files').get()?.count || 0;
    const organizedFiles = db.prepare('SELECT COUNT(*) as count FROM fm_organized_files').get()?.count || 0;
    const encryptedFiles = db.prepare('SELECT COUNT(*) as count FROM fm_encrypted_vault').get()?.count || 0;

    const byType = db.prepare('SELECT file_type, COUNT(*) as count FROM fm_original_files GROUP BY file_type').all();

    return { totalFiles, organizedFiles, encryptedFiles, byType };
  });

  // ===== 整理相关 =====

  // 预览整理结果
  ipcMain.handle('fileManager:previewOrganize', async (event, { fileIds, targetPath }) => {
    if (!Array.isArray(fileIds) || fileIds.length === 0) return [];
    const files = db.prepare(`SELECT * FROM fm_original_files WHERE id IN (${fileIds.map(() => '?').join(',')})`).all(...fileIds);
    const categories = db.prepare('SELECT * FROM fm_categories').all();

    const preview = previewOrganize(files, targetPath, categories);
    return preview;
  });

  // 执行整理
  ipcMain.handle('fileManager:organizeFiles', async (event, { fileIds, targetPath, options }) => {
    if (!Array.isArray(fileIds) || fileIds.length === 0) return { results: [] };
    const files = db.prepare(`SELECT * FROM fm_original_files WHERE id IN (${fileIds.map(() => '?').join(',')})`).all(...fileIds);
    const categories = db.prepare('SELECT * FROM fm_categories').all();

    const result = await organizeFiles(files, targetPath, categories, options || {}, (processed, total) => {
      event.sender.send('fileManager:organizeProgress', {
        processed,
        total,
        progress: Math.round((processed / total) * 100)
      });
    });

    // 记录整理结果到数据库
    for (const item of result.results) {
      const file = files.find(f => f.path === item.originalPath);
      if (file) {
        db.prepare(`
          INSERT INTO fm_organized_files (original_id, organized_path, category, created_at)
          VALUES (?, ?, ?, ?)
        `).run(file.id, item.organizedPath, item.category, new Date().toISOString());
      }
    }

    return result;
  });

  // 按时间整理
  ipcMain.handle('fileManager:organizeByDate', async (event, { fileIds, targetPath, options }) => {
    if (!Array.isArray(fileIds) || fileIds.length === 0) return [];
    const files = db.prepare(`SELECT * FROM fm_original_files WHERE id IN (${fileIds.map(() => '?').join(',')})`).all(...fileIds);

    const preview = organizeByDate(files, targetPath, options);

    // 执行复制
    for (const item of preview) {
      const destDir = path.dirname(item.organizedPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      if (!options?.dryRun) {
        await fsp.copyFile(item.file.path, item.organizedPath);

        // 记录到数据库
        db.prepare(`
          INSERT INTO fm_organized_files (original_id, organized_path, category, created_at)
          VALUES (?, ?, ?, ?)
        `).run(item.file.id, item.organizedPath, `${item.year}/${item.month}`, new Date().toISOString());
      }
    }

    return { success: true, count: preview.length };
  });

  // ===== AI 分析相关 =====

  // 分析单个文件
  ipcMain.handle('fileManager:analyzeFile', async (event, { fileId }) => {
    const file = db.prepare('SELECT * FROM fm_original_files WHERE id = ?').get(fileId);
    if (!file) return { error: 'File not found' };

    const result = {
      file_type: file.file_type,
      analysis: {
        description: `${file.filename} - ${file.file_type} file`,
        confidence: 0.5,
      }
    };

    db.prepare('UPDATE fm_original_files SET ai_description = ? WHERE id = ?')
      .run(JSON.stringify(result.analysis), fileId);

    return result;
  });

  // 批量分析文件
  ipcMain.handle('fileManager:analyzeFilesBatch', async (event, { fileIds }) => {
    if (!Array.isArray(fileIds) || fileIds.length === 0) return { success: true, count: 0 };
    const files = db.prepare(`SELECT * FROM fm_original_files WHERE id IN (${fileIds.map(() => '?').join(',')})`).all(...fileIds);

    let processed = 0;
    const results = [];

    for (const file of files) {
      const result = {
        fileId: file.id,
        analysis: {
          description: `${file.filename} - ${file.file_type} file`,
          confidence: 0.5,
        }
      };

      results.push(result);
      processed++;

      event.sender.send('fileManager:analysisProgress', {
        processed,
        total: fileIds.length,
        progress: Math.round((processed / fileIds.length) * 100)
      });

      db.prepare('UPDATE fm_original_files SET ai_description = ? WHERE id = ?')
        .run(JSON.stringify(result.analysis), file.id);
    }

    return { success: true, count: results.length };
  });

  // 获取 AI 分析建议的分类
  ipcMain.handle('fileManager:getAICategoryRecommendation', async (event, { fileId }) => {
    const file = db.prepare('SELECT * FROM fm_original_files WHERE id = ?').get(fileId);
    if (!file) return { error: 'File not found' };

    const categories = db.prepare('SELECT * FROM fm_categories').all();

    let recommendedCategory = categories.find(c => c.name === file.file_type);
    if (!recommendedCategory) {
      recommendedCategory = categories.find(c => c.name === '其他');
    }

    return {
      fileId,
      recommendedCategory,
      confidence: 0.7
    };
  });

  // ===== 加密相关 =====

  // 获取加密文件列表
  ipcMain.handle('fileManager:getEncryptedFiles', async (event) => {
    const files = db.prepare('SELECT * FROM fm_encrypted_vault ORDER BY created_at DESC').all();
    return files;
  });

  // 加密文件
  ipcMain.handle('fileManager:encryptFile', async (event, { fileId, password, hint }) => {
    if (typeof password !== 'string' || password.length === 0) return { error: 'Password is required' };
    const file = db.prepare('SELECT * FROM fm_original_files WHERE id = ?').get(fileId);
    if (!file) return { error: 'File not found' };

    try {
      const vaultDir = path.join(process.env.MOSS_HOME || path.join(os.homedir(), '.moss'), 'vault');
      if (!fs.existsSync(vaultDir)) {
        fs.mkdirSync(vaultDir, { recursive: true });
      }

      const encryptedPath = path.join(vaultDir, `${crypto.randomBytes(16).toString('hex')}.enc`);

      const salt = crypto.randomBytes(16);
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      const iv = crypto.randomBytes(12);

      const content = await fsp.readFile(file.path);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const output = Buffer.concat([salt, iv, authTag, encrypted]);
      await fsp.writeFile(encryptedPath, output);

      db.prepare(`
        INSERT INTO fm_encrypted_vault (original_id, encrypted_path, original_filename, file_type, original_size, encrypted_size, password_hint)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, encryptedPath, file.filename, file.file_type, file.size, output.length, hint || '');

      db.prepare('UPDATE fm_original_files SET is_encrypted = 1 WHERE id = ?').run(fileId);

      return { success: true, encryptedPath };
    } catch (err) {
      return { error: `Encryption failed: ${err.message}` };
    }
  });

  // 解密文件
  ipcMain.handle('fileManager:decryptFile', async (event, { encryptedId, password }) => {
    if (typeof password !== 'string' || password.length === 0) {
      return { error: 'Password is required' };
    }
    const encrypted = db.prepare('SELECT * FROM fm_encrypted_vault WHERE id = ?').get(encryptedId);
    if (!encrypted) return { error: 'Encrypted file not found' };

    try {
      const content = await fsp.readFile(encrypted.encrypted_path);

      const salt = content.subarray(0, 16);
      const iv = content.subarray(16, 28);
      const authTag = content.subarray(28, 44);
      const encryptedData = content.subarray(44);

      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

      const tempDir = path.join(process.env.MOSS_HOME || path.join(os.homedir(), '.moss'), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempPath = path.join(tempDir, path.basename(encrypted.original_filename));
      await fsp.writeFile(tempPath, decrypted);

      db.prepare('UPDATE fm_encrypted_vault SET last_accessed = ? WHERE id = ?')
        .run(new Date().toISOString(), encryptedId);

      return { success: true, tempPath };
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return { error: 'Decryption failed: encrypted file is missing' };
      }
      return { error: 'Decryption failed: wrong password or corrupted file' };
    }
  });

  console.log('[FileManager] IPC handlers registered');
}

export default {
  initFileManagerDatabase,
  registerFileManagerIpcHandlers
};
