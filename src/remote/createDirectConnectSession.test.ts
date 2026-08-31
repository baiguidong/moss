import { afterEach, describe, expect, test } from 'bun:test'
import { createDirectConnectSession } from './createDirectConnectSession.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('createDirectConnectSession', () => {
  test('lets the server choose cwd while preserving the client profile mode', async () => {
    let requestBody: Record<string, unknown> | null = null
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({
        session_id: 'remote-session',
        ws_url: 'wss://moss.example.com/sessions/remote-session',
        work_dir: '/srv/moss/sessions/remote-session/workspace',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const created = await createDirectConnectSession({
      serverUrl: 'https://moss.example.com',
      authToken: 'access-token',
      profileMode: 'user',
      autoMemory: {
        enabled: true,
        extractionEnabled: true,
        extractionIntervalTurns: 2,
        selectiveRecallEnabled: true,
        pastContextSearchEnabled: true,
        dreamEnabled: true,
        dreamMinHours: 12,
        dreamMinSessions: 3,
      },
      sessionMemory: {
        enabled: true,
        compactEnabled: true,
        minimumMessageTokensToInit: 100,
        minimumTokensBetweenUpdate: 50,
        toolCallsBetweenUpdates: 2,
        compactMinTokens: 1000,
        compactMinTextBlockMessages: 3,
        compactMaxTokens: 4000,
      },
    })

    expect(requestBody).toEqual({
      profileMode: 'user',
      autoMemory: {
        enabled: true,
        extractionEnabled: true,
        extractionIntervalTurns: 2,
        selectiveRecallEnabled: true,
        pastContextSearchEnabled: true,
        dreamEnabled: true,
        dreamMinHours: 12,
        dreamMinSessions: 3,
      },
      sessionMemory: {
        enabled: true,
        compactEnabled: true,
        minimumMessageTokensToInit: 100,
        minimumTokensBetweenUpdate: 50,
        toolCallsBetweenUpdates: 2,
        compactMinTokens: 1000,
        compactMinTextBlockMessages: 3,
        compactMaxTokens: 4000,
      },
    })
    expect(created.workDir).toBe('/srv/moss/sessions/remote-session/workspace')
  })
})
