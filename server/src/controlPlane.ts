import type http from 'node:http'
import type { createModels } from './model/index.js'
import type { AuthContext } from './auth/token.js'
import { hasScope } from './auth/token.js'
import type { AuthService } from './auth/service.js'
import { HostRepository } from './model/repositories/hosts.js'

const fail = (statusCode: number, message: string): never => { throw Object.assign(new Error(message), { statusCode }) }
const string = (value: unknown, max = 128) => typeof value === 'string' && value.length > 0 && value.length <= max ? value : fail(400, 'Invalid field')
const identifier = (value: unknown) => /^[a-zA-Z0-9:_-]{1,128}$/.test(string(value)) ? String(value) : fail(400, 'Invalid identifier')
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : fail(400, 'Invalid object')

export async function authenticateHostReport(req: http.IncomingMessage, models: Awaited<ReturnType<typeof createModels>>): Promise<AuthContext | null> {
  const token = req.headers.authorization?.match(/^Bearer (moss_host_[\w-]+)$/)?.[1]
  if (!token) return null
  const host = await new HostRepository(models.db).authenticate(token)
  if (!host) return null
  const pathname = new URL(req.url || '/', 'http://local').pathname
  const base = `/api/v1/hosts/${host.id}/`
  if (req.method !== 'POST' || !(pathname === '/api/v1/hosts/heartbeat' || pathname === `${base}usage` || pathname.startsWith(`${base}commands/`))) return null
  return { rawToken: token, userId: String(host.user_id), orgId: String(host.org_id), role: 'host', scopes: ['hosts:report'], keyId: String(host.id) }
}

