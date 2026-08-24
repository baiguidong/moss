import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetStateForTests } from '../../bootstrap/state.js'
import {
  applyDefaultConfigEnvironmentVariables,
  applySafeConfigEnvironmentVariables,
} from '../managedEnv.js'
import { getUserSpecifiedModelSetting } from '../model/model.js'
import { resetSettingsCache } from '../settings/settingsCache.js'

const ORIGINAL_DISABLE_EXPERIMENTAL_BETAS =
  process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
const ORIGINAL_MOSS_CONFIG_DIR = process.env.MOSS_CONFIG_DIR
const ORIGINAL_MODEL_BASE_URL = process.env.MOSS_MODEL_BASE_URL
const ORIGINAL_MODEL_AUTH_TOKEN = process.env.MOSS_MODEL_AUTH_TOKEN
const ORIGINAL_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL

let tempRoot: string | undefined

async function restoreEnv(): Promise<void> {
  if (ORIGINAL_DISABLE_EXPERIMENTAL_BETAS === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
  } else {
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS =
      ORIGINAL_DISABLE_EXPERIMENTAL_BETAS
  }
  restoreEnvVar('MOSS_CONFIG_DIR', ORIGINAL_MOSS_CONFIG_DIR)
  restoreEnvVar('MOSS_MODEL_BASE_URL', ORIGINAL_MODEL_BASE_URL)
  restoreEnvVar('MOSS_MODEL_AUTH_TOKEN', ORIGINAL_MODEL_AUTH_TOKEN)
  restoreEnvVar('ANTHROPIC_MODEL', ORIGINAL_ANTHROPIC_MODEL)
  resetSettingsCache()
  resetStateForTests()
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  }
}

afterEach(async () => {
  await restoreEnv()
})

describe('applyDefaultConfigEnvironmentVariables', () => {
  it('defaults experimental betas off when unset', () => {
    delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS

    applyDefaultConfigEnvironmentVariables()

    expect(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe('1')
  })

  it('does not override an explicit env value', () => {
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '0'

    applyDefaultConfigEnvironmentVariables()

    expect(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe('0')
  })
})

describe('applySafeConfigEnvironmentVariables', () => {
  it('falls back to models.text endpoint settings when model env is unset', async () => {
    await writeUserSettings({
      models: {
        text: {
          baseUrl: 'https://model.settings.test/v1/',
          apiKey: 'settings-token',
        },
      },
    })
    delete process.env.MOSS_MODEL_BASE_URL
    delete process.env.MOSS_MODEL_AUTH_TOKEN

    applySafeConfigEnvironmentVariables()

    expect(process.env.MOSS_MODEL_BASE_URL).toBe(
      'https://model.settings.test',
    )
    expect(process.env.MOSS_MODEL_AUTH_TOKEN).toBe('settings-token')
  })

  it('does not mix a settings token into an explicitly configured endpoint', async () => {
    await writeUserSettings({
      models: {
        text: {
          baseUrl: 'https://model.settings.test',
          apiKey: 'settings-token',
        },
      },
    })
    process.env.MOSS_MODEL_BASE_URL = 'https://model.env.test'
    delete process.env.MOSS_MODEL_AUTH_TOKEN

    applySafeConfigEnvironmentVariables()

    expect(process.env.MOSS_MODEL_BASE_URL).toBe('https://model.env.test')
    expect(process.env.MOSS_MODEL_AUTH_TOKEN).toBeUndefined()
  })

  it('uses models.text.model as the saved CLI model setting', async () => {
    await writeUserSettings({
      models: {
        text: {
          model: 'custom-text-model',
        },
      },
    })
    delete process.env.ANTHROPIC_MODEL

    expect(getUserSpecifiedModelSetting()).toBe('custom-text-model')
  })
})

function restoreEnvVar(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

async function writeUserSettings(settings: unknown): Promise<void> {
  tempRoot = await mkdtemp(join(tmpdir(), 'moss-managed-env-'))
  const configDir = join(tempRoot, '.moss')
  process.env.MOSS_CONFIG_DIR = configDir
  await mkdir(configDir, { recursive: true })
  await writeFile(
    join(configDir, 'settings.json'),
    `${JSON.stringify(settings, null, 2)}\n`,
    'utf8',
  )
  resetSettingsCache()
}
