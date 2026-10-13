import { afterEach, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext, type Tool, type ToolUseContext } from '../../Tool.js'
import { createMcpAuthTool } from '../../tools/McpAuthTool/McpAuthTool.js'
import { ToolSearchTool } from '../../tools/ToolSearchTool/ToolSearchTool.js'
import { filterToolsForAgent } from '../../tools/AgentTool/agentToolUtils.js'
import { filterToolsForProjectWorker, type ProjectWorkerResourceSelection } from '../../tools/AgentTool/projectResourceScope.js'
import { asSessionId } from '../../types/ids.js'
import type { AssistantMessage } from '../../types/message.js'
import { toolToAPISchema } from '../../utils/api.js'
import { getDenyRuleForTool, getAskRuleForTool, toolAlwaysAllowedRule } from '../../utils/permissions/permissions.js'
import { runWithSessionIdContext } from '../../utils/sessionIdContext.js'
import { validatePermissionRule } from '../../utils/settings/permissionValidation.js'
import { fetchToolsForClient } from './client.js'
import { getMcpDisplayName, getMcpToolInfo, getToolNameForPermissionCheck } from './mcpStringUtils.js'
import { excludeToolsByServer, filterToolsByServer } from './utils.js'

const appId = 'moss.sequential-thinking'
const serverName = 'moss_sequential_thinking'
const expectedName = `${serverName}__sequentialthinking`
const originalSkipPrefix = process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX
afterEach(() => {
  if (originalSkipPrefix === undefined) delete process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX
  else process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX = originalSkipPrefix
})

function inApp<T>(owner: string | undefined, name: string, action: () => T): T {
  return runWithSessionIdContext(asSessionId(crypto.randomUUID()), null, action, undefined, undefined, {
    executionEnvironment: 'desktop',
    appToolPolicy: { appIds: owner ? [owner] : [], mcpServers: owner ? { [name]: { appId: owner } } : {} },
  })
}

async function convert(owner: string | undefined = appId, name = serverName) {
  delete process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX
  const calls: unknown[] = []
  const tools = await inApp(owner, name, () => fetchToolsForClient({
    type: 'connected', name, capabilities: { tools: {} },
    config: { type: 'sdk', name, scope: 'dynamic' },
    client: {
      request: async () => ({ tools: ['sequentialthinking', 'reset'].map(name => ({
        name, description: name, inputSchema: { type: 'object', properties: {} },
      })) }),
      callTool: async (params: unknown) => {
        calls.push(params)
        return { content: [{ type: 'text', text: 'done' }] }
      },
    },
  } as never))
  return { tools, calls }
}

test('App MCP names reach the API directly and still call the original upstream tool', async () => {
  const { tools, calls } = await convert()
  const tool = tools[0]!
  expect(tool.name).toBe(expectedName)
  expect(tool.name.length).toBe(44)
  expect(tool.aliases).toBeUndefined()
  expect(getMcpToolInfo(tool)).toEqual({ appId, serverName, toolName: 'sequentialthinking' })
  expect(getMcpDisplayName(tool.name, serverName)).toBe('sequentialthinking')
  const schema = await toolToAPISchema(tool, {
    tools, agents: [], getToolPermissionContext: async () => getEmptyToolPermissionContext(),
  })
  expect(schema.name).toBe(expectedName)
  const permission = await tool.checkPermissions({}, {} as ToolUseContext)
  expect(permission).toMatchObject({ suggestions: [{ rules: [{ toolName: expectedName }] }] })
  const result = await tool.call({ thought: 'demo' }, {
    abortController: new AbortController(), setAppState: () => {},
  } as unknown as ToolUseContext, async () => ({ behavior: 'allow', updatedInput: {} }), {
    message: { content: [{ type: 'tool_use', name: expectedName, id: 'call-demo', input: {} }] },
  } as AssistantMessage)
  expect(result.data).toEqual([{ type: 'text', text: 'done' }])
  expect(calls).toMatchObject([{ name: 'sequentialthinking', arguments: { thought: 'demo' } }])
})

