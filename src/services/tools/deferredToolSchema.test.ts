import { expect, test } from 'bun:test'
import {
  createDeferredToolPlaceholder,
  DEFERRED_TOOL_SCHEMA_ERROR,
  getDeferredToolSchemaHint,
  isDeferredToolSchemaLoaded,
} from './deferredToolSchema.js'
import { TOOL_SEARCH_RESULT_TYPE } from '../../tools/ToolSearchTool/constants.js'

const deferred = { name: 'mcp__docs__search', isMcp: true }

test('deferred tool placeholder carries no callable schema', () => {
  expect(createDeferredToolPlaceholder(deferred)).toEqual({
    type: 'deferred_tool_placeholder',
    name: deferred.name,
    description: 'Schema is loaded by ToolSearch before invocation.',
    schemaLoaded: false,
  })
})

test('unloaded deferred schemas are rejected with a ToolSearch recovery hint', () => {
  expect(isDeferredToolSchemaLoaded(deferred, [])).toBe(false)
  const hint = getDeferredToolSchemaHint(deferred, [], [{ name: 'ToolSearch' }])
  expect(hint).toContain(DEFERRED_TOOL_SCHEMA_ERROR)
  expect(hint).toContain('select:mcp__docs__search')
})

test('a discovered tool is callable after ToolSearch activation', () => {
  const messages = [
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'search-1', name: 'ToolSearch', input: {} },
        ],
      },
    },
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'search-1',
            content: JSON.stringify({ type: TOOL_SEARCH_RESULT_TYPE, matches: [deferred.name] }),
          },
        ],
      },
    },
  ] as never
  expect(isDeferredToolSchemaLoaded(deferred, messages)).toBe(true)
  expect(getDeferredToolSchemaHint(deferred, messages, [{ name: 'ToolSearch' }])).toBeNull()
})
