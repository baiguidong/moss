import http from 'http'
import { randomUUID } from 'crypto'
import { createServerLogger, type ServerLogger } from '../serverLog.js'
import { hasScope, issueAccessToken, verifyAccessToken } from '../auth/token.js'
import {
  createApiKeyRecord,
  ensureAuthCenterStore,
  findApiKeyRecord,
  getDefaultAuthCenterStorePath,
  hashPassword,
  readAuthCenterStore,
  sanitizeApiKey,
  sanitizeUser,
  updateAuthCenterStore,
  verifyPassword,
} from './store.js'
import { renderAdminConsoleHtml } from './adminConsole.js'

type AuthCenterServerOptions = {
  port?: number
  host?: string
  storePath?: string
  tokenTtlSec?: number
}

function defaultScopesForRole(role: string): string[] {
  if (role === 'admin') {
    return ['*']
  }
  if (role === 'viewer') {
    return ['sessions:list', 'sessions:attach']
  }
  return ['sessions:create', 'sessions:attach', 'sessions:list']
}

function issueUserAccessToken(input: {
  issuer: string
  jwtSecret: string
  tokenTtlSec: number
  user: {
    id: string
    orgId: string
    role: string
    email?: string
    name?: string
  }
  scopes: string[]
  keyId: string
}): {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  user: {
    id: string
    email?: string
    name?: string
    role: string
  }
  organization: {
    id: string
  }
  scopes: string[]
} {
  const issued = issueAccessToken(
    {
      iss: input.issuer,
      sub: input.user.id,
      org_id: input.user.orgId,
      role: input.user.role,
      scopes: input.scopes,
      key_id: input.keyId,
    },
    input.jwtSecret,
    input.tokenTtlSec,
  )

  return {
    access_token: issued.token,
    token_type: 'Bearer',
    expires_in: issued.expiresAt - Math.floor(Date.now() / 1000),
    user: {
      id: input.user.id,
      email: input.user.email,
      name: input.user.name,
      role: input.user.role,
    },
    organization: {
      id: input.user.orgId,
    },
    scopes: input.scopes,
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
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

function getBearerToken(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization
  if (typeof header !== 'string') {
    return null
  }
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

function writeHtml(
  res: http.ServerResponse,
  status: number,
  html: string,
): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
  })
  res.end(html)
}

