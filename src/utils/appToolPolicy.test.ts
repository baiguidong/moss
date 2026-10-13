import { describe, expect, test } from 'bun:test'
import type { Tool } from '../Tool.js'
import { applyAppToolPolicy } from './appToolPolicy.js'
import { isDeferredTool } from '../tools/ToolSearchTool/prompt.js'
import { expandMatchesWithConfiguredGroups } from '../tools/ToolSearchTool/ToolSearchTool.js'
import { filterToolsForSession } from './toolAvailability.js'
import { runWithSessionIdContext } from './sessionIdContext.js'
import { asSessionId } from '../types/ids.js'

const native = { name: 'native', appInfo: { appId: 'builder' }, deferLoading: true } as Tool
const global = { name: 'global', appInfo: { appId: 'global', toolScope: 'global' }, deferLoading: true } as Tool
const mcp = { name: 'mcp', isMcp: true, mcpInfo: { serverName: 'shared', toolName: 'lookup' }, alwaysLoad: true } as Tool
const tools = [native, global, mcp]
const owners = { shared: { appId: 'builder', toolScope: 'session' as const } }

describe('App tool scope', () => {
  test('defaults to session and excludes both native and MCP tools before group expansion', () => {
    const result = applyAppToolPolicy(tools, { appIds: [], mcpServers: owners })
    expect(result.map(t => t.name)).toEqual(['global'])
    expect(isDeferredTool(result[0]!)).toBe(true)
    expect(expandMatchesWithConfiguredGroups(['native', 'mcp'], result)).toEqual([])
  })
  test('selection pins every tool; removal and another session cannot reuse cached pinning', () => {
    const selected = applyAppToolPolicy(tools, { appIds: ['builder', 'global'], mcpServers: owners })
    expect(selected.every(t => !isDeferredTool(t))).toBe(true)
    expect(selected[2]).not.toBe(mcp)
    expect(native.alwaysLoad).toBeUndefined()
    expect(applyAppToolPolicy(tools, { appIds: [], mcpServers: owners }).map(t => t.name)).toEqual(['global'])
    const unselectedGlobalMcp = applyAppToolPolicy([mcp], { appIds: [], mcpServers: { shared: { appId: 'builder', toolScope: 'global' } } })
    expect(isDeferredTool(unselectedGlobalMcp[0]!)).toBe(true)
    expect(mcp.alwaysLoad).toBe(true)
  })
  test('dynamic and worker pools inherit the session policy through the shared filter', async () => {
    const a = runWithSessionIdContext(asSessionId('app-scope-a'), undefined, async () => {
      await Promise.resolve()
      return filterToolsForSession(tools)
    }, undefined, undefined, { executionEnvironment: 'desktop', appToolPolicy: { appIds: ['builder'], mcpServers: owners } })
    const b = runWithSessionIdContext(asSessionId('app-scope-b'), undefined, async () => {
      await Promise.resolve()
      return filterToolsForSession(tools)
    }, undefined, undefined, { executionEnvironment: 'desktop', appToolPolicy: { appIds: [], mcpServers: owners } })
    expect((await a).find(t => t.name === 'mcp')?.alwaysLoad).toBe(true)
    expect((await b).map(t => t.name)).toEqual(['global'])
  })
})
