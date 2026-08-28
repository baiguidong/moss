import { randomUUID, timingSafeEqual } from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { open, type FileHandle } from 'fs/promises'
import path from 'path'
import type { DatabaseSync } from 'node:sqlite'
import type net from 'net'
import { createServerLogger, type ServerLogger } from './serverLog.js'
import { MOSS_SERVER_HOME } from './lib/env.js'
import { hasScope, type AuthContext } from './auth/token.js'
import type { RuntimeService } from './runtimeService.js'
import type { SessionRecord, SessionSummary } from './types.js'

type AdapterName = 'feishu'
type ProcessKey = `${string}:${string}:${AdapterName}`

export type PairedUser = {
  userId: string | number
  displayName: string
  pairedAt: number
}

export type PairingState = {
  code: string | null
  expiresAt: number | null
  createdAt: number | null
}

export type FeishuAdapterConfig = {
  appId: string
  appSecret: string
  encryptKey?: string
  verificationToken?: string
  allowedUsers?: string[]
  pairedUsers?: PairedUser[]
  defaultWorkDir?: string
  streamingCard?: boolean
  pairing?: PairingState
}

export type AdapterProcessState = {
  status: 'running' | 'stopped' | 'error'
  pid: number | null
  error: string | null
  startedAt: number | null
  bridgeReady: boolean
  transportConnected: boolean
  transportUpdatedAt: number | null
}

type StoredDeployment = {
  orgId: string
  userId: string
  role: string
  scopes: string[]
  config: FeishuAdapterConfig
  enabled: boolean
}

type BridgeRequest = {
  version: number
  id: string
  type: string
  timestamp: number
  payload?: Record<string, unknown>
}

type HostedProcess = {
  child: ChildProcess
  config: FeishuAdapterConfig
  auth: Pick<AuthContext, 'orgId' | 'userId' | 'role' | 'scopes'>
  configDir: string
  handshakeTimer: ReturnType<typeof setTimeout> | null
}

type HostedTurn = {
  hosted: HostedProcess
  socket: net.Socket
  reject: (error: Error) => void
}

type QueuedTurn = {
  hosted: HostedProcess
  eventId: string
  turnId: string
  chatId: string
  session: SessionRecord
  prompt: string
}

type PairingFailure = {
  count: number
  startedAt: number
}

type PendingPermission = {
  id: string
  actionToken: string
  requestId: string
  sessionId: string
  chatId: string
  toolName: string
  input: Record<string, unknown>
  hosted: HostedProcess
  socket: net.Socket
  timer: ReturnType<typeof setTimeout>
}

const BRIDGE_VERSION = 1
const ADAPTER_RUNTIMES_DIR = path.join(MOSS_SERVER_HOME, 'adapter-runtimes')
const SAFE_TURN_FAILURE_MESSAGE = 'Moss Server 会话处理失败，请稍后重试。'
const RESTART_MAX_DELAY_MS = 30_000
const PAIRING_RATE_WINDOW_MS = 5 * 60_000
const PAIRING_MAX_FAILURES = 5
const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'

export type AdapterProcessManagerOptions = {
  entryFile?: string
  runtimesDir?: string
  handshakeTimeoutMs?: number
  restartBaseDelayMs?: number
}

