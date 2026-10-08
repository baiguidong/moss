import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { compareTaskIds, normalizeSessionTask, snapshotRemoteSessionTasks } from './session-tasks.mjs';

export function createSessionTaskService({
  MOSS_HOME,
  emitToRenderer,
  getLocalSessionEngineDir,
  getSessionRecord,
  scheduleSubAgentSessionSync,
  sessions,
  subAgentSessions,
}) {
  const BACKGROUND_TASK_EMIT_DELAY_MS = 500;
  const WORKFLOW_TASK_EMIT_DELAY_MS = 50;
  const SESSION_TASK_EMIT_DELAY_MS = 150;

  function loadPersistedWorkflowTasks(sessionRecord) {
    const sessionIds = [
      sessionRecord.id,
      sessionRecord.runtime?.sessionId,
      sessionRecord.underlyingSessionId,
    ].filter((value, index, values) => value && values.indexOf(value) === index);
    const historyKey = sessionIds.join(':');
    if (
      sessionRecord.workflowTaskHistoryKey === historyKey &&
      Array.isArray(sessionRecord.workflowTaskHistory)
    ) {
      return sessionRecord.workflowTaskHistory;
    }
    const tasks = [];
    const projectsRoot = path.join(MOSS_HOME, 'projects');
    const workflowDirs = new Set();
    if (sessionRecord.id) {
      const engineDir = getLocalSessionEngineDir(sessionRecord.id);
      for (const sessionId of sessionIds) {
        workflowDirs.add(path.join(engineDir, sessionId, 'workflows'));
      }
      // Older runs used the transient engine session id. Scan only this desktop
      // session's private engine directory so those runs remain visible after a
      // runtime replacement or app restart.
      try {
        for (const entry of fs.readdirSync(engineDir, { withFileTypes: true })) {
          if (entry.isDirectory()) workflowDirs.add(path.join(engineDir, entry.name, 'workflows'));
        }
      } catch {}
    }
    let projects = [];
    try {
      projects = fs.readdirSync(projectsRoot, { withFileTypes: true });
    } catch {}
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      for (const sessionId of sessionIds) {
        workflowDirs.add(path.join(projectsRoot, project.name, sessionId, 'workflows'));
      }
    }
    for (const workflowsDir of workflowDirs) {
      let files = [];
      try {
        files = fs.readdirSync(workflowsDir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith('.run.json')) continue;
        try {
          const runPath = path.join(workflowsDir, file);
          if (fs.statSync(runPath).size > 8 * 1024 * 1024) continue;
          const raw = JSON.parse(fs.readFileSync(runPath, 'utf8'));
          if (
            raw?.version !== 3 ||
            !raw?.taskId ||
            !raw?.workflowRunId ||
            raw?.definition?.version !== 3 ||
            raw?.definition?.kind !== 'state-machine' ||
            raw?.graph?.version !== 3
          ) continue;
          const durableProgress = Array.isArray(raw.workflowProgress)
            ? raw.workflowProgress
            : [];
          const savedLogs = Array.isArray(raw.logs)
            ? raw.logs
              .filter((message) => typeof message === 'string')
              .map((message) => ({ type: 'workflow_log', message }))
            : [];
          tasks.push({
            id: raw.taskId,
            description: raw.summary || raw.description || '',
            command: '',
            kind: 'workflow',
            status: raw.status || 'completed',
            isBackgrounded: true,
            startTime: raw.startTime ?? null,
            endTime: raw.endTime ?? null,
            exitCode: null,
            workflowName: raw.workflowName || null,
            workflowId: raw.workflowId || null,
            workflowRevision: Number(raw.workflowRevision) || null,
            runMode: raw.runMode === 'test' ? 'test' : 'run',
            workflowRunId: raw.workflowRunId,
            definition: raw.definition || null,
            definitionPath: raw.definitionPath || null,
            args: raw.args,
            graph: raw.graph || null,
            mermaid: raw.mermaid || '',
            graphError: raw.graphError || null,
            nodeEvents: Array.isArray(raw.workflowNodeEvents) ? raw.workflowNodeEvents : [],
            progress: [...durableProgress, ...savedLogs],
            agentCount: Number(raw.agentCount) || 0,
            totalTokens: Number(raw.totalTokens) || 0,
            totalToolCalls: Number(raw.totalToolCalls) || 0,
            result: raw.result,
            error: raw.error || null,
          });
        } catch {}
      }
    }
    sessionRecord.workflowTaskHistoryKey = historyKey;
    sessionRecord.workflowTaskHistory = tasks;
    return tasks;
  }

  function snapshotBackgroundTasks(sessionRecord) {
    try {
      const state = sessionRecord.runtime?.getAppState?.();
      const liveTasks = state?.tasks ? Object.values(state.tasks)
        .filter((t) => t && (t.type === 'local_bash' || t.type === 'local_workflow'))
        .map((t) => {
          if (t.type === 'local_workflow') {
            return {
              id: t.id,
              description: t.summary || t.description || '',
              command: '',
              kind: 'workflow',
              status: t.status,
              isBackgrounded: true,
              startTime: t.startTime ?? null,
              endTime: t.endTime ?? null,
              exitCode: null,
              workflowName: t.workflowName || null,
              workflowId: t.workflowId || null,
              workflowRevision: Number(t.workflowRevision) || null,
              runMode: t.runMode === 'test' ? 'test' : 'run',
              workflowRunId: t.workflowRunId || null,
              definition: t.definition || null,
              definitionPath: t.definitionPath || null,
              args: t.args,
              graph: t.graph || null,
              mermaid: t.mermaid || '',
              graphError: t.graphError || null,
              nodeEvents: Array.isArray(t.workflowNodeEvents) ? t.workflowNodeEvents : [],
              progress: Array.isArray(t.workflowProgress) ? t.workflowProgress : [],
              agentCount: Number(t.agentCount) || 0,
              totalTokens: Number(t.totalTokens) || 0,
              totalToolCalls: Number(t.totalToolCalls) || 0,
              result: t.result,
              error: t.error || null,
            };
          }
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
      const taskKey = (task) => task.kind === 'workflow' && task.workflowRunId
        ? `workflow:${task.workflowRunId}`
        : `task:${task.id}`;
      const merged = new Map(
        loadPersistedWorkflowTasks(sessionRecord).map((task) => [taskKey(task), task]),
      );
      // A resumed workflow keeps its run id but gets a new task id. Keying by
      // run id lets the live retry replace the prior snapshot instead of showing
      // both. It also refreshes the in-memory history before a runtime restart.
      for (const task of liveTasks) merged.set(taskKey(task), task);
      const snapshot = [...merged.values()].sort(
        (left, right) => (left.startTime ?? 0) - (right.startTime ?? 0),
      );
      sessionRecord.workflowTaskHistory = snapshot.filter((task) => (
        task.kind === 'workflow' && task.status !== 'running' && task.status !== 'pending'
      ));
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
    let runningWorkflowTaskIds = new Set();
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
      const nextRunningWorkflowTaskIds = new Set(
        Object.values(runtime.getAppState?.()?.tasks || {})
          .filter((task) => task?.type === 'local_workflow' && task?.status === 'running')
          .map((task) => task.id),
      );
      const workflowLifecycleChanged =
        nextRunningWorkflowTaskIds.size !== runningWorkflowTaskIds.size ||
        [...nextRunningWorkflowTaskIds].some((taskId) => !runningWorkflowTaskIds.has(taskId));
      runningWorkflowTaskIds = nextRunningWorkflowTaskIds;
      if (workflowLifecycleChanged) {
        if (timer) clearTimeout(timer);
        emitSnapshot();
        return;
      }
      if (!timer) {
        timer = setTimeout(
          emitSnapshot,
          runningWorkflowTaskIds.size > 0
            ? WORKFLOW_TASK_EMIT_DELAY_MS
            : BACKGROUND_TASK_EMIT_DELAY_MS,
        );
      }
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
        if (task.type === 'local_workflow') {
          task.abortController?.abort(new Error('Workflow stopped by user'));
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
