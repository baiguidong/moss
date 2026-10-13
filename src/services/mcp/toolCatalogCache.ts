import { createHash } from 'node:crypto'
import type { ListToolsResult, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js'

export type ToolCatalogSnapshot = { tools: ListToolsResult; capabilities: ServerCapabilities; serverInfo?: { name: string; version: string }; instructions?: string }

/** Metadata only. No Client objects, tool results, diagram state or credentials. */
export class McpToolCatalogCache {
  private entries = new Map<string, { value: ToolCatalogSnapshot; expires: number; bytes: number }>()
  private bytes = 0
  constructor(private maxEntries = 128, private maxBytes = 8 * 1024 * 1024, private ttlMs = 10 * 60_000) {}
  static key(identity: unknown) { return createHash('sha256').update(JSON.stringify(identity)).digest('hex') }
  get(key: string): ToolCatalogSnapshot | undefined {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    if (entry.expires <= Date.now()) { this.bytes -= entry.bytes; return }
    this.entries.set(key, entry)
    return structuredClone(entry.value)
  }
  put(key: string, value: ToolCatalogSnapshot) {
    this.delete(key)
    const bytes = Buffer.byteLength(JSON.stringify(value))
    if (bytes > this.maxBytes || value.tools.nextCursor || value.capabilities.resources || value.capabilities.prompts) return
    this.entries.set(key, { value: structuredClone(value), bytes, expires: Date.now() + this.ttlMs }); this.bytes += bytes
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.delete(this.entries.keys().next().value!)
  }
  delete(key: string) { const entry = this.entries.get(key); if (entry) this.bytes -= entry.bytes; this.entries.delete(key) }
  stats() { return { entries: this.entries.size, bytes: this.bytes } }
}
export const mcpToolCatalogCache = new McpToolCatalogCache()
