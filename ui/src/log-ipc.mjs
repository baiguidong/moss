import electron from 'electron';
const { ipcMain, dialog } = electron;
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MOSS_HOME = path.join(os.homedir(), '.moss');
const MOSS_LOGS_DIR = path.join(MOSS_HOME, 'logs');
const MOSS_LOG_FILE = 'moss.log';
const MOSS_LOG_PATH = path.join(MOSS_LOGS_DIR, MOSS_LOG_FILE);
const DEFAULT_LOG_ROTATION_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_LOG_ROTATION_MAX_FILES = 5;

export function getMossLogPath() {
  return MOSS_LOG_PATH;
}

function getLogRotationSettings(desktopSettings) {
  return {
    maxSize: desktopSettings?.logRotationMaxSize || DEFAULT_LOG_ROTATION_MAX_SIZE,
    maxFiles: desktopSettings?.logRotationMaxFiles || DEFAULT_LOG_ROTATION_MAX_FILES,
  };
}

function initLogSystem() {
  try {
    fs.mkdirSync(MOSS_LOGS_DIR, { recursive: true });
  } catch {}
}


export function flushLogSync() {
  // No-op since we write synchronously now
}

export function mossLog(level, category, message, data) {
  const now = new Date();
  const timestamp = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const levelPad = level.toUpperCase().padEnd(5, ' ');
  const categoryPad = category.padEnd(12, ' ');

  let line = `${timestamp} [${levelPad}] [${categoryPad}] ${message}`;
  if (data) {
    const dataStr = typeof data === 'object' ? JSON.stringify(data) : String(data);
    line += ` | ${dataStr}`;
  }

  // Write to console
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }

  // Write to file synchronously
  try {
    fs.mkdirSync(MOSS_LOGS_DIR, { recursive: true });
    fs.appendFileSync(MOSS_LOG_PATH, line + '\n', 'utf8');
  } catch {}
}

export function registerLogIpcHandlers() {
  initLogSystem();

  ipcMain.handle('log:get-path', () => MOSS_LOG_PATH);

  ipcMain.handle('log:download', async () => {
    const result = await dialog.showSaveDialog({
      title: '下载日志文件',
      defaultPath: path.join(os.homedir(), 'moss.log'),
      filters: [{ name: 'Log Files', extensions: ['log'] }],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    try {
      flushLogSync();
      await fsp.copyFile(MOSS_LOG_PATH, result.filePath);
      return { canceled: false, path: result.filePath };
    } catch (error) {
      return { canceled: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('log:write', (_event, { level, category, message, data }) => {
    mossLog(level || 'info', category || 'renderer', message, data);
  });
}
