import type http from 'node:http'
import type { AuthContext } from '../auth/token.js'
import type { AuthService } from '../auth/service.js'
import type { ServerAppRuntime } from './serverAppRuntime.js'
import { requireAppScope } from './appAuthorization.js'

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

  try {
    if (pathname === '/api/v1/apps' && req.method === 'GET') {
      requireAppScope(authService, auth, 'apps:read')
      writeJson(res, 200, { apps: await runtime.listApps() })
      return true
    }
    if (pathname === '/api/v1/apps/install' && req.method === 'POST') {
      requireAppScope(authService, auth, 'apps:manage')
      const body = await readJson(req)
      const appId = text(body.appId)
      const version = text(body.version)
      if (!appId || !version) throw Object.assign(new Error('appId and version are required'), { statusCode: 400 })
      writeJson(res, 200, { ok: true, app: await apps.installKnown(appId, version, body.activate === true) })
      return true
    }

    const instanceLogs = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/instances\/([^/]+)\/logs$/)
    if (instanceLogs && req.method === 'GET') {
      requireAppScope(authService, auth, 'apps:logs')
      writeJson(res, 200, { logs: await runtime.getLogs(decode(instanceLogs[1]!), decode(instanceLogs[2]!), { limit: Number(url.searchParams.get('limit')) || 500 }) })
      return true
    }
    const instanceAction = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/instances\/([^/]+)\/actions\/([^/]+)$/)
    if (instanceAction && req.method === 'POST') {
      requireAppScope(authService, auth, 'apps:deploy')
      const body = await readJson(req)
      const result = await runtime.invoke(decode(instanceAction[1]!), decode(instanceAction[2]!), decode(instanceAction[3]!), body.input, { timeoutMs: body.timeoutMs })
      writeJson(res, 200, { result })
      return true
    }
    const instanceRestart = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/instances\/([^/]+)\/restart$/)
    if (instanceRestart && req.method === 'POST') {
      requireAppScope(authService, auth, 'apps:deploy')
      writeJson(res, 200, { status: await runtime.restartInstance(decode(instanceRestart[1]!), decode(instanceRestart[2]!)) })
      return true
    }
    const instanceMatch = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/instances\/([^/]+)$/)
    if (instanceMatch && req.method === 'PATCH') {
      requireAppScope(authService, auth, 'apps:manage')
      const body = await readJson(req)
      const appId = decode(instanceMatch[1]!)
      const instanceId = decode(instanceMatch[2]!)
      if (body.enabled === false) await runtime.setInstanceEnabled(appId, instanceId, false)
      if (body.clearCredentials === true) await runtime.clearInstanceCredentials(appId, instanceId)
      const patch = Object.fromEntries(['displayName', 'config', 'secrets'].filter(key => body[key] !== undefined).map(key => [key, body[key]]))
      const instance = Object.keys(patch).length ? await runtime.updateInstance(appId, instanceId, patch) : null
      if (body.enabled === true) await runtime.setInstanceEnabled(appId, instanceId, true)
      writeJson(res, 200, { ok: true, instance, status: await runtime.getInstanceStatus(appId, instanceId) })
      return true
    }
    if (instanceMatch && req.method === 'DELETE') {
      requireAppScope(authService, auth, 'apps:manage')
      await runtime.removeInstance(decode(instanceMatch[1]!), decode(instanceMatch[2]!), {
        deleteData: url.searchParams.get('delete_data') === 'true',
        deleteCredentials: url.searchParams.get('delete_credentials') === 'true',
      })
      writeJson(res, 200, { ok: true })
      return true
    }
    const instancesMatch = pathname.match(/^\/api\/v1\/apps\/([^/]+)\/instances$/)
    if (instancesMatch && req.method === 'GET') {
      requireAppScope(authService, auth, 'apps:read')
      writeJson(res, 200, { instances: await runtime.listInstances(decode(instancesMatch[1]!)) })
      return true
    }
    if (instancesMatch && req.method === 'POST') {
      requireAppScope(authService, auth, 'apps:manage')
      const body = await readJson(req)
      writeJson(res, 201, { instance: await runtime.createInstance(decode(instancesMatch[1]!), body) })
      return true
    }
    const appMatch = pathname.match(/^\/api\/v1\/apps\/([^/]+)$/)
    if (appMatch && req.method === 'GET') {
      requireAppScope(authService, auth, 'apps:read')
      const app = await runtime.getApp(decode(appMatch[1]!))
      if (!app) throw Object.assign(new Error('App not found'), { statusCode: 404 })
      writeJson(res, 200, { app })
      return true
    }
    if (appMatch && req.method === 'PATCH') {
      requireAppScope(authService, auth, 'apps:manage')
      const appId = decode(appMatch[1]!)
      const body = await readJson(req)
      if (body.enabled === false) await runtime.setAppEnabled(appId, false)
      if (typeof body.activeVersion === 'string') await runtime.activateVersion(appId, body.activeVersion)
      if (body.enabled === true) await runtime.setAppEnabled(appId, true)
      writeJson(res, 200, { app: await runtime.getApp(appId) })
      return true
    }
    if (appMatch && req.method === 'DELETE') {
      requireAppScope(authService, auth, 'apps:manage')
      await runtime.uninstall(decode(appMatch[1]!), {
        deleteData: url.searchParams.get('delete_data') === 'true',
        deleteCredentials: url.searchParams.get('delete_credentials') === 'true',
      })
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
