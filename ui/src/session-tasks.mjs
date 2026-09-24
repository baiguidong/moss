const TASK_STATUSES = new Set(['pending', 'in_progress', 'completed']);
export const SESSION_TASK_POLL_INTERVAL_MS = 5_000;

export function normalizeSessionTask(rawTask) {
  if (!rawTask || typeof rawTask !== 'object' || rawTask.metadata?._internal) return null;
  const id = typeof rawTask.id === 'string' ? rawTask.id : '';
  const subject = typeof rawTask.subject === 'string' ? rawTask.subject : '';
  if (!id.trim() || !subject.trim()) return null;
  return {
    id,
    subject,
    description: typeof rawTask.description === 'string' ? rawTask.description : '',
    activeForm: typeof rawTask.activeForm === 'string' ? rawTask.activeForm : '',
    owner: typeof rawTask.owner === 'string' ? rawTask.owner : null,
    status: TASK_STATUSES.has(rawTask.status) ? rawTask.status : 'pending',
    blockedBy: Array.isArray(rawTask.blockedBy)
      ? rawTask.blockedBy.filter((entry) => typeof entry === 'string')
      : [],
  };
}

export function compareTaskIds(a, b) {
  const left = Number.parseInt(a.id, 10);
  const right = Number.parseInt(b.id, 10);
  if (!Number.isNaN(left) && !Number.isNaN(right)) return left - right;
  return String(a.id).localeCompare(String(b.id));
}

export function snapshotRemoteSessionTasks(record) {
  return record.remoteSessionTasks?.sessionId === record.underlyingSessionId
    ? record.remoteSessionTasks.tasks : [];
}

export function createRemoteSessionTaskSync({ resolveConnection, fetchTasks, onTasks }) {
  const pending = new WeakMap();
  return function sync(record) {
    const sessionId = record.underlyingSessionId;
    if (record.deleted || record.agentMode !== 'remote-direct' || !sessionId) {
      return Promise.resolve([]);
    }
    const current = pending.get(record);
    if (current?.sessionId === sessionId) return current.promise;
    const request = { sessionId, promise: null };
    request.promise = (async () => {
      const connection = await resolveConnection();
      const response = await fetchTasks({ ...connection, sessionId });
      if (record.deleted || record.agentMode !== 'remote-direct' || record.underlyingSessionId !== sessionId) {
        return [];
      }
      const tasks = response.tasks.map(normalizeSessionTask).filter(Boolean).sort(compareTaskIds);
      const changed = JSON.stringify(snapshotRemoteSessionTasks(record)) !== JSON.stringify(tasks);
      record.remoteSessionTasks = { sessionId, tasks };
      if (changed) onTasks(record, tasks);
      return tasks;
    })().finally(() => {
      if (pending.get(record) === request) pending.delete(record);
    });
    pending.set(record, request);
    return request.promise;
  };
}

// Poll even while the agent is idle: another client or a cloud runner can
// change the checklist. Schedule after completion to avoid overlapping calls.
export function startSessionTaskPolling(refresh, {
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  intervalMs = SESSION_TASK_POLL_INTERVAL_MS,
} = {}) {
  let stopped = false;
  let timer;
  const poll = async () => {
    try {
      await refresh();
    } catch {
      // Keep the last successful snapshot and retry on the next tick.
    } finally {
      if (!stopped) timer = setTimer(poll, intervalMs);
    }
  };
  void poll();
  return () => {
    stopped = true;
    clearTimer(timer);
  };
}