function makeKey(orgId: string, userId: string, platform: AdapterName): ProcessKey {
  return `${orgId}:${userId}:${platform}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeUserId(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function constantTimeCodeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left.trim().toUpperCase())
  const rightBuffer = Buffer.from(right.trim().toUpperCase())
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function normalizeConfig(value: unknown): FeishuAdapterConfig {
  if (!isRecord(value)) throw new Error('Feishu config must be an object')
  const appId = normalizeText(value.appId)
  const appSecret = normalizeText(value.appSecret)
  if (!appId || !appSecret) throw new Error('Feishu App ID and App Secret are required')
  const pairedUsers = Array.isArray(value.pairedUsers)
    ? value.pairedUsers.flatMap(entry => {
        if (!isRecord(entry)) return []
        const userId = normalizeUserId(entry.userId)
        if (!userId) return []
        return [{
          userId,
          displayName: (normalizeText(entry.displayName) || 'Feishu User').slice(0, 120),
          pairedAt: Number.isFinite(entry.pairedAt) ? Number(entry.pairedAt) : Date.now(),
        }]
      })
    : []
  const rawPairing = isRecord(value.pairing) ? value.pairing : {}
  return {
    appId,
    appSecret,
    encryptKey: normalizeText(value.encryptKey),
    verificationToken: normalizeText(value.verificationToken),
    allowedUsers: Array.isArray(value.allowedUsers)
      ? value.allowedUsers.map(normalizeUserId).filter(Boolean)
      : [],
    pairedUsers,
    defaultWorkDir: normalizeText(value.defaultWorkDir),
    streamingCard: value.streamingCard === true,
    pairing: {
      code: typeof rawPairing.code === 'string' && rawPairing.code ? rawPairing.code : null,
      expiresAt: Number.isFinite(rawPairing.expiresAt) ? Number(rawPairing.expiresAt) : null,
      createdAt: Number.isFinite(rawPairing.createdAt) ? Number(rawPairing.createdAt) : null,
    },
  }
}

function initialState(): AdapterProcessState {
  return {
    status: 'stopped',
    pid: null,
    error: null,
    startedAt: null,
    bridgeReady: false,
    transportConnected: false,
    transportUpdatedAt: null,
  }
}

function connectionFingerprint(config: FeishuAdapterConfig): string {
  return JSON.stringify({
    appId: config.appId,
    appSecret: config.appSecret,
    encryptKey: config.encryptKey || '',
    verificationToken: config.verificationToken || '',
    streamingCard: config.streamingCard === true,
  })
}

function redactPermissionInput(value: unknown, depth = 0): unknown {
  if (depth >= 6) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 20).map(entry => redactPermissionInput(entry, depth + 1))
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value).slice(0, 50)) {
    result[key] = /secret|token|password|api.?key|authorization/i.test(key)
      ? '[redacted]'
      : redactPermissionInput(entry, depth + 1)
  }
  return result
}

function permissionSummary(toolName: string, input: Record<string, unknown>): string {
  const serialized = JSON.stringify(redactPermissionInput(input), null, 2)
  const preview = serialized.length > 1_200 ? `${serialized.slice(0, 1_197)}...` : serialized
  return `${toolName} 请求在 Server 会话中执行\n${preview}`
}

function sessionOption(session: SessionRecord | SessionSummary, busy: boolean, originChannel?: 'feishu') {
  const id = 'sessionId' in session ? session.sessionId : ''
  if (!id) return null
  return {
    id,
    title: 'title' in session && session.title ? session.title : 'Moss Server 会话',
    preview: 'summary' in session && session.summary ? session.summary : '',
    updatedAt: 'lastActiveAt' in session ? session.lastActiveAt : Date.now(),
    busy,
    projectName: null,
    originChannel,
  }
}

export class AdapterProcessManager {
  private readonly processes = new Map<ProcessKey, HostedProcess>()
  private readonly states = new Map<ProcessKey, AdapterProcessState>()
  private readonly turns = new Map<string, HostedTurn>()
  private readonly turnQueues = new Map<string, QueuedTurn[]>()
  private readonly drainingSessions = new Set<string>()
  private readonly cancelledSessions = new Set<string>()
  private readonly pendingPermissions = new Map<string, PendingPermission>()
  private readonly pairingFailures = new Map<string, PairingFailure>()
  private readonly restartTimers = new Map<ProcessKey, ReturnType<typeof setTimeout>>()
  private readonly restartAttempts = new Map<ProcessKey, number>()
  private readonly transitions = new Map<ProcessKey, Promise<unknown>>()
  private disposed = false
  private readonly logger: ServerLogger

  constructor(
    private readonly db: DatabaseSync,
    private readonly runtime: RuntimeService,
    logger?: ServerLogger,
    private readonly options: AdapterProcessManagerOptions = {},
  ) {
    this.logger = logger ?? createServerLogger()
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feishu_adapter_deployments (
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        config_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (org_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS feishu_adapter_conversations (
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        open_id TEXT NOT NULL,
        active_session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (org_id, user_id, app_id, chat_id)
      );
      CREATE TABLE IF NOT EXISTS feishu_adapter_events (
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        session_id TEXT,
        turn_id TEXT,
        status TEXT NOT NULL,
        result_text TEXT,
        error TEXT,
        delivered_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (org_id, user_id, app_id, event_id)
      );
      CREATE TABLE IF NOT EXISTS feishu_adapter_sessions (
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (org_id, user_id, session_id)
      );
    `)
    this.db.prepare(`
      UPDATE feishu_adapter_events
      SET status = 'failed', error = ?, updated_at = ?
      WHERE status IN ('accepted', 'running')
    `).run('Moss Server restarted while this turn was running.', Date.now())
  }

  getStatus(adapter: AdapterName, orgId: string, userId: string): AdapterProcessState & {
    location: 'server'
    enabled: boolean
    pairedUsers: PairedUser[]
    pairing: PairingState
  } {
    const key = makeKey(orgId, userId, adapter)
    const state = this.refreshState(key)
    const deployment = this.getDeployment(orgId, userId)
    return {
      ...state,
      location: 'server',
      enabled: deployment?.enabled === true,
      pairedUsers: deployment?.config.pairedUsers ?? [],
      pairing: deployment?.config.pairing ?? { code: null, expiresAt: null, createdAt: null },
    }
  }

  async restoreEnabled(): Promise<void> {
    const rows = this.db.prepare(`
      SELECT org_id, user_id, role, scopes_json, config_json, enabled
      FROM feishu_adapter_deployments WHERE enabled = 1
    `).all() as Array<Record<string, unknown>>
    for (const row of rows) {
      try {
        const deployment = this.mapDeployment(row)
        await this.start('feishu', deployment, false)
      } catch (error) {
        this.logger.error(`[AdapterProcess] restore failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  async start(
    adapter: AdapterName,
    input: Pick<AuthContext, 'orgId' | 'userId' | 'role' | 'scopes'> & { config: unknown },
    persist = true,
  ): Promise<void> {
    const key = makeKey(input.orgId, input.userId, adapter)
    return this.enqueueTransition(key, () => this.startLocked(adapter, input, persist))
  }

  private async startLocked(
    adapter: AdapterName,
    input: Pick<AuthContext, 'orgId' | 'userId' | 'role' | 'scopes'> & { config: unknown },
    persist: boolean,
  ): Promise<void> {
    if (this.disposed) throw new Error('Feishu Adapter manager is shutting down')
    for (const scope of ['sessions:create', 'sessions:list', 'sessions:attach']) {
      if (!hasScope(input.scopes, scope)) {
        throw new Error(`Feishu Server hosting requires the ${scope} scope`)
      }
    }
    const config = normalizeConfig(input.config)
    const deployment: StoredDeployment = {
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
      scopes: [...input.scopes],
      config,
      enabled: true,
    }
    const key = makeKey(deployment.orgId, deployment.userId, adapter)
    const existing = this.processes.get(key)
    if (
      existing
      && existing.child.exitCode === null
      && existing.child.signalCode === null
      && connectionFingerprint(existing.config) === connectionFingerprint(config)
    ) {
      this.writeRuntimeConfig(existing.configDir, config)
      this.saveDeployment(deployment)
      existing.config = config
      existing.auth = {
        orgId: deployment.orgId,
        userId: deployment.userId,
        role: deployment.role,
        scopes: deployment.scopes,
      }
      return
    }
    if (persist) this.saveDeployment(deployment)

    this.clearRestart(key)
    await this.stopProcess(key)
    const entryFile = this.findEntryFile()
    if (!entryFile) {
      const message = 'Feishu Adapter entry file is missing from the Moss Server installation.'
      this.states.set(key, { ...initialState(), status: 'error', error: message })
      this.scheduleRestart(key, deployment)
      throw new Error(message)
    }

    const runtimeDir = path.join(
      this.options.runtimesDir ?? ADAPTER_RUNTIMES_DIR,
      deployment.orgId,
      deployment.userId,
      adapter,
    )
    const configDir = path.join(runtimeDir, 'config')
    mkdirSync(configDir, { recursive: true })
    this.writeRuntimeConfig(configDir, config)
    let stdoutFd: FileHandle | null = null
    let stderrFd: FileHandle | null = null
    let child: ChildProcess
    try {
      stdoutFd = await open(path.join(runtimeDir, 'stdout.log'), 'a')
      stderrFd = await open(path.join(runtimeDir, 'stderr.log'), 'a')
      child = spawn(process.execPath, [entryFile], {
        cwd: path.dirname(entryFile),
        stdio: ['ignore', stdoutFd.fd, stderrFd.fd, 'ipc'],
        env: {
          ...process.env,
          MOSS_CONFIG_DIR: configDir,
          MOSS_HOME: configDir,
        },
        windowsHide: true,
      })
    } catch (error) {
      await Promise.allSettled([stdoutFd?.close(), stderrFd?.close()].filter(Boolean))
      const message = error instanceof Error ? error.message : String(error)
      this.states.set(key, { ...initialState(), status: 'error', error: message })
      this.scheduleRestart(key, deployment)
      throw error
    }
    const hosted: HostedProcess = {
      child,
      config,
      auth: {
        orgId: deployment.orgId,
        userId: deployment.userId,
        role: deployment.role,
        scopes: deployment.scopes,
      },
      configDir,
      handshakeTimer: null,
    }
    this.processes.set(key, hosted)
    this.states.set(key, {
      ...initialState(),
      status: 'running',
      pid: child.pid ?? null,
      startedAt: Date.now(),
    })
    child.on('message', value => void this.handleChildMessage(key, hosted, value))
    hosted.handshakeTimer = setTimeout(() => {
      if (this.processes.get(key) !== hosted || this.states.get(key)?.bridgeReady) return
      const message = 'Feishu Adapter IPC handshake timed out.'
      this.states.set(key, { ...initialState(), status: 'error', error: message })
      child.kill('SIGTERM')
    }, this.options.handshakeTimeoutMs ?? 15_000)
    hosted.handshakeTimer.unref?.()
    child.once('error', error => {
      if (this.processes.get(key) !== hosted) return
      if (hosted.handshakeTimer) {
        clearTimeout(hosted.handshakeTimer)
        hosted.handshakeTimer = null
      }
      this.processes.delete(key)
      this.states.set(key, { ...initialState(), status: 'error', error: error.message })
      const current = this.getDeployment(hosted.auth.orgId, hosted.auth.userId)
      if (current?.enabled) this.scheduleRestart(key, current)
    })
    child.once('exit', (code, signal) => {
      if (this.processes.get(key)?.child !== child) return
      if (hosted.handshakeTimer) clearTimeout(hosted.handshakeTimer)
      this.processes.delete(key)
      const previousError = this.states.get(key)?.error
      this.states.set(key, {
        ...initialState(),
        status: 'error',
        error: previousError || `Adapter exited unexpectedly (${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`})`,
      })
      const deployment = this.getDeployment(hosted.auth.orgId, hosted.auth.userId)
      if (deployment?.enabled) this.scheduleRestart(key, deployment)
    })
    await Promise.allSettled([stdoutFd.close(), stderrFd.close()])
    this.logger.info(`[AdapterProcess] ${key} started with pid ${child.pid ?? 'unknown'}`)
  }

  async stop(adapter: AdapterName, orgId: string, userId: string): Promise<void> {
    const key = makeKey(orgId, userId, adapter)
    return this.enqueueTransition(key, () => this.stopLocked(key, orgId, userId))
  }

  private async stopLocked(key: ProcessKey, orgId: string, userId: string): Promise<void> {
    this.clearRestart(key)
    this.restartAttempts.delete(key)
    this.db.prepare(`
      DELETE FROM feishu_adapter_deployments WHERE org_id = ? AND user_id = ?
    `).run(orgId, userId)
    await this.stopProcess(key)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const timer of this.restartTimers.values()) clearTimeout(timer)
    this.restartTimers.clear()
    for (const permission of this.pendingPermissions.values()) clearTimeout(permission.timer)
    this.pendingPermissions.clear()
    const keys = new Set<ProcessKey>([...this.processes.keys(), ...this.transitions.keys()])
    await Promise.all([...keys].map(key => this.enqueueTransition(key, () => this.stopProcess(key))))
  }

  private refreshState(key: ProcessKey): AdapterProcessState {
    const state = this.states.get(key) ?? initialState()
    if (state.pid) {
      try {
        process.kill(state.pid, 0)
      } catch {
        const stopped = initialState()
        this.states.set(key, stopped)
        return stopped
      }
    }
    return { ...state }
  }

  private async stopProcess(key: ProcessKey): Promise<void> {
    const hosted = this.processes.get(key)
    this.processes.delete(key)
    this.states.set(key, initialState())
    if (hosted?.handshakeTimer) clearTimeout(hosted.handshakeTimer)
    if (hosted) {
      for (const permission of this.pendingPermissions.values()) {
        if (permission.hosted !== hosted) continue
        clearTimeout(permission.timer)
        this.pendingPermissions.delete(permission.id)
        this.writePermissionResponse(permission, false, 'Feishu runtime stopped.')
      }
      for (const [sessionId, queue] of this.turnQueues) {
        const retained = queue.filter(turn => turn.hosted !== hosted)
        for (const turn of queue) {
          if (turn.hosted !== hosted) continue
          this.updateEvent(turn.hosted, turn.eventId, 'cancelled', '', 'Feishu runtime stopped.')
        }
        if (retained.length > 0) this.turnQueues.set(sessionId, retained)
        else this.turnQueues.delete(sessionId)
      }
      for (const turn of this.turns.values()) {
        if (turn.hosted !== hosted) continue
        if (!turn.socket.destroyed) turn.socket.write(`${JSON.stringify({ type: 'interrupt' })}\n`)
        turn.reject(new Error('Feishu runtime stopped.'))
      }
    }
    if (!hosted || hosted.child.exitCode !== null || hosted.child.signalCode !== null) return
    await new Promise<void>(resolve => {
      let hardStopTimer: ReturnType<typeof setTimeout> | null = null
      const forceTimer = setTimeout(() => {
        try {
          hosted.child.kill('SIGKILL')
        } catch {}
        hardStopTimer = setTimeout(resolve, 1_000)
      }, 5_000)
      hosted.child.once('exit', () => {
        clearTimeout(forceTimer)
        if (hardStopTimer) clearTimeout(hardStopTimer)
        resolve()
      })
      try {
        hosted.child.kill('SIGTERM')
      } catch {
        clearTimeout(forceTimer)
        resolve()
      }
    })
  }

  private async handleChildMessage(key: ProcessKey, hosted: HostedProcess, value: unknown): Promise<void> {
    if (this.processes.get(key) !== hosted) return
    if (!isRecord(value) || value.version !== BRIDGE_VERSION || typeof value.id !== 'string' || typeof value.type !== 'string') return
    const request = value as BridgeRequest
    try {
      let result: unknown
      if (request.type === 'bridge.hello') {
        if (hosted.handshakeTimer) {
          clearTimeout(hosted.handshakeTimer)
          hosted.handshakeTimer = null
        }
        const state = this.states.get(key) ?? initialState()
        this.states.set(key, { ...state, bridgeReady: true })
        result = { protocolVersion: BRIDGE_VERSION, adapter: 'feishu', serverHosted: true }
      } else {
        result = await this.handleBridgeRequest(key, hosted, request)
      }
      this.sendChild(hosted, { version: BRIDGE_VERSION, replyTo: request.id, ok: true, result })
      if (request.type === 'bridge.hello') {
        this.sendChild(hosted, {
          version: BRIDGE_VERSION,
          id: randomUUID(),
          type: 'bridge.ready',
          timestamp: Date.now(),
          payload: result,
        })
        this.redeliverPending(hosted)
      }
    } catch (error) {
      this.sendChild(hosted, {
        version: BRIDGE_VERSION,
        replyTo: request.id,
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  private async handleBridgeRequest(key: ProcessKey, hosted: HostedProcess, request: BridgeRequest): Promise<unknown> {
    const payload = isRecord(request.payload) ? request.payload : {}
    if (request.type === 'adapter.connection') {
      const state = this.states.get(key) ?? initialState()
      const connected = payload.connected === true
      this.states.set(key, {
        ...state,
        transportConnected: connected,
        transportUpdatedAt: Date.now(),
        error: connected ? null : normalizeText(payload.error) || state.error,
      })
      if (connected) this.restartAttempts.delete(key)
      return { ok: true }
    }
    if (request.type === 'pairing.attempt') return this.handlePairing(hosted, payload)
    if (request.type === 'turn.delivery.ack') {
      this.db.prepare(`
        UPDATE feishu_adapter_events SET delivered_at = ?, updated_at = ?
        WHERE org_id = ? AND user_id = ? AND app_id = ? AND turn_id = ?
      `).run(Date.now(), Date.now(), hosted.auth.orgId, hosted.auth.userId, hosted.config.appId, normalizeText(payload.turnId))
      return { ok: true }
    }
    if (request.type === 'delivery.ack') {
      if (payload.ok === false) {
        const permission = this.pendingPermissions.get(normalizeText(payload.deliveryId))
        if (permission?.hosted === hosted) {
          clearTimeout(permission.timer)
          this.pendingPermissions.delete(permission.id)
          this.writePermissionResponse(permission, false, 'Feishu permission card delivery failed.')
        }
      }
      return { ok: true }
    }
    if (request.type === 'decision.respond') return this.handlePermissionDecision(hosted, payload)
    return this.handleConversationRequest(hosted, request)
  }

  private handlePairing(hosted: HostedProcess, payload: Record<string, unknown>): { paired: boolean; conversationId?: string } {
    const openId = normalizeText(payload.openId)
    const chatId = normalizeText(payload.chatId)
    const code = normalizeText(payload.code)
    const pairing = hosted.config.pairing
    if (!openId || !chatId || !code || !pairing?.code || !pairing.expiresAt || pairing.expiresAt <= Date.now()) {
      return { paired: false }
    }
    const failureKey = this.pairingFailureKey(hosted, openId)
    if (this.isPairingRateLimited(failureKey)) return { paired: false }
    if (!constantTimeCodeEqual(code, pairing.code)) {
      this.recordPairingFailure(failureKey)
      return { paired: false }
    }
    this.pairingFailures.delete(failureKey)
    const pairedUsers = [...(hosted.config.pairedUsers ?? [])]
    if (!pairedUsers.some(entry => String(entry.userId) === openId)) {
      pairedUsers.push({
        userId: openId,
        displayName: (normalizeText(payload.displayName) || 'Feishu User').slice(0, 120),
        pairedAt: Date.now(),
      })
    }
    const nextConfig: FeishuAdapterConfig = {
      ...hosted.config,
      pairedUsers,
      pairing: { code: null, expiresAt: null, createdAt: null },
    }
    this.writeRuntimeConfig(hosted.configDir, nextConfig)
    this.saveDeployment({ ...hosted.auth, config: nextConfig, enabled: true })
    hosted.config = nextConfig
    this.upsertConversation(hosted, chatId, openId)
    return { paired: true, conversationId: `${hosted.config.appId}:${chatId}` }
  }

  private async handleConversationRequest(hosted: HostedProcess, request: BridgeRequest): Promise<unknown> {
    const payload = isRecord(request.payload) ? request.payload : {}
    const openId = normalizeText(payload.openId)
    const chatId = normalizeText(payload.chatId) || this.findLatestChatId(hosted, openId)
    if (!openId || !chatId || !this.isAllowed(hosted.config, openId)) {
      throw new Error('This Feishu user is not paired with the Moss Server deployment.')
    }
    const conversation = this.upsertConversation(hosted, chatId, openId)

    if (request.type === 'conversation.list') {
      const category = ['feishu', 'project'].includes(normalizeText(payload.category))
        ? normalizeText(payload.category)
        : 'recent'
      const page = Math.max(0, Number.parseInt(String(payload.page ?? 0), 10) || 0)
      const pageSize = Math.min(8, Math.max(1, Number.parseInt(String(payload.pageSize ?? 5), 10) || 5))
      const query = normalizeText(payload.query).toLowerCase()
      const feishuSessions = new Set(this.listFeishuSessionIds(hosted))
      const sessions = this.runtime.listSessionRecords({
        orgId: hosted.auth.orgId,
        userId: hosted.auth.userId,
        activeOnly: true,
      }).map(session => sessionOption(session, this.isSessionBusy(session.sessionId), feishuSessions.has(session.sessionId) ? 'feishu' : undefined))
        .filter(Boolean)
        .filter(session => !query || session!.title.toLowerCase().includes(query) || session!.preview.toLowerCase().includes(query))
        .filter(session => category === 'recent'
          || (category === 'feishu' && session!.originChannel === 'feishu')
          || (category === 'project' && Boolean(session!.projectName)))
      const total = sessions.length
      const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1)
      const effectivePage = Math.min(page, lastPage)
      const active = conversation.activeSessionId
        ? this.getWritableSession(hosted, conversation.activeSessionId)
        : null
      return {
        chatId,
        activeSessionId: conversation.activeSessionId,
        currentSession: active ? sessionOption(active, this.isSessionBusy(active.sessionId), feishuSessions.has(active.sessionId) ? 'feishu' : undefined) : null,
        sessions: sessions.slice(effectivePage * pageSize, (effectivePage + 1) * pageSize),
        category,
        query: normalizeText(payload.query),
        page: effectivePage,
        pageSize,
        total,
        hasPrevious: effectivePage > 0,
        hasNext: (effectivePage + 1) * pageSize < total,
      }
    }

    if (request.type === 'conversation.current') {
      const session = conversation.activeSessionId
        ? this.getWritableSession(hosted, conversation.activeSessionId)
        : null
      return { chatId, session: session ? sessionOption(session, this.isSessionBusy(session.sessionId), 'feishu') : null }
    }

    if (request.type === 'conversation.select') {
      const session = this.getWritableSession(hosted, normalizeText(payload.sessionId))
      if (!session) throw new Error('The selected Moss Server session is not writable.')
      this.setActiveSession(hosted, chatId, session.sessionId)
      return { session: sessionOption(session, this.isSessionBusy(session.sessionId)) }
    }

    if (request.type === 'conversation.new') {
      const existing = normalizeText(payload.eventId) ? this.getEvent(hosted, normalizeText(payload.eventId)) : null
      if (existing?.sessionId) {
        const session = this.getWritableSession(hosted, existing.sessionId)
        if (session) return { duplicate: true, session: sessionOption(session, this.isSessionBusy(session.sessionId), 'feishu') }
      }
      const session = await this.createSession(hosted, normalizeText(payload.title))
      this.setActiveSession(hosted, chatId, session.sessionId)
      if (normalizeText(payload.eventId)) this.saveEvent(hosted, normalizeText(payload.eventId), chatId, session.sessionId, null, 'completed')
      return { session: sessionOption(session, false, 'feishu') }
    }

    if (request.type === 'session.abort') {
      const session = conversation.activeSessionId ? this.getWritableSession(hosted, conversation.activeSessionId) : null
      if (!session) throw new Error('No writable Moss Server session is selected.')
      const activeTurn = this.turns.get(session.sessionId)
      if (activeTurn) {
        if (!activeTurn.socket.destroyed) activeTurn.socket.write(`${JSON.stringify({ type: 'interrupt' })}\n`)
      }
      if (this.drainingSessions.has(session.sessionId)) this.cancelledSessions.add(session.sessionId)
      const queued = this.turnQueues.get(session.sessionId) ?? []
      this.turnQueues.delete(session.sessionId)
      for (const turn of queued) {
        this.updateEvent(turn.hosted, turn.eventId, 'cancelled', '', 'Turn cancelled by user.')
      }
      return { session: sessionOption(session, Boolean(activeTurn)), cancelled: queued.length }
    }

    if (request.type === 'chat.message.received') {
      const eventId = normalizeText(payload.eventId)
      const text = normalizeText(payload.text)
      if (!eventId || !text) throw new Error('Feishu message id and text are required.')
      const existing = this.getEvent(hosted, eventId)
      if (existing) {
        return { duplicate: true, sessionId: existing.sessionId, turnId: existing.turnId, status: existing.status }
      }
      let session = conversation.activeSessionId ? this.getWritableSession(hosted, conversation.activeSessionId) : null
      if (!session) {
        session = await this.createSession(hosted)
        this.setActiveSession(hosted, chatId, session.sessionId)
      }
      const queued = this.isSessionBusy(session.sessionId)
      const turnId = randomUUID()
      this.saveEvent(hosted, eventId, chatId, session.sessionId, turnId, 'accepted')
      const queue = this.turnQueues.get(session.sessionId) ?? []
      queue.push({ hosted, eventId, turnId, chatId, session, prompt: text })
      this.turnQueues.set(session.sessionId, queue)
      void this.drainTurnQueue(session.sessionId)
      return { accepted: true, queued, turnId, session: sessionOption(session, true, 'feishu') }
    }

    throw new Error(`Unsupported Feishu Adapter request: ${request.type}`)
  }

  private async runTurn(
    hosted: HostedProcess,
    eventId: string,
    turnId: string,
    chatId: string,
    session: SessionRecord,
    prompt: string,
  ): Promise<void> {
    this.updateEvent(hosted, eventId, 'running')
    try {
      if (this.cancelledSessions.has(session.sessionId)) throw new Error('Turn cancelled by user.')
      const text = await this.sendPrompt(hosted, chatId, session.sessionId, prompt)
      this.updateEvent(hosted, eventId, 'completed', text)
      const delivered = this.sendEvent(this.getCurrentHost(hosted), 'turn.completed', {
        turnId,
        sessionId: session.sessionId,
        chatId,
        text: text || '处理完成。',
        title: session.title || 'Moss Server 会话',
      })
      if (!delivered && !this.getDeployment(hosted.auth.orgId, hosted.auth.userId)?.enabled) {
        this.markEventDelivered(hosted, eventId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.updateEvent(hosted, eventId, 'failed', '', message)
      const delivered = this.sendEvent(this.getCurrentHost(hosted), 'turn.failed', {
        turnId,
        sessionId: session.sessionId,
        chatId,
        message: SAFE_TURN_FAILURE_MESSAGE,
      })
      if (!delivered && !this.getDeployment(hosted.auth.orgId, hosted.auth.userId)?.enabled) {
        this.markEventDelivered(hosted, eventId)
      }
      this.logger.error(`[AdapterProcess] Feishu turn ${turnId} failed: ${message}`)
    } finally {
      this.cancelledSessions.delete(session.sessionId)
    }
  }

  private async drainTurnQueue(sessionId: string): Promise<void> {
    if (this.drainingSessions.has(sessionId)) return
    this.drainingSessions.add(sessionId)
    try {
      while (true) {
        const queue = this.turnQueues.get(sessionId)
        if (!queue) {
          this.turnQueues.delete(sessionId)
          return
        }
        const turn = queue.shift()
        if (!turn) {
          this.turnQueues.delete(sessionId)
          return
        }
        if (queue.length === 0) this.turnQueues.delete(sessionId)
        await this.runTurn(
          turn.hosted,
          turn.eventId,
          turn.turnId,
          turn.chatId,
          turn.session,
          turn.prompt,
        )
      }
    } finally {
      this.drainingSessions.delete(sessionId)
      if ((this.turnQueues.get(sessionId)?.length ?? 0) > 0) {
        void this.drainTurnQueue(sessionId)
      }
    }
  }

  private async sendPrompt(hosted: HostedProcess, chatId: string, sessionId: string, prompt: string): Promise<string> {
    const ready = await this.runtime.ensureSessionReady(sessionId)
    const socket = await this.runtime.connectToAttempt(ready.attempt)
    const key = makeKey(hosted.auth.orgId, hosted.auth.userId, 'feishu')
    if (this.processes.get(key) !== hosted || this.cancelledSessions.has(sessionId)) {
      socket.destroy()
      throw new Error('Feishu runtime stopped before the turn started.')
    }
    return await new Promise<string>((resolve, reject) => {
      let buffer = ''
      let settled = false
      const finish = (error?: Error, text = '') => {
        if (settled) return
        settled = true
        this.turns.delete(sessionId)
        for (const permission of this.pendingPermissions.values()) {
          if (permission.sessionId !== sessionId) continue
          clearTimeout(permission.timer)
          this.pendingPermissions.delete(permission.id)
        }
        socket.destroy()
        if (error) reject(error)
        else resolve(text)
      }
      this.turns.set(sessionId, { hosted, socket, reject: error => finish(error) })
      socket.on('data', chunk => {
        buffer += Buffer.from(chunk).toString('utf8')
        while (true) {
          const index = buffer.indexOf('\n')
          if (index < 0) break
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          if (!line.trim()) continue
          try {
            const envelope = JSON.parse(line) as { type?: string; line?: string }
            if (envelope.type !== 'stdout' || typeof envelope.line !== 'string') continue
            const message = JSON.parse(envelope.line) as Record<string, unknown>
            if (message.type === 'control_request') {
              const request = isRecord(message.request) ? message.request : {}
              if (request.subtype === 'can_use_tool') {
                this.requestToolPermission(hosted, socket, sessionId, chatId, message)
              } else {
                const response = JSON.stringify({
                  type: 'control_response',
                  response: {
                    subtype: 'error',
                    request_id: message.request_id,
                    error: `Unsupported server-hosted control request: ${normalizeText(request.subtype) || 'unknown'}`,
                  },
                })
                socket.write(`${JSON.stringify({ type: 'stdin', data: `${response}\n` })}\n`)
              }
              continue
            }
            if (message.type === 'result') {
              if (message.subtype === 'success') finish(undefined, typeof message.result === 'string' ? message.result : '')
              else finish(new Error(normalizeText(message.result) || normalizeText(message.error) || 'Moss Server turn failed'))
            }
          } catch {}
        }
      })
      socket.once('close', () => finish(new Error('Moss Server session disconnected before completion.')))
      socket.once('error', error => finish(error))
      const userMessage = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: prompt },
        parent_tool_use_id: null,
        session_id: '',
        uuid: randomUUID(),
      })
      socket.write(`${JSON.stringify({ type: 'stdin', data: `${userMessage}\n` })}\n`)
    })
  }

  private async createSession(hosted: HostedProcess, title = ''): Promise<SessionRecord> {
    const session = await this.runtime.createSession({
      cwd: hosted.config.defaultWorkDir || undefined,
      title: title.slice(0, 120) || '飞书会话',
      dangerouslySkipPermissions: false,
      userId: hosted.auth.userId,
      orgId: hosted.auth.orgId,
      role: hosted.auth.role,
      scopes: hosted.auth.scopes,
      profileMode: 'user',
    })
    this.db.prepare(`
      INSERT OR IGNORE INTO feishu_adapter_sessions (org_id, user_id, session_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(hosted.auth.orgId, hosted.auth.userId, session.sessionId, Date.now())
    return session
  }

  private getWritableSession(hosted: HostedProcess, sessionId: string): SessionRecord | null {
    if (!sessionId) return null
    const session = this.runtime.getSession(sessionId)
    if (!session || session.orgId !== hosted.auth.orgId || session.userId !== hosted.auth.userId) return null
    return session.desiredState === 'active' ? session : null
  }

  private sendEvent(hosted: HostedProcess, type: string, payload: Record<string, unknown>): boolean {
    const key = makeKey(hosted.auth.orgId, hosted.auth.userId, 'feishu')
    if (this.processes.get(key) !== hosted || !this.states.get(key)?.bridgeReady) return false
    return this.sendChild(hosted, { version: BRIDGE_VERSION, id: randomUUID(), type, timestamp: Date.now(), payload })
  }

  private sendChild(hosted: HostedProcess, message: Record<string, unknown>): boolean {
    if (hosted.child.exitCode !== null || hosted.child.signalCode !== null || typeof hosted.child.send !== 'function') return false
    try {
      hosted.child.send(message, error => {
        if (error) this.logger.error(`[AdapterProcess] unable to send Feishu IPC message: ${error.message}`)
      })
      return true
    } catch (error) {
      this.logger.error(`[AdapterProcess] unable to send Feishu IPC message: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  private isSessionBusy(sessionId: string): boolean {
    return this.turns.has(sessionId)
      || this.drainingSessions.has(sessionId)
      || (this.turnQueues.get(sessionId)?.length ?? 0) > 0
  }

  private getCurrentHost(fallback: HostedProcess): HostedProcess {
    const key = makeKey(fallback.auth.orgId, fallback.auth.userId, 'feishu')
    const current = this.processes.get(key)
    return current?.config.appId === fallback.config.appId ? current : fallback
  }

  private requestToolPermission(
    hosted: HostedProcess,
    socket: net.Socket,
    sessionId: string,
    chatId: string,
    message: Record<string, unknown>,
  ): void {
    const request = isRecord(message.request) ? message.request : {}
    const requestId = normalizeText(message.request_id)
    if (!requestId) return
    const id = randomUUID()
    const actionToken = randomUUID()
    const toolName = normalizeText(request.tool_name) || '工具操作'
    const input = isRecord(request.input) ? request.input : {}
    if (toolName === ASK_USER_QUESTION_TOOL_NAME) {
      const response = JSON.stringify({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: {
            behavior: 'deny',
            message: 'Ask the user in a normal assistant response and wait for their next Feishu message.',
          },
        },
      })
      socket.write(`${JSON.stringify({ type: 'stdin', data: `${response}\n` })}\n`)
      return
    }
    const timer = setTimeout(() => {
      const permission = this.pendingPermissions.get(id)
      if (!permission) return
      this.pendingPermissions.delete(id)
      this.writePermissionResponse(permission, false, 'Permission request expired.')
      this.sendEvent(hosted, 'decision.resolved', {
        decision: { id, status: 'expired', mobileTitle: 'Moss Server 操作确认', mobileSummary: `${toolName} 请求已过期` },
        reason: 'expired',
        deliveries: [],
      })
    }, 10 * 60_000)
    timer.unref?.()
    const permission: PendingPermission = {
      id,
      actionToken,
      requestId,
      sessionId,
      chatId,
      toolName,
      input,
      hosted,
      socket,
      timer,
    }
    this.pendingPermissions.set(id, permission)
    const sent = this.sendEvent(hosted, 'notification.deliver', {
      deliveryId: id,
      chatId,
      title: 'Moss Server 操作确认',
      summary: permissionSummary(toolName, input),
      decisionRequestId: id,
      actionToken,
    })
    if (!sent) {
      clearTimeout(timer)
      this.pendingPermissions.delete(id)
      this.writePermissionResponse(permission, false, 'Feishu permission card could not be delivered.')
    }
  }

  private handlePermissionDecision(hosted: HostedProcess, payload: Record<string, unknown>): { ok: true } {
    const decisionId = normalizeText(payload.decisionId)
    const permission = this.pendingPermissions.get(decisionId)
    if (!permission || permission.hosted !== hosted) throw new Error('This permission request is no longer pending.')
    const chatId = normalizeText(payload.chatId)
    const openId = normalizeText(payload.openId)
    const token = normalizeText(payload.actionToken)
    if (chatId !== permission.chatId || !this.isAllowed(hosted.config, openId)) {
      throw new Error('This Feishu conversation cannot answer the permission request.')
    }
    if (!token || !constantTimeCodeEqual(token, permission.actionToken)) {
      throw new Error('Permission action token is invalid.')
    }
    clearTimeout(permission.timer)
    this.pendingPermissions.delete(permission.id)
    const allowed = payload.allowed === true
    this.writePermissionResponse(permission, allowed, allowed ? '' : 'Denied from Feishu.')
    this.sendEvent(hosted, 'decision.resolved', {
      decision: {
        id: permission.id,
        status: allowed ? 'resolved' : 'rejected',
        mobileTitle: 'Moss Server 操作确认',
        mobileSummary: `${permission.toolName} 请求${allowed ? '已允许' : '已拒绝'}`,
      },
      reason: allowed ? 'resolved' : 'rejected',
      deliveries: [],
    })
    return { ok: true }
  }

  private writePermissionResponse(permission: PendingPermission, allowed: boolean, message: string): void {
    if (permission.socket.destroyed) return
    const response = JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: permission.requestId,
        response: allowed
          ? { behavior: 'allow', updatedInput: permission.input }
          : { behavior: 'deny', message },
      },
    })
    permission.socket.write(`${JSON.stringify({ type: 'stdin', data: `${response}\n` })}\n`)
  }

  private redeliverPending(hosted: HostedProcess): void {
    const rows = this.db.prepare(`
      SELECT turn_id, session_id, chat_id, status, result_text
      FROM feishu_adapter_events
      WHERE org_id = ? AND user_id = ? AND app_id = ?
        AND status IN ('completed', 'failed') AND delivered_at IS NULL AND turn_id IS NOT NULL
      ORDER BY updated_at ASC
    `).all(hosted.auth.orgId, hosted.auth.userId, hosted.config.appId) as Array<Record<string, unknown>>
    for (const row of rows) {
      this.sendEvent(hosted, row.status === 'completed' ? 'turn.completed' : 'turn.failed', {
        turnId: row.turn_id,
        sessionId: row.session_id,
        chatId: row.chat_id,
        ...(row.status === 'completed'
          ? { text: normalizeText(row.result_text) || '处理完成。', title: 'Moss Server 会话' }
          : { message: SAFE_TURN_FAILURE_MESSAGE }),
      })
    }
  }

  private isAllowed(config: FeishuAdapterConfig, openId: string): boolean {
    return (config.allowedUsers ?? []).some(value => String(value) === openId)
      || (config.pairedUsers ?? []).some(value => String(value.userId) === openId)
  }

  private upsertConversation(hosted: HostedProcess, chatId: string, openId: string): { activeSessionId: string | null } {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO feishu_adapter_conversations (
        org_id, user_id, app_id, chat_id, open_id, active_session_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(org_id, user_id, app_id, chat_id) DO UPDATE SET
        open_id = excluded.open_id, updated_at = excluded.updated_at
    `).run(hosted.auth.orgId, hosted.auth.userId, hosted.config.appId, chatId, openId, now, now)
    const row = this.db.prepare(`
      SELECT active_session_id FROM feishu_adapter_conversations
      WHERE org_id = ? AND user_id = ? AND app_id = ? AND chat_id = ?
    `).get(hosted.auth.orgId, hosted.auth.userId, hosted.config.appId, chatId) as Record<string, unknown>
    return { activeSessionId: normalizeText(row?.active_session_id) || null }
  }

  private setActiveSession(hosted: HostedProcess, chatId: string, sessionId: string): void {
    this.db.prepare(`
      UPDATE feishu_adapter_conversations SET active_session_id = ?, updated_at = ?
      WHERE org_id = ? AND user_id = ? AND app_id = ? AND chat_id = ?
    `).run(sessionId, Date.now(), hosted.auth.orgId, hosted.auth.userId, hosted.config.appId, chatId)
  }

  private findLatestChatId(hosted: HostedProcess, openId: string): string {
    const row = this.db.prepare(`
      SELECT chat_id FROM feishu_adapter_conversations
      WHERE org_id = ? AND user_id = ? AND app_id = ? AND open_id = ?
      ORDER BY updated_at DESC LIMIT 1
    `).get(hosted.auth.orgId, hosted.auth.userId, hosted.config.appId, openId) as Record<string, unknown> | undefined
    return normalizeText(row?.chat_id)
  }

  private listFeishuSessionIds(hosted: HostedProcess): string[] {
    const rows = this.db.prepare(`
      SELECT session_id FROM feishu_adapter_sessions WHERE org_id = ? AND user_id = ?
    `).all(hosted.auth.orgId, hosted.auth.userId) as Array<Record<string, unknown>>
    return rows.map(row => normalizeText(row.session_id)).filter(Boolean)
  }

  private saveEvent(
    hosted: HostedProcess,
    eventId: string,
    chatId: string,
    sessionId: string,
    turnId: string | null,
    status: string,
  ): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT OR IGNORE INTO feishu_adapter_events (
        org_id, user_id, app_id, event_id, chat_id, session_id, turn_id,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(hosted.auth.orgId, hosted.auth.userId, hosted.config.appId, eventId, chatId, sessionId, turnId, status, now, now)
  }

  private getEvent(hosted: HostedProcess, eventId: string): { sessionId: string; turnId: string; status: string } | null {
    const row = this.db.prepare(`
      SELECT session_id, turn_id, status FROM feishu_adapter_events
      WHERE org_id = ? AND user_id = ? AND app_id = ? AND event_id = ?
    `).get(hosted.auth.orgId, hosted.auth.userId, hosted.config.appId, eventId) as Record<string, unknown> | undefined
    return row ? {
      sessionId: normalizeText(row.session_id),
      turnId: normalizeText(row.turn_id),
      status: normalizeText(row.status),
    } : null
  }

  private updateEvent(hosted: HostedProcess, eventId: string, status: string, resultText = '', error = ''): void {
    this.db.prepare(`
      UPDATE feishu_adapter_events
      SET status = ?, result_text = ?, error = ?, updated_at = ?
      WHERE org_id = ? AND user_id = ? AND app_id = ? AND event_id = ?
    `).run(status, resultText || null, error || null, Date.now(), hosted.auth.orgId, hosted.auth.userId, hosted.config.appId, eventId)
  }

  private markEventDelivered(hosted: HostedProcess, eventId: string): void {
    const now = Date.now()
    this.db.prepare(`
      UPDATE feishu_adapter_events SET delivered_at = ?, updated_at = ?
      WHERE org_id = ? AND user_id = ? AND app_id = ? AND event_id = ?
    `).run(now, now, hosted.auth.orgId, hosted.auth.userId, hosted.config.appId, eventId)
  }

  private writeRuntimeConfig(configDir: string, config: FeishuAdapterConfig): void {
    const settingsPath = path.join(configDir, 'settings.json')
    const tempPath = `${settingsPath}.${process.pid}.${randomUUID()}.tmp`
    const content = `${JSON.stringify({
      adapters: {
        feishu: {
          appId: config.appId,
          appSecret: config.appSecret,
          encryptKey: config.encryptKey || '',
          verificationToken: config.verificationToken || '',
          allowedUsers: config.allowedUsers ?? [],
          pairedUsers: config.pairedUsers ?? [],
          defaultWorkDir: config.defaultWorkDir || '',
          streamingCard: config.streamingCard === true,
        },
        pairing: config.pairing ?? { code: null, expiresAt: null, createdAt: null },
      },
    }, null, 2)}\n`
    try {
      writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 })
      renameSync(tempPath, settingsPath)
      chmodSync(settingsPath, 0o600)
    } finally {
      if (existsSync(tempPath)) unlinkSync(tempPath)
    }
  }

  private pairingFailureKey(hosted: HostedProcess, openId: string): string {
    return `${hosted.auth.orgId}:${hosted.auth.userId}:${hosted.config.appId}:${openId}`
  }

  private isPairingRateLimited(key: string): boolean {
    const failure = this.pairingFailures.get(key)
    if (!failure) return false
    if (Date.now() - failure.startedAt > PAIRING_RATE_WINDOW_MS) {
      this.pairingFailures.delete(key)
      return false
    }
    return failure.count >= PAIRING_MAX_FAILURES
  }

  private recordPairingFailure(key: string): void {
    const current = this.pairingFailures.get(key)
    if (!current || Date.now() - current.startedAt > PAIRING_RATE_WINDOW_MS) {
      this.pairingFailures.set(key, { count: 1, startedAt: Date.now() })
      return
    }
    current.count += 1
  }

  private saveDeployment(deployment: StoredDeployment): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO feishu_adapter_deployments (
        org_id, user_id, role, scopes_json, config_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(org_id, user_id) DO UPDATE SET
        role = excluded.role, scopes_json = excluded.scopes_json,
        config_json = excluded.config_json, enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(
      deployment.orgId,
      deployment.userId,
      deployment.role,
      JSON.stringify(deployment.scopes),
      JSON.stringify(deployment.config),
      deployment.enabled ? 1 : 0,
      now,
      now,
    )
  }

  private getDeployment(orgId: string, userId: string): StoredDeployment | null {
    const row = this.db.prepare(`
      SELECT org_id, user_id, role, scopes_json, config_json, enabled
      FROM feishu_adapter_deployments WHERE org_id = ? AND user_id = ?
    `).get(orgId, userId) as Record<string, unknown> | undefined
    return row ? this.mapDeployment(row) : null
  }

  private mapDeployment(row: Record<string, unknown>): StoredDeployment {
    return {
      orgId: String(row.org_id),
      userId: String(row.user_id),
      role: String(row.role),
      scopes: JSON.parse(String(row.scopes_json || '[]')) as string[],
      config: normalizeConfig(JSON.parse(String(row.config_json || '{}'))),
      enabled: Boolean(row.enabled),
    }
  }

  private findEntryFile(): string | null {
    if (this.options.entryFile) return existsSync(this.options.entryFile) ? this.options.entryFile : null
    const candidates = [
      path.join(MOSS_SERVER_HOME, 'adapters', 'feishu.mjs'),
      path.resolve(process.cwd(), 'ui', 'dist', 'adapters', 'feishu.mjs'),
      path.resolve(process.cwd(), 'adapters', 'feishu', 'index.ts'),
    ]
    return candidates.find(candidate => existsSync(candidate)) ?? null
  }

  private scheduleRestart(key: ProcessKey, deployment: StoredDeployment): void {
    if (this.disposed || this.restartTimers.has(key)) return
    const attempt = this.restartAttempts.get(key) ?? 0
    const delay = Math.min((this.options.restartBaseDelayMs ?? 1_000) * (2 ** attempt), RESTART_MAX_DELAY_MS)
    this.restartAttempts.set(key, attempt + 1)
    const timer = setTimeout(() => {
      this.restartTimers.delete(key)
      if (this.disposed) return
      const current = this.getDeployment(deployment.orgId, deployment.userId)
      if (!current?.enabled) return
      void this.start('feishu', current, false).catch(error => {
        this.logger.error(`[AdapterProcess] ${key} restart failed: ${error instanceof Error ? error.message : String(error)}`)
        this.scheduleRestart(key, current)
      })
    }, delay)
    timer.unref?.()
    this.restartTimers.set(key, timer)
    this.logger.info(`[AdapterProcess] ${key} restart scheduled in ${delay}ms`)
  }

  private clearRestart(key: ProcessKey): void {
    const timer = this.restartTimers.get(key)
    if (timer) clearTimeout(timer)
    this.restartTimers.delete(key)
  }

  private async enqueueTransition<T>(key: ProcessKey, action: () => Promise<T>): Promise<T> {
    const previous = this.transitions.get(key) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(action)
    this.transitions.set(key, current)
    try {
      return await current
    } finally {
      if (this.transitions.get(key) === current) this.transitions.delete(key)
    }
  }
}
