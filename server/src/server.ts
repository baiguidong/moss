import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import http from 'http'
import { extname, isAbsolute, join, relative, resolve, sep } from 'path'

import { handleAgentMailRoute } from './agentMail/agentMailRoutes.js'
import { AgentMailService } from './agentMail/agentMailService.js'
import { OAuthLoginError, OAuthLoginService } from './auth/oauth.js'
import { OidcService } from './auth/oidc.js'
import { AuthService, AuthServiceError } from './auth/service.js'
import { hasScope, type AuthContext } from './auth/token.js'
import { CloudSharesRepository } from './model/repositories/cloudShares.js'
import { CloudSharesService } from './cloudStorage/shares.js'
import { handleShareManagement, handlePublicShare } from './cloudStorage/shareRoutes.js'
import { handleCloudStorageRoute } from './cloudStorage/routes.js'
import type { ObjectStore } from './cloudStorage/s3.js'
import { CloudStorageService } from './cloudStorage/service.js'
import { MOSS_SERVER_ASSET_ROOT } from './lib/env.js'

import { AgentMailRepository } from './model/repositories/agentMail.js'
import { CloudStorageRepository } from './model/repositories/cloudStorage.js'
import { OpenIMIntegrationService } from './openim/service.js'
import {
  MAX_PROFILE_ARCHIVE_BYTES,
  getSkillSyncStatus,
  installSkillArchive,
  listProfileMemory,
  readProfileMemory,
  readSessionMemory,
} from './profileResources.js'
import { RagflowIntegrationService } from './ragflow/service.js'
import { getUserProfileDir } from './runtimePaths.js'
import type { createModels } from './model/index.js'
import { HostRepository } from './model/repositories/hosts.js'
import { authenticateHostReport, handleControlPlaneRoute } from './controlPlane.js'
import { listSessionTasks } from './sessionTasks.js'
import { createServerLogger, type ServerLogger } from './serverLog.js'
import { NewAPIService } from './newApi/service.js'

import { getSystemSettings, updateSystemSettings } from './systemSettings.js'
import { fetchModelCatalog } from '../../shared/model-list.mjs'
import { loadSessionContextFromTranscript } from './transcript.js'
import { createTraceRoutes, TraceRouteError } from './traceRoutes.js'
import type { ServerConfig, SessionRecord } from './types.js'

type JsonBody = Record<string, unknown>

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

function isJsonBody(value: unknown): value is JsonBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function serializeSession(session: {
  sessionId: string
  transcriptSessionId: string
  sessionKind?: 'chat' | 'cron'
  cronTaskId?: string
  sourceSessionId?: string
  cwd: string
  userId: string
  orgId: string
  role: string
  scopes: string[]
  runtime: SessionRecord['runtime']
  status: string
  desiredState: string
  title?: string | null
  summary?: string | null
  assistantName?: string | null
  advancedSettings?: SessionRecord['advancedSettings']
  autoMemory?: SessionRecord['autoMemory']
  sessionMemory?: SessionRecord['sessionMemory']
  createdAt: number
  lastActiveAt: number
  endedAt: number | null
}) {
  return {
    sessionId: session.sessionId,
    transcriptSessionId: session.transcriptSessionId,
    sessionKind: session.sessionKind,
    cronTaskId: session.cronTaskId,
    sourceSessionId: session.sourceSessionId,
    workDir: session.cwd,
    userId: session.userId,
    orgId: session.orgId,
    role: session.role,
    scopes: session.scopes,
    runtime: session.runtime,
    status: session.status,
    desiredState: session.desiredState,
    title: session.title ?? null,
    summary: session.summary ?? null,
    assistantName: session.assistantName,
    advancedSettings: session.advancedSettings,
    autoMemory: session.autoMemory,
    sessionMemory: session.sessionMemory,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    endedAt: session.endedAt,
  }
}

