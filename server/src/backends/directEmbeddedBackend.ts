import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getSystemSettings } from '../systemSettings.js'
import type {
  BackendHandle,
  BackendSpawnOptions,
  SessionBackend,
  SessionRuntimeInfo,
} from '../backendTypes.js'
import { buildSessionEnv } from './backendUtils.js'

type JsonObject = Record<string, unknown>
type StdoutListener = (line: string) => void
type ExitListener = (
  code: number | null,
  signal: NodeJS.Signals | null,
) => void
type DirectPermissionDecision =
  | boolean
  | {
      behavior: 'allow'
      updatedInput?: JsonObject
      updatedPermissions?: unknown[]
    }
  | { behavior: 'deny'; message?: string }
type DirectPermissionRequest = {
  suggestions?: unknown[]
  blockedPath?: string
  toolUseId?: string
}
type DirectSessionOptions = {
  cwd?: string
  model?: string
  url?: string
  apiKey?: string
  appendSystemPrompt?: string
  permissionMode?: 'allow-all' | 'default'
  onPermissionRequest?: (
    tool: string,
    input: unknown,
    request: DirectPermissionRequest,
  ) => Promise<DirectPermissionDecision>
  maxTurns?: number
  thinkingConfig?: unknown
  coordinatorMode?: boolean
  sessionId?: string
  sourceJsonlFile?: string
}
type DirectSession = {
  send(
    text: string | Array<{ type: string; [key: string]: unknown }>,
  ): AsyncGenerator<unknown>
  abort(): void
  dispose(): void
}
type DirectRuntimeModule = {
  ClaudeSession: new (options: DirectSessionOptions) => DirectSession
  resumeClaudeSession(
    sessionId: string,
    options: DirectSessionOptions,
  ): Promise<{ session: DirectSession } | null>
}

let directRuntimePromise: Promise<DirectRuntimeModule> | null = null
let directRuntimeModule: DirectRuntimeModule | null = null

export function registerDirectRuntimeModule(module: DirectRuntimeModule): void {
  directRuntimeModule = module
  directRuntimePromise = Promise.resolve(module)
}

function loadDirectRuntime(): Promise<DirectRuntimeModule> {
  directRuntimePromise ??= directRuntimeModule
    ? Promise.resolve(directRuntimeModule)
    : Promise.reject(
        new Error(
          'Missing embedded direct runtime module. Build moss-session-runner.mjs with scripts/session-runner-entry.ts.',
        ),
      )
  return directRuntimePromise
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error)
}

function canFallbackToFreshSession(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('No messages found in JSONL file') ||
    message.includes('ENOENT')
  )
}

function buildThinkingConfig(settings: ReturnType<typeof getSystemSettings>) {
  if (settings.thinkingMode === 'disabled') {
    return { type: 'disabled' as const }
  }
  if (settings.thinkingMode === 'enabled') {
    return {
      type: 'enabled' as const,
      budgetTokens: settings.thinkingBudgetTokens,
    }
  }
  return { type: 'adaptive' as const }
}

function buildManagedRuntimeEnv(
  settings: ReturnType<typeof getSystemSettings>,
): Record<string, string | undefined> {
  return {
    MOSS_BASE_URL: settings.url || undefined,
    MOSS_AUTH_TOKEN: settings.apiKey || undefined,
    MOSS_SERVER_URL: settings.serverUrl || undefined,
    MOSS_SERVER_AUTH_TOKEN: settings.serverAuthToken || undefined,
  }
}

function applyManagedRuntimeEnv(
  settings: ReturnType<typeof getSystemSettings>,
): void {
  for (const [key, value] of Object.entries(buildManagedRuntimeEnv(settings))) {
    if (value) {
      process.env[key] = value
    }
  }
}

async function writeManagedSessionSettings(
  configDir: string | undefined,
  settings: ReturnType<typeof getSystemSettings>,
): Promise<void> {
  if (!configDir) {
    return
  }

  const settingsPath = join(configDir, 'settings.json')
  let existing: JsonObject = {}
  try {
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8')) as unknown
    if (isJsonObject(parsed)) {
      existing = parsed
    }
  } catch {}

  const existingEnv = isJsonObject(existing.env) ? existing.env : {}
  const env: JsonObject = { ...existingEnv }
  for (const [key, value] of Object.entries(buildManagedRuntimeEnv(settings))) {
    if (value) {
      env[key] = value
    } else {
      delete env[key]
    }
  }

  const next: JsonObject = {
    ...existing,
    model: settings.model,
    maxTurns: settings.maxTurns,
    thinkingMode: settings.thinkingMode,
    thinkingBudgetTokens: settings.thinkingBudgetTokens,
    bypassPermissions: settings.bypassPermissions,
  }
  if (Object.keys(env).length > 0) {
    next.env = env
  } else {
    delete next.env
  }

  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

function isContentBlock(
  value: unknown,
): value is { type: string; [key: string]: unknown } {
  return isJsonObject(value) && typeof value.type === 'string'
}

function extractUserContent(
  value: unknown,
): string | Array<{ type: string; [key: string]: unknown }> | null {
  if (!isJsonObject(value) || value.type !== 'user') {
    return null
  }
  const message = value.message
  if (!isJsonObject(message) || message.role !== 'user') {
    return null
  }
  const content = message.content
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content) && content.every(isContentBlock)) {
    return content
  }
  return null
}

