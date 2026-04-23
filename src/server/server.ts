import http from 'http'
import { WebSocketServer } from 'ws'
import { getLastSessionLog } from '../utils/sessionStorage.js'
import { validateUuid } from '../utils/uuid.js'
import type { ServerConfig, SessionIndexEntry } from './types.js'
import { createServerLogger, type ServerLogger } from './serverLog.js'
import {
  type SessionManager,
  type SessionRuntimeOptions,
} from './sessionManager.js'
import { hasScope, type AuthContext } from './auth/token.js'
import { readSessionIndex, removeSessionIndexEntry } from './sessionIndexStore.js'

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function getAuthToken(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization
  if (typeof header !== 'string') {
    return null
  }
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

async function authenticateRequest(
  req: http.IncomingMessage,
  config: ServerConfig,
): Promise<AuthContext | null> {
  const token = getAuthToken(req)
  if (!token) {
    return null
  }

  if (!config.authCenterUrl) {
    return null
  }

  try {
    const response = await fetch(`${config.authCenterUrl}/v1/auth/introspect`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ token }),
    })
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as {
      active?: boolean
      sub?: string
      org_id?: string
      role?: string
      scopes?: string[]
      key_id?: string
    }
    if (
      data.active !== true ||
      typeof data.sub !== 'string' ||
      typeof data.org_id !== 'string' ||
      typeof data.role !== 'string' ||
      !Array.isArray(data.scopes) ||
      typeof data.key_id !== 'string'
    ) {
      return null
    }
    return {
      rawToken: token,
      userId: data.sub,
      orgId: data.org_id,
      role: data.role,
      scopes: data.scopes,
      keyId: data.key_id,
    }
  } catch {
    return null
  }
}

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function parseRuntimeOptions(
  body: Record<string, unknown>,
): SessionRuntimeOptions | undefined {
  if (typeof body.runtime_type === 'string') {
    return {
      type: body.runtime_type === 'docker' ? 'docker' : 'host',
      dockerImage:
        typeof body.docker_image === 'string' ? body.docker_image : undefined,
      dockerMode:
        body.docker_mode === 'user'
          ? 'user'
          : body.docker_mode === 'session'
            ? 'session'
            : undefined,
    }
  }

  if (typeof body.runtime !== 'object' || body.runtime === null) {
    return undefined
  }

  const runtime = body.runtime as Record<string, unknown>
  const type = runtime.type === 'docker' ? 'docker' : runtime.type === 'host' ? 'host' : undefined
  if (!type) {
    return undefined
  }
  return {
    type,
    dockerImage:
      typeof runtime.dockerImage === 'string'
        ? runtime.dockerImage
        : undefined,
    dockerMode:
      runtime.dockerMode === 'user'
        ? 'user'
        : runtime.dockerMode === 'session'
          ? 'session'
          : undefined,
  }
}

