import { describe, expect, test } from 'bun:test'
import type { Tool, Tools } from '../Tool.js'
import { isDeferredTool } from '../tools/ToolSearchTool/prompt.js'
import {
  applyChatToolFilter,
  applyCoordinatorToolFilter,
} from './toolPool.js'

function tools(...names: string[]): Tools {
  return names.map(name => ({ name }) as Tool)
}

describe('coordinator tool pool', () => {
  test('keeps the narrow native tool set for other coordinator sessions', () => {
    const filtered = applyCoordinatorToolFilter(tools('Agent', 'SendMessage', 'TaskStop', 'Read', 'Edit', 'Bash'))
    expect(filtered.map(tool => tool.name)).toEqual(['Agent', 'SendMessage', 'TaskStop'])
  })
})

describe('desktop chat tool pool', () => {
  test('removes every worker orchestration tool', () => {
    const filtered = applyChatToolFilter(tools(
      'Agent',
      'Task',
      'TaskOutput',
      'TaskStop',
      'SendMessage',
      'TeamCreate',
      'TeamDelete',
      'Read',
      'Bash',
      'library_write',
    ), false)
    expect(filtered.map(tool => tool.name)).toEqual([
      'Read',
      'Bash',
      'library_write',
    ])
  })

  test('restores only the Agent Teams lifecycle tools after explicit opt-in', () => {
    const filtered = applyChatToolFilter(tools(
      'Agent',
      'Task',
      'TaskOutput',
      'TaskStop',
      'SendMessage',
      'TeamCreate',
      'TeamDelete',
      'Read',
      'Bash',
    ), true)
    expect(filtered.map(tool => tool.name)).toEqual([
      'Agent',
      'Task',
      'SendMessage',
      'TeamCreate',
      'TeamDelete',
      'Read',
      'Bash',
    ])
    expect(
      filtered
        .filter(tool => [
          'Agent',
          'Task',
          'SendMessage',
          'TeamCreate',
          'TeamDelete',
        ].includes(tool.name))
        .every(tool => !isDeferredTool(tool)),
    ).toBe(true)
  })
})
