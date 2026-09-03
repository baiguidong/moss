import { describe, expect, test } from 'bun:test'
import type { Tool, Tools } from '../Tool.js'
import { applyCoordinatorToolFilter } from './toolPool.js'

function tools(...names: string[]): Tools {
  return names.map(name => ({ name }) as Tool)
}

describe('coordinator tool pool', () => {
  test('keeps the narrow native tool set for other coordinator sessions', () => {
    const filtered = applyCoordinatorToolFilter(tools('Agent', 'SendMessage', 'TaskStop', 'Read', 'Edit', 'Bash'))
    expect(filtered.map(tool => tool.name)).toEqual(['Agent', 'SendMessage', 'TaskStop'])
  })
})