test('ordinary MCP and manager services keep their namespace, and App authentication follows the new name', async () => {
  const managed = await convert('moss.mcp', 'sequential-thinking')
  expect(managed.tools[0]!.name).toBe('mcp__sequential-thinking__sequentialthinking')
  const ordinary = await inApp(undefined, serverName, () => fetchToolsForClient({
    type: 'connected', name: serverName, capabilities: { tools: {} },
    config: { type: 'stdio', command: 'fixture', args: [], scope: 'dynamic' },
    deferredTools: { tools: [{ name: 'read', inputSchema: { type: 'object' } }] },
  } as never))
  expect(ordinary[0]!.name).toBe(`mcp__${serverName}__read`)
  const auth = inApp(appId, serverName, () => createMcpAuthTool(serverName, {
    type: 'http', url: 'https://example.invalid/mcp', scope: 'dynamic',
  }))
  expect(auth.name).toBe(`${serverName}__authenticate`)
  expect(auth.mcpInfo?.appId).toBe(appId)
})

test('exact and server permission rules use App names while SDK builtin overrides remain isolated', async () => {
  const { tools } = await convert()
  const tool = tools[0]!
  expect(getToolNameForPermissionCheck(tool)).toBe(expectedName)
  for (const rule of [expectedName, serverName, `${serverName}__*`]) {
    const permission = { ...getEmptyToolPermissionContext(),
      alwaysAllowRules: { session: [rule] }, alwaysDenyRules: { session: [rule] }, alwaysAskRules: { session: [rule] },
    }
    expect(toolAlwaysAllowedRule(permission, tool)).not.toBeNull()
    expect(getDenyRuleForTool(permission, tool)).not.toBeNull()
    expect(getAskRuleForTool(permission, tool)).not.toBeNull()
  }
  const nested = (await convert(appId, `${serverName}__secondary`)).tools[0]!
  const permission = { ...getEmptyToolPermissionContext(), alwaysDenyRules: { session: [`${serverName}__*`, 'Write'] } }
  expect(getDenyRuleForTool(permission, nested)).toBeNull()
  expect(getDenyRuleForTool(permission, { name: 'Write', mcpInfo: { serverName: 'sdk', toolName: 'Write' } })).toBeNull()
})

test('server cleanup and worker filtering use metadata for App tools', async () => {
  const { tools } = await convert()
  const nested = (await convert(appId, `${serverName}__secondary`)).tools
  const pool = [...tools, ...nested, { name: 'Read' } as Tool]
  expect(filterToolsByServer(pool, serverName)).toEqual(tools)
  expect(excludeToolsByServer(pool, serverName)).toEqual([...nested, pool.at(-1)!])
  expect(filterToolsForAgent({ tools, isBuiltIn: false, isAsync: true })).toEqual(tools)
  const selection = { connectorServerNames: new Set([serverName]) } as ProjectWorkerResourceSelection
  expect(filterToolsForProjectWorker(pool, selection)).toEqual([...tools, pool.at(-1)!])
})

test('permission settings accept App tool names and service wildcards without capitalization', () => {
  for (const name of [expectedName, `${serverName}__*`, `${serverName}__secondary__reset`, `${serverName}__secondary__*`]) {
    expect(validatePermissionRule(name).valid).toBe(true)
    expect(validatePermissionRule(`${name}(*)`).valid).toBe(false)
  }
})

test('ToolSearch discovers and activates App MCP tools using the new names', async () => {
  const { tools } = await convert()
  const nested = (await convert(appId, `${serverName}__secondary`)).tools
  const context = {
    options: { tools: [...tools, ...nested] }, getAppState: () => ({ mcp: { clients: [] } }),
  } as unknown as ToolUseContext
  for (const query of [`select:${expectedName}`, 'sequentialthinking']) {
    expect((await ToolSearchTool.call({ query, max_results: 1 }, context)).data.matches).toEqual(tools.map(tool => tool.name))
  }
})
