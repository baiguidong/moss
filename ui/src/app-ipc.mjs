import { ipcMain } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Generic JSON file CRUD IPC maker
 *
 * Options:
 *   - idField: field name for item identity (default: 'id')
 *   - rootKey: wrap array in object key, e.g. { tasks: [] } (default: null for plain array)
 *   - idPrefix: prefix for generated IDs (default: '')
 *
 * Usage:
 *   // Plain array: ~/.moss/items.json -> []
 *   registerJsonFileIpc('item', '~/.moss/items.json');
 *
 *   // Wrapped array: ~/.moss/tasks.json -> { tasks: [] }
 *   registerJsonFileIpc('task', '~/.moss/tasks.json', { rootKey: 'tasks' });
 *
 *   // Custom id field: item.id -> item.taskId
 *   registerJsonFileIpc('task', '~/.moss/tasks.json', { idField: 'taskId', rootKey: 'tasks' });
 */
export function registerJsonFileIpc(name, filePath, options = {}) {
  const {
    idField = 'id',
    rootKey = null,
    idPrefix = '',
  } = options;

  const resolvedPath = filePath.replace(/^~\//, os.homedir() + '/');

  async function readData() {
    try {
      const raw = await fsp.readFile(resolvedPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (rootKey) {
        return parsed[rootKey] || [];
      }
      return Array.isArray(parsed) ? parsed : (parsed.data || []);
    } catch {
      return [];
    }
  }

  async function writeData(data) {
    if (rootKey) {
      const existing = await readRawFile().catch(() => ({}));
      const obj = { ...existing, [rootKey]: data };
      await fsp.writeFile(resolvedPath, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
    } else {
      await fsp.writeFile(resolvedPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    }
  }

  async function readRawFile() {
    const raw = await fsp.readFile(resolvedPath, 'utf-8');
    return JSON.parse(raw);
  }

  ipcMain.handle(`${name}:list`, async () => {
    return await readData();
  });

  ipcMain.handle(`${name}:get`, async (_event, { id }) => {
    const data = await readData();
    return data.find(item => item[idField] === id) || null;
  });

  ipcMain.handle(`${name}:add`, async (_event, { item }) => {
    const data = await readData();
    const newItem = {
      ...item,
      [idField]: item[idField] || `${idPrefix}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
    data.push(newItem);
    await writeData(data);
    return newItem;
  });

  ipcMain.handle(`${name}:update`, async (_event, { id, updates }) => {
    const data = await readData();
    const index = data.findIndex(item => item[idField] === id);
    if (index === -1) return null;
    data[index] = { ...data[index], ...updates };
    await writeData(data);
    return data[index];
  });

  ipcMain.handle(`${name}:delete`, async (_event, { id }) => {
    const data = await readData();
    const filtered = data.filter(item => item[idField] !== id);
    await writeData(filtered);
    return { ok: true };
  });
}