export async function startAuthCenterServer(
  options: AuthCenterServerOptions = {},
  logger: ServerLogger = createServerLogger(),
): Promise<{
  port: number | null
  host: string
  storePath: string
  bootstrapAdminApiKey?: string
  bootstrapAdminEmail?: string
  bootstrapAdminPassword?: string
  ready: Promise<number | null>
  stop: () => void
}> {
  const storePath = options.storePath ?? getDefaultAuthCenterStorePath()
  const ensured = await ensureAuthCenterStore(storePath)
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 4401
  const tokenTtlSec = options.tokenTtlSec ?? 60 * 60

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        writeJson(res, 200, {
          ok: true,
          store_path: storePath,
        })
        return
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin')) {
        writeHtml(res, 200, renderAdminConsoleHtml())
        return
      }

      if (
        req.method === 'POST' &&
        (url.pathname === '/v1/auth/token' || url.pathname === '/v1/auth/login')
      ) {
        const rawBody = await readBody(req)
        const body = rawBody
          ? (JSON.parse(rawBody) as Record<string, unknown>)
          : {}
        const store = await readAuthCenterStore(storePath)
        const grantType =
          typeof body.grant_type === 'string'
            ? body.grant_type.trim()
            : typeof body.api_key === 'string'
              ? 'api_key'
              : 'password'

        if (grantType === 'api_key') {
          const apiKeyValue =
            typeof body.api_key === 'string' ? body.api_key.trim() : ''
          if (!apiKeyValue) {
            writeJson(res, 400, { error: 'Missing api_key' })
            return
          }

          const apiKey = findApiKeyRecord(store, apiKeyValue)
          if (!apiKey) {
            writeJson(res, 401, { error: 'Invalid API key' })
            return
          }

          const user = store.users.find(
            record => record.id === apiKey.userId && record.status === 'active',
          )
          const organization = store.organizations.find(
            record => record.id === apiKey.orgId,
          )
          if (!user || !organization) {
            writeJson(res, 401, { error: 'API key owner is invalid' })
            return
          }

          await updateAuthCenterStore(
            current => ({
              ...current,
              apiKeys: current.apiKeys.map(record =>
                record.id === apiKey.id
                  ? { ...record, lastUsedAt: Date.now() }
                  : record,
              ),
            }),
            storePath,
          )

          writeJson(
            res,
            200,
            issueUserAccessToken({
              issuer: store.issuer,
              jwtSecret: store.jwtSecret,
              tokenTtlSec,
              user,
              scopes: apiKey.scopes,
              keyId: apiKey.id,
            }),
          )
          return
        }

        if (grantType === 'password') {
          const email = typeof body.email === 'string' ? body.email.trim() : ''
          const password =
            typeof body.password === 'string' ? body.password : ''
          if (!email || !password) {
            writeJson(res, 400, { error: 'Missing email or password' })
            return
          }
          const user = store.users.find(
            record =>
              record.email.toLowerCase() === email.toLowerCase() &&
              record.status === 'active',
          )
          if (!user || !verifyPassword(password, user.passwordHash)) {
            writeJson(res, 401, { error: 'Invalid email or password' })
            return
          }

          await updateAuthCenterStore(
            current => ({
              ...current,
              users: current.users.map(record =>
                record.id === user.id
                  ? { ...record, lastLoginAt: Date.now() }
                  : record,
              ),
            }),
            storePath,
          )

          const organization = store.organizations.find(
            record => record.id === user.orgId,
          )
          writeJson(
            res,
            200,
            {
              ...issueUserAccessToken({
                issuer: store.issuer,
                jwtSecret: store.jwtSecret,
                tokenTtlSec,
                user,
                scopes: defaultScopesForRole(user.role),
                keyId: 'password-login',
              }),
              organization,
            },
          )
          return
        }

        writeJson(res, 400, { error: `Unsupported grant_type: ${grantType}` })
        return
      }

      if (req.method === 'GET' && url.pathname === '/v1/auth/me') {
        const token = getBearerToken(req)
        if (!token) {
          writeJson(res, 401, { error: 'Missing bearer token' })
          return
        }
        const store = await readAuthCenterStore(storePath)
        const auth = verifyAccessToken(token, store.jwtSecret, store.issuer)
        if (!auth) {
          writeJson(res, 401, { error: 'Invalid access token' })
          return
        }
        const user = store.users.find(record => record.id === auth.userId)
        const organization = store.organizations.find(
          record => record.id === auth.orgId,
        )
        writeJson(res, 200, {
          user: user ? sanitizeUser(user) : null,
          organization,
          scopes: auth.scopes,
          role: auth.role,
          key_id: auth.keyId,
        })
        return
      }

      if (req.method === 'POST' && url.pathname === '/v1/auth/introspect') {
        const rawBody = await readBody(req)
        const body = rawBody
          ? (JSON.parse(rawBody) as Record<string, unknown>)
          : {}
        const token = typeof body.token === 'string' ? body.token.trim() : ''
        if (!token) {
          writeJson(res, 400, { error: 'Missing token' })
          return
        }
        const store = await readAuthCenterStore(storePath)
        const auth = verifyAccessToken(token, store.jwtSecret, store.issuer)
        if (!auth) {
          writeJson(res, 200, { active: false })
          return
        }
        writeJson(res, 200, {
          active: true,
          sub: auth.userId,
          org_id: auth.orgId,
          role: auth.role,
          scopes: auth.scopes,
          key_id: auth.keyId,
        })
        return
      }

      if (url.pathname.startsWith('/v1/admin/')) {
        const token = getBearerToken(req)
        if (!token) {
          writeJson(res, 401, { error: 'Missing bearer token' })
          return
        }
        const store = await readAuthCenterStore(storePath)
        const auth = verifyAccessToken(token, store.jwtSecret, store.issuer)
        if (!auth) {
          writeJson(res, 401, { error: 'Invalid access token' })
          return
        }
        const requireScope = (scope: string): boolean => {
          if (!hasScope(auth.scopes, scope)) {
            writeJson(res, 403, { error: `Missing scope: ${scope}` })
            return false
          }
          return true
        }

        if (req.method === 'GET' && url.pathname === '/v1/admin/users') {
          if (!requireScope('admin:users')) return
          writeJson(res, 200, {
            users: store.users
              .filter(user => user.orgId === auth.orgId)
              .map(user => sanitizeUser(user)),
          })
          return
        }

        if (req.method === 'POST' && url.pathname === '/v1/admin/users') {
          if (!requireScope('admin:users')) return
          const rawBody = await readBody(req)
          const body = rawBody
            ? (JSON.parse(rawBody) as Record<string, unknown>)
            : {}
          const email = typeof body.email === 'string' ? body.email.trim() : ''
          const name = typeof body.name === 'string' ? body.name.trim() : ''
          const role = typeof body.role === 'string' ? body.role.trim() : 'member'
          const password =
            typeof body.password === 'string' ? body.password : ''
          if (!email || !name || !password) {
            writeJson(res, 400, { error: 'Missing email, name, or password' })
            return
          }
          if (
            store.users.some(
              user =>
                user.orgId === auth.orgId &&
                user.email.toLowerCase() === email.toLowerCase(),
            )
          ) {
            writeJson(res, 409, { error: 'User email already exists' })
            return
          }

          const user = {
            id: randomUUID(),
            orgId: auth.orgId,
            email,
            name,
            role,
            status: 'active' as const,
            createdAt: Date.now(),
            passwordHash: hashPassword(password),
            passwordUpdatedAt: Date.now(),
            lastLoginAt: null,
          }
          await updateAuthCenterStore(
            current => ({
              ...current,
              users: [...current.users, user],
            }),
            storePath,
          )
          writeJson(res, 200, { user: sanitizeUser(user) })
          return
        }

        const resetPasswordMatch = url.pathname.match(
          /^\/v1\/admin\/users\/([^/]+)\/reset-password$/,
        )
        if (req.method === 'POST' && resetPasswordMatch) {
          if (!requireScope('admin:users')) return
          const userId = resetPasswordMatch[1] || ''
          const rawBody = await readBody(req)
          const body = rawBody
            ? (JSON.parse(rawBody) as Record<string, unknown>)
            : {}
          const password =
            typeof body.password === 'string' ? body.password : ''
          if (!password) {
            writeJson(res, 400, { error: 'Missing password' })
            return
          }
          const user = store.users.find(
            record => record.id === userId && record.orgId === auth.orgId,
          )
          if (!user) {
            writeJson(res, 404, { error: 'Unknown user_id' })
            return
          }
          await updateAuthCenterStore(
            current => ({
              ...current,
              users: current.users.map(record =>
                record.id === userId
                  ? {
                      ...record,
                      passwordHash: hashPassword(password),
                      passwordUpdatedAt: Date.now(),
                    }
                  : record,
              ),
            }),
            storePath,
          )
          writeJson(res, 200, { ok: true })
          return
        }

        if (req.method === 'GET' && url.pathname === '/v1/admin/api-keys') {
          if (!requireScope('admin:api_keys')) return
          writeJson(res, 200, {
            api_keys: store.apiKeys
              .filter(apiKey => apiKey.orgId === auth.orgId)
              .map(apiKey => sanitizeApiKey(apiKey)),
          })
          return
        }

        if (req.method === 'POST' && url.pathname === '/v1/admin/api-keys') {
          if (!requireScope('admin:api_keys')) return
          const rawBody = await readBody(req)
          const body = rawBody
            ? (JSON.parse(rawBody) as Record<string, unknown>)
            : {}
          const userId =
            typeof body.user_id === 'string' ? body.user_id.trim() : ''
          const name = typeof body.name === 'string' ? body.name.trim() : ''
          const scopes = Array.isArray(body.scopes)
            ? body.scopes.filter(
                scope => typeof scope === 'string' && scope.trim(),
              )
            : []

          const user = store.users.find(
            record => record.id === userId && record.orgId === auth.orgId,
          )
          if (!user) {
            writeJson(res, 404, { error: 'Unknown user_id' })
            return
          }
          if (!name || scopes.length === 0) {
            writeJson(res, 400, { error: 'Missing name or scopes' })
            return
          }

          const created = createApiKeyRecord({
            orgId: auth.orgId,
            userId: user.id,
            name,
            scopes,
          })
          await updateAuthCenterStore(
            current => ({
              ...current,
              apiKeys: [...current.apiKeys, created.apiKey],
            }),
            storePath,
          )
          writeJson(res, 200, {
            api_key: sanitizeApiKey(created.apiKey),
            plain_text_key: created.plainTextKey,
          })
          return
        }
      }

      writeJson(res, 404, { error: 'Not found' })
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error))
      writeJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      })
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
      resolve(typeof address === 'object' && address ? address.port : null)
    })
  })

  server.listen(port, host)

  return {
    port: typeof server.address() === 'object' && server.address()
      ? server.address()!.port
      : port,
    host,
    storePath,
    bootstrapAdminApiKey: ensured.bootstrap.bootstrapAdminApiKey,
    bootstrapAdminEmail: ensured.bootstrap.bootstrapAdminEmail,
    bootstrapAdminPassword: ensured.bootstrap.bootstrapAdminPassword,
    ready,
    stop() {
      server.close()
    },
  }
}
