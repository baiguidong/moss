import { spawn } from 'child_process'
import type { McpServer } from './types.js'
import type { McpConnectionTestResult } from './types.js'

export async function testMcpConnection(server: McpServer): Promise<McpConnectionTestResult> {
  const start = Date.now()

  try {
    if (server.mcp_type === 'http' || server.mcp_type === 'sse') {
      return await testHttpConnection(server.url, server.timeout_ms)
    }

    if (server.mcp_type === 'stdio') {
      return await testStdioConnection(server.command, server.args_json, server.env_json, server.timeout_ms)
    }

    return { ok: false, message: `不支持的 MCP 类型: ${server.mcp_type}`, latency_ms: Date.now() - start }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : '连接测试失败',
      latency_ms: Date.now() - start,
    }
  }
}

async function testHttpConnection(url: string | null, timeoutMs: number): Promise<McpConnectionTestResult> {
  const start = Date.now()
  if (!url) {
    return { ok: false, message: 'URL 未配置', latency_ms: Date.now() - start }
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const latencyMs = Date.now() - start
    if (response.ok) {
      return { ok: true, message: `连接成功 (HTTP ${response.status})`, latency_ms: latencyMs }
    }
    return { ok: false, message: `HTTP ${response.status}: ${response.statusText}`, latency_ms: latencyMs }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : '连接失败',
      latency_ms: Date.now() - start,
    }
  }
}

async function testStdioConnection(
  command: string | null,
  argsJson: string | null,
  envJson: string | null,
  timeoutMs: number,
): Promise<McpConnectionTestResult> {
  const start = Date.now()
  if (!command) {
    return { ok: false, message: '启动命令未配置', latency_ms: Date.now() - start }
  }

  let args: string[] = []
  if (argsJson) {
    try {
      const parsed = JSON.parse(argsJson)
      if (Array.isArray(parsed)) args = parsed.filter((v: unknown) => typeof v === 'string')
    } catch { /* ignore */ }
  }

  let env: Record<string, string> | undefined
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson)
      if (typeof parsed === 'object' && parsed !== null) {
        env = { ...process.env as Record<string, string>, ...parsed as Record<string, string> }
      }
    } catch { /* ignore */ }
  }

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let settled = false
    const done = (ok: boolean, message: string) => {
      if (settled) return
      settled = true
      try { child.kill() } catch { /* ignore */ }
      resolve({ ok, message, latency_ms: Date.now() - start })
    }

    child.on('error', (err) => {
      done(false, `进程启动失败: ${err.message}`)
    })

    child.on('close', (code) => {
      if (code === 0) {
        done(true, '连接成功')
      } else {
        done(false, `进程退出 (code: ${code})`)
      }
    })

    setTimeout(() => {
      done(false, '连接超时')
    }, timeoutMs)
  })
}
