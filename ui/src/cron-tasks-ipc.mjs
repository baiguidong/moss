import path from 'node:path';
import { registerJsonFileIpc } from './app-ipc.mjs';
import { MOSS_HOME } from './moss-home.mjs';

export function registerCronIpcHandlers() {
  registerJsonFileIpc('cron', path.join(MOSS_HOME, 'cron_tasks.json'), {
    rootKey: 'tasks',
    idField: 'id',
  });
}
