import type http from 'node:http'
import type { AuthService } from '../auth/service.js'
import type { AuthContext } from '../auth/token.js'
import {
  AgentMailError,
  type AgentMailAclMode,
  type AgentMailService,
} from './agentMailService.js'

type JsonBody = Record<string, unknown>

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readJson(req: http.IncomingMessage, maxBytes = 80 * 1024): Promise<JsonBody> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new AgentMailError(413, 'AGENT_MAIL_REQUEST_TOO_LARGE', 'Agent Mail request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new AgentMailError(400, 'AGENT_MAIL_INVALID_JSON', 'Request body must contain valid JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentMailError(400, 'AGENT_MAIL_INVALID_JSON', 'JSON body must be an object')
  }
  return value as JsonBody
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new AgentMailError(400, 'AGENT_MAIL_INVALID_PATH', 'Agent Mail route contains invalid URL encoding')
  }
}

export async function handleAgentMailRoute(input: {
  req: http.IncomingMessage
  res: http.ServerResponse
  url: URL
  auth: AuthContext
  authService: AuthService
  service: AgentMailService
}): Promise<boolean> {
  const { req, res, url, auth, authService, service } = input
  const pathname = url.pathname
  if (!pathname.startsWith('/api/v1/agent-mail')) return false

  try {
    if (pathname === '/api/v1/agent-mail/recipients' && req.method === 'GET') {
      authService.requireScope(auth, 'agent-mail:send')
      writeJson(res, 200, {
        recipients: service.searchRecipients(auth, url.searchParams.get('query') || '', Number(url.searchParams.get('limit')) || 20),
      })
      return true
    }
    if (pathname === '/api/v1/agent-mail/messages' && req.method === 'POST') {
      authService.requireScope(auth, 'agent-mail:send')
      const body = await readJson(req)
      const result = service.send(auth, {
        toUserId: body.to_user_id,
        subject: body.subject,
        content: body.content,
        clientMessageId: body.client_message_id ?? req.headers['idempotency-key'],
        replyTo: body.reply_to,
      })
      writeJson(res, result.duplicate ? 200 : 201, result)
      return true
    }
    if (pathname === '/api/v1/agent-mail/pull' && req.method === 'POST') {
      authService.requireScope(auth, 'agent-mail:receive')
      const body = await readJson(req, 8 * 1024)
      const controller = new AbortController()
      const abort = () => controller.abort()
      req.once('aborted', abort)
      try {
        writeJson(res, 200, await service.pull(auth, {
          consumerId: body.consumer_id,
          waitMs: body.wait_ms,
          limit: body.limit,
        }, controller.signal))
      } finally {
        req.off('aborted', abort)
      }
      return true
    }
    if (pathname === '/api/v1/agent-mail/acl' && req.method === 'GET') {
      authService.requireScope(auth, 'agent-mail:receive')
      writeJson(res, 200, { entries: service.listAcl(auth) })
      return true
    }
    const aclMatch = pathname.match(/^\/api\/v1\/agent-mail\/acl\/([^/]+)$/)
    if (aclMatch && req.method === 'PUT') {
      authService.requireScope(auth, 'agent-mail:receive')
      const body = await readJson(req, 8 * 1024)
      writeJson(res, 200, {
        entry: service.setAcl(auth, decoded(aclMatch[1]!), String(body.mode || '') as AgentMailAclMode),
      })
      return true
    }
    if ((pathname === '/api/v1/agent-mail/inbox' || pathname === '/api/v1/agent-mail/outbox') && req.method === 'GET') {
      authService.requireScope(auth, pathname.endsWith('/inbox') ? 'agent-mail:receive' : 'agent-mail:send')
      writeJson(res, 200, {
        messages: service.list(auth, pathname.endsWith('/inbox') ? 'inbox' : 'outbox', Number(url.searchParams.get('limit')) || 50),
      })
      return true
    }

    const actionMatch = pathname.match(/^\/api\/v1\/agent-mail\/messages\/([^/]+)\/(accept|heartbeat|complete|fail)$/)
    if (actionMatch && req.method === 'POST') {
      authService.requireScope(auth, 'agent-mail:receive')
      const body = await readJson(req, 8 * 1024)
      const messageId = decoded(actionMatch[1]!)
      const action = actionMatch[2]!
      const consumerId = typeof body.consumer_id === 'string' ? body.consumer_id : ''
      const leaseToken = typeof body.lease_token === 'string' ? body.lease_token : ''
      const message = action === 'accept'
        ? service.accept(auth, messageId, consumerId, leaseToken)
        : action === 'heartbeat'
          ? service.heartbeat(auth, messageId, consumerId, leaseToken)
          : service.finish(auth, messageId, consumerId, leaseToken, {
              status: action === 'complete' ? 'completed' : 'failed',
              error: body.error,
            })
      writeJson(res, 200, { message })
      return true
    }

    writeJson(res, 404, { error: 'Agent Mail route not found', code: 'AGENT_MAIL_ROUTE_NOT_FOUND' })
    return true
  } catch (error) {
    const candidate = error as { statusCode?: number; code?: string; message?: string }
    if (candidate.statusCode === 499 && res.destroyed) return true
    writeJson(res, candidate.statusCode || 500, {
      error: candidate.message || String(error),
      code: candidate.code || 'AGENT_MAIL_INTERNAL_ERROR',
    })
    return true
  }
}
