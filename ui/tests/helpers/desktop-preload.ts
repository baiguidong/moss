import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const preloadUrl = new URL('../../src/preload.mjs', import.meta.url);
const built = await Bun.build({ entrypoints: [fileURLToPath(preloadUrl)], target: 'node', format: 'cjs', external: ['electron'] });
if (!built.success) throw new AggregateError(built.logs, 'Unable to bundle desktop preload fixture');
const source = await built.outputs[0]!.text();
const nativeRequire = createRequire(preloadUrl);

// Execute the real preload without starting Electron or mocking modules globally.
export function loadDesktopPreload(invoke: (channel: string, payload?: unknown) => unknown = async () => ({})) {
  const ipc = Object.assign(new EventEmitter(), { invoke });
  let api!: Window['agentDesktop'];
  const electron = {
    ipcRenderer: ipc,
    webUtils: { getPathForFile: (file: { path?: string }) => file.path || '' },
    contextBridge: { exposeInMainWorld: (_name: string, value: Window['agentDesktop']) => { api = value; } },
  };
  // Bundle local imports as production does; only the Electron boundary is
  // replaced. A regex that removed one import failed as soon as preload split
  // into modules, before any IPC assertions could run.
  runInNewContext(source, { require: (name: string) => name === 'electron' ? electron : nativeRequire(name) });
  return { api, ipc };
}
