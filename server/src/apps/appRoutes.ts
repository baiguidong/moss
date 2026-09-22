import type http from 'node:http'
import type { AuthContext } from '../auth/token.js'
import type { AuthService } from '../auth/service.js'
import type { ServerAppRuntime } from './serverAppRuntime.js'
import { requireAppScope } from './appAuthorization.js'
import type { AppOwner } from '../../../packages/app-runtime/src/index.mjs'

type JsonBody = Record<string, unknown>

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

async function readJson(req: http.IncomingMessage, maxBytes = 1024 * 1024): Promise<JsonBody> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw Object.assign(new Error('App request body is too large'), { statusCode: 413 })
    chunks.push(buffer)
  }
  if (!chunks.length) return {}
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Request body must contain valid JSON'), { statusCode: 400 })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('JSON body must be an object'), { statusCode: 400 })
  return value as JsonBody
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw Object.assign(new Error('App route contains invalid URL encoding'), { statusCode: 400 })
  }
}

function appOwner(auth: AuthContext, url: URL, body?: JsonBody): AppOwner {
  const requestedScope = text(body?.ownerScope) || text(url.searchParams.get('owner_scope')) || 'user'
  if (requestedScope === 'host') {
    if (!(auth.role === 'admin' || auth.systemRoles?.includes('admin'))) {
      throw Object.assign(new Error('Host-scoped Apps require an administrator'), { statusCode: 403 })
    }
    return { scope: 'host', orgId: null, userId: null, key: 'host' }
  }
  if (requestedScope === 'org') {
    if (!(auth.role === 'admin' || auth.systemRoles?.includes('admin'))) {
      throw Object.assign(new Error('Organization-scoped Apps require an administrator'), { statusCode: 403 })
    }
    return { scope: 'org', orgId: auth.orgId, userId: null, key: `org:${encodeURIComponent(auth.orgId)}` }
  }
  if (requestedScope !== 'user') {
    throw Object.assign(new Error('ownerScope must be host, org, or user'), { statusCode: 400 })
  }
  return {
    scope: 'user',
    orgId: auth.orgId,
    userId: auth.userId,
    key: `user:${encodeURIComponent(auth.orgId)}:${encodeURIComponent(auth.userId)}`,
  }
}

