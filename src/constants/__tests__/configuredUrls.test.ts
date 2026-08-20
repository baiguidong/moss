import { afterEach, describe, expect, test } from 'bun:test'
import { getMossWebOrigin } from '../api.js'
import {
  getConfiguredRemoteSessionBaseUrl,
  getRemoteSessionUrl,
} from '../product.js'

const originalEnv = {
  MOSS_REMOTE_SESSION_BASE_URL: process.env.MOSS_REMOTE_SESSION_BASE_URL,
  MOSS_WEB_BASE_URL: process.env.MOSS_WEB_BASE_URL,
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    restoreEnv(key, value)
  }
})

describe('configured Web URLs', () => {
  test('does not default to vendor-hosted Web origins', () => {
    delete process.env.MOSS_REMOTE_SESSION_BASE_URL
    delete process.env.MOSS_WEB_BASE_URL

    expect(getMossWebOrigin()).toBeNull()
    expect(getConfiguredRemoteSessionBaseUrl()).toBeNull()
    expect(getRemoteSessionUrl('session_123')).toBe('session_123')
  })

  test('uses configured Moss Web base URL', () => {
    process.env.MOSS_WEB_BASE_URL = 'https://moss.example.test/'

    expect(getMossWebOrigin()).toBe('https://moss.example.test')
    expect(getRemoteSessionUrl('cse_abc')).toBe(
      'https://moss.example.test/code/session_abc',
    )
  })

  test('remote session URL override wins over shared Web URL', () => {
    process.env.MOSS_WEB_BASE_URL = 'https://moss.example.test'
    process.env.MOSS_REMOTE_SESSION_BASE_URL = 'https://sessions.example.test/'

    expect(getConfiguredRemoteSessionBaseUrl()).toBe(
      'https://sessions.example.test',
    )
    expect(getRemoteSessionUrl('session_abc')).toBe(
      'https://sessions.example.test/code/session_abc',
    )
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
