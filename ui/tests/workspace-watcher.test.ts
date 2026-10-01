import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const source = main.slice(main.indexOf('function closeWorkspaceWatcher('), main.indexOf('/**\n * Handler for MossTool'))
  + main.slice(main.indexOf('async function startWorkspaceWatcher('), main.indexOf('async function ensureRuntime('));

function setup(recursiveSupported = true) {
  const emitted: any[] = [];
  const watches: Array<{ directory: string; recursive: boolean; watcher: FakeWatcher }> = [];
  let directoryReads = 0;
  class FakeWatcher extends EventEmitter {
    closed = false;
    constructor(readonly callback: (type: string, filename: string) => void) { super(); }
    close() { this.closed = true; }
    unref() {}
  }
  const api = runInNewContext(`${source}\n({startWorkspaceWatcher, closeWorkspaceWatcher, syncWorkspaceWatcher});`, {
    path,
    fs: { watch: (directory: string, options: any, callback: any) => {
      const recursive = options?.recursive === true;
      if (recursive && !recursiveSupported) throw new Error('Recursive watches unavailable');
      const watcher = new FakeWatcher(callback ?? options);
      watches.push({ directory, recursive, watcher });
      return watcher;
    } },
    fsp: { readdir: async (directory: string) => {
      directoryReads++;
      return directory === '/workspace'
        ? Array.from({ length: 600 }, (_, index) => ({ name: `dir-${index}`, isDirectory: () => true }))
        : [];
    } },
    WORKSPACE_WATCH_DIRECTORY_LIMIT: 512,
    getSessionWorkspaceRoot: (record: any) => record.workspace,
    isAccessibleDirectory: () => true,
    emitToRenderer: (_channel: string, payload: any) => emitted.push(payload),
    mossLog() {}, setTimeout, clearTimeout,
  });
  const record = { id: 'session', workspace: '/workspace', workspaceWatcher: null, workspaceWatcherSyncTimer: null };
  return { api, record, emitted, watches, get directoryReads() { return directoryReads; } };
}

describe('workspace file notifications', () => {
  test('watches root and new nested files immediately, including large workspaces', async () => {
    const state = setup();
    await state.api.startWorkspaceWatcher(state.record);
    expect(state.directoryReads).toBe(0);
    expect(state.watches).toHaveLength(1);
    expect(state.watches[0]!.recursive).toBe(true);
    const watcher = state.watches[0]!.watcher;
    watcher.callback('rename', 'new.html');
    watcher.callback('rename', 'new-folder/nested.html');
    expect(state.emitted.map((event) => event.path)).toEqual(['/workspace/new.html', '/workspace/new-folder/nested.html']);
    await state.api.syncWorkspaceWatcher(state.record);
    expect(state.watches).toHaveLength(1);
    state.api.closeWorkspaceWatcher(state.record);
    watcher.callback('rename', 'late.html');
    expect(watcher.closed).toBe(true);
    expect(state.emitted).toHaveLength(2);
  });

  test('fallback retains nested watches up to the limit instead of dropping them all', async () => {
    const state = setup(false);
    await state.api.startWorkspaceWatcher(state.record);
    expect(state.watches).toHaveLength(512);
    expect(state.watches.some((entry) => entry.directory !== '/workspace')).toBe(true);
    state.api.closeWorkspaceWatcher(state.record);
    expect(state.watches.every((entry) => entry.watcher.closed)).toBe(true);
  });

  test('an asynchronous watch error is handled and falls back without crashing', async () => {
    const state = setup();
    await state.api.startWorkspaceWatcher(state.record);
    state.watches[0]!.watcher.emit('error', new Error('Watch unavailable'));
    // The fallback scan reads one directory per microtask.
    for (let i = 0; i < 520; i++) await Promise.resolve();
    expect(state.watches[0]!.watcher.closed).toBe(true);
    expect(state.watches.some((entry) => !entry.recursive)).toBe(true);
    state.api.closeWorkspaceWatcher(state.record);
  });
});
