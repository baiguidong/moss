import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { asSessionId } from '../types/ids.js'
import { runWithSessionIdContext } from '../utils/sessionIdContext.js'
import { resetSettingsCache } from '../utils/settings/settingsCache.js'
import {
  getAutoMemorySettings,
  MOSS_AUTO_MEMORY_SETTINGS_ENV,
  MOSS_RUNTIME_AUTO_MEMORY_SETTINGS_ENV,
} from './autoMemorySettings.js'
import {
  getSessionMemorySettings,
  MOSS_RUNTIME_SESSION_MEMORY_SETTINGS_ENV,
  MOSS_SESSION_MEMORY_SETTINGS_ENV,
} from './sessionMemorySettings.js'
import {
  getSessionMemoryConfig,
  resetSessionMemoryState,
  setSessionMemoryConfig,
} from './SessionMemory/sessionMemoryUtils.js'
import {
  persistExtractionState,
  readPersistedExtractionState,
} from './extractMemories/extractMemories.js'

const originalEnvironment = {
  MOSS_CONFIG_DIR: process.env.MOSS_CONFIG_DIR,
  [MOSS_AUTO_MEMORY_SETTINGS_ENV]: process.env[MOSS_AUTO_MEMORY_SETTINGS_ENV],
  [MOSS_RUNTIME_AUTO_MEMORY_SETTINGS_ENV]:
    process.env[MOSS_RUNTIME_AUTO_MEMORY_SETTINGS_ENV],
  [MOSS_SESSION_MEMORY_SETTINGS_ENV]:
    process.env[MOSS_SESSION_MEMORY_SETTINGS_ENV],
  [MOSS_RUNTIME_SESSION_MEMORY_SETTINGS_ENV]:
    process.env[MOSS_RUNTIME_SESSION_MEMORY_SETTINGS_ENV],
}
let tempRoot: string | undefined

afterEach(async () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetSettingsCache()
  resetSessionMemoryState()
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  }
})

describe('Moss memory settings', () => {
  test('resolves runtime snapshots and lets global env enforce policy', () => {
    const runtimeEnvironment = {
      [MOSS_RUNTIME_AUTO_MEMORY_SETTINGS_ENV]: JSON.stringify({
        extractionEnabled: true,
        dreamEnabled: true,
      }),
      [MOSS_RUNTIME_SESSION_MEMORY_SETTINGS_ENV]: JSON.stringify({
        enabled: false,
        minimumMessageTokensToInit: 100,
      }),
    }

    const runtimeSettings = runWithSessionIdContext(
      asSessionId('memory-settings-session'),
      null,
      () => ({
        auto: getAutoMemorySettings(),
        session: getSessionMemorySettings(),
      }),
      undefined,
      runtimeEnvironment,
    )
    expect(runtimeSettings.auto.extractionEnabled).toBe(true)
    expect(runtimeSettings.auto.dreamEnabled).toBe(true)
    expect(runtimeSettings.session.enabled).toBe(false)
    expect(runtimeSettings.session.minimumMessageTokensToInit).toBe(100)

    process.env[MOSS_AUTO_MEMORY_SETTINGS_ENV] = JSON.stringify({
      dreamEnabled: false,
    })
    process.env[MOSS_SESSION_MEMORY_SETTINGS_ENV] = JSON.stringify({
      enabled: true,
    })
    const enforced = runWithSessionIdContext(
      asSessionId('memory-settings-session'),
      null,
      () => ({
        auto: getAutoMemorySettings(),
        session: getSessionMemorySettings(),
      }),
      undefined,
      runtimeEnvironment,
    )
    expect(enforced.auto.dreamEnabled).toBe(false)
    expect(enforced.session.enabled).toBe(true)
  })

  test('keeps session-memory thresholds isolated by session', () => {
    runWithSessionIdContext(asSessionId('session-a'), null, () => {
      setSessionMemoryConfig({ minimumMessageTokensToInit: 111 })
      expect(getSessionMemoryConfig().minimumMessageTokensToInit).toBe(111)
    })
    runWithSessionIdContext(asSessionId('session-b'), null, () => {
      expect(getSessionMemoryConfig().minimumMessageTokensToInit).toBe(10_000)
    })
  })

  test('persists automatic extraction cursor state across runtime lifetimes', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-extraction-state-'))
    process.env.MOSS_CONFIG_DIR = tempRoot

    await runWithSessionIdContext(
      asSessionId('phone-session-1'),
      null,
      () => persistExtractionState('phone-session-1', {
        lastMemoryMessageUuid: 'message-42',
        turnsSinceLastExtraction: 2,
      }),
    )
    const restored = await runWithSessionIdContext(
      asSessionId('phone-session-1'),
      null,
      () => readPersistedExtractionState('phone-session-1'),
    )
    expect(restored).toEqual({
      lastMemoryMessageUuid: 'message-42',
      turnsSinceLastExtraction: 2,
    })
  })
})
