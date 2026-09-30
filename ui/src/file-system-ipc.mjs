import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveUserPath } from './file-path-utils.mjs';

export function registerFileSystemIpcHandlers({
  ipcMain,
  uiRoot,
  getSessionRecord,
  readWorkspaceFile,
  maxImageBase64Bytes,
  maxReadTextBytes,
  uploadRemoteWorkspaceFile,
}) {
  // UI-only metadata lookup. Paths must already come from an approved tool
  // adapter; this endpoint does not discover files or resolve relative paths.
  ipcMain.handle('preview:resolve-files', async (_event, { sessionId, paths } = {}) => {
    if (!Array.isArray(paths) || paths.some((value) => typeof value !== 'string')) {
      throw new Error('Invalid file paths');
    }
    const uniquePaths = [...new Set(paths)];
    let sessionRecord;
    try { sessionRecord = sessionId ? getSessionRecord(sessionId) : null; } catch { /* Missing session. */ }
    if (!sessionRecord || sessionRecord.agentMode !== 'local') {
      return uniquePaths.map((inputPath) => ({ inputPath, error: 'NOT_LOCAL_SESSION' }));
    }
    const workspace = sessionRecord.workspace
      ? await fsp.realpath(sessionRecord.workspace).catch(() => null)
      : null;
    const results = [];
    // Bound open handles even for long replayed conversations.
    for (const inputPath of uniquePaths) {
      // On Windows, /foo and \foo still depend on the current drive.
      const absolute = path.isAbsolute(inputPath)
        && (process.platform !== 'win32' || /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(inputPath));
      if (!absolute || /[\u0000\r\n]/.test(inputPath)) {
        results.push({ inputPath, error: 'INVALID_PATH' });
        continue;
      }
      let handle;
      try {
        const targetPath = await fsp.realpath(inputPath);
        if (!(await fsp.stat(targetPath)).isFile()) {
          results.push({ inputPath, error: 'NOT_FILE' });
          continue;
        }
        // A nonblocking open also avoids hanging on a FIFO/device. Symlinks
        // have already been resolved; do not follow a newly replaced leaf.
        handle = await fsp.open(targetPath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0) | (fs.constants.O_NOFOLLOW || 0));
        const stats = await handle.stat();
        if (!stats.isFile()) {
          results.push({ inputPath, error: 'NOT_FILE' });
          continue;
        }
        const relative = workspace ? path.relative(workspace, targetPath) : null;
        const insideWorkspace = relative !== null && relative !== '..'
          && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
        results.push({ inputPath, file: {
          path: targetPath,
          name: path.basename(targetPath),
          size: stats.size,
          ...(insideWorkspace ? { relativePath: relative } : {}),
        } });
      } catch (error) {
        results.push({ inputPath, error: error.code || 'FILE_UNAVAILABLE' });
      } finally {
        await handle?.close();
      }
    }
    return results;
  });

  // An explicit file-card preview may target a generated file outside the
  // session workspace. Keep that preview read-only; workspace reads/writes
  // retain their existing session boundary.
  ipcMain.handle('preview:read-file', async (_event, { sessionId, filePath }) => {
    const sessionRecord = sessionId ? getSessionRecord(sessionId) : null;
    if (sessionRecord?.agentMode === 'remote-direct') {
      return readWorkspaceFile(sessionRecord, filePath);
    }

    const targetPath = await fsp.realpath(resolveUserPath(filePath, os.homedir()));
    const workspace = sessionRecord?.workspace
      ? await fsp.realpath(sessionRecord.workspace).catch(() => null)
      : null;
    const relative = workspace ? path.relative(workspace, targetPath) : null;
    if (relative !== null && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return readWorkspaceFile(sessionRecord, path.resolve(sessionRecord.workspace, relative));
    }

    const preview = await readWorkspaceFile({
      agentMode: 'local',
      workspace: path.dirname(targetPath),
    }, targetPath);
    return {
      ...preview,
      metadata: { ...preview.metadata, previewEditable: false, previewSaveable: false },
    };
  });

  ipcMain.handle('fs:getImageBase64', async (event, { path: filePath }) => {
    try {
      const ext = path.extname(filePath || '').toLowerCase().replace(/^\./, '');
      const mimeMap = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
        svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
        tif: 'image/tiff', tiff: 'image/tiff',
      };
      const stat = await fsp.stat(filePath);
      if (!stat.isFile() || stat.size > maxImageBase64Bytes) {
        return null;
      }
      if (ext === 'tif' || ext === 'tiff') {
        const { default: sharp } = await import('sharp');
        const pngBuffer = await sharp(filePath, { limitInputPixels: 100_000_000 }).png().toBuffer();
        return `data:image/png;base64,${pngBuffer.toString('base64')}`;
      }
      const mime = mimeMap[ext] || 'application/octet-stream';
      const base64 = await fsp.readFile(filePath, { encoding: 'base64' });
      return `data:${mime};base64,${base64}`;
    } catch {
      return null;
    }
  });

  ipcMain.handle('fs:getFileMetadata', async (event, { path: filePath }) => {
    try {
      const stats = await fsp.stat(filePath);
      return { size: stats.size };
    } catch {
      return null;
    }
  });

  ipcMain.handle('fs:getHomeDir', async () => {
    return os.homedir();
  });

  ipcMain.handle('fs:getAppIcon', async () => {
    try {
      // Try production path first, then dev path
      const prodIcon = path.join(uiRoot, 'dist', 'build', 'icon.png');
      const devIcon = path.join(uiRoot, 'public', 'build', 'icon.png');
      const iconPath = fs.existsSync(prodIcon) ? prodIcon : (fs.existsSync(devIcon) ? devIcon : null);
      if (!iconPath) {
        return null;
      }
      const base64 = await fsp.readFile(iconPath, { encoding: 'base64' });
      return `data:image/png;base64,${base64}`;
    } catch {
      return null;
    }
  });

  ipcMain.handle('fs:readText', async (event, { path: filePath }) => {
    try {
      const resolvedPath = resolveUserPath(filePath, os.homedir());
      const stat = await fsp.stat(resolvedPath);
      if (!stat.isFile()) {
        return { ok: false, error: 'Not a file' };
      }
      if (stat.size > maxReadTextBytes) {
        return { ok: false, error: 'File is too large' };
      }
      const content = await fsp.readFile(resolvedPath, 'utf-8');
      return { ok: true, content };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:delete', async (event, { path: filePath }) => {
    try {
      await fsp.rm(filePath, { recursive: true, force: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:list', async (event, { path: dirPath }) => {
    try {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      return entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }));
    } catch (err) {
      return [];
    }
  });

  ipcMain.handle('fs:createTempFile', async (event, { fileName }) => {
    try {
      const safeFileName = String(fileName || '').replace(/[<>:"/\\|?*]/g, '_');
      const tempPath = path.join(os.tmpdir(), `moss_${Date.now()}_${safeFileName}`);
      return tempPath;
    } catch {
      return null;
    }
  });

  ipcMain.handle('fs:writeFile', async (event, { path: filePath, data }) => {
    try {
      await fsp.writeFile(filePath, Buffer.from(data));
      return true;
    } catch {
      return false;
    }
  });

  function createAvailableWorkspaceFilePath(targetDir, fileName) {
    const normalizedName = String(fileName || '').trim() || 'attachment';
    const parsed = path.parse(normalizedName);
    let candidate = path.join(targetDir, normalizedName);
    let suffix = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(
        targetDir,
        `${parsed.name || 'attachment'}-${suffix}${parsed.ext || ''}`,
      );
      suffix += 1;
    }
    return candidate;
  }

  ipcMain.handle('workspace:saveImage', async (event, { sessionId, fileName, data }) => {
    try {
      const sessionRecord = getSessionRecord(sessionId);
      if (sessionRecord.agentMode === 'remote-direct') {
        if (typeof uploadRemoteWorkspaceFile !== 'function') {
          throw new Error('Remote workspace upload is unavailable.');
        }
        return await uploadRemoteWorkspaceFile(sessionRecord, {
          fileName,
          data: Buffer.from(data),
        });
      }
      const safeName = String(fileName || 'image').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'image';
      const targetDir = sessionRecord.projectId
        ? path.join(sessionRecord.workspace, 'inputs')
        : sessionRecord.workspace;
      await fsp.mkdir(targetDir, { recursive: true });
      const filePath = createAvailableWorkspaceFilePath(targetDir, safeName);
      await fsp.writeFile(filePath, Buffer.from(data));
      return { path: filePath };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('workspace:copyFileToWorkspace', async (event, { sessionId, sourcePath, fileName }) => {
    try {
      const sessionRecord = getSessionRecord(sessionId);
      if (sessionRecord.agentMode === 'remote-direct') {
        if (typeof uploadRemoteWorkspaceFile !== 'function') {
          throw new Error('Remote workspace upload is unavailable.');
        }
        return await uploadRemoteWorkspaceFile(sessionRecord, {
          sourcePath,
          fileName,
        });
      }
      const safeName = String(fileName || path.basename(sourcePath)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'attachment';
      const targetDir = sessionRecord.projectId
        ? path.join(sessionRecord.workspace, 'inputs')
        : sessionRecord.workspace;
      await fsp.mkdir(targetDir, { recursive: true });
      const destPath = createAvailableWorkspaceFilePath(targetDir, safeName);
      // 用 copyFile 而非 readFile+writeFile, 避免把整个文件读进内存(大文件会撑爆主进程)。
      await fsp.copyFile(sourcePath, destPath);
      return { path: destPath };
    } catch (err) {
      return { error: String(err) };
    }
  });
}
