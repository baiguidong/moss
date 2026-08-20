import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyManagedRuntimeEnv,
  writeManagedSessionSettings,
} from '../backends/directEmbeddedBackend.js'
import type { SystemSettingsPayload } from '../systemSettings.js'

const originalEnv = {
  MOSS_MODEL_BASE_URL: process.env.MOSS_MODEL_BASE_URL,
  MOSS_MODEL_AUTH_TOKEN: process.env.MOSS_MODEL_AUTH_TOKEN,
  MOSS_SERVER_URL: process.env.MOSS_SERVER_URL,
  MOSS_SERVER_AUTH_TOKEN: process.env.MOSS_SERVER_AUTH_TOKEN,
}
let tempRoot: string | undefined

afterEach(async () => {
  for (const [key, value] of Object.entries(originalEnv)) {
    restoreEnv(key, value)
  }
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  }
})

describe('direct embedded backend model settings', () => {
  test('writes per-session settings and env bridge for the agent runtime', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-direct-settings-'))
    const configDir = join(tempRoot, 'config')
    await mkdir(configDir, { recursive: true })

    await writeManagedSessionSettings(
      configDir,
      makeSettings({
        url: 'https://model.session.test',
        apiKey: 'model-session-key',
        model: 'session-model',
        maxTurns: 55,
        thinkingMode: 'enabled',
        thinkingBudgetTokens: 12345,
        serverUrl: 'http://server.session.test',
        serverAuthToken: 'server-session-token',
      }),
    )

    const persisted = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    )
    expect(persisted.models.text).toEqual({
      baseUrl: 'https://model.session.test',
      apiKey: 'model-session-key',
      model: 'session-model',
      maxTurns: 55,
      thinking: {
        mode: 'enabled',
        budgetTokens: 12345,
      },
    })
    expect(persisted.env).toEqual({
      MOSS_MODEL_BASE_URL: 'https://model.session.test',
      MOSS_MODEL_AUTH_TOKEN: 'model-session-key',
      MOSS_SERVER_URL: 'http://server.session.test',
      MOSS_SERVER_AUTH_TOKEN: 'server-session-token',
    })
    expect(persisted.model).toBeUndefined()
    expect(persisted.maxTurns).toBeUndefined()
    expect(persisted.thinkingMode).toBeUndefined()
    expect(persisted.thinkingBudgetTokens).toBeUndefined()
  })

  test('clears stale process env when model settings are empty', () => {
    applyManagedRuntimeEnv(
      makeSettings({
        url: 'https://model.env.test',
        apiKey: 'model-env-key',
        serverUrl: 'http://server.env.test',
        serverAuthToken: 'server-env-token',
      }),
    )
    expect(process.env.MOSS_MODEL_BASE_URL).toBe('https://model.env.test')
    expect(process.env.MOSS_MODEL_AUTH_TOKEN).toBe('model-env-key')
    expect(process.env.MOSS_SERVER_URL).toBe('http://server.env.test')
    expect(process.env.MOSS_SERVER_AUTH_TOKEN).toBe('server-env-token')

    applyManagedRuntimeEnv(
      makeSettings({
        url: '',
        apiKey: '',
        serverUrl: '',
        serverAuthToken: '',
      }),
    )
    expect(process.env.MOSS_MODEL_BASE_URL).toBeUndefined()
    expect(process.env.MOSS_MODEL_AUTH_TOKEN).toBeUndefined()
    expect(process.env.MOSS_SERVER_URL).toBeUndefined()
    expect(process.env.MOSS_SERVER_AUTH_TOKEN).toBeUndefined()
  })
})

function makeSettings(
  overrides: Partial<SystemSettingsPayload>,
): SystemSettingsPayload {
  return {
    bypassPermissions: false,
    model: 'default-model',
    maxTurns: 100,
    thinkingMode: 'adaptive',
    thinkingBudgetTokens: 16000,
    url: '',
    apiKey: '',
    serverUrl: '',
    serverAuthToken: '',
    image: {
      provider: 'openai',
      url: 'https://image.default.test',
      apiKey: 'image-key',
      model: 'image-model',
    },
    skillStore: {
      tenantId: '',
    },
    settingsPath: '',
    settingsExists: true,
    settingsLoaded: true,
    settingsParseError: '',
    ...overrides,
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
