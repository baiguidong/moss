/**
 * Claude Code 直接嵌入 SDK（无子进程）
 *
 * 直接在当前 Node.js 进程中运行 QueryEngine，无 IPC/序列化开销。
 */

import { randomUUID } from 'crypto'
import { enableConfigs } from './utils/config.js'
import { getEmptyToolPermissionContext } from './Tool.js'
import { getDefaultAppState } from './state/AppStateStore.js'
import { createStore } from './state/store.js'
import { QueryEngine } from './QueryEngine.js'
import { getTools } from './tools.js'
import { getCommands } from './commands.js'
import { createFileStateCacheWithSizeLimit } from './utils/fileStateCache.js'
import { getGlobalConfig } from './utils/config.js'
import { getAccountInformation, getAnthropicApiKeyWithSource, getAuthTokenSource } from './utils/auth.js'
import { getSettings_DEPRECATED } from './utils/settings/settings.js'
import type { SDKMessage } from './entrypoints/agentSdkTypes.js'
import type { CanUseToolFn } from './utils/permissions/permissions.js'
import type { ThinkingConfig } from './utils/thinking.js'
import { runWithCwdOverrideGenerator } from './utils/cwd.js'

// 全局初始化，只执行一次
let globalInitDone = false
function ensureGlobalInit() {
  if (globalInitDone) return
  globalInitDone = true
  enableConfigs()
}

export function getAuthDebugSnapshot() {
  ensureGlobalInit()

  const settings = getSettings_DEPRECATED() || {}
  const globalConfig = getGlobalConfig()
  const apiKeyInfo = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  const authTokenInfo = getAuthTokenSource()

  return {
    entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null,
    localSettingsAuthOnly: process.env.CLAUDE_CODE_LOCAL_SETTINGS_AUTH_ONLY === 'true',
    hasAnthropicApiKeyEnv: Boolean(process.env.ANTHROPIC_API_KEY),
    hasOauthTokenEnv: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
    hasAnthropicAuthTokenEnv: Boolean(process.env.ANTHROPIC_AUTH_TOKEN),
    hasApiKeyHelper: typeof settings.apiKeyHelper === 'string' && settings.apiKeyHelper.length > 0,
    apiKeySource: apiKeyInfo.source,
    hasApiKeyCandidate: Boolean(apiKeyInfo.key),
    authTokenSource: authTokenInfo.source,
    hasAuthTokenCandidate: authTokenInfo.hasToken,
    hasStoredOauthAccount: Boolean(globalConfig.oauthAccount),
    hasPrimaryApiKey: Boolean(globalConfig.primaryApiKey),
    accountInfo: getAccountInformation(),
  }
}

export type PermissionMode = 'allow-all' | 'default'

export interface ClaudeSessionOptions {
  /** 工作目录 */
  cwd?: string
  /** 模型名，如 'claude-sonnet-4-6' */
  model?: string
  /** 系统提示词（追加到默认之后） */
  appendSystemPrompt?: string
  /** 权限模式：'allow-all' 跳过所有确认，'default' 遵循 settings */
  permissionMode?: PermissionMode
  /** 自定义权限回调，permissionMode='default' 时生效 */
  onPermissionRequest?: (tool: string, input: unknown) => Promise<boolean>
  /** 最大轮次 */
  maxTurns?: number
  /** 思考配置 */
  thinkingConfig?: ThinkingConfig
}

export class ClaudeSession {
  readonly sessionId = randomUUID()

  #engine: QueryEngine | null = null
  #opts: Required<ClaudeSessionOptions>
  #queue: Array<() => void> = []
  #processing = false
  #disposed = false

  constructor(opts: ClaudeSessionOptions = {}) {
    this.#opts = {
      cwd: opts.cwd ?? process.cwd(),
      model: opts.model ?? 'claude-sonnet-4-6',
      appendSystemPrompt: opts.appendSystemPrompt ?? '',
      permissionMode: opts.permissionMode ?? 'allow-all',
      onPermissionRequest: opts.onPermissionRequest ?? (() => Promise.resolve(true)),
      maxTurns: opts.maxTurns ?? 100,
      thinkingConfig: opts.thinkingConfig ?? { type: 'adaptive' },
    }
  }

  /** 懒初始化：第一次 send() 时构建 QueryEngine */
  async #getEngine(): Promise<QueryEngine> {
    if (this.#engine) return this.#engine

    ensureGlobalInit()

    const { cwd, model, appendSystemPrompt, permissionMode, onPermissionRequest, maxTurns, thinkingConfig } = this.#opts

    // 权限上下文
    const permissionContext = {
      ...getEmptyToolPermissionContext(),
      mode: permissionMode === 'allow-all' ? ('bypassPermissions' as const) : ('default' as const),
    }

    // 权限回调
    const canUseTool: CanUseToolFn = async (tool, input, _ctx, _msg, _id, forceDecision) => {
      if (forceDecision) return forceDecision
      if (permissionMode === 'allow-all') return { behavior: 'allow' as const }
      const allowed = await onPermissionRequest(tool.name, input)
      return allowed ? { behavior: 'allow' as const } : { behavior: 'deny' as const, message: 'Denied by user' }
    }

    // AppState store（每个 session 独立）
    const store = createStore(
      {
        ...getDefaultAppState(),
        toolPermissionContext: permissionContext,
      },
      () => {},
    )

    // 工具列表
    const tools = getTools(permissionContext)

    // 斜线命令（加载失败时降级为空列表）
    let commands: Awaited<ReturnType<typeof getCommands>> = []
    try { commands = await getCommands(cwd) } catch {}

    // 文件状态缓存（100MB 上限）
    const fileCache = createFileStateCacheWithSizeLimit(1000, 100 * 1024 * 1024)

    this.#engine = new QueryEngine({
      cwd,
      tools,
      commands,
      mcpClients: [],
      agents: [],
      canUseTool,
      getAppState: () => store.getState(),
      setAppState: f => store.setState(f),
      readFileCache: fileCache,
      userSpecifiedModel: model,
      appendSystemPrompt: appendSystemPrompt || undefined,
      thinkingConfig,
      maxTurns,
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
    await new Promise<void>(resolve => {
      this.#queue.push(resolve)
      if (!this.#processing) this.#flush()
    })

    try {
      const engine = await this.#getEngine()

      const prompt = typeof text === 'string' ? text : text as any
      const abortController = signal
        ? (() => { const ac = new AbortController(); signal.addEventListener('abort', () => ac.abort()); return ac })()
        : undefined

      // QueryEngine.submitMessage 是 AsyncGenerator
      yield* runWithCwdOverrideGenerator(
        this.#opts.cwd,
        () => engine.submitMessage(prompt) as AsyncGenerator<SDKMessage>,
      )
    } finally {
      this.#processing = false
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
  }
}
