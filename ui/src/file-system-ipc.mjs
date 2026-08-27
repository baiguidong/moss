import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveUserPath } from './file-path-utils.mjs';

export function registerFileSystemIpcHandlers({
  ipcMain,
  uiRoot,
  getSessionRecord,
  maxImageBase64Bytes,
  maxReadTextBytes,
}) {
  ipcMain.handle('fs:getImageBase64', async (event, { path: filePath }) => {
    try {
      const ext = path.extname(filePath || '').toLowerCase().replace(/^\./, '');
      const mimeMap = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
        svg: 'image/svg+xml', ico: 'image/x-icon',
      };
      const mime = mimeMap[ext] || 'application/octet-stream';
      const stat = await fsp.stat(filePath);
      if (!stat.isFile() || stat.size > maxImageBase64Bytes) {
        return null;
      }
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
        throw new Error('Remote Direct mode does not support uploading local images to the remote workspace yet.');
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
        throw new Error('Remote Direct mode does not support uploading local files to the remote workspace yet.');
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
