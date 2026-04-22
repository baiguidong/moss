import http from 'http'
import { WebSocketServer } from 'ws'
import type { ServerConfig } from './types.js'
import { createServerLogger, type ServerLogger } from './serverLog.js'
import { SessionManager } from './sessionManager.js'

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
      if (req.url === '/health') {
        writeJson(res, 200, { ok: true, sessions: sessionManager.size })
        return
      }

      const token = getAuthToken(req)
      if (token !== config.authToken) {
        writeJson(res, 401, { error: 'Unauthorized' })
        return
      }

      if (req.method === 'POST' && req.url === '/sessions') {
        const rawBody = await readBody(req)
        const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
        const cwd =
          typeof body.cwd === 'string' && body.cwd.trim()
            ? body.cwd
            : config.workspace || process.cwd()
        const dangerouslySkipPermissions =
          body.dangerously_skip_permissions === true

        const created = await sessionManager.createSession({
          cwd,
          dangerouslySkipPermissions,
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
    try {
      const token = getAuthToken(req)
      if (token !== config.authToken) {
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