function extractUuid(value: unknown): string | null {
  if (!isJsonObject(value)) {
    return null
  }
  return typeof value.uuid === 'string' && value.uuid ? value.uuid : null
}

function toPermissionDecision(value: unknown): DirectPermissionDecision {
  if (!isJsonObject(value)) {
    return {
      behavior: 'deny',
      message: 'Invalid permission response.',
    }
  }
  if (value.behavior === 'allow') {
    return {
      behavior: 'allow',
      updatedInput: isJsonObject(value.updatedInput)
        ? value.updatedInput
        : undefined,
      updatedPermissions: Array.isArray(value.updatedPermissions)
        ? value.updatedPermissions
        : undefined,
    }
  }
  return {
    behavior: 'deny',
    message:
      typeof value.message === 'string'
        ? value.message
        : 'Permission denied.',
  }
}

function createErrorResult(
  sessionId: string,
  startedAt: number,
  error: unknown,
): JsonObject {
  return {
    type: 'result',
    subtype: 'error_during_execution',
    duration_ms: Date.now() - startedAt,
    duration_api_ms: 0,
    is_error: true,
    num_turns: 0,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    errors: [error instanceof Error ? error.message : String(error)],
    uuid: randomUUID(),
    session_id: sessionId,
  }
}

class DirectEmbeddedHandle implements BackendHandle {
  readonly workDir: string
  readonly runtime: SessionRuntimeInfo

  #buffer = ''
  #disposed = false
  #exited = false
  #stdoutListeners = new Set<StdoutListener>()
  #stderrListeners = new Set<StdoutListener>()
  #exitListeners = new Set<ExitListener>()
  #pendingPermissions = new Map<
    string,
    {
      resolve: (decision: DirectPermissionDecision) => void
    }
  >()
  #seenUserUuids = new Set<string>()

  constructor(
    private readonly session: DirectSession,
    private readonly sessionId: string,
    workDir: string,
    runtime: SessionRuntimeInfo,
  ) {
    this.workDir = workDir
    this.runtime = runtime
  }

