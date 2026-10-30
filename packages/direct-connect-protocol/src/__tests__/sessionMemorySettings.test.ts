import { expect, test } from 'bun:test'
import { normalizeSessionMemorySettings, sessionMemorySettingsSchema } from '../index.js'

test('retains retired session-memory payloads for older clients and persisted records', () => {
  expect(normalizeSessionMemorySettings(undefined)).toMatchObject({ enabled: false, compactEnabled: false })
  expect(normalizeSessionMemorySettings({})).toMatchObject({ enabled: false, compactEnabled: false })
  expect(normalizeSessionMemorySettings({ enabled: true })).toMatchObject({ enabled: true, compactEnabled: false })
  const legacy = { enabled: true, compactEnabled: true, minimumMessageTokensToInit: 100, toolCallsBetweenUpdates: 2 }
  expect(sessionMemorySettingsSchema().parse(legacy)).toEqual(legacy)
  expect(normalizeSessionMemorySettings(legacy)).toMatchObject(legacy)
})
