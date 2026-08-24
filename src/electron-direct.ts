/**
 * Claude Code 直接嵌入 SDK（无子进程）
 *
 * 直接在当前 Node.js 进程中运行 QueryEngine，无 IPC/序列化开销。
 */

// Enable interview phase for plan mode by default
process.env.CLAUDE_CODE_PLAN_MODE_INTERVIEW_PHASE = 'true'

import { randomUUID } from 'crypto'
import { enableConfigs } from './utils/config.js'
import { setGlobalAppEventBridge, unregisterAppEventBridge, type MossAppEvent, type MossAppEventResult, type ToolUseContext } from './Tool.js'
import { getDefaultAppState } from './state/AppStateStore.js'
import { createStore } from './state/store.js'
import { QueryEngine } from './QueryEngine.js'
import { assembleToolPool } from './tools.js'
import { mergeAndFilterTools } from './utils/toolPool.js'
import { getCommands } from './commands.js'
import { createFileStateCacheWithSizeLimit } from './utils/fileStateCache.js'
import { getGlobalConfig } from './utils/config.js'
import { getAccountInformation, getAnthropicApiKeyWithSource, getAuthTokenSource } from './utils/auth.js'
import { getSettings_DEPRECATED } from './utils/settings/settings.js'
import type { SDKMessage } from './entrypoints/agentSdkTypes.js'
import {
  hasPermissionsToUseTool,
  type CanUseToolFn,
} from './utils/permissions/permissions.js'
import type { PermissionDecision } from './utils/permissions/PermissionResult.js'
import {
  applyPermissionUpdates,
  persistPermissionUpdates,
} from './utils/permissions/PermissionUpdate.js'
import type { PermissionUpdate } from './utils/permissions/PermissionUpdateSchema.js'
import { initializeToolPermissionContext } from './utils/permissions/permissionSetup.js'
import { executePermissionRequestHooks } from './utils/hooks.js'
import { dequeue, peek } from './utils/messageQueueManager.js'
import type { ThinkingConfig } from './utils/thinking.js'
import { runWithCwdOverride, runWithCwdOverrideGenerator } from './utils/cwd.js'
import { findGitRoot } from './utils/git.js'
import {
  discardWorktreeSessionState,
  getWorktreeSessionForSessionId,
} from './utils/worktree.js'
import type { Message } from './types/message.js'

import {
  bootstrapHeadless,
  prewarmHeadlessGlobalInit as prewarmHeadlessGlobalInitBase,
} from './bootstrap/headless.js'
import type {
  McpServerConfig,
  ScopedMcpServerConfig,
} from './services/mcp/types.js'
import {
  discardSessionCostState,
  setQuestionPreviewFormat,
  discardSessionRegisteredHooks,
  switchSession,
} from './bootstrap/state.js'
import { runWithCoordinatorMode } from './utils/sessionCoordinatorContext.js'
import { getCoordinatorSystemPrompt } from './coordinator/coordinatorMode.js'
import { restoreCostStateForSession } from './cost-tracker.js'
import { asSessionId, type SessionId } from './types/ids.js'
import {
  runWithSessionIdContext,
  runWithSessionIdContextGenerator,
  type TaskScope,
} from './utils/sessionIdContext.js'
import {
  discardSessionTaskScope,
  getTaskListIdForSession,
} from './utils/tasks.js'
import {
  runWithSessionApiOverrides,
  runWithSessionApiOverridesGenerator,
  type SessionApiOverrides,
} from './utils/sessionApiOverrides.js'
import { updateSessionName } from './utils/concurrentSessions.js'
import { getRunningTasks } from './utils/task/framework.js'
import { isBackgroundTask } from './tasks/types.js'
import { sleep } from './utils/sleep.js'
import {
  prepareSessionResume,
  type PreparedSessionResume,
} from './utils/sessionResumeCore.js'
import {
  exitRestoredWorktree,
  restoreSessionStateFromLog,
  restoreWorktreeForResume,
} from './utils/sessionRestore.js'
import {
  adoptResumedSessionFile,
  clearSessionMetadata,
  discardSessionStorageRecord,
  getProjectDir,
  recordContentReplacement,
  resetSessionFilePointer,
  restoreSessionMetadata,
  saveMode,
} from './utils/sessionStorage.js'
import { discardMicrocompactSessionState } from './services/compact/microCompact.js'
import { discardSessionSettingsCache } from './utils/settings/settingsCache.js'
import { discardSessionHooksConfigSnapshot } from './utils/hooks/hooksConfigSnapshot.js'
import { discardSessionFileChangedWatcher } from './utils/hooks/fileChangedWatcher.js'
import { discardSessionEnvCache } from './utils/sessionEnvironment.js'
import { discardSessionLspServerManager } from './services/lsp/manager.js'
import { resolveSessionFilePath } from './utils/sessionStoragePortable.js'
import { initBundledSkills } from './skills/bundled/index.js'
import { logForDiagnosticsNoPII } from './utils/diagLogs.js'
import {
  headlessProfilerStartTurn,
  logHeadlessProfilerTurn,
} from './utils/headlessProfiler.js'
import {
  discardSessionMemoryRuntimeState,
  initSessionMemory,
} from './services/SessionMemory/sessionMemory.js'
import { discardSessionMemoryState } from './services/SessionMemory/sessionMemoryUtils.js'

