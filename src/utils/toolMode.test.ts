import { describe, expect, test } from 'bun:test'
import type { Tool, Tools } from '../Tool.js'
import { filterToolsForMode, isToolAllowedInMode } from './toolMode.js'

function tool({
  name,
  readOnly = false,
  destructive = false,
  isMcp = false,
}: {
  name: string
  readOnly?: boolean
  destructive?: boolean
  isMcp?: boolean
}): Tool {
  return {
    name,
    isMcp,
    isReadOnly: () => readOnly,
    isDestructive: () => destructive,
  } as Tool
}

describe('embedded tool modes', () => {
  const tools = [
    tool({ name: 'AskUserQuestion', readOnly: true }),
    tool({ name: 'Read', readOnly: true }),
    tool({ name: 'Grep', readOnly: true }),
    tool({ name: 'Bash', readOnly: false }),
    tool({ name: 'Edit', readOnly: false }),
  ] as Tools

  test('keeps the complete tool pool in all mode', () => {
    expect(filterToolsForMode(tools, 'all').map(tool => tool.name)).toEqual([
      'AskUserQuestion',
      'Read',
      'Grep',
      'Bash',
      'Edit',
    ])
  })

  test('keeps only AskUserQuestion in ask-only mode', () => {
    expect(filterToolsForMode(tools, 'ask-only').map(tool => tool.name)).toEqual([
      'AskUserQuestion',
    ])
  })

  test('keeps planning reads and searches out of the built-in tool pool', () => {
    expect(filterToolsForMode(tools, 'goal-readonly').map(tool => tool.name)).toEqual([
      'AskUserQuestion',
      'Read',
      'Grep',
    ])
  })

  test('allows only non-destructive MCP tools that declare themselves read-only', () => {
    expect(
      isToolAllowedInMode(
        tool({ name: 'mcp__mail__search', readOnly: true, isMcp: true }),
        'goal-readonly',
      ),
    ).toBe(true)
    expect(
      isToolAllowedInMode(
        tool({ name: 'mcp__mail__send', readOnly: false, isMcp: true }),
        'goal-readonly',
      ),
    ).toBe(false)
    expect(
      isToolAllowedInMode(
        tool({
          name: 'mcp__drive__delete',
          readOnly: true,
          destructive: true,
          isMcp: true,
        }),
        'goal-readonly',
      ),
    ).toBe(false)
  })
})
