import { describe, expect, test } from 'bun:test'
import {
  buildConnectUrl,
  normalizeSessionRuntimeOptions,
  parseConnectUrl,
} from '../index.js'

describe('direct connect URL protocol', () => {
  test('builds and parses an HTTP endpoint', () => {
    const url = buildConnectUrl({ host: '192.168.1.20', port: 43127 })
    expect(url).toBe('cc://192.168.1.20:43127')
    expect(parseConnectUrl(url)).toEqual({
      serverUrl: 'http://192.168.1.20:43127',
      authMode: 'local',
    })
  })

  test('rejects credentials embedded in a connection URL', () => {
    expect(() => parseConnectUrl('cc://localhost:43127?token=secret')).toThrow(
      'Static token URLs are no longer supported',
    )
  })

  test('discards model overrides from old clients and persisted sessions', () => {
    expect(normalizeSessionRuntimeOptions({
      model: ' primary-model ',
      fastModel: ' fast-model ',
      url: 'https://desktop-model.test',
      apiKey: 'desktop-key',
      maxTurns: 1,
      thinkingConfig: { type: 'disabled' },
      appendSystemPrompt: 'Keep session instructions',
      environment: {
        ANTHROPIC_MODEL: 'desktop-model',
        ANTHROPIC_API_KEY: 'desktop-key',
        MOSS_MODEL_BASE_URL: 'https://desktop-model.test',
        MOSS_MODEL_AUTH_TOKEN: 'desktop-token',
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_DISABLE_THINKING: '1',
        CONNECTOR_API_KEY: 'connector-key',
      },
      webSearch: { mode: 'auto', nativeCapability: 'supported' },
    })).toEqual({
      appendSystemPrompt: 'Keep session instructions',
      environment: { CONNECTOR_API_KEY: 'connector-key' },
      webSearch: { mode: 'auto' },
    })
    expect(normalizeSessionRuntimeOptions({
      model: 'primary-model',
      fastModel: '   ',
    })).toBeUndefined()
  })
})