// Bundled skills 必须在模块初始化阶段注册，不能等到 bootstrapHeadless()，
// 因为 loadAllCommands 是 memoized 的，如果在 initBundledSkills() 执行之前
// 调用 getCommands()，会缓存空的 bundledSkills 数组。
// 参考 main.tsx:2004 的注释：
// "Previously ran inside setup() after ~20ms of await points,
//  so the parallel getCommands() memoized an empty list."
initBundledSkills()

export {
  createDirectConnectSession,
  attachDirectConnectSession,
  DirectConnectError,
} from './remote/createDirectConnectSession.js'
export {
  DirectConnectSessionManager,
  type DirectConnectConfig,
} from './remote/directConnectManager.js'
export {
  buildConnectUrl,
  parseConnectUrl,
} from '../packages/direct-connect-protocol/src/index.js'
export { runConnectHeadless } from './remote/connectHeadless.js'

let localAgentRuntimeInitialized = false

function initLocalAgentRuntimeOnce(): void {
  enableConfigs()
  setQuestionPreviewFormat('markdown')
  if (localAgentRuntimeInitialized) return
  initSessionMemory()
  localAgentRuntimeInitialized = true
}

export async function prewarmHeadlessGlobalInit(): Promise<void> {
  initLocalAgentRuntimeOnce()
  await prewarmHeadlessGlobalInitBase()
}

// 全局初始化，只执行一次
export function getAuthDebugSnapshot() {
  enableConfigs()

  const settings = getSettings_DEPRECATED() || {}
  const apiKeyInfo = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  const authTokenInfo = getAuthTokenSource()

  return {
    entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null,
    localSettingsAuthOnly: process.env.CLAUDE_CODE_LOCAL_SETTINGS_AUTH_ONLY === 'true',
    hasAnthropicApiKeyEnv: Boolean(process.env.ANTHROPIC_API_KEY),
    hasMossModelAuthTokenEnv: Boolean(process.env.MOSS_MODEL_AUTH_TOKEN),
    hasApiKeyHelper: typeof settings.apiKeyHelper === 'string' && settings.apiKeyHelper.length > 0,
    apiKeySource: apiKeyInfo.source,
    hasApiKeyCandidate: Boolean(apiKeyInfo.key),
    authTokenSource: authTokenInfo.source,
    hasAuthTokenCandidate: authTokenInfo.hasToken,
    accountInfo: getAccountInformation(),
  }
}

export type PermissionMode = 'allow-all' | 'default'

export type DesktopPermissionDecision =
  | boolean
  | {
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      updatedPermissions?: PermissionUpdate[]
    }
  | { behavior: 'deny'; message?: string }

export type DesktopPermissionRequest = {
  suggestions?: PermissionUpdate[]
  blockedPath?: string
  toolUseId?: string
}

async function defaultDesktopPermissionRequest(
  tool: string,
): Promise<DesktopPermissionDecision> {
  return {
    behavior: 'deny',
    message: `${tool || 'Tool'} requires desktop user interaction, but no permission handler was provided.`,
  }
}

export interface ClaudeSessionOptions {
  /** 工作目录 */
  cwd?: string
  /** 模型名，如 'claude-sonnet-4-6' */
  model?: string
  /** 覆盖默认 API base URL（仅应用于当前 embedded session） */
  url?: string
  /** 覆盖默认 API token（仅应用于当前 embedded session） */
  apiKey?: string
  /** 系统提示词（追加到默认之后） */
  appendSystemPrompt?: string
  /** 权限模式：'allow-all' 映射 CLI bypassPermissions，'default' 遵循 CLI settings */
  permissionMode?: PermissionMode
  /** CLI 权限引擎最终返回 ask 时调用的桌面确认回调 */
  onPermissionRequest?: (
    tool: string,
    input: unknown,
    request: DesktopPermissionRequest,
  ) => Promise<DesktopPermissionDecision>
  /** 最大轮次 */
  maxTurns?: number
  /** 思考配置 */
  thinkingConfig?: ThinkingConfig
  /** 是否启用 Coordinator 模式（多 worker 并行编排）*/
  coordinatorMode?: boolean
  /** App 事件回调，用于 MossTool 保存/打开 app */
  onAppEvent?: (event: MossAppEvent) => Promise<MossAppEventResult>
  /** 恢复后的 transcript session ID */
  sessionId?: string
  /** resume 后直接喂给 QueryEngine 的消息 */
  initialMessages?: Message[]
  /** transcript 所在项目目录；用于跨项目继续写回 */
  projectDir?: string | null
  /** 共享恢复核心产出的附加状态 */
  resumeState?: PreparedSessionResume
  /** Desktop-provided MCP servers. These come from ~/.moss/settings.json. */
  mcpServers?: Record<string, McpServerConfig>
  /** Explicit task-list scope for file-backed task tools. */
  taskScope?: TaskScope
}

