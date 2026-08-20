import type { ScopedLspServerConfig } from './types.js'

/**
 * Get all configured LSP servers.
 *
 * @returns Object containing servers configuration keyed by scoped server name
 */
export async function getAllLspServers(): Promise<{
  servers: Record<string, ScopedLspServerConfig>
}> {
  return {
    servers: {},
  }
}
