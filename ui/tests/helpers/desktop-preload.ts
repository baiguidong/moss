import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the real preload without starting Electron or mocking modules globally.
export function loadDesktopPreload(invoke: (channel: string, payload?: unknown) => unknown = async () => ({})) {
  const ipc = Object.assign(new EventEmitter(), { invoke });
  let api!: Window['agentDesktop'];
  const source = readFileSync(new URL('../../src/preload.mjs', import.meta.url), 'utf8');
  runInNewContext(source.replace("import { contextBridge, ipcRenderer } from 'electron';", ''), {
    ipcRenderer: ipc,
    contextBridge: { exposeInMainWorld: (_name: string, value: Window['agentDesktop']) => { api = value; } },
  });
  return { api, ipc };
}
