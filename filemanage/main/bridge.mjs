/**
 * 文件管理模块 - IPC 桥接
 * 注册所有文件管理相关的 IPC handlers
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BrowserWindow } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { scanFile, scanDirectory, detectDuplicates } from './scanner.mjs';
import { organizeFiles, previewOrganize, organizeByDate } from './organizer.mjs';
import { analyzeFile, analyzeFilesBatch, recommendCategory, generateDescription } from './ai-analyzer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 活跃的扫描任务 (用于停止)
const activeScans = new Map();

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
export function initFileManagerDatabase(db) {
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

  // ===== 扫描相关 =====

  // 开始扫描
  ipcMain.handle('fileManager:startScan', async (event, { paths, config }) => {
    const taskId = Date.now();
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

  // 执行扫描 (异步执行，立即返回)
  ipcMain.handle('fileManager:executeScan', async (event, { taskId }) => {
    const task = db.prepare('SELECT * FROM fm_scan_tasks WHERE id = ?').get(taskId);
    if (!task) return { error: 'Task not found' };

    const sourcePaths = JSON.parse(task.source_paths);
    const config = JSON.parse(task.config || '{}');

    // 检查是否已经在运行
    if (activeScans.has(taskId)) {
      return { error: 'Scan already running' };
    }

    // 创建停止标志
    const scanController = { stopped: false };
    activeScans.set(taskId, scanController);

    // 更新状态为 running
    db.prepare('UPDATE fm_scan_tasks SET status = ?, started_at = ? WHERE id = ?')
      .run('running', new Date().toISOString(), taskId);

    // 获取主窗口
    const mainWindow = BrowserWindow.getAllWindows()[0];

    // 异步执行扫描
    (async () => {
      let totalFiles = 0;
      let processedFiles = 0;
      let errorFiles = 0;

      // 发送进度辅助函数
      const sendProgress = (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('fileManager:scanProgress', data);
        }
      };

      for (const sourcePath of sourcePaths) {
        if (scanController.stopped) break;
        if (!fs.existsSync(sourcePath)) continue;

        try {
          // 递归扫描目录
          const files = [];
          const errors = [];

          async function scanRecursive(currentPath) {
            if (scanController.stopped) return;

            try {
              const entries = await fsp.readdir(currentPath, { withFileTypes: true });

              for (const entry of entries) {
                if (scanController.stopped) break;

                const fullPath = path.join(currentPath, entry.name);

                // 跳过隐藏文件和目录
                if (entry.name.startsWith('.')) continue;

                if (entry.isDirectory()) {
                  if (config.recursive !== false) {
                    await scanRecursive(fullPath);
                  }
                } else if (entry.isFile()) {
                  const ext = path.extname(entry.name);
                  const fileType = getFileType(ext);

                  // 文件类型筛选
                  if (config.fileTypes && config.fileTypes.length > 0) {
                    if (!config.fileTypes.includes(fileType)) continue;
                  }

                  try {
                    const stats = await fsp.stat(fullPath);
                    const fileInfo = {
                      path: fullPath,
                      filename: entry.name,
                      extension: ext,
                      file_type: fileType,
                      mime_type: getMimeType(ext),
                      size: stats.size,
                      created_at: stats.birthtime.toISOString(),
                      modified_at: stats.mtime.toISOString(),
                      scan_date: new Date().toISOString(),
                    };

                    files.push(fileInfo);
                    processedFiles++;

                    // 每 10 个文件发送一次进度
                    if (processedFiles % 10 === 0) {
                      sendProgress({
                        taskId,
                        progress: 0,
                        totalFiles: 0,
                        processedFiles,
                        errorFiles,
                        currentFile: fullPath,
                        status: 'running'
                      });
                    }
                  } catch (err) {
                    errors.push({ path: fullPath, error: err.message });
                    errorFiles++;
                  }
                }
              }
            } catch (err) {
              errors.push({ path: currentPath, error: err.message });
            }
          }

          await scanRecursive(sourcePath);

          if (scanController.stopped) {
            // 扫描被停止
            db.prepare('UPDATE fm_scan_tasks SET status = ?, processed_files = ? WHERE id = ?')
              .run('cancelled', processedFiles, taskId);

            sendProgress({
              taskId,
              progress: 0,
              totalFiles: 0,
              processedFiles,
              errorFiles,
              status: 'cancelled'
            });
            return;
          }

          totalFiles = files.length;

          // 发送进度: 正在写入数据库
          sendProgress({
            taskId,
            progress: 50,
            totalFiles,
            processedFiles,
            errorFiles,
            status: 'running'
          });

          // 插入文件记录到数据库
          for (const file of files) {
            if (scanController.stopped) break;

            try {
              const insertStmt = db.prepare(`
                INSERT OR IGNORE INTO fm_original_files
                (path, filename, extension, file_type, mime_type, size, created_at, modified_at, scan_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `);

              insertStmt.run(
                file.path,
                file.filename,
                file.extension,
                file.file_type,
                file.mime_type,
                file.size,
                file.created_at,
                file.modified_at,
                file.scan_date
              );
            } catch (err) {
              errorFiles++;
            }
          }

          // 发送完成事件
          sendProgress({
            taskId,
            progress: 100,
            totalFiles,
            processedFiles: totalFiles,
            errorFiles,
            status: 'completed'
          });

          // 更新完成状态
          db.prepare('UPDATE fm_scan_tasks SET status = ?, progress = 100, total_files = ?, processed_files = ?, error_files = ?, completed_at = ? WHERE id = ?')
            .run('completed', totalFiles, totalFiles, errorFiles, new Date().toISOString(), taskId);

        } catch (err) {
          console.error('[FileManager] Scan error:', err.message);
          errorFiles++;

          sendProgress({
            taskId,
            progress: 0,
            totalFiles: 0,
            processedFiles,
            errorFiles,
            status: 'error',
            error: err.message
          });
        }
      }

      // 清理
      activeScans.delete(taskId);
    })();

    return { success: true, message: 'Scan started' };
  });

  // 停止扫描
  ipcMain.handle('fileManager:stopScan', async (event, { taskId }) => {
    const controller = activeScans.get(taskId);
    if (controller) {
      controller.stopped = true;
      console.log('[FileManager] Stopping scan:', taskId);
    }

    db.prepare('UPDATE fm_scan_tasks SET status = ? WHERE id = ?').run('cancelling', taskId);

    return { success: true };
  });

  // ===== 文件操作 =====

  // 读取文件内容 (返回 base64 或 data URL)
  ipcMain.handle('fileManager:readFile', async (event, { filePath, asDataUrl }) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { error: 'File not found' };
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

    if (filter?.limit) {
      query += ' LIMIT ?';
      params.push(filter.limit);
    }

    if (filter?.offset) {
      query += ' OFFSET ?';
      params.push(filter.offset);
    }

    const stmt = db.prepare(query);
    return stmt.all(...params);
  });

  // 获取文件详情
  ipcMain.handle('fileManager:getFileDetail', async (event, { fileId }) => {
    const file = db.prepare('SELECT * FROM fm_original_files WHERE id = ?').get(fileId);
    return file;
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
    const files = db.prepare(`SELECT * FROM fm_original_files WHERE id IN (${fileIds.map(() => '?').join(',')})`).all(...fileIds);
    const categories = db.prepare('SELECT * FROM fm_categories').all();

    const preview = previewOrganize(files, targetPath, categories);
    return preview;
  });

  // 执行整理
  ipcMain.handle('fileManager:organizeFiles', async (event, { fileIds, targetPath, options }) => {
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
    const file = db.prepare('SELECT * FROM fm_original_files WHERE id = ?').get(fileId);
    if (!file) return { error: 'File not found' };

    const vaultDir = path.join(process.env.MOSS_HOME || path.join(require('os').homedir(), '.moss'), 'vault');
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
  });

  // 解密文件
  ipcMain.handle('fileManager:decryptFile', async (event, { encryptedId, password }) => {
    const encrypted = db.prepare('SELECT * FROM fm_encrypted_vault WHERE id = ?').get(encryptedId);
    if (!encrypted) return { error: 'Encrypted file not found' };

    const content = await fsp.readFile(encrypted.encrypted_path);

    const salt = content.subarray(0, 16);
    const iv = content.subarray(16, 28);
    const authTag = content.subarray(28, 44);
    const encryptedData = content.subarray(44);

    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    try {
      const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

      const tempDir = path.join(process.env.MOSS_HOME || path.join(require('os').homedir(), '.moss'), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempPath = path.join(tempDir, encrypted.original_filename);
      await fsp.writeFile(tempPath, decrypted);

      db.prepare('UPDATE fm_encrypted_vault SET last_accessed = ? WHERE id = ?')
        .run(new Date().toISOString(), encryptedId);

      return { success: true, tempPath };
    } catch (err) {
      return { error: 'Decryption failed: wrong password or corrupted file' };
    }
  });

  console.log('[FileManager] IPC handlers registered');
}

export default {
  initFileManagerDatabase,
  registerFileManagerIpcHandlers
};
