import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js'
import type { ScopedMcpServerConfig } from './types.js'
import type { CatalogState } from './liveToolCatalog.js'

type CatalogUpdate = {
  name: string
  config: ScopedMcpServerConfig
  connectionStartedAt?: number
  check: { state: 'connected'; checkedAt: number; truncated: boolean; schemaRevision?: string; catalogStale?: boolean; error?: string; tools: Array<{ name: string; description: string; disabled: boolean }> }
}
const listeners = new Set<(update: CatalogUpdate) => void | Promise<void>>()

/** Internal metadata notification; never publishes tool arguments or results. */
export function onMcpToolCatalog(listener: (update: CatalogUpdate) => void | Promise<void>) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function publishMcpToolCatalog(name: string, config: ScopedMcpServerConfig, result: ListToolsResult, connectionStartedAt?: number, status?: CatalogState) {
  if (!listeners.size) return
  const disabled = new Set('disabledTools' in config ? config.disabledTools : [])
  const update: CatalogUpdate = { name, config, connectionStartedAt, check: { state: 'connected', checkedAt: Date.now(), truncated: Boolean(result.nextCursor || result.tools.length > 200),
    ...(status ? { schemaRevision: status.revision, catalogStale: status.stale, checkedAt: status.checkedAt ?? Date.now(), ...(status.error ? { error: status.error } : {}) } : {}),
    tools: result.tools.slice(0, 200).map(tool => ({ name: tool.name, description: tool.description || '', disabled: disabled.has(tool.name) })),
  } }
  for (const listener of listeners) {
    try { Promise.resolve(listener(structuredClone(update))).catch(() => {}) } catch { /* A display update cannot fail an Agent tool call. */ }
  }
}
