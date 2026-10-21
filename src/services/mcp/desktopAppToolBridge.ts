import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CallToolResultSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { asSessionId } from '../../types/ids.js'
import { runWithCwdOverride } from '../../utils/cwd.js'
import { runWithSessionIdContext } from '../../utils/sessionIdContext.js'
import { clearServerCache, connectToServer, releaseMcpLifetime } from './client.js'
import type { ConnectedMCPServer, McpServerConfig, ScopedMcpServerConfig } from './types.js'

// Match the Agent catalog's transport guard. The Host applies a smaller limit
// after filtering to the consumer's explicitly declared tool names.
const MAX_CATALOG_TOOLS = 10_000
const MAX_CATALOG_BYTES = 8 * 1024 * 1024
const MAX_RESULT_BYTES = 768 * 1024

async function withConnection<T>(name: string, config: McpServerConfig, signal: AbortSignal | undefined,
  timeoutMs: number, run: (connection: ConnectedMCPServer, signal: AbortSignal) => Promise<T>): Promise<T> {
  const id = asSessionId(randomUUID())
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  const scoped: ScopedMcpServerConfig = { ...config, scope: 'user' }
  // The Agent MCP transport uses getOriginalCwd() as a default root and stdio
  // cwd. Give Host calls an empty private directory, never a chat workspace.
  const neutralCwd = await mkdtemp(path.join(tmpdir(), 'moss-app-mcp-'))
  try {
    return await runWithCwdOverride(neutralCwd, () => runWithSessionIdContext(id, null, async () => {
      try {
        boundedSignal.throwIfAborted()
        const connection = await connectToServer(name, scoped)
        boundedSignal.throwIfAborted()
        if (connection.type !== 'connected') {
          throw new Error(connection.type === 'needs-auth' ? 'MCP 服务需要重新授权。'
            : connection.type === 'failed' ? connection.error || '无法连接 MCP 服务。' : 'MCP 服务暂不可用。')
        }
        return await run(connection, boundedSignal)
      } finally {
        try { await clearServerCache(name, scoped) }
        finally { await releaseMcpLifetime(id) }
      }
    }, undefined, undefined, { executionEnvironment: 'desktop', mcpLifetime: { id, signal: boundedSignal } }))
  } finally { await rm(neutralCwd, { recursive: true, force: true }) }
}

async function liveTools(connection: ConnectedMCPServer, signal: AbortSignal): Promise<Tool[]> {
  if (!connection.capabilities.tools) return []
  const tools: Tool[] = [], names = new Set<string>(), cursors = new Set<string>()
  let cursor: string | undefined, bytes = 0
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    signal.throwIfAborted()
    const page = await connection.client.listTools(cursor ? { cursor } : {}, { signal, timeout: 20_000 })
    bytes += Buffer.byteLength(JSON.stringify(page))
    if (bytes > MAX_CATALOG_BYTES || tools.length + page.tools.length > MAX_CATALOG_TOOLS) {
      throw new Error('MCP 工具目录超过跨 App 调用上限。')
    }
    for (const tool of page.tools) {
      if (names.has(tool.name)) throw new Error('MCP 工具目录包含重复名称。')
      names.add(tool.name)
      tools.push(tool)
    }
    if (!page.nextCursor) return tools
    if (cursors.has(page.nextCursor)) throw new Error('MCP 工具目录分页游标重复。')
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
  throw new Error('MCP 工具目录页数超过跨 App 调用上限。')
}

/** An isolated Host connection; a conversation's stateful MCP process is never reused. */
export function listDesktopAppMcpTools(name: string, config: McpServerConfig, signal?: AbortSignal): Promise<Tool[]> {
  return withConnection(name, config, signal, 60_000, (connection, boundedSignal) => liveTools(connection, boundedSignal))
}

/** The authorization callback runs after live discovery and immediately before tools/call. */
export function callDesktopAppMcpTool(name: string, config: McpServerConfig, toolName: string,
  args: Record<string, unknown>, options: { signal?: AbortSignal; beforeCall: (tool: Tool) => Promise<void> }): Promise<unknown> {
  return withConnection(name, config, options.signal, 300_000, async (connection, signal) => {
    const tool = (await liveTools(connection, signal)).find(item => item.name === toolName)
    if (!tool) throw new Error('MCP 工具已删除，请重新发现。')
    signal.throwIfAborted()
    await options.beforeCall(tool)
    signal.throwIfAborted()
    const result = await connection.client.callTool({ name: toolName, arguments: args }, CallToolResultSchema, { signal, timeout: 300_000 })
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) throw new Error('MCP 工具结果超过跨 App 调用上限。')
    return result
  })
}
