import { afterEach, expect, test } from 'bun:test'
import { normalizeAppToolName } from '../../../packages/app-sdk/src/tool-names.mjs'
import { assembleToolPool } from '../../tools.js'
import { matchesToolSelector } from '../../utils/appToolNames.js'
import { findToolByName } from '../../Tool.js'
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
const expectedName = 'sequentialthinking_sequentialthinking'
const originalSkipPrefix = process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX
afterEach(() => {
  if (originalSkipPrefix === undefined) delete process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX
  else process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX = originalSkipPrefix
})

function inApp<T>(owner: string | undefined, name: string, action: () => T, environment?: Record<string, string>): T {
  return runWithSessionIdContext(asSessionId(crypto.randomUUID()), null, action, undefined, environment, {
    executionEnvironment: 'desktop',
    appToolPolicy: { appIds: owner ? [owner] : [], mcpServers: owner ? { [name]: { appId: owner } } : {} },
  })
}

async function convert(owner: string | undefined = appId, name = serverName, toolNames = ['sequentialthinking', 'reset']) {
  const calls: unknown[] = []
  const tools = await inApp(owner, name, () => fetchToolsForClient({
    type: 'connected', name, capabilities: { tools: {} },
    config: { type: 'sdk', name, scope: 'dynamic' },
    client: {
      request: async () => ({ tools: toolNames.map(name => ({
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

test('App MCP names use the App prefix in the API and call the original upstream tool', async () => {
  const { tools, calls } = await convert()
  const tool = tools[0]!
  expect(tool.name).toBe(expectedName)
  expect(tool.name.length).toBeLessThanOrEqual(64)
  expect(tool.aliases).toBeUndefined()
  expect(getMcpToolInfo(tool)).toEqual({ appId, serverName, toolName: 'sequentialthinking' })
  expect(getMcpDisplayName(tool.name, serverName)).toBe(expectedName)
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

test('only builtin Apps omit prefixes; ordinary MCP and Host authentication remain namespaced', async () => {
  const builtin = await convert('moss.spreadsheets', 'sheets', ['read_sheet'])
  expect(builtin.tools[0]!.name).toBe('read_sheet')
  const managed = await convert('moss.mcp', 'sequential-thinking')
  expect(managed.tools[0]!.name).toBe('mcp_sequentialthinking')
  const ordinary = await inApp(undefined, serverName, () => fetchToolsForClient({
    type: 'connected', name: serverName, capabilities: { tools: {} },
    config: { type: 'stdio', command: 'fixture', args: [], scope: 'dynamic' },
    deferredTools: { tools: [{ name: 'read', inputSchema: { type: 'object' } }] },
  } as never))
  expect(ordinary[0]!.name).toBe(`mcp__${serverName}__read`)
  const auth = inApp(appId, serverName, () => createMcpAuthTool(serverName, {
    type: 'http', url: 'https://example.invalid/mcp', scope: 'dynamic',
  }))
  expect(auth.name).toBe(normalizeAppToolName(`${serverName}_authenticate`, appId))
  expect(auth.mcpInfo?.appId).toBe(appId)
})

test('QQ Mail SendMessage coexists with Core, uses isolated permissions and dispatches upstream unchanged', async () => {
  // SDK's opt-in builtin override must not remove an App's namespace.
  process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX = 'true'
  const { tools, calls } = await convert('moss.qq-mail', 'qq-mail', ['SendMessage'])
  const mail = tools[0]!
  expect(mail.name).toBe('qqmail_SendMessage')
  const pool = inApp('moss.qq-mail', 'qq-mail', () => assembleToolPool(getEmptyToolPermissionContext(), [mail]), { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: 'true' })
  const core = findToolByName(pool, 'SendMessage')!
  expect(core).toBeDefined()
  expect(core.mcpInfo).toBeUndefined()
  expect(findToolByName(pool, mail.name)).toBeDefined()
  expect(findToolByName([core, mail], 'SendMessage')).toBe(core)
  expect(findToolByName([core, mail], 'qqmail_SendMessage')).toBe(mail)
  expect(matchesToolSelector(mail, ['SendMessage'])).toBe(false)
  expect(matchesToolSelector(mail, ['qq-mail__SendMessage'])).toBe(true)
  expect(matchesToolSelector(mail, ['qqmail_SendMessage'])).toBe(true)
  for (const rule of ['qqmail_SendMessage', 'qq-mail__SendMessage', 'qq-mail__*']) {
    const permission = { ...getEmptyToolPermissionContext(),
      alwaysAllowRules: { session: [rule] }, alwaysDenyRules: { session: [rule] }, alwaysAskRules: { session: [rule] },
    }
    expect(toolAlwaysAllowedRule(permission, mail)).not.toBeNull()
    expect(getDenyRuleForTool(permission, mail)).not.toBeNull()
    expect(getAskRuleForTool(permission, mail)).not.toBeNull()
    expect(toolAlwaysAllowedRule(permission, core)).toBeNull()
    expect(getDenyRuleForTool(permission, core)).toBeNull()
    expect(getAskRuleForTool(permission, core)).toBeNull()
  }
  const permission = { ...getEmptyToolPermissionContext(), alwaysAllowRules: { session: ['SendMessage'] }, alwaysDenyRules: { session: ['SendMessage'] }, alwaysAskRules: { session: ['SendMessage'] } }
  expect(toolAlwaysAllowedRule(permission, mail)).toBeNull()
  expect(getDenyRuleForTool(permission, mail)).toBeNull()
  expect(getAskRuleForTool(permission, mail)).toBeNull()
  const schema = await toolToAPISchema(mail, { tools: pool, agents: [], getToolPermissionContext: async () => getEmptyToolPermissionContext() })
  expect(schema.name).toBe('qqmail_SendMessage')
  expect(await mail.checkPermissions({}, {} as ToolUseContext)).toMatchObject({ suggestions: [{ rules: [{ toolName: 'qqmail_SendMessage' }] }] })
  const context = { options: { tools: pool }, getAppState: () => ({ mcp: { clients: [] } }), abortController: new AbortController(), setAppState: () => {} } as unknown as ToolUseContext
  expect((await ToolSearchTool.call({ query: 'select:qqmail_SendMessage', max_results: 1 }, context)).data.matches).toEqual(['qqmail_SendMessage'])
  await mail.call({ subject: 'fixture' }, context, async () => ({ behavior: 'allow', updatedInput: {} }), {
    message: { content: [{ type: 'tool_use', name: mail.name, id: 'mail-fixture', input: {} }] },
  } as AssistantMessage)
  expect(calls).toMatchObject([{ name: 'SendMessage', arguments: { subject: 'fixture' } }])
})

test('exact and server permission rules use App names while SDK builtin overrides remain isolated', async () => {
  const { tools } = await convert()
  const tool = tools[0]!
  expect(getToolNameForPermissionCheck(tool)).toBe(expectedName)
  for (const rule of [expectedName, serverName, `${serverName}__*`, `${serverName}__sequentialthinking`]) {
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
  const nested = (await convert(appId, `${serverName}__secondary`, ['secondary_thinking'])).tools
  const context = {
    options: { tools: [...tools, ...nested] }, getAppState: () => ({ mcp: { clients: [] } }),
  } as unknown as ToolUseContext
  for (const query of [`select:${expectedName}`, 'sequentialthinking']) {
    expect((await ToolSearchTool.call({ query, max_results: 1 }, context)).data.matches).toEqual(tools.map(tool => tool.name))
  }
})
