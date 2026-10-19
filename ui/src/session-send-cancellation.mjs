// Register before queueing: Stop can arrive while Main is still preparing the
// first send, before a runtime exists or exposes its own abort controller.
export function createSessionSendCancellation() {
  const pending = new Map();
  return {
    async run(sessionId, execute) {
      const controller = new AbortController();
      const requests = pending.get(sessionId) || new Set();
      pending.set(sessionId, requests);
      requests.add(controller);
      try { return await execute(controller.signal); }
      finally {
        requests.delete(controller);
        if (!requests.size) pending.delete(sessionId);
      }
    },
    abort(sessionId) {
      for (const controller of pending.get(sessionId) || []) controller.abort();
    },
  };
}
