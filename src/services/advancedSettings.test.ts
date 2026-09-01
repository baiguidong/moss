import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { asSessionId } from '../types/ids.js'
import { runWithSessionIdContext } from '../utils/sessionIdContext.js'
import { getMaxMcpOutputTokens } from '../utils/mcpValidation.js'
import { withMemoryCorrectionHint } from '../utils/messages.js'
import { isPlanModeInterviewPhaseEnabled } from '../utils/planModeV2.js'
import { getDefaultFileReadingLimits } from '../tools/FileReadTool/limits.js'
import { getAttributionHeader } from '../constants/system.js'
import {
  getPerMessageBudgetLimit,
  provisionContentReplacementState,
} from '../utils/toolResultStorage.js'
import {
  getAdvancedSettings,
  MOSS_RUNTIME_ADVANCED_SETTINGS_ENV,
} from './advancedSettings.js'

const originalFeatureFlagOverrides = process.env.MOSS_FEATURE_FLAG_OVERRIDES

afterEach(() => {
  if (originalFeatureFlagOverrides === undefined) {
    delete process.env.MOSS_FEATURE_FLAG_OVERRIDES
  } else {
    process.env.MOSS_FEATURE_FLAG_OVERRIDES = originalFeatureFlagOverrides
  }
})

describe('advanced settings', () => {
  test('uses legacy-compatible defaults when no setting exists', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'moss-advanced-defaults-'))
    try {
      const settings = runWithSessionIdContext(
        asSessionId('advanced-defaults'),
        undefined,
        getAdvancedSettings,
        undefined,
        { MOSS_CONFIG_DIR: configDir },
      )
      expect(settings).toEqual({
        moss_auto_background_agents: false,
        moss_scratchpad: false,
        moss_idle_session_cleanup: false,
        moss_streaming_tool_execution: false,
        moss_plan_mode_interview: true,
        moss_fast_web_search: false,
        moss_memory_learn_from_corrections: false,
        moss_large_tool_result_protection: false,
        moss_tool_result_budget_chars: 200_000,
        moss_mcp_output_token_limit: 25_000,
        moss_file_read_max_size_bytes: 256 * 1024,
        moss_file_read_max_tokens: 25_000,
        moss_request_attribution_enabled: true,
        moss_context_compaction_strategy: 'proactive',
      })
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test('isolates the desktop snapshot by session', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'moss-advanced-session-'))
    try {
      const settings = runWithSessionIdContext(
        asSessionId('advanced-session'),
        undefined,
        getAdvancedSettings,
        undefined,
        {
          MOSS_CONFIG_DIR: configDir,
          [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify({
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
          }),
        },
      )
      expect(settings).toEqual({
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
      })
      const interviewEnabled = runWithSessionIdContext(
        asSessionId('advanced-plan-mode'),
        undefined,
        isPlanModeInterviewPhaseEnabled,
        undefined,
        {
          MOSS_CONFIG_DIR: configDir,
          [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify({
            moss_plan_mode_interview: false,
          }),
        },
      )
      expect(interviewEnabled).toBe(false)
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test('drives memory and tool runtime behavior from the session snapshot', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'moss-advanced-runtime-'))
    try {
      const behavior = runWithSessionIdContext(
        asSessionId('advanced-runtime'),
        undefined,
        () => ({
          correctionMessage: withMemoryCorrectionHint('rejected'),
          toolResultBudget: getPerMessageBudgetLimit(),
          protectionEnabled:
            provisionContentReplacementState() !== undefined,
          mcpOutputTokenLimit: getMaxMcpOutputTokens(),
          fileReadLimits: getDefaultFileReadingLimits(),
          attribution: getAttributionHeader('test-fingerprint'),
        }),
        undefined,
        {
          MOSS_CONFIG_DIR: configDir,
          MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: true }),
          [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify({
            moss_memory_learn_from_corrections: true,
            moss_large_tool_result_protection: true,
            moss_tool_result_budget_chars: 300_000,
            moss_mcp_output_token_limit: 40_000,
            moss_file_read_max_size_bytes: 512_000,
            moss_file_read_max_tokens: 50_000,
            moss_request_attribution_enabled: false,
          }),
        },
      )

      expect(behavior.correctionMessage).toContain(
        'consider saving that to memory',
      )
      expect(behavior.toolResultBudget).toBe(300_000)
      expect(behavior.protectionEnabled).toBe(true)
      expect(behavior.mcpOutputTokenLimit).toBe(40_000)
      expect(behavior.fileReadLimits).toMatchObject({
        maxSizeBytes: 512_000,
        maxTokens: 50_000,
      })
      expect(behavior.attribution).toBe('')
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test('ignores invalid overrides without discarding valid session settings', () => {
    process.env.MOSS_FEATURE_FLAG_OVERRIDES = JSON.stringify({
      moss_file_read_max_tokens: 'invalid',
      moss_request_attribution_enabled: 'false',
      moss_context_compaction_strategy: 'unknown',
    })

    const settings = runWithSessionIdContext(
      asSessionId('advanced-invalid-overrides'),
      undefined,
      getAdvancedSettings,
      undefined,
      {
        [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify({
          moss_scratchpad: true,
          moss_file_read_max_size_bytes: 512_000,
          moss_file_read_max_tokens: 50_000,
          moss_request_attribution_enabled: false,
          moss_context_compaction_strategy: 'reactive',
          moss_tool_result_budget_chars: 'invalid',
        }),
      },
    )

    expect(settings).toMatchObject({
      moss_scratchpad: true,
      moss_file_read_max_size_bytes: 512_000,
      moss_file_read_max_tokens: 50_000,
      moss_request_attribution_enabled: false,
      moss_context_compaction_strategy: 'reactive',
      moss_tool_result_budget_chars: 200_000,
    })
  })

  test('keeps valid environment overrides above the session snapshot', () => {
    process.env.MOSS_FEATURE_FLAG_OVERRIDES = JSON.stringify({
      moss_file_read_max_tokens: 75_000,
      moss_request_attribution_enabled: true,
    })

    const settings = runWithSessionIdContext(
      asSessionId('advanced-valid-overrides'),
      undefined,
      getAdvancedSettings,
      undefined,
      {
        [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify({
          moss_file_read_max_tokens: 50_000,
          moss_request_attribution_enabled: false,
        }),
      },
    )

    expect(settings.moss_file_read_max_tokens).toBe(75_000)
    expect(settings.moss_request_attribution_enabled).toBe(true)
  })
})