type ResolvedClaudeSessionOptions = {
  cwd: string
  model: string
  url?: string
  apiKey?: string
  appendSystemPrompt: string
  permissionMode: PermissionMode
  onPermissionRequest: (
    tool: string,
    input: unknown,
    request: DesktopPermissionRequest,
  ) => Promise<DesktopPermissionDecision>
  maxTurns: number
  thinkingConfig: ThinkingConfig
  coordinatorMode: boolean
  onAppEvent?: (event: MossAppEvent) => Promise<MossAppEventResult>
  sessionId?: string
  initialMessages?: Message[]
  projectDir?: string | null
  resumeState?: PreparedSessionResume
  mcpServers?: Record<string, McpServerConfig>
  taskScope: TaskScope
}

function addDynamicMcpScope(
  servers: Record<string, McpServerConfig> | undefined,
): Record<string, ScopedMcpServerConfig> {
  if (!servers) return {}
  const scoped: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(servers)) {
    scoped[name] = { ...config, scope: 'dynamic' } as ScopedMcpServerConfig
  }
  return scoped
}

function normalizeMossBaseUrl(value: string | undefined): string | undefined {
  if (!value) return value
  const trimmed = value.trim()
  if (!trimmed) return undefined

  try {
    const url = new URL(trimmed)
    const normalizedPath = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')
    return `${url.origin}${normalizedPath}${url.search}${url.hash}`
  } catch {
    return trimmed.replace(/\/+$/, '').replace(/\/v1$/, '')
  }
}

function normalizeDesktopPermissionDecision(
  decision: DesktopPermissionDecision,
  fallbackInput: Record<string, unknown>,
): PermissionDecision {
  if (typeof decision === 'boolean') {
    return decision
      ? { behavior: 'allow' as const, updatedInput: fallbackInput }
      : {
          behavior: 'deny' as const,
          message: 'Denied by user',
          decisionReason: {
            type: 'other' as const,
            reason: 'desktop_permission_response',
          },
        }
  }

  if (decision && decision.behavior === 'allow') {
    return {
      behavior: 'allow' as const,
      updatedInput: decision.updatedInput ?? fallbackInput,
    }
  }

  return {
    behavior: 'deny' as const,
    message:
      decision && typeof decision.message === 'string'
        ? decision.message
        : 'Denied by user',
    decisionReason: {
      type: 'other' as const,
      reason: 'desktop_permission_response',
    },
  }
}

async function runDesktopPermissionRequestHooks(
  toolName: string,
  toolUseID: string,
  input: Record<string, unknown>,
  context: ToolUseContext,
  suggestions: PermissionUpdate[] | undefined,
): Promise<PermissionDecision | null> {
  const permissionMode = context.getAppState().toolPermissionContext.mode
  for await (const hookResult of executePermissionRequestHooks(
    toolName,
    toolUseID,
    input,
    context,
    permissionMode,
    suggestions,
    context.abortController.signal,
  )) {
    const hookDecision = hookResult.permissionRequestResult
    if (!hookDecision) continue

    if (hookDecision.behavior === 'allow') {
      const permissionUpdates = hookDecision.updatedPermissions ?? []
      if (permissionUpdates.length > 0) {
        persistPermissionUpdates(permissionUpdates)
        context.setAppState(prev => ({
          ...prev,
          toolPermissionContext: applyPermissionUpdates(
            prev.toolPermissionContext,
            permissionUpdates,
          ),
        }))
      }
      return {
        behavior: 'allow',
        updatedInput: hookDecision.updatedInput ?? input,
        userModified: false,
        decisionReason: {
          type: 'hook',
          hookName: 'PermissionRequest',
        },
      }
    }

    if (hookDecision.interrupt) context.abortController.abort()
    return {
      behavior: 'deny',
      message:
        hookDecision.message || 'Permission denied by PermissionRequest hook',
      decisionReason: {
        type: 'hook',
        hookName: 'PermissionRequest',
      },
    }
  }

  return null
}

function buildSessionApiOverrides(
  opts: Pick<ClaudeSessionOptions, 'url' | 'apiKey'>,
): SessionApiOverrides | undefined {
  const mossBaseUrl = normalizeMossBaseUrl(
    typeof opts.url === 'string' ? opts.url : undefined,
  )
  const mossAuthToken =
    typeof opts.apiKey === 'string' ? opts.apiKey.trim() || undefined : undefined

  if (!mossBaseUrl && !mossAuthToken) {
    return undefined
  }

  return {
    ...(mossBaseUrl ? { mossBaseUrl } : {}),
    ...(mossAuthToken ? { mossAuthToken } : {}),
  }
}

