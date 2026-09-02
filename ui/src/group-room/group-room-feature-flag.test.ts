import { describe, expect, test } from 'bun:test'

import { isGroupRoomOnlySettingsUpdate } from './group-room-feature-flag.mjs'

describe('Group Room feature flag isolation', () => {
  test('recognizes only the isolated room flag update', () => {
    expect(isGroupRoomOnlySettingsUpdate({ advanced: { moss_group_rooms: true } })).toBe(true)
    expect(isGroupRoomOnlySettingsUpdate({ advanced: { moss_group_rooms: true, moss_scratchpad: true } })).toBe(false)
    expect(isGroupRoomOnlySettingsUpdate({ model: 'other' })).toBe(false)
  })
})