  writeStdin(data: string): void {
    if (this.#disposed) {
      return
    }
    this.#buffer += data
    while (true) {
      const idx = this.#buffer.indexOf('\n')
      if (idx < 0) {
        break
      }
      const line = this.#buffer.slice(0, idx)
      this.#buffer = this.#buffer.slice(idx + 1)
      void this.#handleLine(line).catch(error => {
        this.#emitStderr(errorMessage(error))
      })
    }
  }

  interrupt(): void {
    this.session.abort()
  }

  onStdoutLine(listener: StdoutListener): () => void {
    this.#stdoutListeners.add(listener)
    return () => {
      this.#stdoutListeners.delete(listener)
    }
  }

  onStderrLine(listener: StdoutListener): () => void {
    this.#stderrListeners.add(listener)
    return () => {
      this.#stderrListeners.delete(listener)
    }
  }

  onExit(listener: ExitListener): () => void {
    this.#exitListeners.add(listener)
    return () => {
      this.#exitListeners.delete(listener)
    }
  }

  destroy(): void {
    if (this.#disposed) {
      return
    }
    this.#disposed = true
    this.session.abort()
    this.session.dispose()
    for (const pending of this.#pendingPermissions.values()) {
      pending.resolve({
        behavior: 'deny',
        message: 'Session stopped before permission response.',
      })
    }
    this.#pendingPermissions.clear()
    this.#emitExit(0, null)
  }

  async #handleLine(line: string): Promise<void> {
    if (!line.trim()) {
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.#emitStderr(`Invalid direct session input: ${line}`)
      return
    }

    if (this.#handleControlResponse(parsed)) {
      return
    }

    const content = extractUserContent(parsed)
    if (content === null) {
      return
    }

    const uuid = extractUuid(parsed)
    if (uuid) {
      if (this.#seenUserUuids.has(uuid)) {
        return
      }
      this.#seenUserUuids.add(uuid)
      if (this.#seenUserUuids.size > 200) {
        const first = this.#seenUserUuids.values().next().value
        if (first) {
          this.#seenUserUuids.delete(first)
        }
      }
    }

    const startedAt = Date.now()
    try {
      for await (const message of this.session.send(content)) {
        this.#emitStdout(message as unknown as JsonObject)
      }
    } catch (error) {
      this.#emitStderr(errorMessage(error))
      this.#emitStdout(createErrorResult(this.sessionId, startedAt, error))
    }
  }

  #handleControlResponse(value: unknown): boolean {
    if (!isJsonObject(value) || value.type !== 'control_response') {
      return false
    }
    const response = value.response
    if (!isJsonObject(response)) {
      return true
    }
    const requestId =
      typeof response.request_id === 'string' ? response.request_id : ''
    const pending = this.#pendingPermissions.get(requestId)
    if (!pending) {
      return true
    }
    this.#pendingPermissions.delete(requestId)
    if (response.subtype === 'error') {
      pending.resolve({
        behavior: 'deny',
        message:
          typeof response.error === 'string'
            ? response.error
            : 'Permission response failed.',
      })
      return true
    }
    pending.resolve(toPermissionDecision(response.response))
    return true
  }

  requestPermission(
    tool: string,
    input: unknown,
    request: DirectPermissionRequest,
  ): Promise<DirectPermissionDecision> {
    if (this.#disposed) {
      return Promise.resolve({
        behavior: 'deny',
        message: 'Session stopped before permission request.',
      })
    }

    const requestId = randomUUID()
    this.#emitStdout({
      type: 'control_request',
      request_id: requestId,
      request: {
        subtype: 'can_use_tool',
        tool_name: tool,
        input: isJsonObject(input) ? input : {},
        permission_suggestions: request.suggestions,
        blocked_path: request.blockedPath,
        tool_use_id: request.toolUseId ?? requestId,
      },
    })

    return new Promise(resolve => {
      this.#pendingPermissions.set(requestId, { resolve })
    })
  }

  #emitStdout(value: JsonObject): void {
    const line = `${JSON.stringify(value)}\n`
    for (const listener of this.#stdoutListeners) {
      listener(line)
    }
  }

  #emitStderr(line: string): void {
    const payload = `${line.trimEnd()}\n`
    for (const listener of this.#stderrListeners) {
      listener(payload)
    }
  }

  #emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#exited) {
      return
    }
    this.#exited = true
    for (const listener of this.#exitListeners) {
      listener(code, signal)
    }
  }
}

export class DirectEmbeddedBackend implements SessionBackend {
  async spawn(options: BackendSpawnOptions): Promise<BackendHandle> {
    const configDir = options.runtime?.configDir
    if (configDir) {
      await mkdir(configDir, { recursive: true })
    }
    const settings = getSystemSettings()
    await writeManagedSessionSettings(configDir, settings)

    Object.assign(
      process.env,
      buildSessionEnv(options, {
        MOSS_SESSION_RUNTIME_TYPE: 'host',
        MOSS_CONFIG_DIR: configDir,
      }),
    )
    applyManagedRuntimeEnv(settings)

    const { ClaudeSession, resumeClaudeSession } = await loadDirectRuntime()
    let handle: DirectEmbeddedHandle | null = null
    const runtime: SessionRuntimeInfo = {
      type: 'host',
      configDir,
    }
    const sessionOptions: DirectSessionOptions = {
      cwd: options.cwd,
      model: settings.model,
      appendSystemPrompt: undefined,
      maxTurns: settings.maxTurns,
      thinkingConfig: buildThinkingConfig(settings),
      permissionMode:
        options.dangerouslySkipPermissions || settings.bypassPermissions
          ? 'allow-all'
          : 'default',
      url: settings.url || undefined,
      apiKey: settings.apiKey || undefined,
      sessionId: options.sessionId,
      onPermissionRequest: async (tool, input, request) => {
        if (!handle) {
          return {
            behavior: 'deny',
            message: 'Session permission bridge is not ready.',
          }
        }
        return handle.requestPermission(tool, input, request)
      },
    }

    let session: DirectSession
    if (options.resumeSessionId) {
      try {
        const resumed = await resumeClaudeSession(options.resumeSessionId, {
          ...sessionOptions,
          sourceJsonlFile: options.transcriptPath,
        })
        session = resumed?.session ?? new ClaudeSession(sessionOptions)
      } catch (error) {
        if (!canFallbackToFreshSession(error)) {
          throw error
        }
        session = new ClaudeSession(sessionOptions)
      }
    } else {
      session = new ClaudeSession(sessionOptions)
    }

    handle = new DirectEmbeddedHandle(
      session,
      options.resumeSessionId || options.sessionId,
      options.cwd,
      runtime,
    )
    return handle
  }
}