async function resolveResumeSourceJsonlFile(
  sessionId: string | undefined,
  options: {
    sourceJsonlFile?: string
    cwdHint?: string
  } = {},
): Promise<string | undefined> {
  if (options.sourceJsonlFile) {
    return options.sourceJsonlFile
  }
  if (!sessionId) {
    return undefined
  }

  const cwdHint =
    typeof options.cwdHint === 'string' && options.cwdHint.trim().length > 0
      ? options.cwdHint.trim()
      : undefined

  const resolved =
    (cwdHint
      ? await resolveSessionFilePath(sessionId, cwdHint)
      : undefined) ?? (await resolveSessionFilePath(sessionId))

  return resolved?.filePath
}

export class ClaudeSession {
  readonly sessionId: string

  #engine: QueryEngine | null = null
  #store: ReturnType<typeof createStore> | null = null
  #pendingListeners: Array<() => void> = []
  #opts: ResolvedClaudeSessionOptions
  #queue: Array<() => void> = []
  #processing = false
  #disposed = false
  #forkContentReplacementsSeeded = false
  #abortController: AbortController | null = null
  // Session's git root (or cwd), resolved during engine bootstrap. Passed
  // into the per-send ALS context so getProjectRoot() resolves per-session.
  #projectRoot: string | undefined
  #storageActivated = false
  #sessionApiOverrides: SessionApiOverrides | undefined

  get coordinatorMode(): boolean {
    return this.#opts.coordinatorMode
  }