export async function handleControlPlaneRoute({ req, res, url, auth, authService, models, readJsonBody, writeJson }: {
  req: http.IncomingMessage; res: http.ServerResponse; url: URL; auth: AuthContext; authService: AuthService;
  models: Awaited<ReturnType<typeof createModels>>;
  readJsonBody: (req: http.IncomingMessage, max?: number) => Promise<Record<string, unknown>>;
  writeJson: (res: http.ServerResponse, status: number, data: unknown) => void;
}) {
  if (!url.pathname.startsWith('/api/v1/hosts') && url.pathname !== '/api/v1/host-policy') return false
  const hosts = new HostRepository(models.db)
  if (url.pathname === '/api/v1/host-policy') {
    if (req.method === 'GET') writeJson(res, 200, await hosts.policy(auth.orgId))
    else if (req.method === 'PUT') {
      await authService.requireCurrentScope(auth, 'admin:settings')
      const body = await readJsonBody(req)
      const settings = object(body.settings)
      for (const [key, value] of Object.entries(settings)) {
        if (!['agentTeamsEnabled', 'bypassPermissions'].includes(key) || typeof value !== 'boolean') fail(400, 'Unsupported policy field')
      }
      writeJson(res, 200, await hosts.setPolicy(auth.orgId, auth.userId, settings))
    } else fail(405, 'Method not allowed')
    return true
  }
  if (url.pathname === '/api/v1/hosts' && req.method === 'GET') {
    const all = url.searchParams.get('all') === 'true'
    if (all) await authService.requireCurrentScope(auth, 'admin:users')
    const visible = all ? new Set((await authService.listUsers(auth.orgId, auth)).users.map(user => user.id)) : new Set([auth.userId])
    writeJson(res, 200, { hosts: (await hosts.list(auth.orgId, all ? undefined : auth.userId)).filter(host => visible.has(String(host.userId))) })
    return true
  }
  if (['/api/v1/hosts/heartbeat', '/api/v1/hosts/enroll'].includes(url.pathname) && req.method === 'POST') {
    const body = await readJsonBody(req)
    const id = identifier(body.id)
    const enrolling = url.pathname.endsWith('/enroll')
    if (auth.role === 'host') {
      if (enrolling || auth.keyId !== id) fail(403, 'Host credential is bound to another computer')
    } else await authService.requireCurrentScope(auth, 'sessions:create')
    const status = object(body.status || {})
    const count = Number(status.activeSessions || 0)
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000) fail(400, 'Invalid activity count')
    const kind = body.kind === 'desktop' || body.kind === 'cloud' ? body.kind : fail(400, 'Invalid host kind')
    const response = await hosts.heartbeat(auth, { id, kind,
      name: string(body.name, 255), version: string(body.version), platform: string(body.platform, 32), epoch: identifier(body.epoch),
      status: { activeSessions: count, paused: status.paused === true, policyRevision: Number(status.policyRevision) || 0 } })
    writeJson(res, 200, { ...response, ...(enrolling ? { token: await hosts.enroll(id) } : {}) })
    return true
  }
  const match = url.pathname.match(/^\/api\/v1\/hosts\/([^/]+)\/(commands|usage)(?:\/([^/]+))?$/)
  if (!match) return fail(404, 'Not found')
  const hostId = identifier(decodeURIComponent(match[1]!))
  const host = await hosts.get(hostId, auth.orgId)
  if (!host || (host.user_id !== auth.userId && !hasScope(auth.scopes, 'admin:users'))) fail(404, 'Host not found')
  if (auth.role !== 'host' && host?.user_id !== auth.userId && !(await authService.getUserOrNull(String(host?.user_id), auth.orgId, auth))) fail(404, 'Host not found')
  if (match[2] === 'usage' && req.method === 'POST' && !match[3]) {
    if (host!.user_id !== auth.userId) fail(403, 'Only the owner can report usage')
    const body = await readJsonBody(req, 256 * 1024)
    if (!Array.isArray(body.events) || body.events.length > 200) fail(400, 'Invalid events')
    const events = (body.events as unknown[]).map(raw => {
      const event = object(raw)
      const occurredAt = Number(event.occurredAt)
      if (!Number.isSafeInteger(occurredAt) || occurredAt <= 0 || occurredAt > Date.now() + 300_000) fail(400, 'Invalid timestamp')
      const counts = Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].map(key => {
        if (!Number.isSafeInteger(event[key]) || event[key] < 0 || event[key] > 1e9) fail(400, 'Invalid token count')
        return [key, event[key]]
      }))
      return { ...counts, eventId: `${auth.userId}:${hostId}:${string(event.eventId, 256)}`, occurredAt,
        model: string(event.model), querySource: 'host-report', sessionId: string(event.sessionId) }
    })
    await models.db.transaction(async () => {
      for (const event of events) await models.usage.record(auth, `${hostId}:${event.sessionId}`, event as any)
    })
    writeJson(res, 200, { accepted: events.length })
  } else if (match[2] === 'commands' && req.method === 'GET' && !match[3]) {
    writeJson(res, 200, { commands: await hosts.commands(hostId) })
  } else if (match[2] === 'commands' && req.method === 'POST' && !match[3]) {
    await authService.requireCurrentScope(auth, host!.user_id === auth.userId ? 'sessions:create' : 'admin:users')
    const body = await readJsonBody(req)
    const action = string(body.action, 32)
    if (!['pause', 'resume', 'cancel-session'].includes(action)) fail(400, 'Unsupported command')
    const input = action === 'cancel-session' ? { sessionId: identifier(object(body.input).sessionId) } : {}
    writeJson(res, 202, await hosts.submit(auth.orgId, auth.userId, hostId, { id: identifier(body.id), action, input }))
  } else if (match[2] === 'commands' && req.method === 'POST' && match[3]) {
    if (host!.user_id !== auth.userId) fail(403, 'Only the owner can acknowledge commands')
    const body = await readJsonBody(req)
    if (!['succeeded', 'failed'].includes(String(body.state))) fail(400, 'Invalid command state')
    const ok = await hosts.complete(hostId, identifier(body.epoch), identifier(match[3]), String(body.state), { error: typeof body.error === 'string' ? body.error.slice(0, 2000) : null })
    writeJson(res, 200, { ok })
  } else fail(405, 'Method not allowed')
  return true
}
