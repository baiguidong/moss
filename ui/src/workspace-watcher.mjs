import nodeFs from 'node:fs';
import nodeFsp from 'node:fs/promises';
import path from 'node:path';
import { getSessionWorkspaceRoot as workspaceRoot, isAccessibleDirectory as accessibleDirectory } from './workspace-paths.mjs';

export function createWorkspaceWatcherService({
  emitToRenderer,
  mossLog,
  fs = nodeFs,
  fsp = nodeFsp,
  getSessionWorkspaceRoot = workspaceRoot,
  isAccessibleDirectory = accessibleDirectory,
  WORKSPACE_WATCH_DIRECTORY_LIMIT = 512,
}) {
  function closeWorkspaceWatcher(sessionRecord) {
    if (!sessionRecord.workspaceWatcher) return;
    sessionRecord.workspaceWatcher.closed = true;
    for (const watcher of sessionRecord.workspaceWatcher.watchers.values()) {
      try {
        watcher.close();
      } catch {}
    }
    sessionRecord.workspaceWatcher.watchers.clear();
    sessionRecord.workspaceWatcher = null;
    if (sessionRecord.workspaceWatcherSyncTimer) {
      clearTimeout(sessionRecord.workspaceWatcherSyncTimer);
      sessionRecord.workspaceWatcherSyncTimer = null;
    }
    if (sessionRecord.persistTimer) {
      clearTimeout(sessionRecord.persistTimer);
      sessionRecord.persistTimer = null;
    }
  }

  async function collectDirectories(rootPath, limit = WORKSPACE_WATCH_DIRECTORY_LIMIT) {
    const directories = [];
    const pending = [rootPath];
    let truncated = false;
    while (pending.length > 0) {
      if (directories.length >= limit) {
        truncated = true;
        break;
      }
      const current = pending.pop();
      directories.push(current);
      let dirents = [];
      try {
        dirents = await fsp.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of dirents) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        pending.push(path.join(current, entry.name));
      }
    }
    return {
      directories,
      truncated,
    };
  }

  function emitWorkspaceChanged(sessionRecord, eventType, changedPath) {
    const workspace = getSessionWorkspaceRoot(sessionRecord) || sessionRecord.workspace;
    emitToRenderer('workspace:changed', {
      sessionId: sessionRecord.id,
      workspace,
      eventType,
      path: changedPath,
      timestamp: Date.now(),
    });
  }

  async function syncWorkspaceWatcher(sessionRecord) {
    const watcherState = sessionRecord.workspaceWatcher;
    if (!watcherState || watcherState.closed) return;

    const root = getSessionWorkspaceRoot(sessionRecord);
    if (!isAccessibleDirectory(root)) return;

    // Modern Electron supports recursive watches on macOS, Windows and Linux.
    // A single recursive watch also covers newly created subdirectories and does
    // not silently drop nested changes when a workspace exceeds 512 directories.
    if (watcherState.recursiveRoot === root && watcherState.watchers.has(root)) return;
    if (!watcherState.recursiveUnavailable) {
      try {
        const watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
          if (watcherState.closed) return;
          emitWorkspaceChanged(sessionRecord, eventType, filename ? path.join(root, filename.toString()) : root);
        });
        watcher.on('error', () => {
          watcher.close();
          if (watcherState.closed) return;
          watcherState.watchers.delete(root);
          watcherState.recursiveRoot = null;
          watcherState.recursiveUnavailable = true;
          void syncWorkspaceWatcher(sessionRecord);
        });
        watcher.unref?.();
        for (const previous of watcherState.watchers.values()) previous.close();
        watcherState.watchers.clear();
        watcherState.watchers.set(root, watcher);
        watcherState.recursiveRoot = root;
        return;
      } catch {
        watcherState.recursiveUnavailable = true;
      }
    }

    const { directories, truncated } = await collectDirectories(root);
    if (watcherState.closed) return;
    if (truncated && !watcherState.truncated) {
      mossLog('warn', 'workspace', 'Workspace watcher reached directory limit', {
        sessionId: sessionRecord.id,
        root,
        limit: WORKSPACE_WATCH_DIRECTORY_LIMIT,
      });
    }
    watcherState.truncated = truncated;
    const nextPaths = new Set(directories);

    for (const watchedPath of watcherState.watchers.keys()) {
      if (nextPaths.has(watchedPath)) continue;
      try {
        watcherState.watchers.get(watchedPath)?.close();
      } catch {}
      watcherState.watchers.delete(watchedPath);
    }

    for (const dirPath of directories) {
      if (watcherState.watchers.has(dirPath)) continue;
      try {
        const watcher = fs.watch(dirPath, (eventType, filename) => {
          if (watcherState.closed) return;
          const changedPath = filename ? path.join(dirPath, filename.toString()) : dirPath;
          emitWorkspaceChanged(sessionRecord, eventType, changedPath);
          if (sessionRecord.workspaceWatcherSyncTimer) {
            clearTimeout(sessionRecord.workspaceWatcherSyncTimer);
          }
          sessionRecord.workspaceWatcherSyncTimer = setTimeout(() => {
            sessionRecord.workspaceWatcherSyncTimer = null;
            void syncWorkspaceWatcher(sessionRecord);
          }, 150);
        });
        watcher.on('error', () => {
          watcher.close();
          if (watcherState.watchers.get(dirPath) === watcher) watcherState.watchers.delete(dirPath);
        });
        watcher.unref?.();
        watcherState.watchers.set(dirPath, watcher);
      } catch {}
    }
  }

  async function startWorkspaceWatcher(sessionRecord) {
    closeWorkspaceWatcher(sessionRecord);
    sessionRecord.workspaceWatcher = {
      closed: false,
      truncated: false,
      watchers: new Map(),
    };
    await syncWorkspaceWatcher(sessionRecord);
  }

  return {
    closeWorkspaceWatcher,
    startWorkspaceWatcher,
    syncWorkspaceWatcher,
    emitWorkspaceChanged,
  };
}
