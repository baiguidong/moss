import { createHash } from 'node:crypto'
import { ListToolsResultSchema, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js'

export const catalogRevision = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export type CatalogState = { revision?: string; checkedAt?: number; stale: boolean; error?: string }

/** One instance per transport. A partial page never replaces the last complete snapshot. */
export class LiveToolCatalog {
  snapshot?: { result: ListToolsResult; revision: string; checkedAt: number }
  private pending?: Promise<ListToolsResult>
  private error?: string
  private generation = 0
  constructor(private options: {
    page(cursor: string | undefined, signal: AbortSignal): Promise<unknown>
    signal?: AbortSignal
    assertOpen?: () => void
    committed?: (result: ListToolsResult, state: CatalogState) => void
    failed?: (state: CatalogState) => void
    timeoutMs?: number
  }) {}

  state(): CatalogState {
    return { revision: this.snapshot?.revision, checkedAt: this.snapshot?.checkedAt,
      stale: Boolean(this.error), ...(this.error ? { error: this.error } : {}) }
  }

  refresh(options: { invalidated?: boolean } = {}): Promise<ListToolsResult> {
    if (options.invalidated) this.generation++
    if (this.pending) return this.pending
    const operation = this.read()
    this.pending = operation
    void operation.finally(() => { if (this.pending === operation) this.pending = undefined }).catch(() => {})
    return operation
  }

  private async read(): Promise<ListToolsResult> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 20_000)
    const signal = this.options.signal ? AbortSignal.any([this.options.signal, timeout]) : timeout
    try {
      let pages = 0
      for (;;) {
        const generation = this.generation
        const tools: ListToolsResult['tools'] = [], cursors = new Set<string>(), names = new Set<string>()
        let cursor: string | undefined, bytes = 0
        for (;;) {
          signal.throwIfAborted(); this.options.assertOpen?.()
          if (pages++ >= 100) throw new Error('MCP tool catalog exceeded 100 pages')
          const result = ListToolsResultSchema.parse(await this.options.page(cursor, signal))
          // A notification during pagination invalidates the entire candidate.
          // Retry within the same deadline/page budget and keep the old snapshot.
          if (generation !== this.generation) break
          bytes += Buffer.byteLength(JSON.stringify(result))
          if (bytes > 8 * 1024 * 1024 || tools.length + result.tools.length > 10_000) throw new Error('MCP tool catalog exceeded its size limit')
          for (const tool of result.tools) {
            if (names.has(tool.name)) throw new Error(`Duplicate MCP tool name: ${tool.name}`)
            names.add(tool.name); tools.push(tool)
          }
          cursor = result.nextCursor
          if (cursor === undefined) break
          if (cursors.has(cursor)) throw new Error('MCP tool catalog repeated a pagination cursor')
          cursors.add(cursor)
        }
        signal.throwIfAborted(); this.options.assertOpen?.()
        if (generation !== this.generation) continue
        const result = { tools }, revision = catalogRevision(result)
        this.snapshot = { result, revision, checkedAt: Date.now() }; this.error = undefined
        this.options.committed?.(result, this.state())
        return result
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.options.failed?.(this.state())
      throw error
    }
  }
}
