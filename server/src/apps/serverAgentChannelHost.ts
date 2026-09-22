import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  AGENT_CHANNEL_SYSTEM_PROMPT,
  DEFAULT_AGENT_CHANNEL_POLICY,
  createAgentChannelController,
  createAgentChannelStore,
  resolveAgentChannelToolSelectors,
  validateAgentChannelDelegation,
} from '../../../packages/app-runtime/src/index.mjs'
import type { AppOwner } from '../../../packages/app-runtime/src/index.mjs'
import type { AuthService } from '../auth/service.js'
import { hasScope } from '../auth/token.js'
import type { RuntimeService } from '../runtimeService.js'
import type { ServerConfig, SessionRecord } from '../types.js'
import type { ServerLogger } from '../serverLog.js'

type HostContext = {
  appId?: string
  instanceId?: string
  principal?: AppOwner | null
}

type RuntimeEvent = {
  type?: string
  state?: string
  appId?: string
  instanceId?: string
  owner?: AppOwner | null
}

type AppRuntimePublisher = {
  withOwner<T>(owner: AppOwner, operation: () => T): T
  publishHostEvent(
    appId: string,
    instanceId: string,
    protocol: string,
    name: string,
    data: unknown,
    options?: { eventId?: string },
  ): Promise<unknown>
}

type ChannelMapping = {
  session_id: string
  owner_key: string
  org_id: string
  user_id: string
  app_id: string
  instance_id: string
  policy_json: string
}

type OwnerController = {
  owner: AppOwner
  db: DatabaseSync
  controller: ReturnType<typeof createAgentChannelController>
}

type ActiveTurn = {
  socket: net.Socket
  interrupt: () => void
}

const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function matchesTool(toolName: string, selectors: string[] | null): boolean {
  if (selectors === null || selectors.includes('*')) return true
  return selectors.some(selector => selector === toolName
    || (selector.endsWith('*') && toolName.startsWith(selector.slice(0, -1))))
}

function ownerDatabaseName(owner: AppOwner): string {
  return `${Buffer.from(owner.key, 'utf8').toString('base64url')}.db`
}

export class ServerAgentChannelHost {
  private readonly controllers = new Map<string, OwnerController>()
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private appRuntime: AppRuntimePublisher | null = null
  private disposed = false

