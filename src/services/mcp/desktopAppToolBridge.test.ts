import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { callDesktopAppMcpTool, listDesktopAppMcpTools } from './desktopAppToolBridge'

const previousMacro = (globalThis as any).MACRO
;(globalThis as any).MACRO = { VERSION: '0.0.0-test', BUILD_TIME: '', FEEDBACK_CHANNEL: '', ISSUES_EXPLAINER: '', VERSION_CHANGELOG: '' }
afterAll(() => { if (previousMacro) (globalThis as any).MACRO = previousMacro; else delete (globalThis as any).MACRO })

const fixture = path.join(import.meta.dir, 'fixtures/stateful-server.mjs')
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const waitForExit = async (pids: number[]) => {
  for (let i = 0; i < 100; i++) {
    if (pids.every(pid => !alive(pid))) return
    await Bun.sleep(20)
  }
  throw new Error('MCP process was not released')
}

test('Host bridge lists and invokes a real MCP tool in isolated short connections', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-app-mcp-bridge-'))
  const pidLog = path.join(root, 'pids')
  const config = { type: 'stdio' as const, command: 'node', args: [fixture], env: { MCP_TEST_PID_LOG: pidLog } }
  try {
    const tools = await listDesktopAppMcpTools('@bridge_fixture', config)
    expect(tools.map(tool => tool.name)).toEqual(['set_value', 'get_value'])
    expect(tools[0].inputSchema).toMatchObject({ properties: { value: { type: 'string' } } })
    let checked = false
    const result = await callDesktopAppMcpTool('@bridge_fixture', config, 'set_value', { value: 'from App' }, {
      beforeCall: async tool => { expect(tool.name).toBe('set_value'); checked = true },
    }) as { content: { type: string; text: string }[] }
    expect(checked).toBe(true)
    const value = JSON.parse(result.content[0].text)
    expect(value.value).toBe('from App')
    expect(value.cwd).toContain('moss-app-mcp-')
    expect(await stat(value.cwd).then(() => true, () => false)).toBe(false)
    const pids = (await readFile(pidLog, 'utf8')).trim().split('\n').map(Number)
    expect(pids).toHaveLength(2)
    expect(pids[0]).not.toBe(pids[1])
    await waitForExit(pids)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 20_000)

test('a canceled Host MCP call releases its subprocess', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-app-mcp-cancel-'))
  const pidLog = path.join(root, 'pids'), controller = new AbortController()
  const config = { type: 'stdio' as const, command: 'node', args: [fixture], env: { MCP_TEST_PID_LOG: pidLog, MCP_TEST_TOOL_DELAY: '5000' } }
  try {
    const pending = callDesktopAppMcpTool('bridge_cancel', config, 'get_value', {}, {
      signal: controller.signal,
      beforeCall: async () => { setTimeout(() => controller.abort(), 30) },
    })
    await expect(pending).rejects.toThrow()
    const pids = (await readFile(pidLog, 'utf8')).trim().split('\n').map(Number)
    await waitForExit(pids)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 20_000)
