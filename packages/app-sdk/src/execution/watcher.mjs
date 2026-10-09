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
