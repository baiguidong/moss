import { describe, expect, test } from 'bun:test'
import type { Tool, Tools } from '../Tool.js'
import { asSessionId } from '../types/ids.js'
import { runWithSessionIdContext } from './sessionIdContext.js'
import { applyCoordinatorToolFilter } from './toolPool.js'

function tools(...names: string[]): Tools {
  return names.map(name => ({ name }) as Tool)
}

describe('coordinator tool pool', () => {
  test('keeps normal main-session tools for a group-room moderator', () => {
    const available = tools('Agent', 'SendMessage', 'TaskStop', 'Read', 'Edit', 'Bash', 'TeamCreate', 'TeamDelete')
    const filtered = runWithSessionIdContext(
      asSessionId('group-session'),
      '/workspace',
      () => applyCoordinatorToolFilter(available),
      {
        kind: 'group-room',
        roomId: 'room-1',
        sessionId: 'group-session',
        projectResources: { connectors: [], skills: [], experts: [] },
        memberResources: {},
      },
    )

    expect(filtered.map(tool => tool.name)).toEqual(['Agent', 'SendMessage', 'TaskStop', 'Read', 'Edit', 'Bash'])
  })

  test('keeps the narrow native tool set for other coordinator sessions', () => {
    const filtered = applyCoordinatorToolFilter(tools('Agent', 'SendMessage', 'TaskStop', 'Read', 'Edit', 'Bash'))
    expect(filtered.map(tool => tool.name)).toEqual(['Agent', 'SendMessage', 'TaskStop'])
  })
})
