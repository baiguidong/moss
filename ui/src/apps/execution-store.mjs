import { Worker } from 'node:worker_threads'
import path from 'node:path'

/** SQLite and serialization run off the Electron main thread. No legacy JSON import. */
export class ExecutionStore {
  constructor(directory) {
    this.worker = new Worker(new URL('./execution-store-worker.mjs', import.meta.url), { workerData: { file: path.join(directory, 'tasks.sqlite') } })
    this.pending = new Map()
    this.sequence = 0
    this.batch = []
    this.scheduled = false
    this.worker.on('message', ({ id, result, error }) => {
      const entry = this.pending.get(id)
      this.pending.delete(id)
      if (error) entry?.reject(new Error(error)); else entry?.resolve(result)
    })
    const fail = error => { this.error = error; for (const entry of this.pending.values()) entry.reject(error); this.pending.clear() }
    this.worker.on('error', fail)
    this.worker.on('exit', () => { if (!this.closed) fail(new Error('Execution store exited unexpectedly')) })
  }
  request(method, input) {
    if (this.error) return Promise.reject(this.error)
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, method, input })
    })
  }
  save(task, execution, event) {
    const { executions, ...state } = task
    const value = { task: structuredClone(state), execution: execution ? structuredClone({ ...execution, events: undefined }) : undefined, event: event && structuredClone(event) }
    return new Promise((resolve, reject) => {
      this.batch.push({ value, resolve, reject })
      if (this.scheduled) return
      this.scheduled = true
      queueMicrotask(() => {
        this.scheduled = false
        const entries = this.batch.splice(0)
        this.request('save', entries.map(entry => entry.value)).then(
          result => entries.forEach(entry => entry.resolve(result)),
          error => entries.forEach(entry => entry.reject(error)),
        )
      })
    })
  }
  async close() {
    if (this.closed) return
    this.closed = true
    try { await this.request('close') } finally { await this.worker.terminate() }
  }
}