export function startServer(
  config: ServerConfig,
  sessionManager: SessionManager,
  logger: ServerLogger = createServerLogger(),
): {
  port: number | null
  ready: Promise<number | null>
  stop: (force?: boolean) => void
} {
  const wss = new WebSocketServer({ noServer: true })

  const buildWsUrl = (sessionId: string): string => {
    const host =
      config.host === '0.0.0.0' || config.host === '::'
        ? '127.0.0.1'
        : config.host
    const address = server.address()
    const actualPort =
      typeof address === 'object' && address ? address.port : config.port
    return `ws://${host}:${actualPort}/sessions/${sessionId}/ws`
  }

  const canAccessSession = (
    session: { userId: string; orgId: string },
    auth: AuthContext,
    anyScope: string,
  ): boolean =>
    session.orgId === auth.orgId &&
    (session.userId === auth.userId || hasScope(auth.scopes, anyScope))

  const getOrResumeSession = async (
    sessionId: string,
    auth: AuthContext,
    anyScope: string,
  ) => {
    const active = sessionManager.getSession(sessionId)
    if (active) {
      return canAccessSession(active, auth, anyScope) ? active : 'forbidden'
    }

    const index = await readSessionIndex()
    const stored = index[sessionId]
    if (!stored) {
      return null
    }
    if (!canAccessSession(stored, auth, anyScope)) {
      return 'forbidden'
    }
    return sessionManager.resumeSession(stored)
  }

  const getStoredSessionEntry = async (
    sessionId: string,
    auth: AuthContext,
    anyScope: string,
  ): Promise<SessionIndexEntry | null | 'forbidden'> => {
    const index = await readSessionIndex()
    const stored = index[sessionId]
    if (!stored) {
      return null
    }
    if (!canAccessSession(stored, auth, anyScope)) {
      return 'forbidden'
    }
    return stored
  }

  const getSessionContextMetadata = async (
    sessionId: string,
    auth: AuthContext,
    anyScope: string,
  ): Promise<
    | {
        sessionId: string
        transcriptSessionId: string
        workDir: string
        userId: string
        orgId: string
        role: string
        scopes: string[]
        runtime: SessionIndexEntry['runtime']
        createdAt: number
        lastActiveAt: number
      }
    | null
    | 'forbidden'
  > => {
    const active = sessionManager.getSession(sessionId)
    if (active) {
      return {
        sessionId: active.sessionId,
        transcriptSessionId: active.sessionId,
        workDir: active.workDir,
        userId: active.userId,
        orgId: active.orgId,
        role: active.role,
        scopes: active.scopes,
        runtime: active.runtime,
        createdAt: active.createdAt,
        lastActiveAt: active.lastActiveAt,
      }
    }

    const stored = await getStoredSessionEntry(sessionId, auth, anyScope)
    if (!stored || stored === 'forbidden') {
      return stored
    }

    return {
      sessionId: stored.sessionId,
      transcriptSessionId: stored.transcriptSessionId,
      workDir: stored.cwd,
      userId: stored.userId,
      orgId: stored.orgId,
      role: stored.role,
      scopes: stored.scopes,
      runtime: stored.runtime,
      createdAt: stored.createdAt,
      lastActiveAt: stored.lastActiveAt,
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      if (url.pathname === '/health') {
        writeJson(res, 200, {
          ok: true,
          sessions: sessionManager.size,
          auth_mode: config.authMode,
        })
        return
      }

      const auth = await authenticateRequest(req, config)
      if (!auth) {
        writeJson(res, 401, { error: 'Unauthorized' })
        return
      }

      if (req.method === 'GET' && url.pathname === '/sessions') {
        const sessions = hasScope(auth.scopes, 'sessions:list:any')
          ? sessionManager.listSessions({ orgId: auth.orgId })
          : sessionManager.listSessions({
              userId: auth.userId,
              orgId: auth.orgId,
            })
        writeJson(res, 200, { sessions })
        return
      }

      const sessionContextMatch = url.pathname.match(/^\/sessions\/([^/]+)\/context$/)
      if (req.method === 'GET' && sessionContextMatch) {
        const sessionId = sessionContextMatch[1] || ''
        const session = await getSessionContextMetadata(
          sessionId,
          auth,
          'sessions:attach:any',
        )
        if (!session) {
          writeJson(res, 404, { error: 'Session not found' })
          return
        }
        if (session === 'forbidden') {
          writeJson(res, 403, { error: 'Forbidden' })
          return
        }

        const transcriptSessionId = validateUuid(session.transcriptSessionId)
        if (!transcriptSessionId) {
          writeJson(res, 500, { error: 'Invalid transcript session id' })
          return
        }

        const log = await getLastSessionLog(transcriptSessionId)
        if (!log) {
          writeJson(res, 404, { error: 'Session context not found' })
          return
        }

        writeJson(res, 200, {
          session: {
            sessionId: session.sessionId,
            transcriptSessionId: session.transcriptSessionId,
            workDir: session.workDir,
            userId: session.userId,
            orgId: session.orgId,
            role: session.role,
            scopes: session.scopes,
            runtime: session.runtime,
            createdAt: session.createdAt,
            lastActiveAt: session.lastActiveAt,
          },
          context: {
            customTitle: log.customTitle,
            tag: log.tag,
            summary: log.summary,
            messages: log.messages,
          },
        })
        return
      }

      const sessionIdMatch = url.pathname.match(/^\/sessions\/([^/]+)$/)
      if (req.method === 'GET' && sessionIdMatch) {
        const sessionId = sessionIdMatch[1] || ''
        const session = await getOrResumeSession(
          sessionId,
          auth,
          'sessions:attach:any',
        )
        if (!session) {
          writeJson(res, 404, { error: 'Session not found' })
          return
        }
        if (session === 'forbidden') {
          writeJson(res, 403, { error: 'Forbidden' })
          return
        }

        writeJson(res, 200, {
          session,
          ws_url: buildWsUrl(session.sessionId),
        })
        return
      }

      if (req.method === 'DELETE' && sessionIdMatch) {
        const sessionId = sessionIdMatch[1] || ''
        const session = sessionManager.getSession(sessionId)
        if (!session) {
          const index = await readSessionIndex()
          const stored = index[sessionId]
          if (!stored) {
            writeJson(res, 404, { error: 'Session not found' })
            return
          }
          if (!canAccessSession(stored, auth, 'sessions:terminate:any')) {
            writeJson(res, 403, { error: 'Forbidden' })
            return
          }
          await removeSessionIndexEntry(sessionId)
          writeJson(res, 200, { ok: true })
          return
        }
        if (
          session.orgId !== auth.orgId ||
          (session.userId !== auth.userId &&
            !hasScope(auth.scopes, 'sessions:terminate:any'))
        ) {
          writeJson(res, 403, { error: 'Forbidden' })
          return
        }
        await removeSessionIndexEntry(sessionId)
        sessionManager.destroySession(sessionId, true)
        writeJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && url.pathname === '/sessions') {
        const rawBody = await readBody(req)
        const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
        const cwd =
          typeof body.cwd === 'string' && body.cwd.trim()
            ? body.cwd
            : config.workspace || process.cwd()
        const dangerouslySkipPermissions =
          body.dangerously_skip_permissions === true
        const runtime = parseRuntimeOptions(body)

        const created = await sessionManager.createSession({
          cwd,
          dangerouslySkipPermissions,
          userId: auth.userId,
          orgId: auth.orgId,
          role: auth.role,
          scopes: auth.scopes,
          runtime,
        })

        const host =
          config.host === '0.0.0.0' || config.host === '::'
            ? '127.0.0.1'
            : config.host
        const address = server.address()
        const actualPort =
          typeof address === 'object' && address ? address.port : config.port

        writeJson(res, 200, {
          session_id: created.sessionId,
          ws_url: `ws://${host}:${actualPort}/sessions/${created.sessionId}/ws`,
          work_dir: created.workDir,
          runtime: created.runtime,
        })
        return
      }

      writeJson(res, 404, { error: 'Not found' })
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error))
      writeJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      try {
      const token = getAuthToken(req)
      const auth = await authenticateRequest(req, config)
      if (!auth || !token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      const url = new URL(req.url || '/', 'http://localhost')
      const match = url.pathname.match(/^\/sessions\/([^/]+)\/ws$/)
      if (!match) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }

      const sessionId = match[1] || ''
      const session = await getOrResumeSession(
        sessionId,
        auth,
        'sessions:attach:any',
      )
      if (!session) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }
      if (session === 'forbidden') {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        try {
          sessionManager.attachSocket(sessionId, ws)
          wss.emit('connection', ws, req)
        } catch (error) {
          logger.error(
            error instanceof Error ? error.message : String(error),
          )
          ws.close()
        }
      })
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error))
        socket.destroy()
      }
    })()
  })

  const ready = new Promise<number | null>((resolve, reject) => {
    const onError = (error: Error) => {
      logger.error(error.message)
      reject(error)
    }

    server.once('error', onError)
    server.once('listening', () => {
      server.off('error', onError)
      const address = server.address()
      const port =
        typeof address === 'object' && address ? address.port : null
      logger.info(
        `Listening on ${config.host}:${String(port ?? config.port)}`,
      )
      resolve(port)
    })
  })

  server.on('error', (error) => {
    logger.error(error.message)
  })
  server.listen(config.port, config.host)

  return {
    get port() {
      const address = server.address()
      return typeof address === 'object' && address ? address.port : null
    },
    ready,
    stop(force = false) {
      for (const client of wss.clients) {
        try {
          client.close()
        } catch {}
      }
      if (force) {
        server.closeAllConnections?.()
      }
      server.close()
    },
  }
}
