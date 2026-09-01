import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyManagedRuntimeEnv,
  DirectEmbeddedBackend,
  registerDirectRuntimeModule,
  writeManagedSessionSettings,
} from '../backends/directEmbeddedBackend.js'
import type { BackendHandle } from '../backendTypes.js'
import type { SystemSettingsPayload } from '../systemSettings.js'

const originalEnv = {
  MOSS_MODEL_BASE_URL: process.env.MOSS_MODEL_BASE_URL,
  MOSS_MODEL_AUTH_TOKEN: process.env.MOSS_MODEL_AUTH_TOKEN,
  MOSS_SERVER_URL: process.env.MOSS_SERVER_URL,
  MOSS_SERVER_AUTH_TOKEN: process.env.MOSS_SERVER_AUTH_TOKEN,
  MOSS_AUTO_MEMORY_SETTINGS: process.env.MOSS_AUTO_MEMORY_SETTINGS,
  MOSS_RUNTIME_ADVANCED_SETTINGS:
    process.env.MOSS_RUNTIME_ADVANCED_SETTINGS,
  MOSS_RUNTIME_AUTO_MEMORY_SETTINGS:
    process.env.MOSS_RUNTIME_AUTO_MEMORY_SETTINGS,
  MOSS_RUNTIME_SESSION_MEMORY_SETTINGS:
    process.env.MOSS_RUNTIME_SESSION_MEMORY_SETTINGS,
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
      }),
    )
    expect(process.env.MOSS_MODEL_BASE_URL).toBe('https://model.env.test')
    expect(process.env.MOSS_MODEL_AUTH_TOKEN).toBe('model-env-key')
    expect(process.env.MOSS_SERVER_URL).toBeUndefined()
    expect(process.env.MOSS_SERVER_AUTH_TOKEN).toBeUndefined()

    applyManagedRuntimeEnv(
      makeSettings({
        url: '',
        apiKey: '',
      }),
    )
    expect(process.env.MOSS_MODEL_BASE_URL).toBeUndefined()
    expect(process.env.MOSS_MODEL_AUTH_TOKEN).toBeUndefined()
    expect(process.env.MOSS_SERVER_URL).toBeUndefined()
    expect(process.env.MOSS_SERVER_AUTH_TOKEN).toBeUndefined()
  })

  test('bridges Moss app events through control request responses', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-direct-app-event-'))
    const eventUrl = 'file:///tmp/welcome.html'
    let createdWorkspaceDirectories: string[] | undefined
    let createdEnvironment: Record<string, string> | undefined

    class FakeSession {
      constructor(
        private readonly options: {
          workspaceDirectories?: string[]
          environment?: Record<string, string>
          onAppEvent?: (event: {
            type: string
            input?: Record<string, unknown>
          }) => Promise<unknown>
        },
      ) {
        createdWorkspaceDirectories = options.workspaceDirectories
        createdEnvironment = options.environment
      }

      async *send(
        _text: string | Array<{ type: string; [key: string]: unknown }>,
      ): AsyncGenerator<unknown> {
        const appEventResult = await this.options.onAppEvent?.({
          type: 'browser_open',
          input: { url: eventUrl },
        })
        yield {
          type: 'result',
          subtype: 'success',
          appEventResult,
        }
      }

      abort(): void {}
      dispose(): void {}
    }

    registerDirectRuntimeModule({
      ClaudeSession: FakeSession,
      resumeClaudeSession: async () => null,
    })

    process.env.MOSS_RUNTIME_ADVANCED_SETTINGS = '{"moss_scratchpad":false}'
    process.env.MOSS_RUNTIME_AUTO_MEMORY_SETTINGS = '{"enabled":false}'
    process.env.MOSS_RUNTIME_SESSION_MEMORY_SETTINGS = '{"enabled":false}'

    const backend = new DirectEmbeddedBackend()
    const handle = await backend.spawn({
      sessionId: 'session-app-event',
      cwd: join(tempRoot, 'workspace'),
      runtime: {
        backend: 'host',
        profileMode: 'session',
        profileDir: join(tempRoot, 'profile'),
        transcriptDir: join(tempRoot, 'transcripts'),
        workspaceDir: join(tempRoot, 'workspace'),
      },
      systemSettings: makeSettings({}),
      advancedSettings: {
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
      },
      autoMemory: {
        enabled: true,
        extractionEnabled: true,
        extractionIntervalTurns: 1,
        pastContextSearchEnabled: true,
        dreamEnabled: true,
        dreamMinHours: 24,
        dreamMinSessions: 5,
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

    try {
      expect(createdWorkspaceDirectories).toEqual([
        join(tempRoot, 'workspace'),
      ])
      expect(createdEnvironment?.MOSS_CONFIG_DIR).toBe(
        join(tempRoot, 'profile'),
      )
      expect(JSON.parse(createdEnvironment?.MOSS_RUNTIME_ADVANCED_SETTINGS || '{}')).toEqual({
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
      })
      expect(JSON.parse(createdEnvironment?.MOSS_RUNTIME_AUTO_MEMORY_SETTINGS || '{}')).toEqual({
        enabled: true,
        extractionEnabled: true,
        extractionIntervalTurns: 1,
        pastContextSearchEnabled: true,
        dreamEnabled: true,
        dreamMinHours: 24,
        dreamMinSessions: 5,
      })
      expect(JSON.parse(createdEnvironment?.MOSS_RUNTIME_SESSION_MEMORY_SETTINGS || '{}')).toEqual({
        enabled: true,
        compactEnabled: true,
        minimumMessageTokensToInit: 100,
        minimumTokensBetweenUpdate: 50,
        toolCallsBetweenUpdates: 2,
        compactMinTokens: 1000,
        compactMinTextBlockMessages: 3,
        compactMaxTokens: 4000,
      })
      expect(process.env.MOSS_AUTO_MEMORY_SETTINGS).toBe(
        originalEnv.MOSS_AUTO_MEMORY_SETTINGS,
      )
      expect(process.env.MOSS_RUNTIME_ADVANCED_SETTINGS).toBeUndefined()
      expect(process.env.MOSS_RUNTIME_AUTO_MEMORY_SETTINGS).toBeUndefined()
      expect(process.env.MOSS_RUNTIME_SESSION_MEMORY_SETTINGS).toBeUndefined()
      const controlRequestPromise = waitForStdout(
        handle,
        message => message.type === 'control_request',
      )
      const resultPromise = waitForStdout(
        handle,
        message => message.type === 'result',
      )

      handle.writeStdin(
        `${JSON.stringify({
          type: 'user',
          uuid: 'user-message-1',
          message: {
            role: 'user',
            content: 'open welcome',
          },
        })}\n`,
      )

      const controlRequest = await controlRequestPromise
      expect(controlRequest.request).toEqual({
        subtype: 'moss_app_event',
        event: {
          type: 'browser_open',
          input: { url: eventUrl },
        },
      })

      handle.writeStdin(
        `${JSON.stringify({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: controlRequest.request_id,
            response: {
              ok: true,
              previewUrl: eventUrl,
            },
          },
        })}\n`,
      )

      const result = await resultPromise
      expect(result.appEventResult).toEqual({
        ok: true,
        previewUrl: eventUrl,
      })
    } finally {
      handle.destroy()
    }
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
    image: {
      provider: 'openai',
      url: 'https://image.default.test',
      apiKey: 'image-key',
      model: 'image-model',
    },
    serverRuntime: {
      backend: 'host',
      dockerImage: '',
      defaultProfileMode: 'session',
      allowedProfileModes: ['session', 'user'],
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

function waitForStdout(
  handle: BackendHandle,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let off = () => {}
    const timeout = setTimeout(() => {
      off()
      reject(new Error('Timed out waiting for stdout message.'))
    }, 2000)

    off = handle.onStdoutLine(line => {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (!predicate(parsed)) {
        return
      }
      clearTimeout(timeout)
      off()
      resolve(parsed)
    })
  })
}
