import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext, type Tool, type ToolUseContext } from '../../Tool.js'
import { fetchToolsForClient } from '../../services/mcp/client.js'
import { buildMcpToolName } from '../../services/mcp/mcpStringUtils.js'
import { filterToolsByDenyRules } from '../../tools.js'
import { extractDiscoveredToolNames } from '../../utils/toolSearch.js'
import { createAppContributionTools } from '../AppContributionTool/AppContributionTool.js'
import { MossTools } from '../MossTool/MossTool.js'
import { expandMatchesWithConfiguredGroups, ToolSearchTool } from './ToolSearchTool.js'

function mcpTool(serverName: string, toolName: string, name = buildMcpToolName(serverName, toolName)): Tool {
  return {
    name, isMcp: true, mcpInfo: { serverName, toolName },
    prompt: async () => toolName.replaceAll('_', ' '),
    call: async () => { throw new Error('Discovery must not execute tools') },
  } as Tool
}
const browser = ['browser_navigate', 'browser_click', 'browser_snapshot', 'browser_type', 'browser_tabs', 'browser_wait_for', 'browser_take_screenshot']
  .map(name => mcpTool('playwright-cdp', name))
const names = (tools: Tool[]) => tools.map(tool => tool.name)
const search = (tools: Tool[], query: string, max_results = 1) => ToolSearchTool.call({ query, max_results }, {
  options: { tools }, getAppState: () => ({ mcp: { clients: [] } }),
} as unknown as ToolUseContext)
const appTools = createAppContributionTools([
  { appId: 'example.catalog', id: 'example.catalog/search', name: 'app__example_catalog__search', title: 'Search Catalog', description: 'Find records in catalog' },
  { appId: 'example.catalog', id: 'example.catalog/lookup', name: 'app__example_catalog__lookup', title: 'Lookup Catalog', description: 'Retrieve a record' },
  // A different App may have the same normalized prefix, so grouping must use its actual ID.
  { appId: 'example-catalog', id: 'example-catalog/import', name: 'app__example_catalog__import', title: 'Import', description: 'Upload a file' },
].map(tool => ({ ...tool, effect: 'read' as const, inputSchemaDocument: { type: 'object' } })))

describe('provider tool group activation', () => {
  test.each([
    'browser_navigate',
    'browser navigate',
    `select:${browser[0]!.name}`,
    'mcp__playwright-cdp',
  ])('MCP query %s activates the full server group even when max_results is one', async query => {
    const other = mcpTool('another-browser', 'browser_close')
    const result = await search([...MossTools, ...browser, other, ...appTools], query)
    expect(result.data.matches).toEqual(names(browser))
    expect(result.data.matches).not.toContain(other.name)
  })

  test.each(['select:app__example_catalog__search', 'find records'])('App query %s activates only tools from the same actual App ID', async query => {
    expect(appTools[0]!.appInfo).toEqual({ appId: 'example.catalog' })
    const result = await search([...appTools, ...browser], query)
    expect(result.data.matches).toEqual(names(appTools.slice(0, 2)))
  })

  test('server metadata keeps separator-containing names and unprefixed SDK tools isolated', () => {
    const grouped = [mcpTool('example__browser', 'navigate'), mcpTool('example__browser', 'click')]
    const other = mcpTool('example__browser__other', 'navigate')
    expect(expandMatchesWithConfiguredGroups([grouped[0]!.name], [...grouped, other])).toEqual(names(grouped))
    const sdk = [mcpTool('sdk-connector', 'connector_cli_setup', 'connector_cli_setup'), mcpTool('sdk-connector', 'query', 'query')]
    const pool = [...MossTools.filter(tool => tool.name !== 'connector_cli_setup'), ...sdk]
    expect(expandMatchesWithConfiguredGroups(['connector_cli_setup'], pool)).toEqual(names(sdk))
    expect(expandMatchesWithConfiguredGroups(['connector_mcp_authenticate'], pool)).not.toContain('connector_cli_setup')
  })

  test('multiple matches deduplicate groups and remain scoped to the current pool', () => {
    const matches = [browser[0]!.name, appTools[0]!.name, browser[1]!.name, appTools[1]!.name]
    expect(expandMatchesWithConfiguredGroups(matches, [...browser, ...appTools])).toEqual([
      ...names(browser), ...names(appTools.slice(0, 2)),
    ])
    expect(expandMatchesWithConfiguredGroups([browser[0]!.name], browser.slice(0, 1))).toEqual([browser[0]!.name])
    expect(expandMatchesWithConfiguredGroups([browser[0]!.name], browser.slice(1))).toEqual([])
  })

  test('tools lacking provider metadata remain individual even if they have MCP-like names', () => {
    const unknown = [{ name: 'mcp__legacy__read', isMcp: true }, { name: 'mcp__legacy__write', isMcp: true }] as Tool[]
    expect(expandMatchesWithConfiguredGroups([unknown[0]!.name], unknown)).toEqual([unknown[0]!.name])
  })

  test('real MCP conversion removes excluded tools before group expansion and permission filtering remains effective', async () => {
    const converted = await fetchToolsForClient({
      type: 'connected', name: 'group-exclusion-fixture', capabilities: { tools: {} },
      config: { type: 'stdio', command: 'fixture', disabledTools: ['browser_snapshot'] },
      client: { request: async () => ({ tools: browser.slice(0, 3).map(tool => ({ name: tool.mcpInfo!.toolName, inputSchema: { type: 'object' } })) }) },
    } as never)
    expect(converted).toHaveLength(2)
    const permission = { ...getEmptyToolPermissionContext(), alwaysDenyRules: { session: [converted[1]!.name, appTools[1]!.name] } }
    const permitted = filterToolsByDenyRules([...converted, ...appTools], permission)
    const result = await search(permitted, `select:${converted[0]!.name},${appTools[0]!.name}`)
    expect(result.data.matches).toEqual([converted[0]!.name, appTools[0]!.name])
    expect((await search(permitted, `select:${converted[1]!.name},${appTools[1]!.name}`)).data.matches).toEqual([])
  })

  test('entire MCP and App groups persist through history restoration and compaction, without carrying into a new conversation', async () => {
    const result = await search([...browser, ...appTools], `select:${browser[0]!.name},${appTools[0]!.name}`)
    const block = ToolSearchTool.mapToolResultToToolResultBlockParam(result.data, 'activate-groups')
    const discovered = extractDiscoveredToolNames([
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'activate-groups', name: 'ToolSearch', input: {} }] } },
      { type: 'user', message: { content: [block] } },
    ] as never)
    expect([...discovered]).toEqual([...names(browser), ...names(appTools.slice(0, 2))])
    expect(extractDiscoveredToolNames([
      { type: 'system', subtype: 'compact_boundary', compactMetadata: { preCompactDiscoveredTools: [...discovered] } },
    ] as never)).toEqual(discovered)
    expect(extractDiscoveredToolNames([]).size).toBe(0)
  })
})