  constructor(
    private readonly config: ServerConfig,
    private readonly db: DatabaseSync,
    private readonly runtime: RuntimeService,
    private readonly authService: AuthService,
    private readonly logger: ServerLogger,
  ) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_channel_sessions (
        session_id TEXT PRIMARY KEY,
        owner_key TEXT NOT NULL,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        policy_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS app_channel_sessions_owner_idx
        ON app_channel_sessions (owner_key, app_id, instance_id, updated_at DESC);
    `)
  }

  attachAppRuntime(runtime: AppRuntimePublisher): void {
    this.appRuntime = runtime
  }

  private requireOwner(context: HostContext): AppOwner & { orgId: string; userId: string } {
    const owner = context.principal
    const orgId = text(owner?.orgId)
    const userId = text(owner?.userId)
    if (owner?.scope !== 'user' || !orgId || !userId || !owner.key) {
      throw new Error('Agent Channel requires a user-scoped Server App instance.')
    }
    return { ...owner, orgId, userId }
  }

  private mapping(sessionId: string): ChannelMapping | null {
    return (this.db.prepare(`
      SELECT session_id, owner_key, org_id, user_id, app_id, instance_id, policy_json
      FROM app_channel_sessions WHERE session_id = ?
    `).get(sessionId) as ChannelMapping | undefined) || null
  }

  private toSessionOption(session: SessionRecord | null, context: HostContext): Record<string, unknown> | null {
    if (!session) return null
    const owner = this.requireOwner(context)
    const mapping = this.mapping(session.sessionId)
    if (
      !mapping
      || mapping.owner_key !== owner.key
      || mapping.app_id !== text(context.appId)
      || mapping.instance_id !== text(context.instanceId)
      || session.orgId !== owner.orgId
      || session.userId !== owner.userId
      || session.desiredState === 'terminated'
      || session.deletedAt
    ) return null
    return {
      id: session.sessionId,
      title: session.title || 'App Channel 会话',
      preview: session.summary || '',
      updatedAt: session.lastActiveAt,
      busy: this.activeTurns.has(session.sessionId),
      originChannel: `app:${mapping.app_id}`,
    }
  }

  private listSessionOptions(query: string, context: HostContext): Record<string, unknown>[] {
    const owner = this.requireOwner(context)
    const appId = text(context.appId)
    const instanceId = text(context.instanceId)
    const normalizedQuery = text(query).toLowerCase()
    const rows = this.db.prepare(`
      SELECT session_id FROM app_channel_sessions
      WHERE owner_key = ? AND app_id = ? AND instance_id = ?
      ORDER BY updated_at DESC
    `).all(owner.key, appId, instanceId) as Array<{ session_id: string }>
    return rows
      .map(row => this.toSessionOption(this.runtime.getSession(row.session_id), context))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .filter(entry => !normalizedQuery || [entry.title, entry.preview]
        .some(value => String(value || '').toLowerCase().includes(normalizedQuery)))
  }

  private ownerIdentity(owner: AppOwner & { orgId: string; userId: string }) {
    const identity = this.authService.getAccountIdentity(owner.orgId, owner.userId)
    if (!identity.user || identity.user.status !== 'active') {
      throw new Error('The user that owns this App is no longer active.')
    }
    if (!hasScope(identity.scopes, 'sessions:create')) {
      throw new Error('The App owner is not allowed to create Agent sessions.')
    }
    return {
      role: identity.user.role,
      scopes: identity.scopes,
    }
  }

  private async createSession(input: Record<string, unknown>, context: HostContext) {
    const owner = this.requireOwner(context)
    const identity = this.ownerIdentity(owner)
    const policy = isRecord(input.binding) ? input.binding : DEFAULT_AGENT_CHANNEL_POLICY
    const allowedTools = resolveAgentChannelToolSelectors(policy, [])
    const session = await this.runtime.createSession({
      cwd: this.config.workspace,
      title: text(input.title).slice(0, 120) || 'App Channel 会话',
      dangerouslySkipPermissions: false,
      userId: owner.userId,
      orgId: owner.orgId,
      role: identity.role,
      scopes: identity.scopes,
      runtimeOptions: {
        appendSystemPrompt: AGENT_CHANNEL_SYSTEM_PROMPT,
        ...(allowedTools === null ? {} : { allowedTools }),
      },
    })
    const timestamp = Date.now()
    this.db.prepare(`
      INSERT INTO app_channel_sessions (
        session_id, owner_key, org_id, user_id, app_id, instance_id,
        policy_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.sessionId,
      owner.key,
      owner.orgId,
      owner.userId,
      text(context.appId),
      text(context.instanceId),
      JSON.stringify(policy),
      timestamp,
      timestamp,
    )
    return this.toSessionOption(session, context)
  }

  private applySessionPolicy(sessionId: string, policy: unknown, context: HostContext): void {
    const owner = this.requireOwner(context)
    const result = this.db.prepare(`
      UPDATE app_channel_sessions SET policy_json = ?, updated_at = ?
      WHERE session_id = ? AND owner_key = ? AND app_id = ? AND instance_id = ?
    `).run(
      JSON.stringify(policy || {}),
      Date.now(),
      sessionId,
      owner.key,
      text(context.appId),
      text(context.instanceId),
    )
    if (result.changes !== 1) throw new Error('The selected Moss session is no longer writable.')
  }

