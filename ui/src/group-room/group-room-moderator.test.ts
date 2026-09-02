import { describe, expect, test } from 'bun:test'

import { normalizeModeratorDecision } from './group-room-moderator.mjs'

describe('Group Room moderator decision contract', () => {
  test('accepts a final response and strips unsupported fields', () => {
    expect(normalizeModeratorDecision({ action: 'respond', response: ' Done ', assignments: [] })).toEqual({
      action: 'respond', response: 'Done',
    })
  })

  test('accepts only unique available members within the internal batch limit', () => {
    expect(normalizeModeratorDecision({
      action: 'delegate',
      assignments: [{ memberId: 'a', task: ' Inspect ' }, { memberId: 'b', task: 'Verify' }],
      reason: ' Independent ',
    }, { memberIds: new Set(['a', 'b']), maxAssignments: 2 })).toEqual({
      action: 'delegate',
      assignments: [{ memberId: 'a', task: 'Inspect' }, { memberId: 'b', task: 'Verify' }],
      reason: 'Independent',
    })
    expect(() => normalizeModeratorDecision({
      action: 'delegate', assignments: [{ memberId: 'outside', task: 'Escape' }],
    }, { memberIds: new Set(['a']) })).toThrow('unavailable room member')
    expect(() => normalizeModeratorDecision({
      action: 'delegate', assignments: [{ memberId: 'a', task: 'Again' }],
    }, { memberIds: new Set(['a']), forceFinish: true })).toThrow('safety boundary')
  })
})
