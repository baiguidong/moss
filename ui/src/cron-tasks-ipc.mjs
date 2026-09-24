import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readCronTaskStore, updateCronTaskStore } from '../../shared/cron-task-store.mjs';

export function registerCronIpcHandlers({ ipcMain, mossHome }) {
  const filePath = path.join(mossHome, 'cron_tasks.json');
  ipcMain.handle('cron:list', () => readCronTaskStore(filePath));
  ipcMain.handle('cron:get', async (_event, { id }) => {
    return (await readCronTaskStore(filePath)).find(task => task.id === id) || null;
  });
  ipcMain.handle('cron:add', (_event, { item }) => updateCronTaskStore(filePath, tasks => {
    const task = { ...item, id: item.id || randomUUID() };
    if (tasks.some(entry => entry.id === task.id)) throw new Error('Task already exists.');
    tasks.push(task);
    return task;
  }));
  ipcMain.handle('cron:update', (_event, { id, updates }) => updateCronTaskStore(filePath, tasks => {
    const task = tasks.find(entry => entry.id === id);
    if (!task) return null;
    if (task.runId) throw new Error('正在执行的任务不能修改，请等待执行结束。');
    const cronChanged = updates.cron !== undefined && updates.cron !== task.cron;
    Object.assign(task, updates, { id });
    if (cronChanged) delete task.nextRunAt;
    return task;
  }));
  ipcMain.handle('cron:delete', (_event, { id, taskId }) => updateCronTaskStore(filePath, tasks => {
    const index = tasks.findIndex(task => task.id === (id ?? taskId));
    if (index >= 0) tasks.splice(index, 1);
    return { ok: true };
  }));
}
