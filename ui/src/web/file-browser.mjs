import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { constants } from 'node:fs';

async function fileOperation(operation) {
  try { return await operation(); }
  catch (error) {
    const message = { ENOENT: '文件或文件夹已不存在，请刷新后重试。', ENOTDIR: '此路径不是文件夹。', EACCES: '没有权限访问此文件或文件夹。', EPERM: '没有权限访问此文件或文件夹。', ELOOP: '此快捷方式无法访问，请选择其他目录。' }[error.code];
    if (message) error.message = message;
    throw error;
  }
}

// Like /api/files, this browses the authenticated user's Host filesystem.
// It is deliberately separate from session-scoped workspace APIs and App IPC.
export function createFileBrowser({ homeDirectory = os.homedir() } = {}) {
  function resolvePath(value = homeDirectory) {
    if (typeof value !== 'string' || /[\x00-\x1f]/u.test(value)) throw new Error('目录路径无效。');
    if (value === '~') value = homeDirectory;
    else if (/^~[\\/]/u.test(value)) value = path.join(homeDirectory, value.slice(2));
    if (!path.isAbsolute(value)) throw new Error('请输入云电脑中的绝对路径。');
    return path.resolve(value);
  }

  async function list({ directory, reveal, kind = 'file', hidden = false, query = '', offset = 0, extensions = [] } = {}) {
    let currentPath = resolvePath(directory);
    let highlightedPath = null;
    if (reveal) {
      highlightedPath = resolvePath(reveal);
      await fsp.stat(highlightedPath);
      currentPath = path.dirname(highlightedPath);
    }
    const entries = await fsp.readdir(currentPath, { withFileTypes: true });
    const items = [];
    // Only symlinks need stat; bound concurrency in directories with many links.
    for (let start = 0; start < entries.length; start += 32) {
      const batch = await Promise.all(entries.slice(start, start + 32).map(async entry => {
        const entryPath = path.join(currentPath, entry.name);
        if (!hidden && entry.name.startsWith('.') && entryPath !== highlightedPath) return null;
        if (query && !entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) return null;
        const stat = entry.isSymbolicLink() ? await fsp.stat(entryPath).catch(() => null) : entry;
        if (!stat || (!stat.isFile() && !stat.isDirectory())) return null;
        const isDirectory = stat.isDirectory();
        if (!isDirectory && (kind === 'directory' || (extensions.length && !extensions.includes(path.extname(entry.name).slice(1).toLowerCase())))) return null;
        return { name: entry.name, path: entryPath, isDirectory };
      }));
      items.push(...batch.filter(Boolean));
    }
    items.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    const requestedOffset = Number(offset);
    let start = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
    if (highlightedPath) start = Math.max(0, Math.floor(items.findIndex(item => item.path === highlightedPath) / 200) * 200);
    const parent = path.dirname(currentPath);
    return { path: currentPath, parentPath: parent === currentPath ? null : parent, homePath: homeDirectory,
      highlightedPath, entries: items.slice(start, start + 200), offset: start, total: items.length, hasMore: start + 200 < items.length };
  }

  async function select({ paths, kind, extensions = [] } = {}) {
    if (!['directory', 'file', 'any'].includes(kind) || !Array.isArray(paths) || !paths.length || paths.length > 100
      || !Array.isArray(extensions) || extensions.some(ext => typeof ext !== 'string')) throw new Error('文件选择无效。');
    const results = [];
    for (const value of new Set(paths)) {
      const filename = resolvePath(value);
      const stat = await fsp.stat(filename);
      if ((kind === 'directory' && !stat.isDirectory()) || (kind === 'file' && !stat.isFile()) || (!stat.isFile() && !stat.isDirectory())) throw new Error('请选择有效的文件或文件夹。');
      if (stat.isFile() && extensions.length && !extensions.includes(path.extname(filename).slice(1).toLowerCase())) throw new Error(`请选择 ${extensions.join('、')} 文件。`);
      await fsp.access(filename, constants.R_OK | (stat.isDirectory() ? constants.X_OK : 0));
      results.push({ path: filename, name: path.basename(filename) || filename, isDirectory: stat.isDirectory(), size: stat.size });
    }
    return results;
  }
  return { list: input => fileOperation(() => list(input)), select: input => fileOperation(() => select(input)) };
}