  private writeControlResponse(
    socket: net.Socket,
    requestId: string,
    response: Record<string, unknown>,
  ): void {
    const message = JSON.stringify({
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response },
    })
    socket.write(`${JSON.stringify({ type: 'stdin', data: `${message}\n` })}\n`)
  }

  private respondToToolRequest(
    socket: net.Socket,
    message: Record<string, unknown>,
    policy: Record<string, unknown>,
  ): void {
    const request = isRecord(message.request) ? message.request : {}
    const requestId = text(message.request_id)
    if (!requestId) return
    const toolName = text(request.tool_name) || 'unknown'
    const toolInput = isRecord(request.input) ? request.input : {}
    const delegationViolation = validateAgentChannelDelegation(policy, toolName, toolInput)
    const selectors = resolveAgentChannelToolSelectors(policy, [])
    const denied = delegationViolation || (!matchesTool(toolName, selectors)
      ? `Tool ${toolName} is not enabled for this Agent Channel conversation.`
      : '')
    if (denied) {
      this.writeControlResponse(socket, requestId, { behavior: 'deny', message: denied })
      return
    }
    if (policy.permissionMode === 'dontAsk' || policy.permissionMode === 'acceptEdits') {
      this.writeControlResponse(socket, requestId, { behavior: 'allow', updatedInput: toolInput })
      return
    }
    this.writeControlResponse(socket, requestId, {
      behavior: 'deny',
      message: toolName === ASK_USER_QUESTION_TOOL_NAME
        ? 'Ask the user in a normal assistant response and wait for their next message.'
        : 'Interactive tool approval is unavailable in this App Channel.',
    })
  }

  private async sendPrompt(
    sessionId: string,
    prompt: string,
    options: Record<string, unknown>,
    context: HostContext,
  ): Promise<{ assistantText: string; title: string }> {
    if (!this.toSessionOption(this.runtime.getSession(sessionId), context)) {
      throw new Error('The selected Moss session is not writable by this Channel App.')
    }
    const release = await this.runtime.acquireSessionTurn(sessionId)
    let released = false
    const releaseOnce = () => {
      if (released) return
      released = true
      release()
    }
    try {
      const ready = await this.runtime.ensureSessionReady(sessionId)
      const socket = await this.runtime.connectToAttempt(ready.attempt)
      const policy = isRecord(options.policy) ? options.policy : {}
      const result = await new Promise<string>((resolve, reject) => {
        let buffer = ''
        let settled = false
        const finish = (error?: Error, assistantText = '') => {
          if (settled) return
          settled = true
          this.activeTurns.delete(sessionId)
          socket.destroy()
          releaseOnce()
          if (error) reject(error)
          else resolve(assistantText)
        }
        const interrupt = () => {
          if (!socket.destroyed) socket.write(`${JSON.stringify({ type: 'interrupt' })}\n`)
        }
        this.activeTurns.set(sessionId, { socket, interrupt })
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
                  this.respondToToolRequest(socket, message, policy)
                } else {
                  const requestId = text(message.request_id)
                  if (requestId) this.writeControlResponse(socket, requestId, {
                    behavior: 'deny',
                    message: `Unsupported server-hosted control request: ${text(request.subtype) || 'unknown'}`,
                  })
                }
                continue
              }
              if (message.type === 'result') {
                if (message.subtype === 'success') {
                  finish(undefined, typeof message.result === 'string' ? message.result : '')
                } else {
                  finish(new Error(text(message.result) || text(message.error) || 'Moss Server turn failed'))
                }
              }
            } catch {}
          }
        })
        socket.once('close', () => finish(new Error('Moss Server session disconnected before completion.')))
        socket.once('error', error => finish(error))
        const runtimeContext = text(options.runtimeContext)
        const messageText = [runtimeContext, prompt].filter(Boolean).join('\n\n')
        const userMessage = JSON.stringify({
          type: 'user',
          message: { role: 'user', content: messageText },
          parent_tool_use_id: null,
          session_id: '',
          uuid: randomUUID(),
        })
        socket.write(`${JSON.stringify({ type: 'stdin', data: `${userMessage}\n` })}\n`)
      })
      const session = this.runtime.getSession(sessionId)
      return { assistantText: result, title: session?.title || 'App Channel 会话' }
    } catch (error) {
      releaseOnce()
      throw error
    }
  }

  private controllerFor(context: HostContext): OwnerController {
    if (this.disposed) throw new Error('Server Agent Channel Host is shutting down.')
    const owner = this.requireOwner(context)
    const existing = this.controllers.get(owner.key)
    if (existing) return existing
    const root = join(this.config.dataDir, 'agent-channels')
    mkdirSync(root, { recursive: true })
    const db = new DatabaseSync(join(root, ownerDatabaseName(owner)))
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;')
    const store = createAgentChannelStore(db)
    const ownerContext = (requestContext: HostContext = {}): HostContext => ({
      ...requestContext,
      principal: owner,
    })
    const controller = createAgentChannelController({
      store,
      catalog: async () => ({ agents: [], tools: [], skills: [], connectors: [] }),
      listWritableSessions: (query: string, requestContext: HostContext) => (
        this.listSessionOptions(query, ownerContext(requestContext))
      ),
      getWritableSession: (sessionId: string, requestContext: HostContext) => (
        this.toSessionOption(this.runtime.getSession(sessionId), ownerContext(requestContext))
      ),
      createSession: (input: Record<string, unknown>) => this.createSession(input, ownerContext({
        appId: text(input.appId),
        instanceId: text(input.instanceId),
      })),
      applySessionPolicy: (sessionId: string, policy: unknown, requestContext: HostContext) => (
        this.applySessionPolicy(sessionId, policy, ownerContext(requestContext))
      ),
      summarizeSession: (session: { id?: string }) => this.runtime.getSession(text(session?.id))?.summary || '',
      sendPrompt: (sessionId: string, prompt: string, options: Record<string, unknown>) => (
        this.sendPrompt(sessionId, prompt, options, ownerContext({
          appId: text(options.appId || options.sourceChannel),
          instanceId: text(options.instanceId),
        }))
      ),
      abortSession: async (sessionId: string) => {
        this.activeTurns.get(sessionId)?.interrupt()
        return { ok: true }
      },
      defaultsFor: () => DEFAULT_AGENT_CHANNEL_POLICY,
      publishEvent: async ({ appId, instanceId, protocol, name, data, eventId }: Record<string, unknown>) => {
        if (!this.appRuntime) throw new Error('Server App Runtime is not ready.')
        return this.appRuntime.withOwner(owner, () => this.appRuntime!.publishHostEvent(
          text(appId),
          text(instanceId),
          text(protocol),
          text(name),
          data,
          { eventId: text(eventId) },
        ))
      },
      log: (level: string, message: string, details: unknown) => {
        const suffix = details ? ` ${JSON.stringify(details)}` : ''
        if (level === 'error') this.logger.error(`[AgentChannel] ${message}${suffix}`)
        else if (level === 'warn') this.logger.warn(`[AgentChannel] ${message}${suffix}`)
        else this.logger.debug(`[AgentChannel] ${message}${suffix}`)
      },
    })
    const created = { owner, db, controller }
    this.controllers.set(owner.key, created)
    return created
  }

  handleAgentRequest(method: string, input: Record<string, unknown>, context: HostContext): unknown {
    return this.controllerFor(context).controller.handleAgentRequest(method, input, context)
  }

  onRuntimeEvent(event: RuntimeEvent): void {
    if (event.type !== 'status' || event.state !== 'running' || !event.appId || !event.instanceId || !event.owner) return
    if (event.owner.scope !== 'user') return
    const context = { appId: event.appId, instanceId: event.instanceId, principal: event.owner }
    this.controllerFor(context).controller.onReady({ appId: event.appId, instanceId: event.instanceId })
  }

  originForSession(sessionId: string, orgId?: string, userId?: string): string {
    const mapping = this.mapping(sessionId)
    if (!mapping || (orgId && mapping.org_id !== orgId) || (userId && mapping.user_id !== userId)) return 'desktop'
    return `app:${mapping.app_id}`
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const turn of this.activeTurns.values()) turn.interrupt()
    this.activeTurns.clear()
    for (const entry of this.controllers.values()) entry.db.close()
    this.controllers.clear()
  }
}
