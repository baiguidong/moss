import { expect, test } from 'bun:test'
import type { Tool } from '../Tool.js'
import { attachToolSources } from './toolSources.js'
import { normalizeMessage } from './queryHelpers.js'
import { mergeAssistantMessages } from './messages.js'
import { toSDKMessages } from './messages/mappers.js'
import { toolSourceMetadata } from '../../shared/tool-source.mjs'

test('App, MCP and builtin sources survive sibling merging and SDK conversion outside API content', () => {
  const tools = [
    { name: 'create', appInfo: { appId: 'example.visual', appDisplayName: '可视化', contributionId: 'example.visual/create' } },
    { name: 'browser_navigate', mcpInfo: { appId: 'example.browser', serverName: 'browser', toolName: 'browser_navigate' } },
    { name: 'Read' },
  ] as Tool[]
  const messages = tools.map((tool, index) => {
    const message: any = { type: 'assistant', uuid: `message-${index}`, message: { role: 'assistant', id: 'response', content: [
      { type: 'tool_use', id: `call-${index}`, name: tool.name, input: {} },
    ] } }
    attachToolSources(message, tools)
    expect(message.tool_sources[`call-${index}`].kind).toBe(['app', 'mcp', 'builtin'][index])
    expect(JSON.stringify(message.message)).not.toContain('tool_sources')
    return message
  })
  const merged = messages.reduce(mergeAssistantMessages)
  expect(Object.keys(merged.tool_sources)).toHaveLength(3)
  for (const converted of [...normalizeMessage(merged), ...toSDKMessages([merged])]) {
    expect(converted).toHaveProperty('tool_sources', toolSourceMetadata(merged).tool_sources)
    expect(JSON.stringify(converted.message)).not.toContain('tool_sources')
  }
  const unknown: any = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'unknown', name: 'missing', input: {} }] } }
  attachToolSources(unknown, tools)
  expect(unknown.tool_sources).toBeUndefined()
})
