import { randomUUID } from 'crypto'
import type { WebSocket } from 'ws'

export type SessionRuntimeType = 'host' | 'docker'

export type SessionRuntimeOptions = {
  type?: SessionRuntimeType
  dockerImage?: string
  dockerMode?: 'session' | 'user'
}

export type SessionRuntimeInfo = {
  type: SessionRuntimeType
  dockerImage?: string
  dockerMode?: 'session' | 'user'
  containerName?: string
  configDir?: string
}

export type SessionCreateOptions = {
  cwd?: string
  dangerouslySkipPermissions?: boolean
  userId?: string
  orgId?: string
  role?: string
  scopes?: string[]
  runtime?: SessionRuntimeOptions
}

export type BackendSpawnOptions = {
  sessionId: string
  cwd: string
  dangerouslySkipPermissions?: boolean
  userId?: string
  orgId?: string
  role?: string
  scopes?: string[]
  runtime?: SessionRuntimeOptions
}

export type BackendHandle = {
  workDir: string
  runtime: SessionRuntimeInfo
  writeStdin: (data: string) => void
  onStdoutLine: (listener: (line: string) => void) => () => void
  onExit: (listener: (code: number | null, signal: NodeJS.Signals | null) => void) => () => void
  destroy: (force?: boolean) => void
}

export interface SessionBackend {
  spawn(options: BackendSpawnOptions): Promise<BackendHandle>
}

export type SessionSummary = {
  sessionId: string
  workDir: string
  userId: string
  orgId: string
  role: string
  scopes: string[]
  runtime: SessionRuntimeInfo
  createdAt: number
  lastActiveAt: number
}

type SessionRecord = {
  id: string
  workDir: string
  userId: string
  orgId: string
  role: string
  scopes: string[]
  runtime: SessionRuntimeInfo
  handle: BackendHandle
  sockets: Set<WebSocket>
  createdAt: number
  lastActiveAt: number
  timeout: NodeJS.Timeout | null
}

export class SessionManager {
  readonly #sessions = new Map<string, SessionRecord>()
  readonly #idleTimeoutMs: number
  readonly #maxSessions: number

  constructor(
    private readonly backend: SessionBackend,
    options: {
      idleTimeoutMs?: number
      maxSessions?: number
      onSessionsChanged?: (sessions: SessionSummary[]) => void
    } = {},
  ) {
    this.#idleTimeoutMs = Math.max(0, options.idleTimeoutMs ?? 10 * 60 * 1000)
    this.#maxSessions = Math.max(0, options.maxSessions ?? 32)
    this.#onSessionsChanged = options.onSessionsChanged
  }

  readonly #onSessionsChanged?: (sessions: SessionSummary[]) => void

  get size(): number {
    return this.#sessions.size
  }

  async createSession(options: SessionCreateOptions = {}): Promise<{
    sessionId: string
    workDir: string
    runtime: SessionRuntimeInfo
  }> {
    if (this.#maxSessions > 0 && this.#sessions.size >= this.#maxSessions) {
      throw new Error(
        `Maximum concurrent sessions reached (${this.#maxSessions})`,
      )
    }

    const sessionId = randomUUID()
    const cwd = options.cwd || process.cwd()
    const handle = await this.backend.spawn({
      sessionId,
      cwd,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
      userId: options.userId,
      orgId: options.orgId,
      role: options.role,
      scopes: options.scopes,
      runtime: options.runtime,
    })

    const record: SessionRecord = {
      id: sessionId,
      workDir: handle.workDir,
      userId: options.userId || 'anonymous',
      orgId: options.orgId || 'default',
      role: options.role || 'member',
      scopes: options.scopes || [],
      runtime: handle.runtime,
      handle,
      sockets: new Set(),
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      timeout: null,
    }

    this.#sessions.set(sessionId, record)
    this.#emitSessionsChanged()

    handle.onStdoutLine((line) => {
      record.lastActiveAt = Date.now()
      for (const socket of record.sockets) {
        if (socket.readyState === socket.OPEN) {
          socket.send(line)
        }
      }
    })

    handle.onExit(() => {
      for (const socket of record.sockets) {
        try {
          socket.close()
        } catch {}
      }
      this.#clearTimeout(record)
      this.#sessions.delete(record.id)
      this.#emitSessionsChanged()
    })

    this.#armIdleTimeout(record)

    return {
      sessionId,
      workDir: record.workDir,
      runtime: record.runtime,
    }
  }

  getSession(sessionId: string): SessionSummary | null {
    const record = this.#sessions.get(sessionId)
    if (!record) {
      return null
    }

    return this.#toSummary(record)
  }

  listSessions(filter: {
    userId?: string
    orgId?: string
  } = {}): SessionSummary[] {
    return [...this.#sessions.values()]
      .filter(record => {
        if (filter.userId && record.userId !== filter.userId) {
          return false
        }
        if (filter.orgId && record.orgId !== filter.orgId) {
          return false
        }
        return true
      })
      .map(record => this.#toSummary(record))
  }

  attachSocket(sessionId: string, socket: WebSocket): void {
    const record = this.#sessions.get(sessionId)
    if (!record) {
      throw new Error(`Unknown session: ${sessionId}`)
    }

    record.sockets.add(socket)
    record.lastActiveAt = Date.now()
    this.#clearTimeout(record)
    this.#emitSessionsChanged()

    socket.on('message', (data) => {
      record.lastActiveAt = Date.now()
      const text =
        typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
      record.handle.writeStdin(text.endsWith('\n') ? text : `${text}\n`)
    })

    socket.on('close', () => {
      record.sockets.delete(socket)
      record.lastActiveAt = Date.now()
      this.#armIdleTimeout(record)
      this.#emitSessionsChanged()
    })
  }

  destroySession(sessionId: string, force = false): void {
    const record = this.#sessions.get(sessionId)
    if (!record) {
      return
    }

    this.#clearTimeout(record)
    record.handle.destroy(force)
  }

  async destroyAll(force = true): Promise<void> {
    for (const sessionId of [...this.#sessions.keys()]) {
      this.destroySession(sessionId, force)
    }
  }

  #armIdleTimeout(record: SessionRecord): void {
    if (this.#idleTimeoutMs <= 0 || record.sockets.size > 0) {
      return
    }

    this.#clearTimeout(record)
    record.timeout = setTimeout(() => {
      this.destroySession(record.id, true)
    }, this.#idleTimeoutMs)
    record.timeout.unref?.()
  }

  #clearTimeout(record: SessionRecord): void {
    if (record.timeout) {
      clearTimeout(record.timeout)
      record.timeout = null
    }
  }

  #toSummary(record: SessionRecord): SessionSummary {
    return {
      sessionId: record.id,
      workDir: record.workDir,
      userId: record.userId,
      orgId: record.orgId,
      role: record.role,
      scopes: record.scopes,
      runtime: record.runtime,
      createdAt: record.createdAt,
      lastActiveAt: record.lastActiveAt,
    }
  }

  #emitSessionsChanged(): void {
    this.#onSessionsChanged?.(this.listSessions())
  }
}
