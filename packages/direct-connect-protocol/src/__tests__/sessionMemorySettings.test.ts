import { expect, test } from 'bun:test'
import { normalizeSessionMemorySettings, sessionMemorySettingsSchema } from '../index.js'

test('session summaries default off and preserve an explicit opt-in from existing clients', () => {
  expect(normalizeSessionMemorySettings(undefined)).toMatchObject({ enabled: false, compactEnabled: false })
  expect(normalizeSessionMemorySettings({})).toMatchObject({ enabled: false, compactEnabled: false })
  expect(normalizeSessionMemorySettings({ enabled: true })).toMatchObject({ enabled: true, compactEnabled: false })
  const legacy = { enabled: true, compactEnabled: true, minimumMessageTokensToInit: 100, toolCallsBetweenUpdates: 2 }
  expect(sessionMemorySettingsSchema().parse(legacy)).toEqual(legacy)
  expect(normalizeSessionMemorySettings(legacy)).toMatchObject(legacy)
})
