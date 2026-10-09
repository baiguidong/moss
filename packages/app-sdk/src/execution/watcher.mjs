export const DEFAULT_EXECUTION_REFRESH_MS = 5000;
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
/** One Backend subscription; each active execution owns its wait and query cleanup. */
export class ExecutionWatcher {
    client;
    refreshMs;
    listeners = new Map();
    pending = new Set();
    unsubscribe;
    closed = false;
    constructor(client, refreshMs = DEFAULT_EXECUTION_REFRESH_MS) {
        this.client = client;
        this.refreshMs = refreshMs;
        this.unsubscribe = client.on('execution.changed', ({ execution }) => {
            for (const listener of this.listeners.get(execution.id) || [])
                listener(execution);
        });
    }
    wait(initial, signal, onProgress) {
        return new Promise((resolve, reject) => {
            if (this.closed || signal.aborted) {
                reject(signal.reason || new Error('Execution watcher closed'));
                return;
            }
            let state = initial, done = false, querying = false;
            const queries = new AbortController();
            const listeners = this.listeners.get(initial.id) || new Set();
            const finish = (error) => {
                if (done)
                    return;
                done = true;
                clearInterval(timer);
                signal.removeEventListener('abort', abort);
                listeners.delete(update);
                if (!listeners.size)
                    this.listeners.delete(initial.id);
                this.pending.delete(stop);
                queries.abort();
                error ? reject(error) : resolve(state);
            };
            const abort = () => finish(signal.reason || new Error('Execution wait cancelled'));
            const stop = () => finish(new Error('Execution watcher closed'));
            const update = (next) => {
                if (done || next.id !== initial.id || next.taskId !== initial.taskId || next.sequence < state.sequence)
                    return;
                const changed = next.sequence > state.sequence;
                state = next;
                try {
                    if (changed)
                        onProgress(state);
                }
                catch (error) {
                    finish(error);
                    return;
                }
                if (terminal.has(state.status))
                    finish();
            };
            const refresh = async () => {
                if (done || querying)
                    return;
                querying = true;
                try {
                    update(await this.client.request('execution.get', { executionId: initial.id }, { signal: queries.signal }));
                }
                catch (error) {
                    if (!done)
                        finish(error);
                }
                finally {
                    querying = false;
                }
            };
            const timer = setInterval(() => { void refresh(); }, this.refreshMs);
            listeners.add(update);
            this.listeners.set(initial.id, listeners);
            this.pending.add(stop);
            signal.addEventListener('abort', abort, { once: true });
            update(initial);
            // Query after registering: completion may have arrived before execution.start returned.
            void refresh();
        });
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.unsubscribe();
        for (const stop of this.pending)
            stop();
    }
}

/** Durable task change cursors supplement live hints and recover missed notifications. */
export class TaskChangesWatcher {
  constructor(client, onTask, { refreshMs = 5000, onReset = async () => {}, onError = () => {} } = {}) {
    this.client = client; this.onTask = onTask; this.onReset = onReset; this.onError = onError
    this.closed = false; this.controller = new AbortController()
    this.applied = new Map(); this.applying = new Map()
    this.off = client.on('task.changed', ({ task }) => {
      const applied = this.apply(task).catch(error => this.report(error))
      void this.refresh()
      return applied
    })
    this.timer = setInterval(() => { void this.refresh() }, refreshMs)
    this.timer.unref?.()
    this.ready = this.refresh()
  }
  apply(task) {
    const run = async () => {
      if (this.closed) return
      const previous = this.applied.get(task.id), signature = JSON.stringify(task)
      if (previous && (previous.signature === signature || task.revision < previous.revision
        || (task.revision === previous.revision && task.updatedAt < previous.updatedAt))) return
      await this.onTask(task)
      this.applied.delete(task.id)
      this.applied.set(task.id, { signature, revision: task.revision, updatedAt: task.updatedAt })
      if (this.applied.size > 1000) this.applied.delete(this.applied.keys().next().value)
    }
    const previous = this.applying.get(task.id)
    const pending = previous ? previous.catch(() => {}).then(run) : run()
    this.applying.set(task.id, pending)
    return pending.finally(() => { if (this.applying.get(task.id) === pending) this.applying.delete(task.id) })
  }
  refresh() {
    if (this.closed) return Promise.resolve()
    if (this.pending) return this.pending
    this.pending = (async () => {
      let hasMore
      do {
        const first = !this.cursor
        const page = await this.client.request('task.changes', { ...(this.cursor ? { afterCursor: this.cursor } : {}), limit: 100 }, { signal: this.controller.signal })
        if (this.closed) return
        if (first || page.reset) await this.onReset()
        for (const change of page.changes) { if (this.closed) return; await this.apply(change.task) }
        this.cursor = page.nextCursor; hasMore = page.hasMore
      } while (hasMore && !this.closed)
    })().catch(error => { if (!this.closed) this.report(error) }).finally(() => { this.pending = null })
    return this.pending
  }
  report(error) { try { Promise.resolve(this.onError(error)).catch(() => {}) } catch {} }
  close() { if (this.closed) return; this.closed = true; clearInterval(this.timer); this.off(); this.controller.abort() }
}