  constructor(opts: ClaudeSessionOptions = {}) {
    this.sessionId = opts.sessionId ?? randomUUID()
    this.#sessionApiOverrides = buildSessionApiOverrides(opts)
    if (opts.onAppEvent) {
      // Register keyed by this session's id so concurrent sessions'
      // app events don't all route to the most recently created session.
      // Primary routing is per-engine via emitAppEvent; this is a fallback.
      setGlobalAppEventBridge(opts.onAppEvent, this.sessionId)
    }
    const cwd = opts.cwd ?? process.cwd()
    const taskScope = opts.taskScope ?? {
      kind: 'session' as const,
      sessionId: this.sessionId,
    }
    this.#opts = {
      cwd,
      model: opts.model ?? 'claude-sonnet-4-6',
      url: opts.url,
      apiKey: opts.apiKey,
      appendSystemPrompt: opts.appendSystemPrompt ?? '',
      permissionMode: opts.permissionMode ?? 'allow-all',
      onPermissionRequest: opts.onPermissionRequest ?? defaultDesktopPermissionRequest,
      maxTurns: opts.maxTurns ?? 100,
      thinkingConfig: opts.thinkingConfig ?? { type: 'adaptive' },
      coordinatorMode: opts.coordinatorMode ?? false,
      onAppEvent: opts.onAppEvent,
      sessionId: opts.sessionId,
      initialMessages: opts.initialMessages,
      // 始终显式解析 projectDir, 避免并发多会话时 getTranscriptPath()
      // 回退到全局 originalCwd 而把 transcript 写进其他会话的项目目录。
      projectDir: opts.projectDir ?? getProjectDir(cwd),
      resumeState: opts.resumeState,
      mcpServers: opts.mcpServers,
      taskScope,
    }
  }

  async #activateSessionStorage(): Promise<void> {
    // Per-instance latch: session storage (file pointer, metadata) is now
    // per-session inside Project, so activation is one-time setup for this
    // session — not a global "switch" that must re-run when another
    // concurrent session was activated in between.
    if (this.#storageActivated) {
      return
    }

    const { projectDir, resumeState, coordinatorMode } = this.#opts

    switchSession(asSessionId(this.sessionId), projectDir ?? null)

    await resetSessionFilePointer()
    clearSessionMetadata()

    if (!resumeState || !resumeState.forkSession) {
      exitRestoredWorktree()
    }

    if (resumeState) {
      restoreCostStateForSession(this.sessionId)
      restoreSessionMetadata(
        resumeState.forkSession
          ? { ...resumeState, worktreeSession: undefined }
          : resumeState,
      )

      if (resumeState.forkSession) {
        if (
          !this.#forkContentReplacementsSeeded &&
          resumeState.contentReplacements?.length
        ) {
          await recordContentReplacement(resumeState.contentReplacements)
          this.#forkContentReplacementsSeeded = true
        }
      } else {
        restoreWorktreeForResume(resumeState.worktreeSession)
        adoptResumedSessionFile()
      }

      void updateSessionName(resumeState.agentName)
    }

    saveMode(coordinatorMode ? 'coordinator' : 'normal')
    this.#storageActivated = true
  }

  /** 懒初始化：第一次 send() 时构建 QueryEngine */
  async #getEngine(): Promise<QueryEngine> {
    if (this.#engine) return this.#engine
    initLocalAgentRuntimeOnce()
    const engineStart = Date.now()
    logForDiagnosticsNoPII('info', 'local_agent_engine_init_started')

    const {
      model,
      appendSystemPrompt,
      permissionMode,
      onPermissionRequest,
      maxTurns,
      thinkingConfig,
      onAppEvent,
      initialMessages: resumedMessages,
      resumeState,
    } = this.#opts
    // A worktree restored on resume must also shape engine bootstrap
    // (MOSS.md discovery, SessionStart hooks, commands) — not just the
    // per-turn cwd context.
    const cwd =
      getWorktreeSessionForSessionId(this.sessionId)?.worktreePath ??
      this.#opts.cwd

    // 统一 Headless 初始化 (包含 Skills, Plugins, MOSS.md, MCP)
    const bootstrapStart = Date.now()
    const dynamicMcpServers = addDynamicMcpScope(this.#opts.mcpServers)
    logForDiagnosticsNoPII('info', 'local_agent_engine_dynamic_mcp_loaded', {
      dynamic_mcp_server_count: Object.keys(dynamicMcpServers).length,
    })
    const bootstrapResult = await bootstrapHeadless(
      cwd,
      dynamicMcpServers,
    )
    logForDiagnosticsNoPII('info', 'local_agent_engine_bootstrap_completed', {
      duration_ms: Date.now() - bootstrapStart,
      mcp_client_count: bootstrapResult.mcp.clients.length,
      mcp_tool_count: bootstrapResult.mcp.tools.length,
      mcp_command_count: bootstrapResult.mcp.commands.length,
      agent_count: bootstrapResult.agents.length,
      initial_message_count: bootstrapResult.initialMessages.length,
    })
    const { initialMessages: bootstrapMessages, mcp, agents: customAgents } =
      bootstrapResult
    // send() already resolved #projectRoot from the session's base cwd;
    // keep it stable (project identity must not move to a worktree root).
    this.#projectRoot = this.#projectRoot ?? bootstrapResult.projectRoot

    // Use the same settings/rule loader as the CLI so user, project, and local
    // permission rules behave identically in embedded desktop sessions.
    const permissionInit = await initializeToolPermissionContext({
      allowedToolsCli: [],
      disallowedToolsCli: [],
      permissionMode:
        permissionMode === 'allow-all' ? 'bypassPermissions' : 'default',
      allowDangerouslySkipPermissions: permissionMode === 'allow-all',
      addDirs: [],
    })
    const permissionContext = permissionInit.toolPermissionContext
    for (const warning of permissionInit.warnings) {
      logForDiagnosticsNoPII('warn', 'local_agent_permission_init_warning', {
        warning,
      })
    }

    // 权限回调
    const canUseTool: CanUseToolFn = async (tool, input, ctx, msg, id, forceDecision) => {
      const permissionDecision =
        forceDecision ??
        (await hasPermissionsToUseTool(tool, input, ctx, msg, id))

      if (
        permissionDecision.behavior === 'allow' ||
        permissionDecision.behavior === 'deny'
      ) {
        return permissionDecision
      }

      const requestInput = permissionDecision.updatedInput ?? input
      const hookDecision = await runDesktopPermissionRequestHooks(
        tool.name,
        id,
        requestInput,
        ctx,
        permissionDecision.suggestions,
      )
      if (hookDecision) return hookDecision

      const decision = await onPermissionRequest(tool.name, requestInput, {
        suggestions: permissionDecision.suggestions,
        blockedPath: permissionDecision.blockedPath,
        toolUseId: id,
      })

      if (
        decision &&
        typeof decision !== 'boolean' &&
        decision.behavior === 'allow' &&
        decision.updatedPermissions?.length
      ) {
        persistPermissionUpdates(decision.updatedPermissions)
        ctx.setAppState(prev => ({
          ...prev,
          toolPermissionContext: applyPermissionUpdates(
            prev.toolPermissionContext,
            decision.updatedPermissions!,
          ),
        }))
      }

      return normalizeDesktopPermissionDecision(decision, requestInput)
    }

    // AppState store（每个 session 独立）
    const storeStart = Date.now()
    this.#store = createStore(
      {
        ...getDefaultAppState(),
        mcp: {
          ...getDefaultAppState().mcp,
          clients: mcp.clients,
          commands: mcp.commands,
          tools: mcp.tools,
        },
        toolPermissionContext: permissionContext,
      },
      () => {},
    )
    logForDiagnosticsNoPII('info', 'local_agent_engine_store_created', {
      duration_ms: Date.now() - storeStart,
    })
    const store = this.#store

    if (resumeState) {
      const resumeRestoreStart = Date.now()
      restoreSessionStateFromLog(resumeState, f => store.setState(f))
      logForDiagnosticsNoPII('info', 'local_agent_engine_resume_restored', {
        duration_ms: Date.now() - resumeRestoreStart,
      })
    }

    // Attach all pending listeners to the newly created store
    for (const listener of this.#pendingListeners) {
      store.subscribe(listener)
    }
    this.#pendingListeners = []

    // 工具列表
    const toolsStart = Date.now()
    const computeTools = () => {
      const state = store.getState()
      const assembled = assembleToolPool(state.toolPermissionContext, state.mcp.tools)
      return mergeAndFilterTools([], assembled, state.toolPermissionContext.mode)
    }
    const tools = computeTools()
    logForDiagnosticsNoPII('info', 'local_agent_engine_tools_loaded', {
      duration_ms: Date.now() - toolsStart,
      tool_count: tools.length,
      mcp_tool_count: tools.filter(tool => tool.isMcp).length,
    })

    // 斜线命令（加载失败时降级为空列表）
    let commands: Awaited<ReturnType<typeof getCommands>> = []
    const commandsStart = Date.now()
    try { commands = await getCommands(cwd) } catch {}
    logForDiagnosticsNoPII('info', 'local_agent_engine_commands_loaded', {
      duration_ms: Date.now() - commandsStart,
      command_count: commands.length,
    })

    // 文件状态缓存（100MB 上限）
    const fileCache = createFileStateCacheWithSizeLimit(1000, 100 * 1024 * 1024)

    // Coordinator mode: use coordinator system prompt (replaces default)
    const coordinatorSystemPrompt = this.#opts.coordinatorMode
      ? getCoordinatorSystemPrompt()
      : undefined

    const queryEngineStart = Date.now()
    this.#engine = new QueryEngine({
      cwd,
      tools,
      commands,
      mcpClients: mcp.clients,
      agents: customAgents,
      canUseTool,
      getAppState: () => store.getState(),
      setAppState: f => store.setState(f),
      readFileCache: fileCache,
      userSpecifiedModel: model,
      customSystemPrompt: coordinatorSystemPrompt,
      appendSystemPrompt: appendSystemPrompt || undefined,
      thinkingConfig,
      maxTurns,
      initialMessages: resumedMessages ?? bootstrapMessages,
      emitAppEvent: onAppEvent,
      refreshTools: computeTools,
    })
    logForDiagnosticsNoPII('info', 'local_agent_engine_query_engine_created', {
      duration_ms: Date.now() - queryEngineStart,
    })
    logForDiagnosticsNoPII('info', 'local_agent_engine_init_completed', {
      duration_ms: Date.now() - engineStart,
    })

    return this.#engine
  }

  /**
   * 发送消息，返回 AsyncGenerator，按顺序 yield 每条 SDKMessage。
   * 最后一条是 { type: 'result', ... }。
   *
   * @param text    用户消息文本，或 Anthropic content block 数组
   * @param signal  可选 AbortSignal
   */
  async *send(text: string | Array<{ type: string; [k: string]: unknown }>, signal?: AbortSignal): AsyncGenerator<SDKMessage> {
    if (this.#disposed) throw new Error('Session has been disposed')

    // 串行队列
    const queueStart = Date.now()
    await new Promise<void>(resolve => {
      this.#queue.push(resolve)
      if (!this.#processing) this.#flush()
    })
    logForDiagnosticsNoPII('info', 'local_agent_send_queue_acquired', {
      duration_ms: Date.now() - queueStart,
    })
    const sendStart = Date.now()
    const hadEngineAtStart = this.#engine !== null
    headlessProfilerStartTurn()
    logForDiagnosticsNoPII('info', 'local_agent_send_started', {
      had_engine: hadEngineAtStart,
      coordinator_mode: this.#opts.coordinatorMode,
    })

    try {
      initLocalAgentRuntimeOnce()

      const sessionId = asSessionId(this.sessionId)
      const projectDir = this.#opts.projectDir
      const runInSessionContext = <T>(fn: () => T): T =>
        runWithSessionIdContext(sessionId, projectDir, () =>
          runWithCoordinatorMode(this.#opts.coordinatorMode, fn),
          this.#opts.taskScope,
        )

      // Resolve the project root before entering the ALS wrappers so even
      // the first send's activation phase sees this session's root instead
      // of falling back to the process-global (last-bootstrapped) value.
      if (this.#projectRoot === undefined) {
        const projectRootStart = Date.now()
        const gitRoot = findGitRoot(this.#opts.cwd)
        this.#projectRoot = gitRoot || this.#opts.cwd
        logForDiagnosticsNoPII('info', 'local_agent_send_project_root_resolved', {
          duration_ms: Date.now() - projectRootStart,
          is_git_repo: gitRoot !== null,
        })
      }

      // Per-send ALS contexts are rebuilt from the session options, so a
      // worktree entered in a previous turn (EnterWorktreeTool) or restored
      // on resume must be re-applied from the session's worktree slot —
      // otherwise the in-context setCwd from those flows would evaporate
      // when the next context is created.
      const effectiveCwd = () =>
        getWorktreeSessionForSessionId(this.sessionId)?.worktreePath ??
        this.#opts.cwd

      const activateStorageStart = Date.now()
      await runWithSessionApiOverrides(this.#sessionApiOverrides, () =>
        runWithCwdOverride(
          effectiveCwd(),
          () => runInSessionContext(() => this.#activateSessionStorage()),
          this.#projectRoot,
        ),
      )
      logForDiagnosticsNoPII('info', 'local_agent_send_storage_activated', {
        duration_ms: Date.now() - activateStorageStart,
      })

      // Re-evaluate after activation: resume may have just restored a
      // worktree into the slot, and the engine/turn contexts must run there.
      const getEngineStart = Date.now()
      const engine = await runWithSessionApiOverrides(this.#sessionApiOverrides, () =>
        runWithCwdOverride(
          effectiveCwd(),
          () => runInSessionContext(() => this.#getEngine()),
          this.#projectRoot,
        ),
      )
      logForDiagnosticsNoPII('info', 'local_agent_send_engine_ready', {
        duration_ms: Date.now() - getEngineStart,
        reused_engine: hadEngineAtStart,
      })

      // Reset the engine's abort controller from any previous interrupt so
      // this turn can run cleanly.
      engine.resetAbort()

      const prompt = typeof text === 'string' ? text : text as any
      const internalAbort = new AbortController()
      this.#abortController = internalAbort
      const combinedSignal = signal
        ? AbortSignal.any([signal, internalAbort.signal])
        : internalAbort.signal
      const waitSignal = combinedSignal
      let finalResult: SDKMessage | undefined

      const isCurrentSessionMainThreadCommand = (
        cmd: {
          agentId?: unknown
          mode: string
          sessionId?: SessionId
        },
      ) =>
        cmd.agentId === undefined &&
        (cmd.mode === 'task-notification' || cmd.mode === 'orphaned-permission') &&
        (cmd.sessionId === undefined || cmd.sessionId === sessionId)

      const dequeueMainThreadTaskNotification = () =>
        this.#opts.coordinatorMode
          ? dequeue(isCurrentSessionMainThreadCommand)
          : undefined

      const hasQueuedMainThreadTaskNotification = () =>
        this.#opts.coordinatorMode &&
        peek(isCurrentSessionMainThreadCommand) !== undefined

      const hasRunningBackgroundTasks = () => {
        if (!this.#opts.coordinatorMode) return false
        const state = this.#store?.getState()
        if (!state) return false
        return getRunningTasks(state).some(
          task => isBackgroundTask(task) && task.type !== 'in_process_teammate',
        )
      }

      // QueryEngine.submitMessage 是 AsyncGenerator
      yield* runWithSessionApiOverridesGenerator(this.#sessionApiOverrides, () =>
        runWithCwdOverrideGenerator(effectiveCwd(), () =>
          runWithSessionIdContextGenerator(
            sessionId,
            projectDir,
            () =>
              (async function* () {
                const runTurn = async function* (
                  turnPrompt:
                    | string
                    | Array<{ type: string; [k: string]: unknown }>,
                  mode: 'prompt' | 'task-notification' | 'orphaned-permission',
                  uuid?: string,
                ): AsyncGenerator<SDKMessage> {
                  const iterator = engine.submitMessage(turnPrompt, {
                    uuid,
                    mode,
                  })

                  try {
                    while (true) {
                      const result = await iterator.next()
                      if (result.done) {
                        return
                      }
                      if (result.value.type === 'result') {
                        finalResult = result.value
                        continue
                      }
                      yield result.value
                    }
                  } finally {
                    if (typeof iterator.return === 'function') {
                      await iterator.return()
                    }
                  }
                }

                let nextTurn:
                  | {
                      value:
                        | string
                        | Array<{ type: string; [k: string]: unknown }>
                      mode:
                        | 'prompt'
                        | 'task-notification'
                        | 'orphaned-permission'
                      uuid?: string
                    }
                  | undefined = {
                  value: prompt,
                  mode: 'prompt',
                }

                // Mirror CLI coordinator semantics: keep the foreground send alive
                // while background tasks are still running so task notifications
                // can trigger follow-up turns without waiting for new user input.
                do {
                  if (waitSignal?.aborted) {
                    break
                  }

                  if (nextTurn) {
                    yield* runTurn(nextTurn.value, nextTurn.mode, nextTurn.uuid)
                    nextTurn = undefined
                  }

                  const queuedCmd = dequeueMainThreadTaskNotification()
                  if (queuedCmd) {
                    nextTurn = {
                      value: queuedCmd.value as
                        | string
                        | Array<{ type: string; [k: string]: unknown }>,
                      mode: queuedCmd.mode as
                        | 'task-notification'
                        | 'orphaned-permission',
                      uuid: queuedCmd.uuid,
                    }
                    continue
                  }

                  if (!hasRunningBackgroundTasks()) {
                    break
                  }

                  await sleep(100, waitSignal, { unref: true })
                } while (
                  nextTurn !== undefined ||
                  hasQueuedMainThreadTaskNotification() ||
                  hasRunningBackgroundTasks()
                )

                if (finalResult) {
                  yield finalResult
                }
              })(),
            this.#opts.taskScope,
          ),
        ),
      )
    } finally {
      logForDiagnosticsNoPII('info', 'local_agent_send_completed', {
        duration_ms: Date.now() - sendStart,
        reused_engine: hadEngineAtStart,
      })
      logHeadlessProfilerTurn()
      this.#processing = false
      this.#abortController = null
      this.#flush()
    }
  }

  #flush() {
    if (this.#queue.length === 0) return
    this.#processing = true
    this.#queue.shift()!()
  }

  /** 销毁 session，释放资源（后续 send() 会抛错） */
  dispose() {
    this.#disposed = true
    this.#engine = null
    this.#pendingListeners = []
    if (this.#opts.onAppEvent) {
      unregisterAppEventBridge(this.sessionId, this.#opts.onAppEvent)
    }
    // Drop per-session state so long-lived desktop processes don't
    // accumulate records for disposed sessions.
    discardSessionStorageRecord(this.sessionId)
    discardSessionMemoryRuntimeState(this.sessionId)
    discardSessionMemoryState(this.sessionId)
    discardMicrocompactSessionState(this.sessionId)
    discardSessionCostState(this.sessionId)
    discardSessionRegisteredHooks(this.sessionId)
    discardSessionSettingsCache(this.sessionId)
    discardSessionHooksConfigSnapshot(this.sessionId)
    discardSessionFileChangedWatcher(this.sessionId)
    discardSessionEnvCache(this.sessionId)
    void discardSessionLspServerManager(this.sessionId)
    discardWorktreeSessionState(this.sessionId)
    discardSessionTaskScope(this.sessionId)
    this.#storageActivated = false
  }

  /** 中止正在进行的请求 */
  abort() {
    if (this.#abortController) {
      this.#abortController.abort()
      this.#abortController = null
    }
    if (this.#engine) {
      this.#engine.interrupt()
    }
  }

  /** 订阅 app state 变化（用于通知前端新 teammate task 等） */
  subscribe(listener: () => void): () => void {
    if (this.#store) {
      return this.#store.subscribe(listener)
    }
    // Store not ready yet - queue the listener to be attached when store is created
    this.#pendingListeners.push(listener)
    return () => {
      const idx = this.#pendingListeners.indexOf(listener)
      if (idx !== -1) this.#pendingListeners.splice(idx, 1)
    }
  }

  /** 获取当前 app state */
  getAppState() {
    return this.#store?.getState() ?? null
  }

  getTaskListId() {
    return getTaskListIdForSession(this.sessionId, this.#opts.taskScope)
  }
}

export interface ResumeClaudeSessionResult {
  session: ClaudeSession
  messages: Message[]
  metadata: {
    sessionId: string
    sourceSessionId: string
    customTitle?: string
    projectDir: string | null
    cwd: string | null
    fullPath?: string
    mode?: 'coordinator' | 'normal'
  }
}

export interface ClaudeSessionSnapshot {
  messages: Message[]
  metadata: {
    sessionId: string
    sourceSessionId: string
    customTitle?: string
    projectDir: string | null
    cwd: string | null
    fullPath?: string
    mode?: 'coordinator' | 'normal'
  }
}

export async function loadClaudeSessionSnapshot(
  sessionId: string | undefined,
  options: {
    sourceJsonlFile?: string
    cwdHint?: string
  } = {},
): Promise<ClaudeSessionSnapshot | null> {
  const sourceJsonlFile = await resolveResumeSourceJsonlFile(sessionId, options)
  const prepared = await prepareSessionResume(sessionId, {
    sourceJsonlFile,
  })
  if (!prepared) {
    return null
  }

  return {
    messages: prepared.messages,
    metadata: {
      sessionId: prepared.sessionId,
      sourceSessionId: prepared.sourceSessionId,
      customTitle: prepared.customTitle,
      projectDir: prepared.projectDir,
      cwd: prepared.cwd,
      fullPath: prepared.fullPath,
      mode: prepared.mode,
    },
  }
}

export async function resumeClaudeSession(
  sessionId: string,
  options: Omit<ClaudeSessionOptions, 'sessionId' | 'initialMessages' | 'projectDir'> & {
    forkSession?: boolean
    sourceJsonlFile?: string
  } = {},
): Promise<ResumeClaudeSessionResult | null> {
  const { forkSession, sourceJsonlFile, ...sessionOptions } = options
  const resolvedSourceJsonlFile = await resolveResumeSourceJsonlFile(sessionId, {
    sourceJsonlFile,
    cwdHint: sessionOptions.cwd,
  })
  const prepared = await prepareSessionResume(sessionId, {
    forkSession,
    sourceJsonlFile: resolvedSourceJsonlFile,
  })
  if (!prepared) {
    return null
  }

  const session = new ClaudeSession({
    ...sessionOptions,
    cwd: prepared.cwd ?? sessionOptions.cwd,
    coordinatorMode: prepared.mode
      ? prepared.mode === 'coordinator'
      : (sessionOptions.coordinatorMode ?? false),
    sessionId: prepared.sessionId,
    initialMessages: prepared.messages,
    projectDir: prepared.projectDir,
    resumeState: prepared,
  })

  return {
    session,
    messages: prepared.messages,
    metadata: {
      sessionId: prepared.sessionId,
      sourceSessionId: prepared.sourceSessionId,
      customTitle: prepared.customTitle,
      projectDir: prepared.projectDir,
      cwd: prepared.cwd,
      fullPath: prepared.fullPath,
      mode: prepared.mode,
    },
  }
}