export async function handleAppRoute(input: {
  req: http.IncomingMessage
  res: http.ServerResponse
  url: URL
  auth: AuthContext
  authService: AuthService
  apps: ServerAppRuntime
}): Promise<boolean> {
  const { req, res, url, auth, authService, apps } = input
  const pathname = url.pathname
  if (!pathname.startsWith('/api/v1/apps')) return false
  const runtime = apps.runtime
  const runAsOwner = <T>(body: JsonBody | undefined, operation: () => Promise<T> | T): Promise<T> | T =>
    runtime.withOwner(appOwner(auth, url, body), operation)

  try {
    if (pathname === '/api/v1/apps' && req.method === 'GET') {
      requireAppScope(authService, auth, 'apps:read')
      writeJson(res, 200, { apps: await runAsOwner(undefined, () => runtime.listApps()) })
      return true
    }
    if (pathname === '/api/v1/apps/install' && req.method === 'POST') {
      requireAppScope(authService, auth, 'apps:manage')
      const body = await readJson(req)
      const appId = text(body.appId)
      const version = text(body.version)
      if (!appId || !version) throw Object.assign(new Error('appId and version are required'), { statusCode: 400 })
      writeJson(res, 200, {
        ok: true,
        app: await runAsOwner(body, () => apps.installKnown(
          appId, version, body.activate === true, Array.isArray(body.grants) ? body.grants.map(String) : [],
        )),
      })
      return true
    }
    if (pathname === '/api/v1/apps/availability' && req.method === 'POST') {
      requireAppScope(authService, auth, 'apps:read')
      const body = await readJson(req)
      if (!Array.isArray(body.packages)) {
        throw Object.assign(new Error('packages must be an array'), { statusCode: 400 })
      }
      const packages = body.packages
      if (packages.length > 200) throw Object.assign(new Error('At most 200 App versions can be checked at once'), { statusCode: 400 })
      const availability = await Promise.all(packages.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw Object.assign(new Error('Each App version must be an object'), { statusCode: 400 })
        }
        const candidate = entry as JsonBody
        const appId = text(candidate.appId)
        const version = text(candidate.version)
        if (!appId || !version) throw Object.assign(new Error('Each App version requires appId and version'), { statusCode: 400 })
        return apps.getKnownPackageAvailability(appId, version)
      }))
      writeJson(res, 200, { packages: availability })
      return true
    }

    const instanceLogs = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/instances\/([^/]+)\/logs$/)
    if (instanceLogs && req.method === 'GET') {
      requireAppScope(authService, auth, 'apps:logs')
      writeJson(res, 200, { logs: await runAsOwner(undefined, () => runtime.getLogs(decode(instanceLogs[1]!), decode(instanceLogs[2]!), { limit: Number(url.searchParams.get('limit')) || 500 })) })
      return true
    }
    const instanceAction = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/instances\/([^/]+)\/actions\/([^/]+)$/)
    if (instanceAction && req.method === 'POST') {
      requireAppScope(authService, auth, 'apps:invoke')
      const body = await readJson(req)
      const result = await runAsOwner(body, () => runtime.invoke(
        decode(instanceAction[1]!),
        decode(instanceAction[2]!),
        decode(instanceAction[3]!),
        body.input,
        { requestId: text(body.requestId) || undefined, timeoutMs: Number(body.timeoutMs) || undefined },
      ))
      writeJson(res, 200, { result })
      return true
    }
    const instanceHost = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/instances\/([^/]+)\/host$/)
    if (instanceHost && req.method === 'POST') {
      requireAppScope(authService, auth, 'apps:invoke')
      const body = await readJson(req)
      const protocol = text(body.protocol)
      const method = text(body.method)
      if (!protocol || !method) {
        throw Object.assign(new Error('protocol and method are required'), { statusCode: 400 })
      }
      const result = await runAsOwner(body, () => runtime.requestHostCapability(
        decode(instanceHost[1]!),
        decode(instanceHost[2]!),
        protocol,
        method,
        body.input && typeof body.input === 'object' && !Array.isArray(body.input)
          ? body.input as Record<string, unknown>
          : {},
        { requestId: text(body.requestId) || undefined },
      ))
      writeJson(res, 200, { result })
      return true
    }
    const instanceRestart = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/instances\/([^/]+)\/restart$/)
    if (instanceRestart && req.method === 'POST') {
      requireAppScope(authService, auth, 'apps:deploy')
      const status = await runAsOwner(undefined, () => runtime.restartInstance(
        decode(instanceRestart[1]!),
        decode(instanceRestart[2]!),
      ))
      writeJson(res, 200, { status })
      return true
    }
    const instanceStatus = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/instances\/([^/]+)\/status$/)
    if (instanceStatus && req.method === 'GET') {
      requireAppScope(authService, auth, 'apps:read')
      const status = await runAsOwner(undefined, () => runtime.getInstanceStatus(
        decode(instanceStatus[1]!),
        decode(instanceStatus[2]!),
      ))
      writeJson(res, 200, { status })
      return true
    }
    const instanceMatch = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/instances\/([^/]+)$/)
    if (instanceMatch && req.method === 'PATCH') {
      requireAppScope(authService, auth, 'apps:manage')
      const body = await readJson(req)
      const appId = decode(instanceMatch[1]!)
      const instanceId = decode(instanceMatch[2]!)
      const result = await runAsOwner(body, async () => {
        if (body.enabled === false) await runtime.setInstanceEnabled(appId, instanceId, false)
        if (body.clearCredentials === true) await runtime.clearInstanceCredentials(appId, instanceId)
        const patch = Object.fromEntries(['displayName', 'config', 'secrets'].filter(key => body[key] !== undefined).map(key => [key, body[key]]))
        const instance = Object.keys(patch).length ? await runtime.updateInstance(appId, instanceId, patch) : null
        if (body.enabled === true) await runtime.setInstanceEnabled(appId, instanceId, true)
        return { ok: true, instance, status: await runtime.getInstanceStatus(appId, instanceId) }
      })
      writeJson(res, 200, result)
      return true
    }
    if (instanceMatch && req.method === 'DELETE') {
      requireAppScope(authService, auth, 'apps:manage')
      await runAsOwner(undefined, () => runtime.removeInstance(decode(instanceMatch[1]!), decode(instanceMatch[2]!), {
        deleteData: url.searchParams.get('delete_data') === 'true',
        deleteCredentials: url.searchParams.get('delete_credentials') === 'true',
      }))
      writeJson(res, 200, { ok: true })
      return true
    }
    const instancesMatch = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/instances$/)
    if (instancesMatch && req.method === 'GET') {
      requireAppScope(authService, auth, 'apps:read')
      writeJson(res, 200, { instances: await runAsOwner(undefined, () => runtime.listInstances(decode(instancesMatch[1]!))) })
      return true
    }
    if (instancesMatch && req.method === 'POST') {
      requireAppScope(authService, auth, 'apps:manage')
      const body = await readJson(req)
      writeJson(res, 201, { instance: await runAsOwner(body, () => runtime.createInstance(decode(instancesMatch[1]!), body)) })
      return true
    }
    const appMatch = pathname.match(/^\/api\/v1\/apps\/([^/]+)$/)
    if (appMatch && req.method === 'GET') {
      requireAppScope(authService, auth, 'apps:read')
      const app = await runAsOwner(undefined, () => runtime.getApp(decode(appMatch[1]!)))
      if (!app) throw Object.assign(new Error('App not found'), { statusCode: 404 })
      writeJson(res, 200, { app })
      return true
    }
    if (appMatch && req.method === 'PATCH') {
      requireAppScope(authService, auth, 'apps:manage')
      const appId = decode(appMatch[1]!)
      const body = await readJson(req)
      const app = await runAsOwner(body, async () => {
        if (body.enabled === false) await runtime.setAppEnabled(appId, false)
        if (typeof body.activeVersion === 'string') await runtime.activateVersion(appId, body.activeVersion)
        if (Array.isArray(body.grants)) await runtime.setAppGrants(appId, body.grants)
        if (body.enabled === true) await runtime.setAppEnabled(appId, true)
        return runtime.getApp(appId)
      })
      writeJson(res, 200, { app })
      return true
    }
    if (appMatch && req.method === 'DELETE') {
      requireAppScope(authService, auth, 'apps:manage')
      await runAsOwner(undefined, () => runtime.uninstall(decode(appMatch[1]!), {
        deleteData: url.searchParams.get('delete_data') === 'true',
        deleteCredentials: url.searchParams.get('delete_credentials') === 'true',
      }))
      writeJson(res, 200, { ok: true })
      return true
    }
    writeJson(res, 404, { error: 'App route not found' })
    return true
  } catch (error) {
    const candidate = error as { statusCode?: number; code?: string; message?: string }
    const status = candidate.statusCode || (candidate.code?.startsWith('APP_') ? 400 : 500)
    writeJson(res, status, { error: candidate.message || String(error), code: candidate.code })
    return true
  }
}
