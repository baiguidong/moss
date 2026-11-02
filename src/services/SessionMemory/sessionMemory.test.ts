import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asSessionId } from '../../types/ids.js'
import { runWithSessionIdContext } from '../../utils/sessionIdContext.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

mock.module('color-diff-napi', () => ({
  ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}),
}))
const { getAllBaseTools, getTools, getToolsForDefaultPreset, assembleToolPool } = await import('../../tools.js')
const { getEmptyToolPermissionContext } = await import('../../Tool.js')

let root: string
const originalEnvironment = Object.fromEntries([
  'MOSS_CONFIG_DIR', 'MOSS_SESSION_MEMORY_SETTINGS', 'MOSS_RUNTIME_SESSION_MEMORY_SETTINGS', 'CLAUDE_CODE_SIMPLE',
].map(key => [key, process.env[key]]))

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'moss-retired-session-summary-'))
  const legacySettings = { enabled: true, compactEnabled: true }
  await writeFile(join(root, 'settings.json'), JSON.stringify({ sessionMemory: legacySettings }))
  process.env.MOSS_CONFIG_DIR = root
  process.env.MOSS_SESSION_MEMORY_SETTINGS = JSON.stringify(legacySettings)
  process.env.MOSS_RUNTIME_SESSION_MEMORY_SETTINGS = JSON.stringify(legacySettings)
  delete process.env.CLAUDE_CODE_SIMPLE
  resetSettingsCache()
})
afterEach(async () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetSettingsCache()
  await rm(root, { recursive: true, force: true })
})

test('retired summary tools stay unavailable in CLI, desktop and server despite legacy opt-ins', () => {
  const permissions = getEmptyToolPermissionContext()
  expect(getAllBaseTools().map(tool => tool.name)).not.toContain('SaveSessionSummary')
  for (const runtime of [undefined, { executionEnvironment: 'desktop' as const }, { executionEnvironment: 'server' as const }]) {
    runWithSessionIdContext(asSessionId('retired-summary'), root, () => {
      expect(getTools(permissions).map(tool => tool.name)).not.toContain('SaveSessionSummary')
      expect(getToolsForDefaultPreset()).not.toContain('SaveSessionSummary')
      expect(assembleToolPool(permissions, []).map(tool => tool.name)).not.toContain('SaveSessionSummary')
    }, undefined, { MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: '{"enabled":true}' }, runtime)
  }
})
