// A receipt is pending until the owning engine has recorded it in its transcript.
// session_turn_queue already provides the durable event identity and startup storage.
export function createSessionTaskInbox({ db, getSession, whenIdle, deliver, onError, canRun = () => true }) {
  const source = 'runtime-task';
  db.exec("CREATE INDEX IF NOT EXISTS idx_pending_runtime_task ON session_turn_queue(session_id, created_at) WHERE source_channel = 'runtime-task' AND status = 'queued'");
  const insert = db.prepare(`INSERT INTO session_turn_queue
    (id, session_id, source_channel, source_event_id, prompt, payload_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?) ON CONFLICT(source_channel, source_event_id) DO NOTHING`);
  const next = db.prepare(`SELECT id AS uuid, prompt AS value, payload_json, error FROM session_turn_queue
    WHERE source_channel = ? AND session_id = ? AND status = 'queued' ORDER BY created_at, rowid LIMIT 1`);
  const settle = db.prepare(`UPDATE session_turn_queue SET status = ?, prompt = '', error = NULL, updated_at = ?, delivered_at = ?
    WHERE source_channel = ? AND session_id = ? AND id = ? AND status = 'queued'`);
  const cancelPending = db.prepare(`UPDATE session_turn_queue SET status = 'cancelled', prompt = '', updated_at = ?
    WHERE source_channel = ? AND session_id = ? AND status = 'queued'`);
  const pendingSessions = db.prepare(`SELECT DISTINCT session_id FROM session_turn_queue WHERE source_channel = ? AND status = 'queued'`);
  const removeSession = db.prepare('DELETE FROM session_turn_queue WHERE source_channel = ? AND session_id = ?');
  const cancelExecution = db.prepare(`UPDATE session_turn_queue SET status = 'cancelled', prompt = '', updated_at = ?
    WHERE source_channel = ? AND session_id = ? AND status = 'queued' AND json_extract(payload_json, '$.taskId') = ?`);
  const recordFailure = db.prepare("UPDATE session_turn_queue SET error = ?, updated_at = ? WHERE id = ? AND status = 'queued'");
  const scheduled = new Set();
  const epochs = new WeakMap();
  const stoppedTasks = new WeakMap();
  const retryTimers = new Map();

  function finish(sessionId, uuid, status) {
    const now = Date.now();
    settle.run(status, now, now, source, sessionId, uuid);
  }

  function schedule(sessionId) {
    if (!canRun() || scheduled.has(sessionId) || retryTimers.has(sessionId)) return;
    scheduled.add(sessionId);
    setImmediate(async () => {
      let receiptId;
      try {
        await whenIdle(sessionId);
        if (!canRun()) return;
        const receipt = next.get(source, sessionId);
        if (!receipt) return;
        receiptId = receipt.uuid;
        const record = getSession(sessionId);
        if (record?.deleted) return; // Storage shutdown may still roll back deletion.
        if (!record || record.agentMode === 'remote-direct') {
          cancelPending.run(Date.now(), source, sessionId);
          return;
        }
        const { engineId } = JSON.parse(receipt.payload_json);
        if (record.underlyingSessionId !== engineId) {
          finish(sessionId, receipt.uuid, 'cancelled');
          return;
        }
        // Capture the generation before queueing or initializing a runtime.
        if (await deliver(record, bind(record, engineId)) === false) return; // A user turn has priority.
        if (next.get(source, sessionId)?.uuid === receipt.uuid) throw new Error('Runtime did not accept the pending task notification');
      } catch (error) {
        if (!canRun()) return;
        const pending = next.get(source, sessionId);
        if (!pending || (receiptId && receiptId !== pending.uuid)) return;
        onError(sessionId, error);
        recordFailure.run(String(error.message || error), Date.now(), pending.uuid);
        // Retry preparation once. If it still fails, the next user turn or
        // host recovery can retry without continuously opening failed turns.
        if (pending.error) { retryTimers.set(sessionId, null); return; }
        const timer = setTimeout(() => {
          retryTimers.delete(sessionId);
          schedule(sessionId);
        }, 5000);
        timer.unref();
        retryTimers.set(sessionId, timer);
      } finally {
        scheduled.delete(sessionId);
        if (canRun() && !getSession(sessionId)?.deleted && next.get(source, sessionId)) schedule(sessionId);
      }
    });
  }

  function bind(record, engineId) {
    const epoch = epochs.get(record);
    const generation = stoppedTasks.get(record)?.generation || 0;
    if (retryTimers.get(record.id) === null) {
      retryTimers.delete(record.id);
      schedule(record.id);
    }
    const owns = () => record.underlyingSessionId === engineId && epochs.get(record) === epoch;
    return {
      publish(uuid, value, taskId) {
        if (!owns() || (stoppedTasks.get(record)?.tasks.get(taskId) || 0) > generation) return false;
        const now = Date.now();
        const added = insert.run(uuid, record.id, source, uuid, value, JSON.stringify({ engineId, taskId }), now, now);
        if (added.changes) schedule(record.id);
        return true;
      },
      peek() {
        if (!scheduled.has(record.id) || record.deleted || !canRun() || !owns()) return;
        const receipt = next.get(source, record.id);
        if (receipt && JSON.parse(receipt.payload_json).engineId === engineId) return { uuid: receipt.uuid, value: receipt.value };
      },
      acknowledge(uuid) {
        if (owns()) finish(record.id, uuid, 'completed');
      },
    };
  }

  return {
    bind,
    cancelTask(record, taskId) {
      const stopped = stoppedTasks.get(record) || { generation: 0, tasks: new Map() };
      stopped.tasks.set(taskId, ++stopped.generation);
      stoppedTasks.set(record, stopped);
      cancelExecution.run(Date.now(), source, record.id, taskId);
    },
    cancel(record) {
      epochs.set(record, (epochs.get(record) || 0) + 1);
      stoppedTasks.delete(record);
      if (record.deleted) removeSession.run(source, record.id);
      else cancelPending.run(Date.now(), source, record.id);
      clearTimeout(retryTimers.get(record.id));
      retryTimers.delete(record.id);
    },
    recover() {
      for (const { session_id: id } of pendingSessions.all(source)) {
        if (retryTimers.get(id) === null) retryTimers.delete(id);
        schedule(id);
      }
    },
  };
}
