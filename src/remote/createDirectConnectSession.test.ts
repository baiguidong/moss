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
      advancedSettings: {
        moss_auto_background_agents: true,
        moss_scratchpad: true,
        moss_idle_session_cleanup: true,
        moss_streaming_tool_execution: true,
        moss_plan_mode_interview: false,
        moss_fast_web_search: true,
        moss_memory_learn_from_corrections: true,
        moss_large_tool_result_protection: true,
        moss_tool_result_budget_chars: 300_000,
        moss_mcp_output_token_limit: 40_000,
        moss_file_read_max_size_bytes: 512_000,
        moss_file_read_max_tokens: 50_000,
        moss_request_attribution_enabled: false,
        moss_context_compaction_strategy: 'reactive',
      },
      autoMemory: {
        enabled: true,
        extractionEnabled: true,
        extractionIntervalTurns: 2,
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
      advancedSettings: {
        moss_auto_background_agents: true,
        moss_scratchpad: true,
        moss_idle_session_cleanup: true,
        moss_streaming_tool_execution: true,
        moss_plan_mode_interview: false,
        moss_fast_web_search: true,
        moss_memory_learn_from_corrections: true,
        moss_large_tool_result_protection: true,
        moss_tool_result_budget_chars: 300_000,
        moss_mcp_output_token_limit: 40_000,
        moss_file_read_max_size_bytes: 512_000,
        moss_file_read_max_tokens: 50_000,
        moss_request_attribution_enabled: false,
        moss_context_compaction_strategy: 'reactive',
      },
      autoMemory: {
        enabled: true,
        extractionEnabled: true,
        extractionIntervalTurns: 2,
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
