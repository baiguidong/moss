import { ImageTools } from '../tools/ImageTool/ImageTool.js'
import { afterEach, describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { BashTool } from '../tools/BashTool/BashTool.js'
import { EnterPlanModeTool } from '../tools/EnterPlanModeTool/EnterPlanModeTool.js'
import { EnterWorktreeTool } from '../tools/EnterWorktreeTool/EnterWorktreeTool.js'
import { MossTools } from '../tools/MossTool/MossTool.js'
import { NotebookEditTool } from '../tools/NotebookEditTool/NotebookEditTool.js'
import { TaskCreateTool } from '../tools/TaskCreateTool/TaskCreateTool.js'
import {
  expandMatchesWithConfiguredGroups,
  ToolSearchTool,
} from '../tools/ToolSearchTool/ToolSearchTool.js'
import { isDeferredTool } from '../tools/ToolSearchTool/prompt.js'
import { WebFetchTool } from '../tools/WebFetchTool/WebFetchTool.js'
import {
  extractDiscoveredToolNames,
  getToolSearchMode,
  isToolSearchEnabled,
} from './toolSearch.js'

const originalEnableToolSearch = process.env.ENABLE_TOOL_SEARCH
const originalDisableBetas = process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS

afterEach(() => {
  if (originalEnableToolSearch === undefined) {
    delete process.env.ENABLE_TOOL_SEARCH
  } else {
    process.env.ENABLE_TOOL_SEARCH = originalEnableToolSearch
  }
  if (originalDisableBetas === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
  } else {
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = originalDisableBetas
  }
})

describe('generic ToolSearch', () => {
  test('is enabled by default independently of experimental API betas', () => {
    delete process.env.ENABLE_TOOL_SEARCH
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
    expect(getToolSearchMode()).toBe('tst')
  })

  test('keeps the explicit environment kill switch', () => {
    process.env.ENABLE_TOOL_SEARCH = 'false'
    expect(getToolSearchMode()).toBe('standard')
  })

  test('does not restrict discovery by model name', async () => {
    delete process.env.ENABLE_TOOL_SEARCH
    expect(await isToolSearchEnabled(
      'claude-haiku-or-any-compatible-model',
      [ToolSearchTool],
      async () => getEmptyToolPermissionContext(),
      [],
    )).toBe(true)
  })

  test('keeps built-in task, plan, network, notebook, shell, and worktree tools resident', () => {
    expect(isDeferredTool(TaskCreateTool)).toBe(false)
    expect(isDeferredTool(EnterPlanModeTool)).toBe(false)
    expect(isDeferredTool(WebFetchTool)).toBe(false)
    expect(isDeferredTool(NotebookEditTool)).toBe(false)
    expect(isDeferredTool(BashTool)).toBe(false)
    expect(isDeferredTool(EnterWorktreeTool)).toBe(false)
  })

  test('continues to defer MCP tools unless they opt out', () => {
    expect(isDeferredTool({ name: 'mcp__demo__read', isMcp: true } as never))
      .toBe(true)
    expect(isDeferredTool({
      name: 'mcp__demo__read',
      isMcp: true,
      alwaysLoad: true,
    } as never)).toBe(false)
  })

  test('restores activated tools from an ordinary ToolSearch result', () => {
    const result = ToolSearchTool.mapToolResultToToolResultBlockParam({
      matches: ['browser_open', 'app_preview'],
      query: 'preview browser',
      total_deferred_tools: 12,
    }, 'tool-use-search')

    expect(typeof result.content).toBe('string')
    expect(result.content).not.toContain('tool_reference')

    const messages = [
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tool-use-search',
            name: 'ToolSearch',
            input: { query: 'preview browser' },
          }],
        },
      },
      {
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool-use-search',
            content: result.content,
          }],
        },
      },
    ]

    expect([...extractDiscoveredToolNames(messages as never)])
      .toEqual(['browser_open', 'app_preview'])
  })

  test('keeps activated groups loaded after conversation compaction', () => {
    const messages = [{
      type: 'system',
      subtype: 'compact_boundary',
      compactMetadata: {
        preCompactDiscoveredTools: ['browser_press', 'browser_scroll'],
      },
    }]

    expect([...extractDiscoveredToolNames(messages as never)])
      .toEqual(['browser_press', 'browser_scroll'])
  })

  test('activates the complete settings group for a matched host tool', () => {
    expect(expandMatchesWithConfiguredGroups(
      ['browser_open'],
      MossTools,
    )).toEqual([
      'browser_open',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_press',
      'browser_scroll',
      'browser_wait',
      'browser_reload',
    ])
    expect(expandMatchesWithConfiguredGroups(
      ['image_edit'],
      ImageTools,
    )).toEqual(['image_generate', 'image_edit'])
  })

  test('only activates group members present in the permitted tool pool', () => {
    const availableTools = MossTools.filter(tool =>
      ['browser_open', 'browser_click'].includes(tool.name),
    )
    expect(expandMatchesWithConfiguredGroups(
      ['browser_open'],
      availableTools,
    )).toEqual(['browser_open', 'browser_click'])
  })

  test('keeps tools outside configured groups scoped to the individual match', () => {
    expect(expandMatchesWithConfiguredGroups(
      ['custom_deferred_tool'],
      [{ name: 'custom_deferred_tool' }] as never,
    )).toEqual(['custom_deferred_tool'])
  })

  test('ignores identical JSON returned by a different tool', () => {
    const payload = JSON.stringify({
      type: 'moss_tool_search_result',
      matches: ['browser_open'],
    })
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tool-use-other',
            name: 'Read',
            input: {},
          }],
        },
      },
      {
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool-use-other',
            content: payload,
          }],
        },
      },
    ]

    expect([...extractDiscoveredToolNames(messages as never)]).toEqual([])
  })
})
