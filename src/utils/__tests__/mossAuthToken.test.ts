import { afterEach, describe, expect, test } from 'bun:test'
import { isProviderManagedEnvVar } from '../managedEnvConstants.js'
import {
  getSessionMossBaseUrl,
  getSessionMossAuthToken,
  runWithSessionApiOverrides,
} from '../sessionApiOverrides.js'
import { subprocessEnv } from '../subprocessEnv.js'

const originalMossAuthToken = process.env.MOSS_AUTH_TOKEN
const originalMossBaseUrl = process.env.MOSS_BASE_URL
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY
const originalSubprocessScrub = process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB
const testGlobal = globalThis as typeof globalThis & {
  MACRO?: { VERSION: string }
}
const originalMacro = testGlobal.MACRO

afterEach(() => {
  restoreEnv('MOSS_AUTH_TOKEN', originalMossAuthToken)
  restoreEnv('MOSS_BASE_URL', originalMossBaseUrl)
  restoreEnv('ANTHROPIC_API_KEY', originalAnthropicApiKey)
  restoreEnv('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', originalSubprocessScrub)
  if (originalMacro === undefined) {
    delete testGlobal.MACRO
  } else {
    testGlobal.MACRO = originalMacro
  }
})

describe('Moss auth token', () => {
  test('passes the Moss endpoint and token explicitly to the API client', async () => {
    process.env.MOSS_AUTH_TOKEN = 'moss-token'
    process.env.MOSS_BASE_URL = 'https://moss.example.test'
    process.env.ANTHROPIC_API_KEY = 'direct-api-key'
    testGlobal.MACRO = { VERSION: 'test' }

    const { getAnthropicClient } = await import(
      '../../services/api/client.js'
    )
    const client = await getAnthropicClient({
      apiKey: 'direct-api-key',
      maxRetries: 0,
    })

    expect(client.baseURL).toBe('https://moss.example.test')
    expect(client.authToken).toBe('moss-token')
  })

  test('supports session-scoped Moss endpoint and token overrides', () => {
    const overrides = runWithSessionApiOverrides(
      {
        mossBaseUrl: 'https://moss.example.test',
        mossAuthToken: 'session-token',
      },
      () => ({
        baseUrl: getSessionMossBaseUrl(),
        token: getSessionMossAuthToken(),
      }),
    )

    expect(overrides).toEqual({
      baseUrl: 'https://moss.example.test',
      token: 'session-token',
    })
    expect(getSessionMossBaseUrl()).toBeUndefined()
    expect(getSessionMossAuthToken()).toBeUndefined()
  })

  test('is protected from settings overrides in host-managed sessions', () => {
    expect(isProviderManagedEnvVar('MOSS_AUTH_TOKEN')).toBe(true)
    expect(isProviderManagedEnvVar('MOSS_BASE_URL')).toBe(true)
  })

  test('is removed from scrubbed subprocess environments', () => {
    process.env.MOSS_AUTH_TOKEN = 'secret-token'
    process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1'

    expect(subprocessEnv().MOSS_AUTH_TOKEN).toBeUndefined()
    expect(process.env.MOSS_AUTH_TOKEN).toBe('secret-token')
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
