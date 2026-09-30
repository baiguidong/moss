import { randomUUID } from 'node:crypto'
import { asSessionId } from '../../types/ids.js'
import { runWithSessionIdContext } from '../../utils/sessionIdContext.js'
import { connectToServer, clearServerCache } from './client.js'
import type { McpServerConfig, ScopedMcpServerConfig } from './types.js'

/** An isolated, short-lived connection; never closes a conversation's MCP client. */
export async function inspectDesktopMcpServer(name: string, config: McpServerConfig, signal?: AbortSignal) {
  return runWithSessionIdContext(asSessionId(randomUUID()), null, async () => {
    const started = Date.now()
    const scoped: ScopedMcpServerConfig = { ...config, scope: 'user' }
    signal?.throwIfAborted()
    const connection = await connectToServer(name, scoped)
    try {
      signal?.throwIfAborted()
      if (connection.type !== 'connected') {
        if (connection.type === 'needs-auth') return { state: 'needs-auth', tools: [], checkedAt: Date.now() }
        throw new Error(connection.type === 'failed' ? connection.error || '无法连接 MCP 服务。' : '服务暂不可用。')
      }
      const tools: Array<{ name: string; description: string; disabled: boolean }> = []
      let cursor: string | undefined
      let pages = 0
      if (connection.capabilities.tools) {
        do {
          const page = await connection.client.listTools({ cursor }, { signal, timeout: 15_000 })
          for (const tool of page.tools) {
            if (tools.length >= 200) break
            tools.push({ name: tool.name.slice(0, 256), description: (tool.description || '').slice(0, 1500), disabled: config.disabledTools?.includes(tool.name) || false })
          }
          cursor = page.nextCursor
          if (page.tools.length > 200 || tools.length >= 200) break
        } while (cursor && ++pages < 20)
      }
      return { state: 'connected', serverInfo: connection.serverInfo, tools, truncated: Boolean(cursor || tools.length >= 200), durationMs: Date.now() - started, checkedAt: Date.now() }
    } finally {
      await clearServerCache(name, scoped)
    }
  })
}
