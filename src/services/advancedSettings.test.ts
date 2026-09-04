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
import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
} from '../tools/AgentTool/loadAgentsDir.js'
import { getAttributionHeader } from '../constants/system.js'
import { ParsedCommand } from '../utils/bash/ParsedCommand.js'
import { parseForSecurity } from '../utils/bash/ast.js'
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
  clearAgentDefinitionsCache()
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
        moss_bash_ast_permissions: false,
        moss_hive_evidence: false,
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
        moss_session_debug_logging: false,
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
            moss_bash_ast_permissions: true,
            moss_hive_evidence: true,
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
        moss_bash_ast_permissions: true,
        moss_hive_evidence: true,
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
        moss_session_debug_logging: false,
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

  test('isolates cached agent definitions by hive evidence setting', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'moss-agent-cache-session-'))
    const getDefinitions = (sessionId: string, enabled: boolean) =>
      runWithSessionIdContext(
        asSessionId(sessionId),
        undefined,
        () => getAgentDefinitionsWithOverrides(cwd),
        undefined,
        {
          [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify({
            moss_hive_evidence: enabled,
          }),
        },
      )

    try {
      clearAgentDefinitionsCache()
      const disabled = getDefinitions('agent-cache-disabled', false)
      const disabledAgain = getDefinitions('agent-cache-disabled-again', false)
      const enabled = getDefinitions('agent-cache-enabled', true)

      expect(disabledAgain).toBe(disabled)
      expect(enabled).not.toBe(disabled)
      await Promise.all([disabled, enabled])
    } finally {
      clearAgentDefinitionsCache()
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('controls Bash AST parsing per session without leaking cached mode', async () => {
    const command = 'printf parser-mode-cache-test | wc -c'
    const parseWithSetting = <T>(
      sessionId: string,
      enabled: boolean,
      operation: () => T,
    ) =>
      runWithSessionIdContext(
        asSessionId(sessionId),
        undefined,
        operation,
        undefined,
        {
          [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify({
            moss_bash_ast_permissions: enabled,
          }),
        },
      )

    const disabledSecurity = await parseWithSetting(
      'bash-ast-disabled',
      false,
      () => parseForSecurity(command),
    )
    expect(disabledSecurity.kind).toBe('parse-unavailable')

    const legacyParsed = await parseWithSetting(
      'bash-ast-cache-disabled',
      false,
      () => ParsedCommand.parse(command),
    )
    expect(legacyParsed?.getTreeSitterAnalysis()).toBeNull()

    const enabledSecurity = await parseWithSetting(
      'bash-ast-enabled',
      true,
      () => parseForSecurity(command),
    )
    expect(enabledSecurity.kind).toBe('simple')

    const astParsed = await parseWithSetting(
      'bash-ast-cache-enabled',
      true,
      () => ParsedCommand.parse(command),
    )
    expect(astParsed?.getTreeSitterAnalysis()).not.toBeNull()

    const legacyParsedAgain = await parseWithSetting(
      'bash-ast-cache-disabled-again',
      false,
      () => ParsedCommand.parse(command),
    )
    expect(legacyParsedAgain?.getTreeSitterAnalysis()).toBeNull()

    const concurrentCommand = 'printf parser-concurrent-mode | wc -c'
    const [concurrentAst, concurrentLegacy] = await Promise.all([
      parseWithSetting('bash-ast-concurrent-enabled', true, () =>
        ParsedCommand.parse(concurrentCommand),
      ),
      parseWithSetting('bash-ast-concurrent-disabled', false, () =>
        ParsedCommand.parse(concurrentCommand),
      ),
    ])
    expect(concurrentAst?.getTreeSitterAnalysis()).not.toBeNull()
    expect(concurrentLegacy?.getTreeSitterAnalysis()).toBeNull()
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
