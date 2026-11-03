// Register before queueing: Stop can arrive while Main is still preparing the
// first send, before a runtime exists or exposes its own abort controller.
export function createSessionSendCancellation() {
  const pending = new Map();
  // A Web cancel can arrive just before its send. Bound these short-lived
  // tombstones so that reordering cannot start a message the user removed.
  const canceled = new Map();
  const keyFor = (sessionId, clientMessageId) => JSON.stringify([sessionId, clientMessageId]);
  const prune = () => {
    for (const [key, expires] of canceled) if (expires <= Date.now()) canceled.delete(key);
    while (canceled.size > 1024) canceled.delete(canceled.keys().next().value);
  };
  return {
    async run(sessionId, execute, clientMessageId) {
      const controller = new AbortController();
      prune();
      if (clientMessageId && canceled.has(keyFor(sessionId, clientMessageId))) {
        // Consume the pre-send cancellation once. A later deliberate retry
        // with the same stable message ID must be allowed to start.
        canceled.delete(keyFor(sessionId, clientMessageId));
        controller.abort();
      }
      const request = { controller, clientMessageId, accepted: false };
      const requests = pending.get(sessionId) || new Set();
      pending.set(sessionId, requests);
      requests.add(request);
      const accept = () => {
        controller.signal.throwIfAborted();
        request.accepted = true;
      };
      try { return await execute(controller.signal, accept); }
      finally {
        requests.delete(request);
        if (!requests.size) pending.delete(sessionId);
      }
    },
    cancel(sessionId, clientMessageId) {
      const requests = [...(pending.get(sessionId) || [])].filter(request => request.clientMessageId === clientMessageId);
      if (requests.some(request => request.accepted)) return { ok: true, canceled: false };
      canceled.set(keyFor(sessionId, clientMessageId), Date.now() + 5 * 60_000);
      prune();
      for (const request of requests) request.controller.abort();
      return { ok: true, canceled: true };
    },
    abort(sessionId) {
      for (const request of pending.get(sessionId) || []) request.controller.abort();
    },
  };
}
