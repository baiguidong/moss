import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat } from 'fs/promises'
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
        fastModel: 'session-fast-model',
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
      fastModel: 'session-fast-model',
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
    expect(persisted.fastModel).toBeUndefined()
    expect(persisted.maxTurns).toBeUndefined()
    expect(persisted.thinkingMode).toBeUndefined()
    expect(persisted.thinkingBudgetTokens).toBeUndefined()
    if (process.platform !== 'win32') {
      expect((await stat(join(configDir, 'settings.json'))).mode & 0o777).toBe(0o600)
    }
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

  test('passes the fast model to ClaudeSession when starting a session', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-direct-fast-model-'))
    const createdOptions: Array<{ model?: string; fastModel?: string }> = []

    class FakeSession {
      constructor(options: { model?: string; fastModel?: string }) {
        createdOptions.push(options)
      }
      async *send(): AsyncGenerator<unknown> {}
      abort(): void {}
      dispose(): void {}
      setPermissionMode(): void {}
    }

    registerDirectRuntimeModule({
      ClaudeSession: FakeSession,
      resumeClaudeSession: async () => null,
    })

    const backend = new DirectEmbeddedBackend()
    const baseSpawnOptions = {
      cwd: join(tempRoot, 'workspace'),
      runtime: {
        backend: 'host' as const,
        profileDir: join(tempRoot, 'profile'),
        transcriptDir: join(tempRoot, 'transcripts'),
        workspaceDir: join(tempRoot, 'workspace'),
      },
      systemSettings: makeSettings({
        model: 'server-primary-model',
        fastModel: 'server-fast-model',
      }),
    }

    const serverConfigured = await backend.spawn({
      ...baseSpawnOptions,
      sessionId: 'session-server-fast-model',
    })
    serverConfigured.destroy()

    const sessionConfigured = await backend.spawn({
      ...baseSpawnOptions,
      sessionId: 'session-runtime-fast-model',
      runtimeOptions: {
        model: 'runtime-primary-model',
        fastModel: 'runtime-fast-model',
      },
    })
    sessionConfigured.destroy()

    const sessionWithFastFallback = await backend.spawn({
      ...baseSpawnOptions,
      sessionId: 'session-runtime-fast-model-empty',
      runtimeOptions: {
        model: 'runtime-primary-model',
        fastModel: '',
      },
    })
    sessionWithFastFallback.destroy()

    expect(createdOptions.map(({ model, fastModel }) => ({ model, fastModel }))).toEqual([
      {
        model: 'server-primary-model',
        fastModel: 'server-fast-model',
      },
      {
        model: 'runtime-primary-model',
        fastModel: 'runtime-fast-model',
      },
      {
        model: 'runtime-primary-model',
        fastModel: undefined,
      },
    ])
  })

  test('requires both the client switch and server scope for Agent Mail', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-direct-agent-mail-'))
    const createdOptions: Array<{ agentMailEnabled?: boolean }> = []

    class FakeSession {
      constructor(options: { agentMailEnabled?: boolean }) {
        createdOptions.push(options)
      }
      async *send(): AsyncGenerator<unknown> {}
      abort(): void {}
      dispose(): void {}
      setPermissionMode(): void {}
    }

    registerDirectRuntimeModule({
      ClaudeSession: FakeSession,
      resumeClaudeSession: async () => null,
    })

    const backend = new DirectEmbeddedBackend()
    const baseSpawnOptions = {
      cwd: join(tempRoot, 'workspace'),
      runtime: {
        backend: 'host' as const,
        profileDir: join(tempRoot, 'profile'),
        transcriptDir: join(tempRoot, 'transcripts'),
        workspaceDir: join(tempRoot, 'workspace'),
      },
      systemSettings: makeSettings(),
    }

    const legacy = await backend.spawn({
      ...baseSpawnOptions,
      sessionId: 'session-agent-mail-legacy',
      scopes: ['agent-mail:send'],
    })
    legacy.destroy()
    const disabled = await backend.spawn({
      ...baseSpawnOptions,
      sessionId: 'session-agent-mail-disabled',
      scopes: ['agent-mail:send'],
      runtimeOptions: { agentMailEnabled: false },
    })
    disabled.destroy()
    const unauthorized = await backend.spawn({
      ...baseSpawnOptions,
      sessionId: 'session-agent-mail-unauthorized',
      scopes: [],
      runtimeOptions: { agentMailEnabled: true },
    })
    unauthorized.destroy()
    const enabled = await backend.spawn({
      ...baseSpawnOptions,
      sessionId: 'session-agent-mail-enabled',
      scopes: ['agent-mail:send'],
      runtimeOptions: { agentMailEnabled: true },
    })
    enabled.destroy()

    expect(createdOptions.map(({ agentMailEnabled }) => agentMailEnabled)).toEqual([
      true,
      false,
      false,
      true,
    ])
  })

  test('bridges Moss app events through control request responses', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-direct-app-event-'))
    const eventUrl = 'file:///tmp/welcome.html'
    let createdWorkspaceDirectories: string[] | undefined
    let createdEnvironment: Record<string, string> | undefined
    let createdAgentMailEnabled: boolean | undefined

    class FakeSession {
      constructor(
        private readonly options: {
          workspaceDirectories?: string[]
          environment?: Record<string, string>
          agentMailEnabled?: boolean
          onAppEvent?: (event: {
            type: string
            input?: Record<string, unknown>
          }) => Promise<unknown>
        },
      ) {
        createdWorkspaceDirectories = options.workspaceDirectories
        createdEnvironment = options.environment
        createdAgentMailEnabled = options.agentMailEnabled
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
      setPermissionMode(): void {}
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
        profileDir: join(tempRoot, 'profile'),
        transcriptDir: join(tempRoot, 'transcripts'),
        workspaceDir: join(tempRoot, 'workspace'),
      },
      systemSettings: makeSettings({}),
      scopes: ['sessions:create', 'agent-mail:send'],
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
      expect(createdAgentMailEnabled).toBe(true)
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

  test('applies remote permission mode control requests and acknowledges them', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-direct-permission-mode-'))
    const appliedModes: string[] = []

    class FakeSession {
      async *send(): AsyncGenerator<unknown> {}
      abort(): void {}
      dispose(): void {}
      setPermissionMode(mode: string): void {
        appliedModes.push(mode)
      }
    }

    registerDirectRuntimeModule({
      ClaudeSession: FakeSession,
      resumeClaudeSession: async () => null,
    })

    const backend = new DirectEmbeddedBackend()
    const handle = await backend.spawn({
      sessionId: 'session-permission-mode',
      cwd: join(tempRoot, 'workspace'),
      runtime: {
        backend: 'host',
        profileDir: join(tempRoot, 'profile'),
        transcriptDir: join(tempRoot, 'transcripts'),
        workspaceDir: join(tempRoot, 'workspace'),
      },
      systemSettings: makeSettings({}),
    })

    try {
      const responsePromise = waitForStdout(
        handle,
        message => message.type === 'control_response',
      )
      handle.writeStdin(
        `${JSON.stringify({
          type: 'control_request',
          request_id: 'permission-request-1',
          request: {
            subtype: 'set_permission_mode',
            mode: 'plan',
          },
        })}\n`,
      )

      expect(appliedModes).toEqual(['plan'])
      expect(await responsePromise).toEqual({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'permission-request-1',
          response: {},
        },
      })
    } finally {
      handle.destroy()
    }
  })

  test('interrupts the active turn in process without disposing the session', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-direct-interrupt-'))
    let abortCount = 0
    let disposeCount = 0
    let sendCount = 0
    let markFirstTurnStarted: (() => void) | undefined
    const firstTurnStarted = new Promise<void>(resolve => {
      markFirstTurnStarted = resolve
    })

    class FakeSession {
      async *send(
        _content: unknown,
        signal?: AbortSignal,
      ): AsyncGenerator<unknown> {
        sendCount += 1
        if (sendCount === 1) {
          markFirstTurnStarted?.()
          await new Promise<void>(resolve => {
            if (signal?.aborted) {
              resolve()
              return
            }
            signal?.addEventListener('abort', () => resolve(), { once: true })
          })
          return
        }
        yield { type: 'result', subtype: 'success' }
      }
      abort(): void {
        abortCount += 1
      }
      dispose(): void {
        disposeCount += 1
      }
      setPermissionMode(): void {}
    }

    registerDirectRuntimeModule({
      ClaudeSession: FakeSession,
      resumeClaudeSession: async () => null,
    })

    const backend = new DirectEmbeddedBackend()
    const handle = await backend.spawn({
      sessionId: 'session-interrupt',
      cwd: join(tempRoot, 'workspace'),
      runtime: {
        backend: 'host',
        profileDir: join(tempRoot, 'profile'),
        transcriptDir: join(tempRoot, 'transcripts'),
        workspaceDir: join(tempRoot, 'workspace'),
      },
      systemSettings: makeSettings({}),
    })

    try {
      const interruptedResultPromise = waitForStdout(
        handle,
        message => message.type === 'result',
      )
      const responsePromise = waitForStdout(
        handle,
        message => message.type === 'control_response',
      )
      handle.writeStdin([
        JSON.stringify({
          type: 'user',
          uuid: 'message-to-interrupt',
          message: { role: 'user', content: 'keep working' },
        }),
        JSON.stringify({
          type: 'control_request',
          request_id: 'interrupt-request-1',
          request: { subtype: 'interrupt' },
        }),
        '',
      ].join('\n'))
      await firstTurnStarted

      await expect(responsePromise).resolves.toMatchObject({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'interrupt-request-1',
        },
      })
      expect(abortCount).toBe(1)
      expect(disposeCount).toBe(0)
      await expect(interruptedResultPromise).resolves.toMatchObject({
        type: 'result',
        subtype: 'error_during_execution',
      })

      const resultPromise = waitForStdout(
        handle,
        message => message.type === 'result',
      )
      handle.writeStdin(`${JSON.stringify({
        type: 'user',
        uuid: 'message-after-interrupt',
        message: { role: 'user', content: 'continue' },
      })}\n`)
      await expect(resultPromise).resolves.toMatchObject({
        type: 'result',
        subtype: 'success',
      })
      expect(sendCount).toBe(2)
      expect(disposeCount).toBe(0)
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
    fastModel: '',
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
      dockerImage: 'moss-runtime:test',
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
