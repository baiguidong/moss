import { createHash } from 'node:crypto'

/** Cache the resolved API schemas, not tool names or mutable Tool objects. */
export class ToolTokenCache {
  private entries = new Map<string, { pending: Promise<number | null>; expires: number }>()
  constructor(private readonly limit = 64, private readonly retryMs = 30_000, private readonly now = Date.now) {}
  count(identity: unknown, schemas: unknown, calculate: () => Promise<number | null>) {
    const key = createHash('sha256').update(JSON.stringify([identity, schemas])).digest('hex')
    const cached = this.entries.get(key)
    if (cached && cached.expires > this.now()) { this.entries.delete(key); this.entries.set(key, cached); return cached.pending }
    const pending = Promise.resolve().then(calculate)
    const entry = { pending, expires: Infinity }
    this.entries.set(key, entry)
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!)
    void pending.then(value => {
      if (value === null || value === 0) entry.expires = this.now() + this.retryMs
    }, () => { entry.expires = this.now() + this.retryMs })
    return pending
  }
}
