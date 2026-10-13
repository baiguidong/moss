import { AsyncResource } from 'node:async_hooks'
import { setMaxListeners } from 'node:events'

export type McpLifetime = { id: string; signal: AbortSignal }
type Resource = { type: string; cleanup?: () => Promise<void> }
export type ConnectionControls = { signal: AbortSignal; beginRequest(): () => void; disconnected(): void }
type Entry<T> = {
  key: string; owner?: McpLifetime; abortOwner?: () => void; controller: AbortController
  promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void
  closed: Promise<void>; resolveClosed(): void; factory(controls: ConnectionControls): Promise<T>
  started: boolean; closing: boolean; finished: boolean; resource?: T
  idleMs: number; lastUsed: number; timer?: ReturnType<typeof setTimeout>; requests: number
}
const cancelled = () => new DOMException('MCP connection was released by its session', 'AbortError')

/** One process-wide budget; connections are owned by a specific runtime generation. */
export class McpConnectionPool<T extends Resource> {
  private entries = new Map<string, Entry<T>>()
  private queue: Entry<T>[] = []
  private starting = 0
  private live = 0
  private signals = new WeakSet<AbortSignal>()
  constructor(private options: { maxConnections: number; maxStarting: number; maxQueued: number; retired?: (key: string) => void }) {}

  stats() { return { connections: this.live, starting: this.starting, queued: this.queue.length, entries: this.entries.size } }
  has(key: string) { return this.entries.has(key) }
  get(key: string) { return this.entries.get(key)?.promise }

  ownerStats(ownerId: string) {
    const entries = [...this.entries.values()].filter(entry => entry.owner?.id === ownerId && !entry.finished)
    return { connections: entries.length, requests: entries.reduce((total, entry) => total + entry.requests, 0),
      retainedState: entries.some(entry => entry.idleMs <= 0) }
  }
  updateOwnerIdle(ownerId: string, idleMs: number) {
    for (const entry of this.entries.values()) {
      if (entry.owner?.id !== ownerId || entry.idleMs <= 0) continue
      entry.idleMs = idleMs
      this.armIdle(entry, false)
    }
  }

  acquire(key: string, owner: McpLifetime | undefined, factory: Entry<T>['factory'], idleMs = 0): Promise<T> {
    if (owner?.signal.aborted) return Promise.reject(cancelled())
    const existing = this.entries.get(key)
    if (existing) return existing.closing
      ? existing.closed.then(() => this.acquire(key, owner, factory, idleMs)) : existing.promise
    if (this.queue.length >= this.options.maxQueued) return Promise.reject(new Error('MCP 启动队列已满，请稍后重试。'))
    let resolve!: Entry<T>['resolve'], reject!: Entry<T>['reject'], resolveClosed!: () => void
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
    // Aborting a session must be safe even if its former caller no longer awaits this promise.
    void promise.catch(() => {})
    const entry: Entry<T> = { key, owner, factory: AsyncResource.bind(factory), idleMs, controller: new AbortController(), promise, resolve, reject,
      closed: new Promise<void>(yes => { resolveClosed = yes }), resolveClosed,
      started: false, closing: false, finished: false, requests: 0, lastUsed: Date.now() }
    if (owner) {
      if (!this.signals.has(owner.signal)) { setMaxListeners(0, owner.signal); this.signals.add(owner.signal) }
      entry.abortOwner = () => { void this.closeEntry(entry) }
      owner.signal.addEventListener('abort', entry.abortOwner, { once: true })
    }
    this.entries.set(key, entry); this.queue.push(entry); this.pump()
    return promise
  }

  close(key: string): Promise<void> { const entry = this.entries.get(key); return entry ? this.closeEntry(entry) : Promise.resolve() }
  async closeOwner(ownerId: string): Promise<void> {
    await Promise.all([...this.entries.values()].filter(entry => entry.owner?.id === ownerId).map(entry => this.closeEntry(entry)))
  }
  private finish(entry: Entry<T>) {
    if (entry.finished) return
    entry.finished = true
    clearTimeout(entry.timer)
    if (entry.owner && entry.abortOwner) entry.owner.signal.removeEventListener('abort', entry.abortOwner)
    this.queue = this.queue.filter(item => item !== entry)
    if (this.entries.get(entry.key) === entry) {
      this.entries.delete(entry.key)
      this.options.retired?.(entry.key)
    }
    if (entry.started) this.live--
    entry.resolveClosed(); this.pump()
  }
  private armIdle(entry: Entry<T>, touch = true) {
    if (touch) entry.lastUsed = Date.now()
    clearTimeout(entry.timer)
    // Stateful services keep their data until explicit session disposal.
    if (!entry.resource || entry.idleMs <= 0 || entry.requests || entry.closing || entry.finished) return
    entry.timer = setTimeout(() => { void this.closeEntry(entry) }, Math.max(0, entry.idleMs - (Date.now() - entry.lastUsed)))
    entry.timer.unref?.()
  }
  private beginRequest(entry: Entry<T>) {
    if (entry.closing || entry.finished) throw cancelled()
    clearTimeout(entry.timer); entry.requests++
    let released = false
    return () => { if (!released) { released = true; entry.requests--; this.armIdle(entry) } }
  }
  private closeEntry(entry: Entry<T>): Promise<void> {
    if (entry.closing || entry.finished) return entry.closed
    entry.closing = true; clearTimeout(entry.timer); entry.controller.abort(cancelled())
    if (!entry.started) { entry.reject(cancelled()); this.finish(entry) }
    else if (entry.resource) {
      void Promise.resolve().then(() => entry.resource?.cleanup?.()).catch(() => {}).finally(() => this.finish(entry))
    }
    // An in-flight factory receives cancellation and disposes its transport before settling.
    return entry.closed
  }
  private pump() {
    while (this.starting < this.options.maxStarting && this.queue.length) {
      const entry = this.queue.shift()!
      if (entry.closing || entry.finished) continue
      if (this.live >= this.options.maxConnections) {
        entry.reject(new Error(`MCP 活跃连接已达到上限（${this.options.maxConnections}）。请关闭不使用的会话或停用服务后重试。`))
        this.finish(entry); continue
      }
      entry.started = true; this.live++; this.starting++
      void Promise.resolve().then(() => {
        entry.controller.signal.throwIfAborted()
        return entry.factory({ signal: entry.controller.signal, beginRequest: () => this.beginRequest(entry), disconnected: () => { void this.closeEntry(entry) } })
      }).then(async resource => {
        entry.resource = resource
        if (entry.closing) {
          await resource.cleanup?.(); entry.reject(cancelled()); this.finish(entry)
        } else {
          entry.resolve(resource)
          if (resource.type === 'connected') this.armIdle(entry)
          else this.finish(entry)
        }
      }).catch(error => { entry.reject(error); this.finish(entry) })
        .finally(() => { this.starting--; this.pump() })
    }
  }
}