function isInsidePath(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function checksum(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`
}

function readBody(
  req: http.IncomingMessage,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let data = ''
    let bytes = 0
    let rejected = false
    req.setEncoding('utf8')
    req.on('data', chunk => {
      if (rejected) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxBytes) {
        rejected = true
        reject(new HttpError(413, 'Request body too large'))
        return
      }
      data += chunk
    })
    req.on('end', () => {
      if (!rejected) resolveBody(data)
    })
    req.on('error', error => {
      if (!rejected) reject(error)
    })
  })
}

function readBufferBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let rejected = false
    req.on('data', chunk => {
      if (rejected) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > maxBytes) {
        rejected = true
        reject(new HttpError(413, 'Request body too large'))
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (!rejected) resolveBody(Buffer.concat(chunks, bytes))
    })
    req.on('error', error => {
      if (!rejected) reject(error)
    })
  })
}

async function readJsonBody(
  req: http.IncomingMessage,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<JsonBody> {
  const rawBody = await readBody(req, maxBytes)
  if (!rawBody.trim()) {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
  if (!isJsonBody(parsed)) {
    throw new HttpError(400, 'JSON body must be an object')
  }
  return parsed
}

async function readOAuthJsonBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<JsonBody> {
  try {
    return await readJsonBody(req, maxBytes)
  } catch (error) {
    if (error instanceof HttpError) {
      throw new OAuthLoginError(error.statusCode, error.message)
    }
    throw error
  }
}

async function readOAuthFormBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<URLSearchParams> {
  if (
    !String(req.headers['content-type'] || '').startsWith(
      'application/x-www-form-urlencoded',
    )
  ) {
    throw new OAuthLoginError(
      415,
      'OAuth authorization form must be URL encoded',
    )
  }
  try {
    return new URLSearchParams(await readBody(req, maxBytes))
  } catch (error) {
    if (error instanceof HttpError) {
      throw new OAuthLoginError(error.statusCode, error.message)
    }
    throw error
  }
}

function getBearerToken(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization
  if (typeof header !== 'string') {
    return null
  }
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

async function authenticateRequest(
  req: http.IncomingMessage,
  authService: AuthService,
): Promise<AuthContext | null> {
  const token = getBearerToken(req)
  if (!token) return null
  return await authService.verifyAccessToken(token)
}

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function writeNoStoreJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'cache-control': 'no-store',
    pragma: 'no-cache',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function writeOAuthAuthorizePage(
  res: http.ServerResponse,
  input: {
    transactionId?: string
    redirectUri?: string
    loginIdentifier?: string
    error?: string
    status?: number
  },
): void {
  const canLogin = Boolean(input.transactionId)
  const title = canLogin ? '登录到 Moss Server' : '认证请求已失效'
  const subtitle = canLogin
    ? '使用 Moss 账号登录，完成本次授权。'
    : '请返回 Moss 客户端重新发起认证。'
  const error = input.error
    ? `<div class="error" role="alert">${escapeHtml(input.error)}</div>`
    : ''
  const form = canLogin
    ? `<form method="post" action="/api/v1/auth/oauth/authorize">
        <input type="hidden" name="transaction_id" value="${escapeHtml(input.transactionId || '')}">
        <label for="login_identifier">用户名或邮箱</label>
        <input id="login_identifier" name="login_identifier" value="${escapeHtml(input.loginIdentifier || '')}" autocomplete="username" required autofocus placeholder="输入你的账号">
        <label for="password">密码</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="输入登录密码">
        <div class="actions">
          <button type="submit" name="action" value="authorize">登录并继续<span aria-hidden="true">→</span></button>
          <button class="secondary" type="submit" name="action" value="cancel" formnovalidate>取消</button>
        </div>
      </form>`
    : '<p class="muted">请返回 Moss 客户端重新发起认证。</p>'
  const callbackTarget =
    canLogin && input.redirectUri ? new URL(input.redirectUri).toString() : ''
  const formAction = callbackTarget ? `'self' ${callbackTarget}` : "'none'"
  const payload = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
    :root{color-scheme:light;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f6f8f3;color:#263c30}
    *{box-sizing:border-box}body{margin:0;min-height:100svh;background:radial-gradient(ellipse at 16% 50%,#dce9d596,transparent 54%),#f6f8f3;color:#263c30}
    .page{width:min(100%,1160px);min-height:100svh;margin:auto;padding:clamp(18px,4vh,32px) clamp(20px,4vw,48px) 18px;display:flex;flex-direction:column}
    .brand{display:flex;align-items:center;gap:10px;font-size:21px;font-weight:650;letter-spacing:.12em}.brand-mark{width:30px;height:30px;display:grid;place-items:center;border-radius:8px;background:#347650;color:#fff;font-size:18px;font-weight:750;letter-spacing:-.08em}.brand-label{margin-left:7px;padding-left:17px;border-left:1px solid #dde5dc;color:#687b6d;font-size:12px;font-weight:450;letter-spacing:.08em}
    .content{display:grid;grid-template-columns:minmax(0,1fr) 410px;align-items:center;gap:64px;flex:1;padding:24px 0}.intro{padding-bottom:24px}.eyebrow{display:flex;align-items:center;gap:8px;color:#347650;font-size:12px;font-weight:550;letter-spacing:.12em}.eyebrow i{width:6px;height:6px;border-radius:50%;background:#347650}.intro h1{font-size:clamp(36px,4.1vw,52px);font-weight:620;line-height:1.35;letter-spacing:-.04em;margin:23px 0 20px}.intro h1 em{color:#347650;font-style:normal}.intro>p{max-width:360px;margin:0;color:#687b6d;font-size:15px;line-height:1.95}.benefits{display:flex;flex-wrap:wrap;gap:20px;margin-top:32px;color:#687b6d;font-size:12px}.benefits span{display:inline-flex;align-items:center;gap:7px}.benefits b{width:16px;height:16px;display:grid;place-items:center;border:1px solid #a9c5ad;border-radius:50%;color:#347650;font-size:10px}
    .auth-card{width:100%;padding:28px;border:1px solid #dde5dc;border-radius:24px;background:#fff;box-shadow:0 16px 56px #1935220d,0 2px 8px #19352205}.card-icon{width:40px;height:40px;display:grid;place-items:center;border-radius:14px;background:#edf4eb;color:#347650;margin-bottom:14px}.card-icon svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.8}.auth-card h1{font-size:23px;font-weight:600;letter-spacing:-.04em;margin:0}.subtitle{margin:6px 0 20px;color:#687b6d;font-size:13px;line-height:1.7}.error{padding:10px 12px;margin:0 0 16px;border-radius:8px;background:#fff2f0;color:#a53939;font-size:12px;line-height:1.7;overflow-wrap:anywhere}.muted{margin:0;color:#687b6d;font-size:13px;line-height:1.9}
    label{display:block;margin:0 0 8px;font-size:12px;font-weight:550}label+label{margin-top:14px}input{display:block;width:100%;height:46px;padding:0 13px;border:1px solid #dde5dc;border-radius:10px;background:#f6f8f3;color:#263c30;font:inherit;font-size:14px;outline:none;transition:border-color .15s,box-shadow .15s}input::placeholder{color:#687b6d;opacity:.7}input:focus{border-color:#347650;box-shadow:0 0 0 3px #3476501f}
    .actions{display:flex;gap:10px;margin-top:22px}.actions button{height:44px;border:1px solid #347650;border-radius:10px;padding:0 17px;font-family:inherit;font-size:14px;font-weight:550;cursor:pointer}.actions button:first-child{display:flex;align-items:center;justify-content:center;gap:10px;flex:1;background:#347650;color:#fff}.actions button:first-child span{font-size:18px;line-height:1}.actions button.secondary{background:#fff;color:#526257;border-color:#dde5dc}.actions button:hover{filter:brightness(1.04)}.actions button:focus-visible{outline:2px solid #347650;outline-offset:3px}
    .hint{margin:14px 0 0;color:#687b6d;text-align:center;font-size:11px;line-height:1.6}.footer{color:#687b6d;text-align:center;font-size:11px;letter-spacing:.05em}
    @media(max-width:800px){.page{max-width:500px;padding:20px 24px 16px}.content{display:flex;justify-content:center;gap:0;padding:16px 0}.intro{display:none}.auth-card{padding:24px}}
    @media(max-height:620px) and (min-width:801px){.page{padding-top:14px;padding-bottom:10px}.content{padding:10px 0}.intro{padding-bottom:0}.intro h1{margin:12px 0;line-height:1.25}.benefits{margin-top:16px}.auth-card{padding:20px 24px}.card-icon{display:none}.subtitle{margin:4px 0 12px}.actions{margin-top:16px}}
    @media(max-height:520px){.page{padding-top:10px;padding-bottom:8px}.footer{display:none}.auth-card{padding:18px 20px}.subtitle{display:none}}
    @media(prefers-color-scheme:dark){:root{color-scheme:dark;background:#14221b;color:#e1e9e0}body{background:radial-gradient(ellipse at 16% 50%,#29412c66,transparent 54%),#14221b;color:#e1e9e0}.brand-label,.intro>p,.benefits,.subtitle,.muted,.hint,.footer{color:#a0b3a6}.brand-label{border-color:#354a3b}.auth-card{background:#1d2d24;border-color:#354a3b;box-shadow:0 16px 56px #0003}.auth-card h1{color:#e1e9e0}.card-icon{background:#293f30;color:#7cb98a}input{background:#14221b;border-color:#354a3b;color:#e1e9e0}input::placeholder{color:#a0b3a6}.actions button.secondary{background:#1d2d24;border-color:#354a3b;color:#e1e9e0}.error{background:#55332d;color:#f0aba3}}
  </style></head><body><div class="page"><header class="brand"><span class="brand-mark" aria-hidden="true">m</span><span>moss</span><span class="brand-label">统一登录</span></header><div class="content"><section class="intro" aria-label="Moss 工作空间介绍"><div class="eyebrow"><i></i>你的专属工作空间</div><h1>登录 Moss，<br><em>继续你的工作。</em></h1><p>使用 Moss 账号安全登录，继续访问云电脑、控制平面和桌面客户端。</p><div class="benefits"><span><b aria-hidden="true">✓</b>云端保存</span><span><b aria-hidden="true">✓</b>统一账号</span><span><b aria-hidden="true">✓</b>安全授权</span></div></section><main class="auth-card"><div class="card-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" /></svg></div><h1>${title}</h1><p class="subtitle">${subtitle}</p>${error}${form}${canLogin ? '<p class="hint">登录后将返回原应用，继续你的工作。</p>' : ''}</main></div><footer class="footer">Moss 企业工作空间 · 安全登录</footer></div></body></html>`
  res.writeHead(input.status ?? 200, {
    'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; base-uri 'none'; frame-ancestors 'none'`,
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  res.end(payload)
}

function redirectNoStore(res: http.ServerResponse, location: string): void {
  res.writeHead(303, {
    'cache-control': 'no-store',
    location,
    'referrer-policy': 'no-referrer',
  })
  res.end()
}

function redirect(res: http.ServerResponse, location: string): void {
  res.writeHead(302, { location })
  res.end()
}

function canAccessSession(
  auth: AuthContext,
  session: { orgId: string; userId: string },
  anyScope: string,
): boolean {
  return (
    session.orgId === auth.orgId &&
    (session.userId === auth.userId || hasScope(auth.scopes, anyScope))
  )
}

function resolveAdminDistDir(): string | null {
  const candidates = [resolve(MOSS_SERVER_ASSET_ROOT, 'admin', 'dist')]

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) {
      return candidate
    }
  }
  return null
}

function contentTypeForPath(filePath: string): string {
  return (
    MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  )
}

async function writeFileResponse(
  res: http.ServerResponse,
  filePath: string,
  headOnly = false,
): Promise<void> {
  const data = headOnly ? null : await readFile(filePath)
  res.writeHead(200, {
    'content-type': contentTypeForPath(filePath),
    'content-length': headOnly
      ? String((await stat(filePath)).size)
      : String(data?.byteLength ?? 0),
  })
  if (headOnly) {
    res.end()
    return
  }
  res.end(data)
}

async function serveAdminRequest(
  res: http.ServerResponse,
  pathname: string,
  adminDistDir: string | null,
  headOnly = false,
): Promise<void> {
  if (!adminDistDir) {
    throw new HttpError(
      503,
      'Admin UI is not built. Run `pnpm --dir admin run build`.',
    )
  }

  const relativePath =
    pathname === '/admin' || pathname === '/admin/'
      ? 'index.html'
      : decodeURIComponent(pathname.replace(/^\/admin\/?/, ''))
  const requestedPath = relativePath || 'index.html'
  const resolvedPath = resolve(adminDistDir, requestedPath)
  const insideAdminRoot =
    resolvedPath === adminDistDir ||
    resolvedPath.startsWith(`${adminDistDir}${sep}`)

  if (!insideAdminRoot) {
    throw new HttpError(403, 'Forbidden')
  }

  try {
    const info = await stat(resolvedPath)
    if (info.isFile()) {
      await writeFileResponse(res, resolvedPath, headOnly)
      return
    }
  } catch {}

  if (requestedPath.includes('.')) {
    throw new HttpError(404, 'Not found')
  }

  await writeFileResponse(res, join(adminDistDir, 'index.html'), headOnly)
}

function writeError(
  logger: ServerLogger,
  res: http.ServerResponse,
  error: unknown,
): void {
  if (res.headersSent) {
    res.destroy(error instanceof Error ? error : undefined)
    return
  }
  if (error instanceof OAuthLoginError) {
    writeNoStoreJson(res, error.statusCode, { error: error.message })
    return
  }

  if (error instanceof AuthServiceError || error instanceof HttpError || error instanceof TraceRouteError) {
    writeJson(res, error.statusCode, { error: error.message })
    return
  }

  if (error instanceof Error && 'statusCode' in error && Number.isInteger(error.statusCode) && Number(error.statusCode) >= 400 && Number(error.statusCode) < 500) {
    writeJson(res, Number(error.statusCode), { error: error.message })
    return
  }
  logger.error(error instanceof Error ? error.message : String(error))
  writeJson(res, 500, {
    error: error instanceof Error ? error.message : String(error),
  })
}

export function startServer(
  config: ServerConfig,
  models: Awaited<ReturnType<typeof createModels>>,
  authService: AuthService,
  logger: ServerLogger = createServerLogger(),
  ragflowIntegration?: RagflowIntegrationService,
  openIMIntegration?: OpenIMIntegrationService,
  cloudObjectStore?: ObjectStore,
  newApiService?: NewAPIService,
): {
  port: number | null
  ready: Promise<number | null>
  stop: () => Promise<void>
} {
  const adminDistDir = resolveAdminDistDir()
  const agentMailService = new AgentMailService(
    new AgentMailRepository(models.db),
  )
  const cloudStorage = new CloudStorageService(
    new CloudStorageRepository(models.db),
    config,
    async (auth, scope) => await authService.requireCurrentScope(auth, scope),
    cloudObjectStore,
  )
  const cloudShares = new CloudSharesService(new CloudSharesRepository(models.db), cloudStorage,
    (orgId, userId) => authService.requireSharingOwner(orgId, userId))
  const oidcConfig = config.oidc ?? {
    enabled: true,
    newApiClientId: 'new-api',
    desktopClientId: 'moss-desktop',
    webClientId: 'moss-web',
    trustedRedirectUris: [],
  }
  const oauthCallbacks = [
    ...(process.env.MOSS_OAUTH_WEB_CALLBACKS || '').split(',').map(value => value.trim()).filter(Boolean),
    ...oidcConfig.trustedRedirectUris,
  ]
  const oauthLoginService = new OAuthLoginService(authService, Date.now, [...new Set(oauthCallbacks)])
  const oidcOrigin = oidcConfig.issuer || config.publicUrl || `http://localhost:${config.port}`
  const oidcService = new OidcService({ ...config, oidc: oidcConfig }, authService, oauthLoginService, oidcOrigin)
  const handleTraceRoute = createTraceRoutes({
    config,
    getSession: id => models.sessions.getSession(id),
    listSessions: filter => models.sessions.listSessionRecords(filter),
    canAccessSession,
    requireAnyScope: (auth, scopes) => authService.requireAnyScope(auth, scopes),
    readJsonBody,
  })

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const pathname = url.pathname
      const isHead = req.method === 'HEAD'

      if ((req.method === 'GET' || isHead) && pathname === '/') {
        redirect(res, '/admin')
        return
      }

      if ((req.method === 'GET' || isHead) && pathname === '/healthz') {
        writeJson(res, 200, {
          ok: true,
          ready: true,
          auth_mode: config.authMode,
          oauth_enabled: true,
          role: 'control-plane',
          server_execution: false,
        })
        return
      }

      if ((req.method === 'GET' || isHead) && pathname === '/readyz') {
        try {
          await models.db.check()
        } catch {
          writeJson(res, 503, { ok: false, ready: false })
          return
        }
        writeJson(res, 200, {
          ok: true,
          ready: true,
        })
        return
      }

      if (oidcConfig.enabled && (req.method === 'GET' || isHead) && pathname === '/.well-known/openid-configuration') {
        writeNoStoreJson(res, 200, oidcService.discovery())
        return
      }
      if (oidcConfig.enabled && (req.method === 'GET' || isHead) && pathname === '/oidc/jwks.json') {
        writeNoStoreJson(res, 200, oidcService.jwks())
        return
      }
      if (oidcConfig.enabled && req.method === 'GET' && pathname === '/oidc/authorize') {
        const result = await oidcService.authorize(url.searchParams)
        redirectNoStore(res, result.location)
        return
      }
      if (oidcConfig.enabled && req.method === 'POST' && pathname === '/oidc/token') {
        const form = await readOAuthFormBody(req, 32 * 1024)
        writeNoStoreJson(res, 200, await oidcService.token(form, typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined))
        return
      }
      if (oidcConfig.enabled && req.method === 'POST' && pathname === '/oidc/revoke') {
        const form = await readOAuthFormBody(req, 32 * 1024)
        await oidcService.revoke(form, typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined)
        writeNoStoreJson(res, 200, {})
        return
      }
      if (oidcConfig.enabled && (req.method === 'GET' || req.method === 'POST') && pathname === '/oidc/userinfo') {
        const token = getBearerToken(req)
        if (!token) throw new OAuthLoginError(401, 'Missing bearer token')
        writeNoStoreJson(res, 200, await oidcService.userinfo(token))
        return
      }

      if (
        (req.method === 'GET' || isHead) &&
        (pathname === '/admin' || pathname.startsWith('/admin/'))
      ) {
        await serveAdminRequest(res, pathname, adminDistDir, isHead)
        return
      }

      if (
        req.method === 'POST' &&
        (pathname === '/api/v1/auth/token' || pathname === '/api/v1/auth/login')
      ) {
        const body = await readJsonBody(req)
        const grantType = typeof body.grant_type === 'string'
          ? body.grant_type.trim()
          : 'password'
        if (grantType === 'password') {
          writeJson(
            res,
            200,
            await authService.issueTokenFromPassword({
              username: typeof body.username === 'string' ? body.username : '',
              email: typeof body.email === 'string' ? body.email : '',
              password: typeof body.password === 'string' ? body.password : '',
            }),
          )
          return
        }

        throw new HttpError(400, `Unsupported grant_type: ${grantType}`)
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/oauth/start') {
        const body = await readOAuthJsonBody(req, 4 * 1024)
        writeNoStoreJson(
          res,
          200,
          await oauthLoginService.start({
            redirectUri:
              typeof body.redirect_uri === 'string' ? body.redirect_uri : '',
            state: typeof body.state === 'string' ? body.state : '',
            codeChallenge:
              typeof body.code_challenge === 'string'
                ? body.code_challenge
                : '',
            codeChallengeMethod:
              typeof body.code_challenge_method === 'string'
                ? body.code_challenge_method
                : '',
          }),
        )
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/oauth/cancel') {
        const body = await readOAuthJsonBody(req, 4 * 1024)
        writeNoStoreJson(
          res,
          200,
          await oauthLoginService.cancelClientRequest({
            state: typeof body.state === 'string' ? body.state : '',
            redirectUri:
              typeof body.redirect_uri === 'string' ? body.redirect_uri : '',
            code: typeof body.code === 'string' ? body.code : undefined,
          }),
        )
        return
      }

      if (
        req.method === 'GET' &&
        (pathname === '/api/v1/auth/oauth/authorize' ||
          pathname.startsWith('/api/v1/auth/oauth/authorize/'))
      ) {
        try {
          const pathTransactionId = pathname.startsWith(
            '/api/v1/auth/oauth/authorize/',
          )
            ? pathname.slice('/api/v1/auth/oauth/authorize/'.length)
            : ''
          const authorization =
            await oauthLoginService.getAuthorizationRequest(pathTransactionId)
          writeOAuthAuthorizePage(res, authorization)
        } catch (error) {
          if (!(error instanceof OAuthLoginError)) throw error
          writeOAuthAuthorizePage(res, {
            error: error.message,
            status: error.statusCode,
          })
        }
        return
      }

      if (
        req.method === 'POST' &&
        pathname === '/api/v1/auth/oauth/authorize'
      ) {
        const form = await readOAuthFormBody(req, 8 * 1024)
        const transactionId = form.get('transaction_id') || ''
        if (form.get('action') === 'cancel') {
          redirectNoStore(res, await oauthLoginService.cancel(transactionId))
          return
        }
        try {
          redirectNoStore(
            res,
            await oauthLoginService.authorizeWithPassword({
              transactionId,
              loginIdentifier: form.get('login_identifier') || '',
              password: form.get('password') || '',
            }),
          )
        } catch (error) {
          if (!(error instanceof OAuthLoginError)) throw error
          const retryable = error.statusCode === 401
          const retryAuthorization = retryable
            ? await oauthLoginService.getAuthorizationRequest(transactionId)
            : null
          writeOAuthAuthorizePage(res, {
            ...retryAuthorization,
            loginIdentifier: retryable
              ? form.get('login_identifier') || ''
              : undefined,
            error: error.message,
            status: error.statusCode,
          })
        }
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/oauth/exchange') {
        const body = await readOAuthJsonBody(req, 4 * 1024)
        const result = await oauthLoginService.exchange({
          code: typeof body.code === 'string' ? body.code : '',
          codeVerifier:
            typeof body.code_verifier === 'string' ? body.code_verifier : '',
          redirectUri:
            typeof body.redirect_uri === 'string' ? body.redirect_uri : '',
        })
        const session = await authService.createRefreshSession(result.access_token, oidcConfig.desktopClientId)
        writeNoStoreJson(res, 200, { ...result, ...session })
        return
      }

      // The legacy browser flow remains usable when OIDC is disabled. This
      // endpoint is exclusively the public Desktop client, never a way around
      // confidential OIDC client authentication.
      if (req.method === 'POST' && pathname === '/api/v1/auth/oauth/revoke') {
        const body = await readOAuthJsonBody(req, 4 * 1024)
        await authService.revokeRefreshToken(
          typeof body.refresh_token === 'string' ? body.refresh_token : '', oidcConfig.desktopClientId,
        )
        writeNoStoreJson(res, 200, {})
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/oauth/refresh') {
        const body = await readOAuthJsonBody(req, 4 * 1024)
        const result = await authService.refreshAccessToken(
          typeof body.refresh_token === 'string' ? body.refresh_token : '', oidcConfig.desktopClientId,
        )
        if (!result) throw new OAuthLoginError(400, 'invalid_grant')
        writeNoStoreJson(res, 200, result)
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/auth/me') {
        const token = getBearerToken(req)
        if (!token) {
          throw new HttpError(401, 'Missing bearer token')
        }
        const auth = await authService.verifyAccessToken(token)
        if (!auth) {
          throw new HttpError(401, 'Invalid access token')
        }
        writeJson(res, 200, await authService.getMe(auth))
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/introspect') {
        const body = await readJsonBody(req)
        const token = typeof body.token === 'string' ? body.token.trim() : ''
        if (!token) {
          throw new HttpError(400, 'Missing token')
        }
        writeJson(res, 200, await authService.introspect(token))
        return
      }

      const openIMWebhookMatch = pathname.match(
        /^\/api\/v1\/im\/openim-callback\/([^/]+)\/([^/]+)$/,
      )
      if (openIMIntegration && req.method === 'POST' && openIMWebhookMatch) {
        const webhookSecret = decodeURIComponent(openIMWebhookMatch[1] || '')
        const command = decodeURIComponent(openIMWebhookMatch[2] || '')
        if (
          !openIMIntegration.webhookEnabled() ||
          !openIMIntegration.matchesWebhookSecret(webhookSecret)
        ) {
          throw new HttpError(404, 'Not found')
        }
        const body = await readJsonBody(req, 512 * 1024)
        writeNoStoreJson(
          res,
          200,
          await openIMIntegration.handleWebhook(command, body),
        )
        return
      }

      if (await handlePublicShare(req, res, url, cloudShares)) return

      const auth = await authenticateRequest(req, authService) || await authenticateHostReport(req, models)
      if (!auth) {
        throw new HttpError(401, 'Unauthorized')
      }

      if (await handleControlPlaneRoute({ req, res, url, auth, authService, models, readJsonBody, writeJson, newApiService })) return

      if (req.method === 'GET' && pathname === '/api/v1/model-access') {
        if (!newApiService?.enabled()) throw new HttpError(503, 'New API gateway is unavailable')
        authService.requireAnyCurrentScope(auth, ['sessions:create', 'sessions:list', 'sessions:list:any'])
        writeNoStoreJson(res, 200, await newApiService.ensureUserKey(auth))
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/model-usage') {
        if (!newApiService?.enabled()) throw new HttpError(503, 'New API gateway is unavailable')
        authService.requireAnyCurrentScope(auth, ['sessions:list', 'sessions:list:any', 'admin:users'])
        writeNoStoreJson(res, 200, await newApiService.userInfo(auth))
        return
      }

      const userBalanceMatch = pathname.match(/^\/api\/v1\/users\/([^/]+)\/balance$/)
      if (req.method === 'GET' && userBalanceMatch) {
        authService.requireScope(auth, 'admin:users')
        if (!newApiService?.enabled()) throw new HttpError(503, 'New API gateway is unavailable')
        const userId = userBalanceMatch[1] || ''
        const target = await authService.getUserOrNull(userId, auth.orgId, auth)
        if (!target) throw new HttpError(404, 'Unknown user_id')
        writeNoStoreJson(res, 200, await newApiService.balanceById(userId, auth.orgId))
        return
      }

      const traceResult = await handleTraceRoute(req, url, auth)
      if (traceResult) {
        writeNoStoreJson(res, traceResult.status, traceResult.body)
        return
      }

      if (
        await handleShareManagement(req, res, url, auth, cloudShares) ||
        await handleCloudStorageRoute({
          req,
          res,
          url,
          auth,
          service: cloudStorage,
        })
      )
        return

      if (
        openIMIntegration &&
        req.method === 'POST' &&
        pathname === '/api/v1/im/session'
      ) {
        const body = await readJsonBody(req)
        const platformID = Math.floor(Number(body.platform_id) || 0)
        if (![1, 2, 3, 4, 5, 6, 7, 8].includes(platformID)) {
          throw new HttpError(400, 'Invalid platform_id')
        }
        writeNoStoreJson(
          res,
          200,
          await openIMIntegration.createSession(auth, platformID),
        )
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/directory') {
        authService.requireScope(auth, 'directory:read')
        writeJson(res, 200, await authService.listDirectory(auth.orgId))
        return
      }

      if (
        openIMIntegration &&
        req.method === 'GET' &&
        pathname === '/api/v1/im/directory'
      ) {
        writeJson(
          res,
          200,
          await openIMIntegration.listDirectory(auth, {
            cursor: url.searchParams.get('cursor') || undefined,
            limit: Number(url.searchParams.get('limit')) || undefined,
          }),
        )
        return
      }

      if (
        openIMIntegration &&
        req.method === 'POST' &&
        pathname === '/api/v1/im/direct-session'
      ) {
        const body = await readJsonBody(req)
        const targetUserId =
          typeof body.user_id === 'string' ? body.user_id.trim() : ''
        if (!targetUserId) throw new HttpError(400, 'Missing user_id')
        writeJson(
          res,
          200,
          await openIMIntegration.prepareDirectConversation(auth, targetUserId),
        )
        return
      }

      if (
        openIMIntegration &&
        req.method === 'POST' &&
        pathname === '/api/v1/im/group-session'
      ) {
        const body = await readJsonBody(req)
        const targetUserIds = Array.isArray(body.user_ids)
          ? body.user_ids.filter(
              (value): value is string => typeof value === 'string',
            )
          : []
        writeJson(
          res,
          200,
          await openIMIntegration.prepareGroupConversation(auth, targetUserIds),
        )
        return
      }

      if (
        openIMIntegration &&
        req.method === 'GET' &&
        pathname === '/api/v1/im/health'
      ) {
        writeJson(res, 200, await openIMIntegration.health(auth))
        return
      }

      if (
        await handleAgentMailRoute({
          req,
          res,
          url,
          auth,
          authService,
          service: agentMailService,
          requireMailbox: () => new HostRepository(models.db).requireMailbox(String(req.headers['x-moss-device-credential'] || (auth.role === 'host' ? auth.rawToken : '')), auth),
        })
      ) {
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/bootstrap') {
        writeJson(res, 200, {
          client_data: null,
          additional_model_options: [],
          capabilities: {
            control_plane: { version: 1 },
            server_execution: false,
            cloud_computer: { version: 1, path: '/' },
            cloud_storage: {
              version: 1,
              enabled: config.cloudStorage?.enabled ?? false,
            },
            agent_mail: { version: 1 },
            ragflow: {
              enabled: ragflowIntegration?.enabled ?? false,
              version: 1,
            },
          },
        })
        return
      }

      if (
        req.method === 'POST' &&
        pathname === '/api/v1/integrations/ragflow/resolve'
      ) {
        if (!ragflowIntegration)
          throw new HttpError(503, 'RAGFlow integration is unavailable')
        const gatewayToken =
          typeof req.headers['x-moss-rag-gateway-token'] === 'string'
            ? req.headers['x-moss-rag-gateway-token']
            : ''
        if (!ragflowIntegration.authorizeGateway(gatewayToken)) {
          throw new HttpError(403, 'Invalid Moss RAG gateway token')
        }
        writeNoStoreJson(res, 200, await ragflowIntegration.resolve(auth))
        return
      }

      if (
        req.method === 'GET' &&
        pathname === '/api/v1/integrations/ragflow/status'
      ) {
        if (!ragflowIntegration)
          throw new HttpError(503, 'RAGFlow integration is unavailable')
        authService.requireScope(auth, 'admin:users')
        writeJson(res, 200, await ragflowIntegration.getStatus())
        return
      }

      const ragflowUserMatch = pathname.match(
        /^\/api\/v1\/users\/([^/]+)\/ragflow(?:\/(provision|credentials|password|api-key))?$/,
      )
      if (ragflowUserMatch) {
        if (!ragflowIntegration)
          throw new HttpError(503, 'RAGFlow integration is unavailable')
        authService.requireScope(auth, 'admin:users')
        const userId = decodeURIComponent(ragflowUserMatch[1] || '')
        const action = ragflowUserMatch[2] || ''
        if (!(await authService.getUserOrNull(userId, auth.orgId, auth))) {
          throw new HttpError(404, 'Unknown user_id')
        }
        if (req.method === 'GET' && !action) {
          writeJson(
            res,
            200,
            await ragflowIntegration.getUserStatus(auth.orgId, userId),
          )
          return
        }
        if (req.method === 'POST' && action === 'provision') {
          writeJson(
            res,
            200,
            await ragflowIntegration.provisionForUser(
              auth.orgId,
              userId,
              auth.userId,
            ),
          )
          return
        }
        authService.requireScope(auth, 'ragflow:credentials')
        if (req.method === 'POST' && action === 'credentials') {
          writeNoStoreJson(
            res,
            200,
            await ragflowIntegration.revealCredentials(
              auth.orgId,
              userId,
              auth.userId,
            ),
          )
          return
        }
        if (req.method === 'POST' && action === 'password') {
          writeNoStoreJson(
            res,
            200,
            await ragflowIntegration.rotatePassword(
              auth.orgId,
              userId,
              auth.userId,
            ),
          )
          return
        }
        if (req.method === 'POST' && action === 'api-key') {
          writeNoStoreJson(
            res,
            200,
            await ragflowIntegration.rotateApiKey(
              auth.orgId,
              userId,
              auth.userId,
            ),
          )
          return
        }
      }

      if (
        req.method === 'GET' &&
        pathname === '/api/v1/settings/remote-managed'
      ) {
        const settings = {}
        writeJson(res, 200, {
          uuid: `${auth.orgId}:default`,
          checksum: checksum(settings),
          settings,
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/policy-limits') {
        const restrictions = {}
        writeJson(res, 200, {
          restrictions,
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/roles') {
        authService.requireScope(auth, 'admin:users')
        writeJson(res, 200, await authService.listRoles(auth.orgId))
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/permissions') {
        authService.requireScope(auth, 'admin:users')
        writeJson(res, 200, authService.listPermissions())
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/roles') {
        authService.requireSystemAdmin(auth)
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          await authService.createRole({
            orgId: auth.orgId,
            name: typeof body.name === 'string' ? body.name : '',
            description:
              typeof body.description === 'string' ? body.description : '',
            permissions: Array.isArray(body.permissions)
              ? body.permissions.filter(
                  (value): value is string => typeof value === 'string',
                )
              : [],
          }),
        )
        return
      }

      const roleMatch = pathname.match(/^\/api\/v1\/roles\/([^/]+)$/)
      if (req.method === 'PATCH' && roleMatch) {
        authService.requireSystemAdmin(auth)
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          await authService.updateRole({
            orgId: auth.orgId,
            roleId: roleMatch[1] || '',
            name: typeof body.name === 'string' ? body.name : undefined,
            description:
              typeof body.description === 'string'
                ? body.description
                : undefined,
            permissions: Array.isArray(body.permissions)
              ? body.permissions.filter(
                  (value): value is string => typeof value === 'string',
                )
              : undefined,
          }),
        )
        return
      }

      if (req.method === 'DELETE' && roleMatch) {
        authService.requireSystemAdmin(auth)
        writeJson(
          res,
          200,
          await authService.deleteRole({
            orgId: auth.orgId,
            roleId: roleMatch[1] || '',
          }),
        )
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/departments') {
        authService.requireScope(auth, 'admin:users')
        writeJson(res, 200, await authService.listDepartments(auth.orgId, auth))
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/departments') {
        authService.requireScope(auth, 'admin:users')
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          await authService.createDepartment({
            orgId: auth.orgId,
            name: typeof body.name === 'string' ? body.name : '',
            parentId:
              body.parent_id === null || typeof body.parent_id === 'string'
                ? body.parent_id
                : undefined,
          }),
        )
        return
      }

      const departmentMatch = pathname.match(
        /^\/api\/v1\/departments\/([^/]+)$/,
      )
      if (req.method === 'PATCH' && departmentMatch) {
        authService.requireScope(auth, 'admin:users')
        const departmentId = departmentMatch[1] || ''
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          await authService.updateDepartment({
            orgId: auth.orgId,
            departmentId,
            name: typeof body.name === 'string' ? body.name : undefined,
            parentId:
              body.parent_id === null || typeof body.parent_id === 'string'
                ? body.parent_id
                : undefined,
          }),
        )
        return
      }

      if (req.method === 'DELETE' && departmentMatch) {
        authService.requireScope(auth, 'admin:users')
        const departmentId = departmentMatch[1] || ''
        writeJson(
          res,
          200,
          await authService.deleteDepartment({
            orgId: auth.orgId,
            departmentId,
          }),
        )
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/users') {
        authService.requireScope(auth, 'admin:users')
        writeJson(res, 200, await authService.listUsers(auth.orgId, auth))
        return
      }

      const userUsageMatch = pathname.match(/^\/api\/v1\/users\/([^/]+)\/usage$/)
      if (req.method === 'GET' && (pathname === '/api/v1/usage' || userUsageMatch)) {
        const userId = userUsageMatch ? decodeURIComponent(userUsageMatch[1] || '') : auth.userId
        const hostKind = url.searchParams.get('host_kind')
        if (hostKind !== null && hostKind !== 'cloud') throw new HttpError(400, 'Invalid host_kind')
        if (userId === auth.userId) {
          await authService.requireAnyCurrentScope(auth, ['sessions:list', 'sessions:list:any', 'admin:users'])
        } else {
          await authService.requireCurrentScope(auth, 'admin:users')
        }
        const actor = await authService.getUserOrNull(auth.userId, auth.orgId)
        if (!actor) throw new HttpError(401, 'Unauthorized')
        const currentAuth = { ...auth, role: actor.role,
          systemRoles: actor.roles.flatMap(role => role.systemKey ? [role.systemKey] : []) }
        const user = userId === auth.userId ? actor : await authService.getUserOrNull(userId, auth.orgId, currentAuth)
        if (!user) throw new HttpError(404, 'Unknown user_id')
        const hostIds = hostKind === 'cloud'
          ? (await new HostRepository(models.db).list(auth.orgId, userId)).filter(host => host.kind === 'cloud').map(host => host.hostId)
          : undefined
        const usage = await models.usage.getOverview({ orgId: auth.orgId, userId }, Date.now(), hostIds)
        const gateway = newApiService?.enabled()
          ? await newApiService.userInfoById(userId, auth.orgId).catch(() => null)
          : null
        writeNoStoreJson(res, 200, { user, ...usage, ...(gateway ? { gateway } : {}) })
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/users') {
        authService.requireScope(auth, 'admin:users')
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          await authService.createUser(
            {
              orgId: auth.orgId,
              email: typeof body.email === 'string' ? body.email : '',
              name: typeof body.name === 'string' ? body.name : '',
              departmentId:
                body.department_id === null ||
                typeof body.department_id === 'string'
                  ? body.department_id
                  : undefined,
              role: typeof body.role === 'string' ? body.role : 'user',
              roleIds: Array.isArray(body.role_ids)
                ? body.role_ids.filter(
                    (value): value is string => typeof value === 'string',
                  )
                : undefined,
              password: typeof body.password === 'string' ? body.password : '',
            },
            auth,
          ),
        )
        return
      }

      const userMatch = pathname.match(/^\/api\/v1\/users\/([^/]+)$/)
      if (req.method === 'PATCH' && userMatch) {
        authService.requireScope(auth, 'admin:users')
        const userId = userMatch[1] || ''
        const body = await readJsonBody(req)
        const result = await authService.updateUser(
          {
            orgId: auth.orgId,
            userId,
            name: typeof body.name === 'string' ? body.name : undefined,
            departmentId:
              body.department_id === null ||
              typeof body.department_id === 'string'
                ? body.department_id
                : undefined,
            role: typeof body.role === 'string' ? body.role : undefined,
            roleIds: Array.isArray(body.role_ids)
              ? body.role_ids.filter(
                  (value): value is string => typeof value === 'string',
                )
              : undefined,
            status: typeof body.status === 'string' ? body.status : undefined,
          },
          auth,
        )
        if (openIMIntegration) {
          if (result.user.status === 'disabled') {
            await openIMIntegration.syncUser(result.user)
          } else {
            await openIMIntegration.syncUser(result.user).catch(error => {
              logger.warn(
                `Unable to synchronize OpenIM user ${result.user.id}: ${error instanceof Error ? error.message : String(error)}`,
              )
            })
          }
        }
        if (
          typeof body.status === 'string' &&
          newApiService?.enabled() &&
          typeof newApiService.syncUserStatus === 'function'
        ) {
          if (result.user.status === 'disabled') {
            await newApiService.syncUserStatus(
              result.user.id,
              result.user.orgId,
              result.user.status,
            )
          } else {
            await newApiService
              .syncUserStatus(
                result.user.id,
                result.user.orgId,
                result.user.status,
              )
              .catch(error => {
                logger.warn(
                  `Unable to synchronize New API user ${result.user.id}: ${error instanceof Error ? error.message : String(error)}`,
                )
              })
          }
        }
        writeJson(res, 200, result)
        return
      }

      if (req.method === 'DELETE' && userMatch) {
        const userId = decodeURIComponent(userMatch[1] || '')
        const user = await authService.getUserOrNull(userId, auth.orgId, auth)
        const result = await authService.deleteUser({ orgId: auth.orgId, userId }, auth)
        const cleanup = await Promise.allSettled([
          ...(openIMIntegration && user
            ? [openIMIntegration.syncUser({ ...user, status: 'disabled' })]
            : []),
        ])
        for (const outcome of cleanup) {
          if (outcome.status === 'rejected') {
            logger.warn(`Unable to stop deleted user ${userId} connections: ${String(outcome.reason)}`)
          }
        }
        writeJson(res, 200, result)
        return
      }

      const userRolesMatch = pathname.match(
        /^\/api\/v1\/users\/([^/]+)\/roles$/,
      )
      if (req.method === 'PUT' && userRolesMatch) {
        authService.requireSystemAdmin(auth)
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          await authService.setUserRoles(
            {
              orgId: auth.orgId,
              userId: userRolesMatch[1] || '',
              roleIds: Array.isArray(body.role_ids)
                ? body.role_ids.filter(
                    (value): value is string => typeof value === 'string',
                  )
                : [],
            },
            auth,
          ),
        )
        return
      }

      const userPasswordMatch = pathname.match(
        /^\/api\/v1\/users\/([^/]+)\/password$/,
      )
      if (req.method === 'POST' && userPasswordMatch) {
        authService.requireScope(auth, 'admin:users')
        const userId = userPasswordMatch[1] || ''
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          await authService.setUserPassword(
            {
              orgId: auth.orgId,
              userId,
              password: typeof body.password === 'string' ? body.password : '',
            },
            auth,
          ),
        )
        return
      }

      const userTokenLimitMatch = pathname.match(
        /^\/api\/v1\/users\/([^/]+)\/token-limit$/,
      )
      if (req.method === 'PATCH' && userTokenLimitMatch) {
        authService.requireScope(auth, 'admin:users')
        const userId = userTokenLimitMatch[1] || ''
        const body = await readJsonBody(req)
        const tokenLimit =
          body.tokenLimit === null ? null : Number(body.tokenLimit)
        writeJson(
          res,
          200,
          await authService.setUserTokenLimit(
            {
              orgId: auth.orgId,
              userId,
              tokenLimit:
                tokenLimit !== null && Number.isFinite(tokenLimit)
                  ? tokenLimit
                  : null,
            },
            auth,
          ),
        )
        return
      }

      const userRechargeMatch = pathname.match(
        /^\/api\/v1\/users\/([^/]+)\/recharge$/,
      )
      if (req.method === 'POST' && userRechargeMatch) {
        authService.requireScope(auth, 'admin:users')
        if (!newApiService?.enabled()) throw new HttpError(503, 'New API gateway is unavailable')
        const userId = userRechargeMatch[1] || ''
        const target = await authService.getUserOrNull(userId, auth.orgId, auth)
        if (!target) throw new HttpError(404, 'Unknown user_id')
        const body = await readJsonBody(req)
        const amountUsd = Number(body.amountUsd)
        writeJson(res, 200, await newApiService.recharge(auth, userId, auth.orgId, amountUsd))
        return
      }

      const departmentTokenLimitMatch = pathname.match(
        /^\/api\/v1\/departments\/([^/]+)\/token-limit$/,
      )
      if (req.method === 'PATCH' && departmentTokenLimitMatch) {
        authService.requireScope(auth, 'admin:users')
        const departmentId = departmentTokenLimitMatch[1] || ''
        const body = await readJsonBody(req)
        const tokenLimit =
          body.tokenLimit === null ? null : Number(body.tokenLimit)
        writeJson(
          res,
          200,
          await authService.setDepartmentTokenLimit(
            {
              orgId: auth.orgId,
              departmentId,
              tokenLimit:
                tokenLimit !== null && Number.isFinite(tokenLimit)
                  ? tokenLimit
                  : null,
            },
            auth,
          ),
        )
        return
      }

      const userSessionsMatch = pathname.match(
        /^\/api\/v1\/users\/([^/]+)\/sessions$/,
      )
      if (req.method === 'GET' && userSessionsMatch) {
        authService.requireScope(auth, 'admin:users')
        const userId = userSessionsMatch[1] || ''
        const user = await authService.getUserOrNull(userId, auth.orgId, auth)
        if (!user) {
          throw new HttpError(404, 'Unknown user_id')
        }
        writeJson(res, 200, {
          user,
          sessions: (
            await models.sessions.listUserSessions(auth.orgId, userId)
          ).map(session => serializeSession(session)),
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/webui/snapshot-policy') {
        writeJson(res, 200, getSystemSettings().webui?.snapshots || {})
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/settings/system') {
        authService.requireScope(auth, 'admin:settings')
        writeJson(res, 200, getSystemSettings())
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/settings/models') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        try {
          const catalog = newApiService?.enabled()
            ? await newApiService.adminModelCatalog(auth)
            : await fetchModelCatalog({
              url: typeof body.url === 'string' ? body.url : '',
              apiKey: typeof body.apiKey === 'string' ? body.apiKey : '',
            })
          writeJson(res, 200, catalog)
        } catch (error) {
          throw new HttpError(502, error instanceof Error ? error.message : String(error))
        }
        return
      }

      if (req.method === 'PATCH' && pathname === '/api/v1/settings/system') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        let settings
        try { settings = updateSystemSettings(body) }
        catch (error) { if (error instanceof RangeError) throw new HttpError(400, error.message); throw error }
        openIMIntegration?.updateConfig(settings.openIM)
        writeJson(res, 200, settings)
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/profile/skills') {
        authService.requireScope(auth, 'sessions:create')
        writeJson(
          res,
          200,
          await getSkillSyncStatus(getUserProfileDir(config, auth.userId)),
        )
        return
      }

      if (req.method === 'PUT' && pathname === '/api/v1/profile/skills') {
        authService.requireScope(auth, 'sessions:create')
        const archive = await readBufferBody(req, MAX_PROFILE_ARCHIVE_BYTES)
        const requestedRevision =
          typeof req.headers['x-moss-content-sha256'] === 'string'
            ? req.headers['x-moss-content-sha256'].trim()
            : ''
        try {
          writeJson(
            res,
            200,
            await installSkillArchive(
              getUserProfileDir(config, auth.userId),
              archive,
              requestedRevision,
            ),
          )
        } catch (error) {
          throw new HttpError(
            400,
            error instanceof Error ? error.message : String(error),
          )
        }
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/profile/memory') {
        authService.requireAnyScope(auth, [
          'sessions:list',
          'sessions:list:any',
        ])
        const profileDir = getUserProfileDir(config, auth.userId)
        const sessions = await models.sessions.listSessionRecords({
          orgId: auth.orgId,
          userId: auth.userId,
        })
        const sessionEntries = await Promise.all(
          sessions.map(async session => {
            const memory = await readSessionMemory(session)
            return {
              sessionId: session.sessionId,
              exists: memory.exists,
              bytes: memory.bytes,
              updatedAt: memory.updatedAt,
              readable: memory.readable,
            }
          }),
        )
        writeJson(res, 200, {
          global: {
            rootLabel: 'Moss Server / memory',
            files: await listProfileMemory(profileDir),
          },
          sessions: sessionEntries,
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/profile/memory/read') {
        authService.requireAnyScope(auth, [
          'sessions:list',
          'sessions:list:any',
        ])
        try {
          writeJson(
            res,
            200,
            await readProfileMemory(
              getUserProfileDir(config, auth.userId),
              url.searchParams.get('file') || '',
            ),
          )
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            throw new HttpError(404, 'Memory entry not found')
          }
          throw error
        }
        return
      }

      // Legacy execution endpoints are permanently retired. History is exported
      // through explicit archive endpoints and can never reattach a runner.
      if (pathname === '/api/v1/sessions' || pathname.startsWith('/api/v1/sessions/') || pathname.startsWith('/api/v1/cron/')) {
        writeJson(res, 410, { code: 'SERVER_EXECUTION_RETIRED', error: '服务端会话已退役，请连接自己的云电脑或使用此电脑。' })
        return
      }
      if (req.method === 'GET' && pathname === '/api/v1/archives/sessions') {
        authService.requireAnyScope(auth, ['sessions:list', 'sessions:list:any'])
        const sessions = await models.sessions.listSessionRecords({ orgId: auth.orgId,
          userId: hasScope(auth.scopes, 'sessions:list:any') ? undefined : auth.userId })
        writeJson(res, 200, { archived: true, sessions: sessions.map(serializeSession) })
        return
      }
      const archiveMatch = pathname.match(/^\/api\/v1\/archives\/sessions\/([^/]+)(?:\/(tasks))?$/)
      if (req.method === 'GET' && archiveMatch) {
        const record = await models.sessions.getSession(decodeURIComponent(archiveMatch[1]!))
        if (!record) throw new HttpError(404, 'Session not found')
        if (!canAccessSession(auth, record, 'sessions:attach:any')) throw new HttpError(403, 'Forbidden')
        writeNoStoreJson(res, 200, archiveMatch[2] === 'tasks' ? { archived: true, tasks: await listSessionTasks(record) } : { archived: true, session: serializeSession(record), context: await loadSessionContextFromTranscript(record) })
        return
      }

      throw new HttpError(404, 'Not found')
    } catch (error) {
      writeError(logger, res, error)
    }
  })

  server.on('upgrade', (_req, socket) => {
    socket.end('HTTP/1.1 410 Gone\r\nConnection: close\r\n\r\nServer execution retired')
  })

  const ready = new Promise<number | null>((resolvePort, reject) => {
    const onError = (error: Error) => {
      logger.error(error.message)
      reject(error)
    }
    server.once('error', onError)
    server.once('listening', () => {
      server.off('error', onError)
      const address = server.address()
      resolvePort(typeof address === 'object' && address ? address.port : null)
    })
  })

  server.requestTimeout = 15 * 60_000
  server.headersTimeout = 30_000
  server.listen(config.port, config.host)
  void cloudStorage.reconcile().catch(error => logger.error(String(error)))

  return {
    port: null,
    ready,
    stop: async () => {
      await cloudStorage.close()
      agentMailService.dispose()
      await new Promise<void>((resolveClose, reject) => {
        server.close(error => {
          if (error) {
            reject(error)
          } else {
            resolveClose()
          }
        })
      })
    },
  }
}
