import http from 'http'
import { WebSocketServer } from 'ws'
import type { ServerConfig } from './types.js'
import { createServerLogger, type ServerLogger } from './serverLog.js'
import {
  type SessionManager,
  type SessionRuntimeOptions,
} from './sessionManager.js'
import { hasScope, type AuthContext } from './auth/token.js'

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

      const sessionIdMatch = url.pathname.match(/^\/sessions\/([^/]+)$/)
      if (req.method === 'GET' && sessionIdMatch) {
        const sessionId = sessionIdMatch[1] || ''
        const session = sessionManager.getSession(sessionId)
        if (!session) {
          writeJson(res, 404, { error: 'Session not found' })
          return
        }
        if (
          session.orgId !== auth.orgId ||
          (session.userId !== auth.userId &&
            !hasScope(auth.scopes, 'sessions:attach:any'))
        ) {
          writeJson(res, 403, { error: 'Forbidden' })
          return
        }
        writeJson(res, 200, { session })
        return
      }

      if (req.method === 'DELETE' && sessionIdMatch) {
        const sessionId = sessionIdMatch[1] || ''
        const session = sessionManager.getSession(sessionId)
        if (!session) {
          writeJson(res, 404, { error: 'Session not found' })
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
      const session = sessionManager.getSession(sessionId)
      if (!session) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }
      if (
        session.orgId !== auth.orgId ||
        (session.userId !== auth.userId &&
          !hasScope(auth.scopes, 'sessions:attach:any'))
      ) {
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
