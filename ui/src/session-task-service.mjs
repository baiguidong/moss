import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { compareTaskIds, normalizeSessionTask, snapshotRemoteSessionTasks } from './session-tasks.mjs';

export function createSessionTaskService({
  MOSS_HOME,
  getAppTasks = () => [],
  cancelAppTask = () => false,
  emitToRenderer,
  getSessionRecord,
  scheduleSubAgentSessionSync,
  sessions,
  subAgentSessions,
}) {
  const BACKGROUND_TASK_EMIT_DELAY_MS = 500;
  const SESSION_TASK_EMIT_DELAY_MS = 150;

  function snapshotBackgroundTasks(sessionRecord) {
    try {
      const state = sessionRecord.runtime?.getAppState?.();
      const liveTasks = state?.tasks ? Object.values(state.tasks)
        .filter((t) => t && t.type === 'local_bash')
        .map((t) => {
          return {
            id: t.id,
            description: t.description || '',
            command: typeof t.command === 'string' ? t.command : '',
            kind: t.kind === 'monitor' ? 'monitor' : 'shell',
            status: t.status,
            isBackgrounded: t.isBackgrounded !== false,
            startTime: t.startTime ?? null,
            endTime: t.endTime ?? null,
            exitCode: t.result?.code ?? null,
          };
        }) : [];
      const merged = new Map(liveTasks.map(task => [task.id, task]));
      for (const task of getAppTasks(sessionRecord.id)) merged.set(task.id, {
        id: task.id, kind: 'app', appId: task.appId, route: task.route,
        description: task.title, command: task.summary || '', status: task.status,
        isBackgrounded: true, startTime: task.createdAt, endTime: task.status === 'running' ? null : task.updatedAt,
        exitCode: null, totalTokens: task.tokens, error: task.error, result: task.result,
      });
      const snapshot = [...merged.values()].sort(
        (left, right) => (left.startTime ?? 0) - (right.startTime ?? 0),
      );
      return snapshot;
    } catch {
      return [];
    }
  }

  function attachBackgroundTaskWatcher(sessionRecord) {
    const runtime = sessionRecord?.runtime;
    if (!runtime || typeof runtime.subscribe !== 'function') return;
    if (sessionRecord.backgroundTaskWatcherRuntime === runtime) return;
    sessionRecord.backgroundTaskUnsubscribe?.();

    let lastJson = '';
    let timer = null;
    const emitSnapshot = () => {
      timer = null;
      if (sessionRecord.runtime !== runtime) return;
      const tasks = snapshotBackgroundTasks(sessionRecord);
      const json = JSON.stringify(tasks);
      if (json === lastJson) return;
      lastJson = json;
      emitToRenderer('agent:background-tasks', { sessionId: sessionRecord.id, tasks });
    };
    const unsubscribe = runtime.subscribe(() => {
      scheduleSubAgentSessionSync(sessionRecord);
      if (!timer) timer = setTimeout(emitSnapshot, BACKGROUND_TASK_EMIT_DELAY_MS);
    });
    sessionRecord.backgroundTaskWatcherRuntime = runtime;
    sessionRecord.backgroundTaskUnsubscribe = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        unsubscribe?.();
      } catch {}
      sessionRecord.backgroundTaskWatcherRuntime = null;
      sessionRecord.backgroundTaskUnsubscribe = null;
    };
  }

  function sanitizeTaskPathComponent(input) {
    return String(input || '').replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  function resolveTaskScopeOwnerSession(sessionRecord) {
    // Sub-agents inherit their root session's taskScope, so task files live under
    // the owning root session id. Walk up parentSessionId to that root.
    let current = sessionRecord;
    const seen = new Set();
    while (current?.parentSessionId && !seen.has(current.id)) {
      seen.add(current.id);
      const parent =
        sessions.get(current.parentSessionId) ||
        subAgentSessions.get(current.parentSessionId);
      if (!parent) break;
      current = parent;
    }
    return current;
  }

  function getSessionTaskListId(sessionRecord) {
    try {
      const runtimeTaskListId = sessionRecord.runtime?.getTaskListId?.();
      if (typeof runtimeTaskListId === 'string' && runtimeTaskListId.trim()) {
        return runtimeTaskListId.trim();
      }
    } catch {}
    // Tasks are keyed by taskScope (buildClaudeSessionConfig), derived from the
    // moss session id / project id — never underlyingSessionId. Project sessions
    // are session-scoped (`project-<projectId>__session-<rootSessionId>`) so
    // sibling sessions don't share one checklist. Mirror the engine's
    // getTaskListIdForScope so reads without a live runtime hit the same directory
    // the writes used.
    const owner = resolveTaskScopeOwnerSession(sessionRecord);
    if (owner.projectId) {
      return `project-${owner.projectId}__session-${owner.id}`;
    }
    return owner.id;
  }

  function getSessionTasksDir(sessionRecord) {
    return path.join(
      MOSS_HOME,
      'tasks',
      sanitizeTaskPathComponent(getSessionTaskListId(sessionRecord)),
    );
  }

  function snapshotSessionTasks(sessionRecord) {
    if (sessionRecord.agentMode === 'remote-direct') {
      return snapshotRemoteSessionTasks(sessionRecord);
    }
    const dir = getSessionTasksDir(sessionRecord);
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      return [];
    }

    const tasks = [];
    for (const file of files) {
      if (!file.endsWith('.json') || file.startsWith('.')) continue;
      const filePath = path.join(dir, file);
      try {
        const rawTask = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (rawTask?.metadata?._internal) continue;
        const task = normalizeSessionTask(rawTask);
        if (task) tasks.push(task);
      } catch {}
    }
    return tasks.sort(compareTaskIds);
  }

  function attachSessionTaskWatcher(sessionRecord) {
    if (sessionRecord?.agentMode === 'remote-direct') return;
    const runtime = sessionRecord?.runtime;
    if (!runtime || typeof runtime.subscribe !== 'function') return;
    if (sessionRecord.sessionTaskWatcherRuntime === runtime) return;
    sessionRecord.sessionTaskUnsubscribe?.();

    let lastJson = JSON.stringify(snapshotSessionTasks(sessionRecord));
    let watchedDir = null;
    let fsWatcher = null;
    let timer = null;

    const scheduleSnapshot = () => {
      if (!timer) {
        timer = setTimeout(emitSnapshot, SESSION_TASK_EMIT_DELAY_MS);
      }
    };

    const syncFileWatcher = () => {
      const nextDir = getSessionTasksDir(sessionRecord);
      if (nextDir === watchedDir && fsWatcher) return;
      try {
        fsWatcher?.close();
      } catch {}
      fsWatcher = null;
      watchedDir = nextDir;
      if (!fs.existsSync(nextDir)) return;
      try {
        fsWatcher = fs.watch(nextDir, scheduleSnapshot);
        fsWatcher.unref?.();
      } catch {
        fsWatcher = null;
      }
    };

    function emitSnapshot() {
      timer = null;
      if (sessionRecord.runtime !== runtime) return;
      syncFileWatcher();
      const tasks = snapshotSessionTasks(sessionRecord);
      const json = JSON.stringify(tasks);
      if (json === lastJson) return;
      lastJson = json;
      emitToRenderer('agent:state', { sessionId: sessionRecord.id, tasks });
    }

    const unsubscribe = runtime.subscribe(scheduleSnapshot);
    syncFileWatcher();
    sessionRecord.sessionTaskWatcherRuntime = runtime;
    sessionRecord.sessionTaskUnsubscribe = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        fsWatcher?.close();
      } catch {}
      fsWatcher = null;
      watchedDir = null;
      try {
        unsubscribe?.();
      } catch {}
      sessionRecord.sessionTaskWatcherRuntime = null;
      sessionRecord.sessionTaskUnsubscribe = null;
    };
  }

  // Task output files live at <claudeTmp>/<sanitized-cwd>/<engineSessionId>/tasks/<taskId>.output.
  // The sanitized-cwd segment is version-dependent, so locate it by scanning the
  // project dirs for the known engine session id instead of reconstructing it.
  const taskOutputPathCache = new Map();

  function getClaudeTempDirForLookup() {
    if (process.platform === 'win32') {
      return path.join(process.env.CLAUDE_CODE_TMPDIR || os.tmpdir(), 'claude');
    }
    let base = process.env.CLAUDE_CODE_TMPDIR || '/tmp';
    try {
      base = fs.realpathSync(base);
    } catch {}
    return path.join(base, `claude-${process.getuid?.() ?? 0}`);
  }

  function findTaskOutputPath(sessionRecord, taskId) {
    if (!/^[\w.-]+$/.test(String(taskId))) return null;
    const cached = taskOutputPathCache.get(taskId);
    if (cached && fs.existsSync(cached)) return cached;

    const engineSessionIds = [
      sessionRecord.runtime?.sessionId,
      sessionRecord.underlyingSessionId,
    ].filter(Boolean);
    const claudeTmp = getClaudeTempDirForLookup();
    let projectDirs = [];
    try {
      projectDirs = fs.readdirSync(claudeTmp);
    } catch {
      return null;
    }
    for (const dir of projectDirs) {
      for (const sid of engineSessionIds) {
        const candidate = path.join(claudeTmp, dir, sid, 'tasks', `${taskId}.output`);
        if (fs.existsSync(candidate)) {
          taskOutputPathCache.set(taskId, candidate);
          return candidate;
        }
      }
    }
    return null;
  }

  async function readTaskOutputTail(filePath, maxBytes = 16 * 1024) {
    const handle = await fsp.open(filePath, 'r');
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - maxBytes);
      const length = size - start;
      if (length === 0) return { content: '', truncated: false, size };
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      return { content: buffer.toString('utf8'), truncated: start > 0, size };
    } finally {
      await handle.close();
    }
  }

  function registerIpc(ipcMain) {
    ipcMain.handle('agent:list-background-tasks', async (_event, { sessionId }) => {
      const sessionRecord = getSessionRecord(sessionId);
      return { tasks: snapshotBackgroundTasks(sessionRecord) };
    });

    ipcMain.handle('agent:task-output', async (_event, { sessionId, taskId, maxBytes }) => {
      const sessionRecord = getSessionRecord(sessionId);
      const filePath = findTaskOutputPath(sessionRecord, taskId);
      if (!filePath) return { content: '', truncated: false };
      try {
        return await readTaskOutputTail(filePath, Number(maxBytes) > 0 ? Number(maxBytes) : undefined);
      } catch {
        return { content: '', truncated: false };
      }
    });

    ipcMain.handle('agent:kill-task', async (_event, { sessionId, taskId }) => {
      if (cancelAppTask(sessionId, taskId)) return { ok: true };
      const sessionRecord = getSessionRecord(sessionId);
      const state = sessionRecord.runtime?.getAppState?.();
      const task = state?.tasks?.[taskId];
      if (!task || task.status !== 'running') {
        return { ok: false, error: 'Task is not running.' };
      }
      try {
        if (typeof sessionRecord.runtime?.stopTask === 'function') {
          await sessionRecord.runtime.stopTask(taskId);
          return { ok: true };
        }
        if (task.type !== 'local_bash') {
          return { ok: false, error: 'Task cannot be stopped here.' };
        }
        task.shellCommand?.kill();
        task.shellCommand?.cleanup?.();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
    });
  }

  return {
    attachBackgroundTaskWatcher,
    attachSessionTaskWatcher,
    getClaudeTempDirForLookup,
    snapshotBackgroundTasks,
    snapshotSessionTasks,
    registerIpc,
  };
}
