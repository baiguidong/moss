import http from 'http'
import net from 'net'
import { existsSync, cpSync, rmSync } from 'fs'
import { readFile, stat, mkdir, writeFile, readdir } from 'fs/promises'
import os from 'os'
import { dirname, extname, join, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import type { ServerConfig, SessionRecord } from './types.js'
import { createServerLogger, type ServerLogger } from './serverLog.js'
import { hasScope, type AuthContext } from './auth/token.js'
import { AuthService, AuthServiceError } from './auth/service.js'
import { RuntimeService } from './runtimeService.js'
import { getSystemSettings, updateSystemSettings } from './systemSettings.js'
import {
  createCustomAssistant,
  fetchAgentHubAssistantDetail,
  fetchAgentHubAssistants,
  fetchAgentHubCategories,
  fetchAgentHubSkillDetailsByIds,
  getInstalledAssistants,
  installHubAssistant,
  type AgentHubAssistant,
  uninstallAssistant,
  updateInstalledAssistantMeta,
  batchSyncAssistants,
  type AssistantStoreMeta,
  uploadCustomAssistant,
  packageAssistantZip,
  readAssistantMeta,
  findAssistantDir,
  writeAssistantMeta,
} from './agentStore.js'
import {
  fetchSkillHubCategories,
  fetchSkillHubSkillDetail,
  fetchSkillHubSkills,
  getInstalledSkills,
  importLocalSkillArchive,
  importLocalSkillDirectory,
  installHubSkill,
  setInstalledSkillEnabled,
  setInstalledSkillMeta,
  type SkillHubSkill,
  type SkillStoreMeta,
  uninstallSkill,
  batchSyncSkills,
  uploadCustomSkill,
  packageSkillZip,
  findInstalledSkillPath,
  readSkillMeta,
  readSkillVersion,
  writeSkillMeta,
} from './skillStore.js'
import { createAdaptersApi } from './api/adapters.js'
import {
  getSkillSyncProgress,
  getAgentSyncProgress,
  updateSkillSyncProgress,
  updateAgentSyncProgress,
  resetSkillSyncProgress,
  resetAgentSyncProgress,
} from './syncProgress.js'
import { createEnterpriseApi } from './api/enterprise.js'
import { createChannelsApi } from './api/channels.js'
import { getChannelManager } from '../channels/core/ChannelManager.js'
import { getPairingService } from '../channels/pairing/PairingService.js'
import { MossActionExecutor } from '../channels/gateway/MossActionExecutor.js'
import { getUserProfile } from './api/userProfile.js'
import { loadBudgetStats } from './budgetStats.js'
import { loadDashboardStats } from './dashboardStats.js'
import { loadSessionContextFromTranscript } from './transcript.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import { isVisibleTo, type VisibleTo } from './visibilityFilter.js'
import { MOSS_SKILLS_CUSTOM_DIR, MOSS_SKILLS_TENANT_DIR } from '../utils/skills/localSkillDirectories.js'
import { DocumentStore } from './documentStore.js'

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
  cwd: string
  userId: string
  orgId: string
  role: string
  scopes: string[]
  runtime: SessionRecord['runtime']
  status: string
  desiredState: string
  assistantName?: string | null
  title?: string | null
  source?: string
  channelChatId?: string
  createdAt: number
  lastActiveAt: number
  endedAt: number | null
}) {
  return {
    sessionId: session.sessionId,
    transcriptSessionId: session.transcriptSessionId,
    workDir: session.cwd,
    userId: session.userId,
    orgId: session.orgId,
    role: session.role,
    scopes: session.scopes,
    runtime: session.runtime,
    status: session.status,
    desiredState: session.desiredState,
    assistantName: session.assistantName,
    title: session.title,
    source: session.source,
    channelChatId: session.channelChatId,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    endedAt: session.endedAt,
  }
}

function parseOptionalTimestampQuery(
  value: string | null,
  paramName: string,
): number | null {
  if (value === null || value.trim() === '') {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, `Invalid ${paramName} query parameter`)
  }

  return parsed
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      data += chunk
    })
    req.on('end', () => resolveBody(data))
    req.on('error', reject)
  })
}

function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => {
      chunks.push(Buffer.from(chunk))
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJsonBody(req: http.IncomingMessage): Promise<JsonBody> {
  const rawBody = await readBody(req)
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

async function copySkillToTenantDir(skillName: string): Promise<void> {
  const sourceDir = join(MOSS_SKILLS_CUSTOM_DIR, skillName)
  const targetDir = join(MOSS_SKILLS_TENANT_DIR, skillName)

  if (!existsSync(sourceDir)) {
    throw new HttpError(404, `Skill directory not found: ${skillName}`)
  }

  // Ensure tenant directory exists
  await mkdir(MOSS_SKILLS_TENANT_DIR, { recursive: true })

  // Copy the skill directory
  cpSync(sourceDir, targetDir, { recursive: true })

  // Update metadata to set source_type to 'tenant'
  const meta = await readSkillMeta(targetDir)
  if (meta) {
    meta.source_type = 'tenant'
    await writeSkillMeta(targetDir, meta)
  }
}

async function copyAssistantToTenantDir(assistantName: string): Promise<void> {
  const MOSS_HOME = process.env.MOSS_HOME || join(os.homedir(), '.moss')
  const MOSS_ASSISTANTS_DIR = join(MOSS_HOME, 'assistants')
  const ASSISTANT_CUSTOM_DIR = join(MOSS_ASSISTANTS_DIR, 'custom')
  const ASSISTANT_TENANT_DIR = join(MOSS_ASSISTANTS_DIR, 'tenant')

  const sourceDir = join(ASSISTANT_CUSTOM_DIR, assistantName)
  const targetDir = join(ASSISTANT_TENANT_DIR, assistantName)

  if (!existsSync(sourceDir)) {
    throw new HttpError(404, `Assistant directory not found: ${assistantName}`)
  }

  // Ensure tenant directory exists
  await mkdir(ASSISTANT_TENANT_DIR, { recursive: true })

  // Copy the assistant directory
  cpSync(sourceDir, targetDir, { recursive: true })

  // Update metadata to set source_type to 'tenant'
  const meta = await readAssistantMeta(targetDir)
  if (meta) {
    meta.source_type = 'tenant'
    await writeAssistantMeta(targetDir, meta)
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

function authenticateRequest(
  req: http.IncomingMessage,
  authService: AuthService,
): AuthContext | null {
  const token = getBearerToken(req)
  const auth = token ? authService.verifyAccessToken(token) : null
  if (token && !auth) {
    process.stderr.write(`[authenticateRequest] Verification failed for token: ${token.slice(0, 10)}...\n`)
  }
  return auth
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

function redirect(
  res: http.ServerResponse,
  location: string,
): void {
  res.writeHead(302, { location })
  res.end()
}

function parseRuntimeOptions(body: JsonBody) {
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
  if (!isJsonBody(body.runtime)) {
    return undefined
  }
  const runtime = body.runtime
  const type =
    runtime.type === 'docker'
      ? 'docker'
      : runtime.type === 'host'
        ? 'host'
        : undefined
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

function buildWsUrl(server: http.Server, config: ServerConfig, sessionId: string): string {
  const address = server.address()
  const actualPort =
    typeof address === 'object' && address ? address.port : config.port

  // Use advertisedHost if configured, otherwise derive from bind host
  let host: string
  if (config.advertisedHost) {
    host = config.advertisedHost
  } else if (config.host === '0.0.0.0' || config.host === '::') {
    host = '127.0.0.1'
  } else {
    host = config.host
  }

  return `ws://${host}:${actualPort}/ws/sessions/${sessionId}`
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
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(process.cwd(), 'admin', 'dist'),
    resolve(currentDir, '..', '..', 'admin', 'dist'),
    resolve(currentDir, 'admin', 'dist'),
  ]

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) {
      return candidate
    }
  }
  return null
}

function contentTypeForPath(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
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
    throw new HttpError(503, 'Admin UI is not built. Run `pnpm --dir admin run build`.')
  }

  const relativePath =
    pathname === '/admin' || pathname === '/admin/'
      ? 'index.html'
      : decodeURIComponent(pathname.replace(/^\/admin\/?/, ''))
  const requestedPath = relativePath || 'index.html'
  const resolvedPath = resolve(adminDistDir, requestedPath)
  const insideAdminRoot =
    resolvedPath === adminDistDir || resolvedPath.startsWith(`${adminDistDir}${sep}`)

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
  if (error instanceof AuthServiceError || error instanceof HttpError) {
    writeJson(res, error.statusCode, { error: error.message })
    return
  }

  logger.error(error instanceof Error ? error.message : String(error))
  writeJson(res, 500, {
    error: error instanceof Error ? error.message : String(error),
  })
}

function setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const origin = req.headers.origin
  if (!origin) return false

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Max-Age', '86400')
  return true
}

function handleCorsPreflight(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (req.method === 'OPTIONS' && req.headers.origin) {
    setCorsHeaders(req, res)
    res.writeHead(204)
    res.end()
    return true
  }
  return false
}

export function startServer(
  config: ServerConfig,
  runtime: RuntimeService,
  authService: AuthService,
  logger: ServerLogger = createServerLogger(),
): {
  port: number | null
  ready: Promise<number | null>
  stop: () => Promise<void>
} {
  const adminDistDir = resolveAdminDistDir()
  const wss = new WebSocketServer({ noServer: true })
  const enterpriseApi = createEnterpriseApi(runtime.store, config.runtimeDir)
  const documentStore = new DocumentStore(runtime.store)

  // Initialize ChannelManager and PairingService with database
  // 初始化 ChannelManager 和 PairingService
  const channelManager = getChannelManager()
  channelManager.initialize(runtime.store)
  getPairingService().initialize(runtime.store)

  // Wire up message routing: incoming channel messages -> AI processing -> response
  const pluginManager = channelManager.getPluginManager()
  const sessionManager = channelManager.getSessionManager()
  if (pluginManager && sessionManager) {
    const mossActionExecutor = new MossActionExecutor(
      pluginManager,
      sessionManager,
      getPairingService(),
      runtime,
      runtime.store,
    )
    channelManager.setMessageHandler(mossActionExecutor.getMessageHandler())
    console.log('[Server] MossActionExecutor wired up for channel message routing')
  }


  // Start enabled plugins (for enterprise mode)
  // 启动已启用的插件（企业模式）
  channelManager.startEnabledPlugins().catch((error) => {
    console.error('[Server] Failed to start enabled plugins:', error)
  })

  const channelsApi = createChannelsApi(runtime.store)

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const pathname = url.pathname
      const isHead = req.method === 'HEAD'

      // Handle CORS preflight for all API routes
      if (pathname.startsWith('/api/') && handleCorsPreflight(req, res)) {
        return
      }

      // Set CORS headers for all API routes (non-preflight)
      if (pathname.startsWith('/api/')) {
        setCorsHeaders(req, res)
      }

      if ((req.method === 'GET' || isHead) && pathname === '/') {
        redirect(res, '/admin')
        return
      }

      if ((req.method === 'GET' || isHead) && pathname === '/healthz') {
        writeJson(res, 200, {
          ok: true,
          ready: true,
          sessions: runtime.countActiveSessions(),
          auth_mode: config.authMode,
        })
        return
      }

      if ((req.method === 'GET' || isHead) && pathname === '/readyz') {
        writeJson(res, 200, {
          ok: true,
          ready: true,
        })
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
        const grantType =
          typeof body.grant_type === 'string'
            ? body.grant_type.trim()
            : typeof body.api_key === 'string'
              ? 'api_key'
              : 'password'
        if (grantType === 'api_key') {
          writeJson(
            res,
            200,
            authService.issueTokenFromApiKey(
              typeof body.api_key === 'string' ? body.api_key : '',
            ),
          )
          return
        }

        if (grantType === 'password') {
          writeJson(
            res,
            200,
            authService.issueTokenFromPassword({
              username: typeof body.username === 'string' ? body.username : '',
              email: typeof body.email === 'string' ? body.email : '',
              password: typeof body.password === 'string' ? body.password : '',
            }),
          )
          return
        }

        if (grantType === 'refresh_token') {
          const refreshToken =
            typeof body.refresh_token === 'string'
              ? body.refresh_token.trim()
              : ''
          if (!refreshToken) {
            throw new HttpError(400, 'Missing refresh_token')
          }
          writeJson(res, 200, authService.refreshToken(refreshToken))
          return
        }

        throw new HttpError(400, `Unsupported grant_type: ${grantType}`)
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/logout') {
        const auth = authenticateRequest(req, authService)
        if (!auth) {
          throw new HttpError(401, 'Unauthorized')
        }
        const accessToken = getBearerToken(req)!
        const body = await readJsonBody(req).catch(() => ({}))
        const refreshToken =
          typeof body.refresh_token === 'string'
            ? body.refresh_token.trim()
            : undefined
        authService.logout(accessToken, refreshToken)
        writeJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/auth/me') {
        const token = getBearerToken(req)
        if (!token) {
          throw new HttpError(401, 'Missing bearer token')
        }
        const auth = authService.verifyAccessToken(token)
        if (!auth) {
          throw new HttpError(401, 'Invalid access token')
        }
        writeJson(res, 200, authService.getMe(auth))
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/user/profile') {
        const auth = authenticateRequest(req, authService)
        if (!auth) {
          throw new HttpError(401, 'Unauthorized')
        }
        const result = await getUserProfile(auth, authService, runtime.store)
        writeJson(res, 200, result)
        return
      }

      if (pathname.startsWith('/api/v1/channels/')) {
        const auth = authenticateRequest(req, authService)
        if (!auth) {
          throw new HttpError(401, 'Unauthorized')
        }

        // GET /api/v1/channels/plugins
        if (req.method === 'GET' && pathname === '/api/v1/channels/plugins') {
          writeJson(res, 200, await channelsApi.getPlugins(auth.orgId, auth.userId))
          return
        }

        // POST /api/v1/channels/plugins/:id/enable
        const enableMatch = pathname.match(/^\/api\/v1\/channels\/plugins\/([^/]+)\/enable$/)
        if (req.method === 'POST' && enableMatch) {
          const pluginId = enableMatch[1] || ''
          const body = await readJsonBody(req)
          writeJson(res, 200, await channelsApi.enablePlugin(auth.orgId, auth.userId, pluginId, body))
          return
        }

        // POST /api/v1/channels/plugins/:id/disable
        const disableMatch = pathname.match(/^\/api\/v1\/channels\/plugins\/([^/]+)\/disable$/)
        if (req.method === 'POST' && disableMatch) {
          const pluginId = disableMatch[1] || ''
          writeJson(res, 200, await channelsApi.disablePlugin(auth.orgId, auth.userId, pluginId))
          return
        }

        // POST /api/v1/channels/plugins/:id/test
        const testMatch = pathname.match(/^\/api\/v1\/channels\/plugins\/([^/]+)\/test$/)
        if (req.method === 'POST' && testMatch) {
          const pluginId = testMatch[1] || ''
          const body = await readJsonBody(req)
          writeJson(res, 200, await channelsApi.testPlugin(auth.orgId, auth.userId, pluginId, body))
          return
        }

        // POST /api/v1/channels/plugins/:id/delete
        const deleteMatch = pathname.match(/^\/api\/v1\/channels\/plugins\/([^/]+)\/delete$/)
        if (req.method === 'POST' && deleteMatch) {
          const pluginId = deleteMatch[1] || ''
          writeJson(res, 200, await channelsApi.disablePlugin(auth.orgId, auth.userId, pluginId))
          return
        }

        // GET /api/v1/channels/pairings/pending
        if (req.method === 'GET' && pathname === '/api/v1/channels/pairings/pending') {
          writeJson(res, 200, await channelsApi.getPendingPairings(auth.orgId, auth.userId))
          return
        }

        // POST /api/v1/channels/pairings/:code/approve
        const approveMatch = pathname.match(/^\/api\/v1\/channels\/pairings\/([^/]+)\/approve$/)
        if (req.method === 'POST' && approveMatch) {
          const code = approveMatch[1] || ''
          writeJson(res, 200, await channelsApi.approvePairing(auth.orgId, auth.userId, code))
          return
        }

        // POST /api/v1/channels/pairings/:code/reject
        const rejectMatch = pathname.match(/^\/api\/v1\/channels\/pairings\/([^/]+)\/reject$/)
        if (req.method === 'POST' && rejectMatch) {
          const code = rejectMatch[1] || ''
          writeJson(res, 200, await channelsApi.rejectPairing(auth.orgId, auth.userId, code))
          return
        }

        // GET /api/v1/channels/plugins/:id
        const pluginMatch = pathname.match(/^\/api\/v1\/channels\/plugins\/([^/]+)$/)
        if (req.method === 'GET' && pluginMatch) {
          const pluginId = pluginMatch[1] || ''
          const result = await channelsApi.getPlugin(auth.orgId, auth.userId, pluginId)
          if (!result) {
            throw new HttpError(404, 'Plugin not found')
          }
          writeJson(res, 200, result)
          return
        }

        // GET /api/v1/channels/plugins/:id/credentials
        const credMatch = pathname.match(/^\/api\/v1\/channels\/plugins\/([^/]+)\/credentials$/)
        if (req.method === 'GET' && credMatch) {
          const pluginId = credMatch[1] || ''
          const result = await channelsApi.getPluginCredentials(auth.orgId, auth.userId, pluginId)
          if (!result) {
            throw new HttpError(404, 'Plugin not found')
          }
          writeJson(res, 200, result)
          return
        }

        // POST /api/v1/channels/settings/sync
        if (req.method === 'POST' && pathname === '/api/v1/channels/settings/sync') {
          const body = await readJsonBody(req)
          writeJson(res, 200, await channelsApi.syncChannelSettings(auth.orgId, auth.userId, body))
          return
        }

        // GET /api/v1/channels/users
        if (req.method === 'GET' && pathname === '/api/v1/channels/users') {
          writeJson(res, 200, await channelsApi.getUsers(auth.orgId, auth.userId))
          return
        }

        // DELETE /api/v1/channels/users/:id
        const userDelMatch = pathname.match(/^\/api\/v1\/channels\/users\/([^/]+)$/)
        if (req.method === 'DELETE' && userDelMatch) {
          const targetId = userDelMatch[1] || ''
          writeJson(res, 200, await channelsApi.deleteUser(auth.orgId, auth.userId, targetId))
          return
        }

        // DELETE /api/v1/channels/users?platform=xxx
        if (req.method === 'DELETE' && pathname === '/api/v1/channels/users') {
          const urlObj = new URL(req.url as string, `http://${req.headers.host}`)
          const platformType = urlObj.searchParams.get('platform') || ''
          if (!platformType) {
            throw new HttpError(400, 'Missing platform parameter')
          }
          writeJson(res, 200, await channelsApi.deleteUsersByPlatform(auth.orgId, auth.userId, platformType))
          return
        }

        // GET /api/v1/channels/sessions
        if (req.method === 'GET' && pathname === '/api/v1/channels/sessions') {
          writeJson(res, 200, await channelsApi.getSessions(auth.orgId, auth.userId))
          return
        }

        // DELETE /api/v1/channels/sessions/:id
        const sessionDelMatch = pathname.match(/^\/api\/v1\/channels\/sessions\/([^/]+)$/)
        if (req.method === 'DELETE' && sessionDelMatch) {
          const sessionId = sessionDelMatch[1] || ''
          writeJson(res, 200, await channelsApi.deleteSession(auth.orgId, auth.userId, sessionId))
          return
        }

        // POST /api/v1/channels/wechat/qr-start
        if (req.method === 'POST' && pathname === '/api/v1/channels/wechat/qr-start') {
          writeJson(res, 200, await channelsApi.startWechatQrLogin())
          return
        }

        // GET /api/v1/channels/wechat/qr-poll?qrcode=xxx
        if (req.method === 'GET' && pathname === '/api/v1/channels/wechat/qr-poll') {
          const urlObj = new URL(req.url as string, `http://${req.headers.host}`)
          const qrcode = urlObj.searchParams.get('qrcode') || ''
          if (!qrcode) {
            throw new HttpError(400, 'Missing qrcode parameter')
          }
          writeJson(res, 200, await channelsApi.pollWechatQrStatus(qrcode))
          return
        }
      }

      if (req.method === 'POST' && pathname === '/api/v1/auth/introspect') {
        const body = await readJsonBody(req)
        const token = typeof body.token === 'string' ? body.token.trim() : ''
        if (!token) {
          throw new HttpError(400, 'Missing token')
        }
        writeJson(res, 200, authService.introspect(token))
        return
      }

      if ((req.method === 'GET' || isHead) && pathname === '/api/v1/tenant/config') {
        writeJson(res, 200, await enterpriseApi.getConfig())
        return
      }

      const auth = authenticateRequest(req, authService)
      if (!auth) {
        throw new HttpError(401, 'Unauthorized')
      }

      if (req.method === 'GET' && pathname === '/api/v1/roles') {
        authService.requireScope(auth, 'admin:users')
        writeJson(res, 200, authService.listRoles())
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/departments') {
        authService.requireScope(auth, 'admin:users')
        writeJson(res, 200, authService.listDepartments(auth.orgId, auth))
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/departments') {
        authService.requireScope(auth, 'admin:users')
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          authService.createDepartment({
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

      const departmentMatch = pathname.match(/^\/api\/v1\/departments\/([^/]+)$/)
      if (req.method === 'PATCH' && departmentMatch) {
        authService.requireScope(auth, 'admin:users')
        const departmentId = departmentMatch[1] || ''
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          authService.updateDepartment({
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
          authService.deleteDepartment({
            orgId: auth.orgId,
            departmentId,
          }),
        )
        return
      }

      // ============================================================
      // Document Center (P0): /api/v1/documents/* + /api/v1/wikis/*
      // ============================================================

      // ---- Tree nodes ----
      if (req.method === 'GET' && pathname === '/api/v1/documents/tree') {
        authService.requireScope(auth, 'admin:documents')
        writeJson(res, 200, { nodes: documentStore.listTree(auth.orgId) })
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/documents/tree/nodes') {
        authService.requireScope(auth, 'admin:documents')
        const body = await readJsonBody(req)
        try {
          const node = documentStore.createNode({
            orgId: auth.orgId,
            parentId:
              body.parent_id === null
                ? null
                : typeof body.parent_id === 'string'
                  ? body.parent_id
                  : null,
            name: typeof body.name === 'string' ? body.name.trim() : '',
            description: typeof body.description === 'string' ? body.description : undefined,
            sortOrder: typeof body.sort_order === 'number' ? body.sort_order : undefined,
          })
          if (!node.name) {
            writeJson(res, 400, { error: { code: 'invalid_payload', message: 'name is required' } })
            return
          }
          writeJson(res, 200, node)
        } catch (err) {
          writeJson(res, 400, { error: { code: 'create_failed', message: err instanceof Error ? err.message : String(err) } })
        }
        return
      }

      const documentNodeMatch = pathname.match(/^\/api\/v1\/documents\/tree\/nodes\/([^/]+)$/)
      if (req.method === 'PATCH' && documentNodeMatch) {
        authService.requireScope(auth, 'admin:documents')
        const nodeId = documentNodeMatch[1] || ''
        const body = await readJsonBody(req)
        try {
          const updated = documentStore.updateNode(nodeId, auth.orgId, {
            parentId:
              body.parent_id === undefined
                ? undefined
                : body.parent_id === null
                  ? null
                  : typeof body.parent_id === 'string'
                    ? body.parent_id
                    : undefined,
            name: typeof body.name === 'string' ? body.name : undefined,
            description:
              body.description === null
                ? null
                : typeof body.description === 'string'
                  ? body.description
                  : undefined,
            sortOrder: typeof body.sort_order === 'number' ? body.sort_order : undefined,
          })
          writeJson(res, 200, updated)
        } catch (err) {
          writeJson(res, 400, { error: { code: 'update_failed', message: err instanceof Error ? err.message : String(err) } })
        }
        return
      }

      if (req.method === 'DELETE' && documentNodeMatch) {
        authService.requireScope(auth, 'admin:documents')
        const nodeId = documentNodeMatch[1] || ''
        await documentStore.deleteNode(nodeId, auth.orgId)
        writeJson(res, 200, { ok: true })
        return
      }

      // ---- Documents (uploads) ----
      const documentsByNodeMatch = pathname.match(/^\/api\/v1\/documents\/tree\/nodes\/([^/]+)\/documents$/)
      if (req.method === 'GET' && documentsByNodeMatch) {
        authService.requireScope(auth, 'admin:documents')
        const nodeId = documentsByNodeMatch[1] || ''
        writeJson(res, 200, { documents: documentStore.listDocumentsForNode(nodeId, auth.orgId) })
        return
      }

      if (req.method === 'POST' && documentsByNodeMatch) {
        authService.requireScope(auth, 'admin:documents')
        const nodeId = documentsByNodeMatch[1] || ''
        const body = await readJsonBody(req)
        const fileName = typeof body.file_name === 'string' ? body.file_name : ''
        const mimeType = typeof body.mime_type === 'string' ? body.mime_type : 'application/octet-stream'
        const contentB64 = typeof body.content_base64 === 'string' ? body.content_base64 : ''
        if (!fileName || !contentB64) {
          writeJson(res, 400, { error: { code: 'invalid_payload', message: 'file_name and content_base64 are required' } })
          return
        }
        let content: Buffer
        try {
          content = Buffer.from(contentB64, 'base64')
        } catch {
          writeJson(res, 400, { error: { code: 'invalid_payload', message: 'content_base64 is not valid base64' } })
          return
        }
        // Size limit: 50MB per file
        const MAX_DOC_SIZE = 50 * 1024 * 1024
        if (content.byteLength > MAX_DOC_SIZE) {
          writeJson(res, 413, { error: { code: 'payload_too_large', message: `document exceeds 50MB limit` } })
          return
        }
        try {
          const doc = await documentStore.uploadDocument({
            orgId: auth.orgId,
            nodeId,
            fileName,
            mimeType,
            content,
            uploadedBy: auth.userId,
          })
          writeJson(res, 200, doc)
        } catch (err) {
          writeJson(res, 400, { error: { code: 'upload_failed', message: err instanceof Error ? err.message : String(err) } })
        }
        return
      }

      const documentItemMatch = pathname.match(/^\/api\/v1\/documents\/([^/]+)$/)
      if (req.method === 'DELETE' && documentItemMatch) {
        authService.requireScope(auth, 'admin:documents')
        const docId = documentItemMatch[1] || ''
        await documentStore.deleteDocument(docId, auth.orgId)
        writeJson(res, 200, { ok: true })
        return
      }

      // ---- Wikis ----
      if (req.method === 'GET' && pathname === '/api/v1/wikis') {
        authService.requireScope(auth, 'admin:documents')
        const url = new URL(req.url ?? '', 'http://localhost')
        const nodeId = url.searchParams.get('node_id') ?? undefined
        const buildStatus = url.searchParams.get('build_status') ?? undefined
        writeJson(res, 200, {
          wikis: documentStore.listWikis(auth.orgId, {
            nodeId,
            buildStatus: buildStatus as any,
          }),
        })
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/wikis') {
        authService.requireScope(auth, 'admin:documents')
        const body = await readJsonBody(req)
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!name) {
          writeJson(res, 400, { error: { code: 'invalid_payload', message: 'name is required' } })
          return
        }
        const sourceDocumentIds = Array.isArray(body.source_document_ids)
          ? body.source_document_ids.filter((v: unknown) => typeof v === 'string')
          : []
        try {
          const wiki = await documentStore.createWiki({
            orgId: auth.orgId,
            nodeId:
              body.node_id === null
                ? null
                : typeof body.node_id === 'string'
                  ? body.node_id
                  : null,
            name,
            description: typeof body.description === 'string' ? body.description : undefined,
            sourceDocumentIds,
            createdBy: auth.userId,
          })
          writeJson(res, 200, wiki)
        } catch (err) {
          writeJson(res, 400, { error: { code: 'create_failed', message: err instanceof Error ? err.message : String(err) } })
        }
        return
      }

      const wikiItemMatch = pathname.match(/^\/api\/v1\/wikis\/([^/]+)$/)
      if (req.method === 'GET' && wikiItemMatch) {
        authService.requireScope(auth, 'admin:documents')
        const wikiId = wikiItemMatch[1] || ''
        const wiki = documentStore.getWiki(wikiId, auth.orgId)
        if (!wiki) {
          writeJson(res, 404, { error: { code: 'not_found', message: 'wiki not found' } })
          return
        }
        writeJson(res, 200, wiki)
        return
      }

      if (req.method === 'PATCH' && wikiItemMatch) {
        authService.requireScope(auth, 'admin:documents')
        const wikiId = wikiItemMatch[1] || ''
        const body = await readJsonBody(req)
        try {
          const wiki = documentStore.updateWiki(wikiId, auth.orgId, {
            name: typeof body.name === 'string' ? body.name : undefined,
            description:
              body.description === null
                ? null
                : typeof body.description === 'string'
                  ? body.description
                  : undefined,
            nodeId:
              body.node_id === undefined
                ? undefined
                : body.node_id === null
                  ? null
                  : typeof body.node_id === 'string'
                    ? body.node_id
                    : undefined,
            sourceDocumentIds: Array.isArray(body.source_document_ids)
              ? body.source_document_ids.filter((v: unknown) => typeof v === 'string')
              : undefined,
          })
          writeJson(res, 200, wiki)
        } catch (err) {
          writeJson(res, 400, { error: { code: 'update_failed', message: err instanceof Error ? err.message : String(err) } })
        }
        return
      }

      if (req.method === 'DELETE' && wikiItemMatch) {
        authService.requireScope(auth, 'admin:documents')
        const wikiId = wikiItemMatch[1] || ''
        await documentStore.deleteWiki(wikiId, auth.orgId)
        writeJson(res, 200, { ok: true })
        return
      }

      // ---- Wiki Build ----
      const wikiBuildMatch = pathname.match(/^\/api\/v1\/wikis\/([^/]+)\/build$/)
      if (req.method === 'POST' && wikiBuildMatch) {
        authService.requireScope(auth, 'admin:documents')
        const wikiId = wikiBuildMatch[1] || ''
        const wiki = documentStore.getWiki(wikiId, auth.orgId)
        if (!wiki) {
          writeJson(res, 404, { error: { code: 'not_found', message: 'wiki not found' } })
          return
        }
        // P0: queue a build job. The actual worker (D5) will pick it up
        // and call RuntimeService.createSession. For now we just persist
        // the job; the placeholder build worker will be wired in next step.
        const job = documentStore.createBuildJob({
          wikiId,
          triggeredBy: auth.userId,
        })
        documentStore.setWikiBuildResult(wikiId, { status: 'pending' })
        writeJson(res, 200, { job_id: job.id, wiki_id: wikiId })
        return
      }

      const wikiBuildStatusMatch = pathname.match(/^\/api\/v1\/wikis\/([^/]+)\/build-status$/)
      if (req.method === 'GET' && wikiBuildStatusMatch) {
        authService.requireScope(auth, 'admin:documents')
        const wikiId = wikiBuildStatusMatch[1] || ''
        const wiki = documentStore.getWiki(wikiId, auth.orgId)
        if (!wiki) {
          writeJson(res, 404, { error: { code: 'not_found', message: 'wiki not found' } })
          return
        }
        const latestJob = documentStore.getLatestBuildJob(wikiId)
        writeJson(res, 200, {
          wiki_build_status: wiki.buildStatus,
          last_built_at: wiki.lastBuiltAt,
          last_build_error: wiki.lastBuildError,
          latest_job: latestJob,
        })
        return
      }

      // TODO: SSE endpoint for live build progress will be added in D7.

      // ---- Agent-facing wiki endpoints (called by wikiCli from inside scode container) ----
      // P0: scope check is admin:documents; later this will be replaced by SESSION_TOKEN auth.
      // TODO(D6): replace scope check with SESSION_TOKEN-based assistant_id resolution.
      if (req.method === 'GET' && pathname === '/api/v1/agent/wikis') {
        authService.requireScope(auth, 'admin:documents')
        // For P0 placeholder: list all wikis in the org. D6 will filter by
        // the assistant_id embedded in SESSION_TOKEN and the assistant's
        // enabledWikis array from _moss_meta.json.
        writeJson(res, 200, { wikis: documentStore.listWikis(auth.orgId) })
        return
      }

      const agentWikiFilesMatch = pathname.match(/^\/api\/v1\/agent\/wikis\/([^/]+)\/files$/)
      if (req.method === 'GET' && agentWikiFilesMatch) {
        authService.requireScope(auth, 'admin:documents')
        const wikiId = agentWikiFilesMatch[1] || ''
        const wiki = documentStore.getWiki(wikiId, auth.orgId)
        if (!wiki) {
          writeJson(res, 404, { error: { code: 'not_found', message: 'wiki not found' } })
          return
        }
        // List files in the wiki directory (P0: shallow only)
        try {
          const entries = await readdir(wiki.storagePath, { withFileTypes: true })
          const files = entries
            .filter(e => e.isFile() && (e.name.endsWith('.md') || e.name === '_moss_meta.json'))
            .map(e => e.name)
          writeJson(res, 200, { wiki_id: wikiId, files })
        } catch (err) {
          writeJson(res, 200, { wiki_id: wikiId, files: [] })
        }
        return
      }

      const agentWikiFileMatch = pathname.match(/^\/api\/v1\/agent\/wikis\/([^/]+)\/files\/(.+)$/)
      if (req.method === 'GET' && agentWikiFileMatch) {
        authService.requireScope(auth, 'admin:documents')
        const wikiId = agentWikiFileMatch[1] || ''
        const filePath = agentWikiFileMatch[2] || ''
        const wiki = documentStore.getWiki(wikiId, auth.orgId)
        if (!wiki) {
          writeJson(res, 404, { error: { code: 'not_found', message: 'wiki not found' } })
          return
        }
        // Path traversal guard
        const resolved = resolve(wiki.storagePath, filePath)
        if (!resolved.startsWith(resolve(wiki.storagePath) + sep) && resolved !== resolve(wiki.storagePath)) {
          writeJson(res, 400, { error: { code: 'invalid_path', message: 'path escapes wiki dir' } })
          return
        }
        try {
          const content = await readFile(resolved, 'utf-8')
          writeJson(res, 200, { wiki_id: wikiId, path: filePath, content })
        } catch {
          writeJson(res, 404, { error: { code: 'not_found', message: 'file not found' } })
        }
        return
      }

      const agentWikiSearchMatch = pathname.match(/^\/api\/v1\/agent\/wikis\/([^/]+)\/search$/)
      if (req.method === 'GET' && agentWikiSearchMatch) {
        authService.requireScope(auth, 'admin:documents')
        const wikiId = agentWikiSearchMatch[1] || ''
        const url = new URL(req.url ?? '', 'http://localhost')
        const query = url.searchParams.get('q') ?? ''
        if (!query) {
          writeJson(res, 400, { error: { code: 'invalid_payload', message: 'q is required' } })
          return
        }
        const wiki = documentStore.getWiki(wikiId, auth.orgId)
        if (!wiki) {
          writeJson(res, 404, { error: { code: 'not_found', message: 'wiki not found' } })
          return
        }
        // P0: simple grep across .md files in wiki dir
        try {
          const entries = await readdir(wiki.storagePath, { withFileTypes: true })
          const matches: Array<{ file: string; line_no: number; line: string }> = []
          const qLower = query.toLowerCase()
          for (const e of entries) {
            if (!e.isFile() || !e.name.endsWith('.md')) continue
            const content = await readFile(resolve(wiki.storagePath, e.name), 'utf-8')
            const lines = content.split(/\r?\n/)
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(qLower)) {
                matches.push({ file: e.name, line_no: i + 1, line: lines[i] })
                if (matches.length >= 100) break
              }
            }
            if (matches.length >= 100) break
          }
          writeJson(res, 200, { wiki_id: wikiId, query, matches })
        } catch (err) {
          writeJson(res, 200, { wiki_id: wikiId, query, matches: [] })
        }
        return
      }

      const agentWikiMetaMatch = pathname.match(/^\/api\/v1\/agent\/wikis\/([^/]+)\/metadata$/)
      if (req.method === 'GET' && agentWikiMetaMatch) {
        authService.requireScope(auth, 'admin:documents')
        const wikiId = agentWikiMetaMatch[1] || ''
        const wiki = documentStore.getWiki(wikiId, auth.orgId)
        if (!wiki) {
          writeJson(res, 404, { error: { code: 'not_found', message: 'wiki not found' } })
          return
        }
        // Count chunk files
        let chunkCount = 0
        try {
          const entries = await readdir(wiki.storagePath, { withFileTypes: true })
          chunkCount = entries.filter(e => e.isFile() && e.name.endsWith('.md') && e.name !== 'WIKI.md').length
        } catch {
          // dir not built yet
        }
        writeJson(res, 200, {
          wiki_id: wikiId,
          name: wiki.name,
          description: wiki.description,
          build_status: wiki.buildStatus,
          last_built_at: wiki.lastBuiltAt,
          source_document_count: wiki.sourceDocumentIds.length,
          chunk_count: chunkCount,
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/users') {
        authService.requireScope(auth, 'admin:users')
        writeJson(res, 200, authService.listUsers(auth.orgId, auth))
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/users') {
        authService.requireScope(auth, 'admin:users')
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          authService.createUser({
            orgId: auth.orgId,
            email: typeof body.email === 'string' ? body.email : '',
            name: typeof body.name === 'string' ? body.name : '',
            departmentId:
              body.department_id === null || typeof body.department_id === 'string'
                ? body.department_id
                : undefined,
            role: typeof body.role === 'string' ? body.role : 'user',
            password: typeof body.password === 'string' ? body.password : '',
          }, auth),
        )
        return
      }

      const userMatch = pathname.match(/^\/api\/v1\/users\/([^/]+)$/)
      if (req.method === 'PATCH' && userMatch) {
        authService.requireScope(auth, 'admin:users')
        const userId = userMatch[1] || ''
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          authService.updateUser({
            orgId: auth.orgId,
            userId,
            name: typeof body.name === 'string' ? body.name : undefined,
            departmentId:
              body.department_id === null || typeof body.department_id === 'string'
                ? body.department_id
                : undefined,
            role: typeof body.role === 'string' ? body.role : undefined,
            status:
              typeof body.status === 'string' ? body.status : undefined,
          }, auth),
        )
        return
      }

      const userPasswordMatch = pathname.match(/^\/api\/v1\/users\/([^/]+)\/password$/)
      if (req.method === 'POST' && userPasswordMatch) {
        authService.requireScope(auth, 'admin:users')
        const userId = userPasswordMatch[1] || ''
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          authService.setUserPassword({
            orgId: auth.orgId,
            userId,
            password: typeof body.password === 'string' ? body.password : '',
          }, auth),
        )
        return
      }

      const userTokenLimitMatch = pathname.match(/^\/api\/v1\/users\/([^/]+)\/token-limit$/)
      if (req.method === 'PATCH' && userTokenLimitMatch) {
        authService.requireScope(auth, 'admin:users')
        const userId = userTokenLimitMatch[1] || ''
        const body = await readJsonBody(req)
        const tokenLimit = body.tokenLimit === null ? null : Number(body.tokenLimit)
        writeJson(
          res,
          200,
          authService.setUserTokenLimit({
            orgId: auth.orgId,
            userId,
            tokenLimit: tokenLimit !== null && Number.isFinite(tokenLimit) ? tokenLimit : null,
          }, auth),
        )
        return
      }

      const departmentTokenLimitMatch = pathname.match(/^\/api\/v1\/departments\/([^/]+)\/token-limit$/)
      if (req.method === 'PATCH' && departmentTokenLimitMatch) {
        authService.requireScope(auth, 'admin:users')
        const departmentId = departmentTokenLimitMatch[1] || ''
        const body = await readJsonBody(req)
        const tokenLimit = body.tokenLimit === null ? null : Number(body.tokenLimit)
        writeJson(
          res,
          200,
          authService.setDepartmentTokenLimit({
            orgId: auth.orgId,
            departmentId,
            tokenLimit: tokenLimit !== null && Number.isFinite(tokenLimit) ? tokenLimit : null,
          }, auth),
        )
        return
      }

      const userSessionsMatch = pathname.match(/^\/api\/v1\/users\/([^/]+)\/sessions$/)
      if (req.method === 'GET' && userSessionsMatch) {
        authService.requireScope(auth, 'admin:users')
        const userId = userSessionsMatch[1] || ''
        const user = authService.getUserOrNull(userId, auth.orgId, auth)
        if (!user) {
          throw new HttpError(404, 'Unknown user_id')
        }
        writeJson(res, 200, {
          user,
          sessions: runtime.store
            .listUserSessions(auth.orgId, userId)
            .map(session => serializeSession(session)),
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/api-keys') {
        authService.requireScope(auth, 'admin:api_keys')
        writeJson(res, 200, authService.listApiKeys(auth.orgId, auth))
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/api-keys') {
        authService.requireScope(auth, 'admin:api_keys')
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          authService.createApiKey({
            orgId: auth.orgId,
            userId: typeof body.user_id === 'string' ? body.user_id : '',
            name: typeof body.name === 'string' ? body.name : '',
            scopes: Array.isArray(body.scopes)
              ? body.scopes.filter((scope): scope is string => typeof scope === 'string')
              : [],
          }, auth),
        )
        return
      }

      const apiKeyMatch = pathname.match(/^\/api\/v1\/api-keys\/([^/]+)$/)
      if (req.method === 'DELETE' && apiKeyMatch) {
        authService.requireScope(auth, 'admin:api_keys')
        const keyId = apiKeyMatch[1] || ''
        writeJson(res, 200, authService.revokeApiKey({ orgId: auth.orgId, keyId }, auth))
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/settings/system') {
        authService.requireScope(auth, 'admin:settings')
        writeJson(res, 200, getSystemSettings())
        return
      }

      if (req.method === 'PATCH' && pathname === '/api/v1/settings/system') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        writeJson(res, 200, updateSystemSettings(body))
        return
      }

      if (req.method === 'PATCH' && pathname === '/api/v1/settings/enterprise') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        writeJson(res, 200, await enterpriseApi.updateConfig(body))
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/upload/logo') {
        authService.requireScope(auth, 'admin:settings')
        const buffer = await readRawBody(req)
        const uploadDir = join(config.runtimeDir, 'uploads', 'enterprise')
        await mkdir(uploadDir, { recursive: true })

        const contentType = req.headers['content-type']
        let ext = '.png'
        if (typeof contentType === 'string') {
          const mime = contentType.split(';')[0].trim().toLowerCase()
          if (mime === 'image/png') {
            ext = '.png'
          } else if (mime === 'image/jpeg' || mime === 'image/jpg') {
            ext = '.jpg'
          } else if (mime === 'image/webp') {
            ext = '.webp'
          } else if (mime === 'image/svg+xml') {
            ext = '.svg'
          }
        }

        const filename = `logo_${Date.now()}${ext}`
        const filePath = join(uploadDir, filename)
        await writeFile(filePath, buffer)

        writeJson(res, 200, { success: true, data: { url: filename } })
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/agent-hub/categories') {
        authService.requireScope(auth, 'admin:settings')
        writeJson(res, 200, await fetchAgentHubCategories())
        return
      }

      if (
        req.method === 'GET' &&
        pathname === '/api/v1/agent-hub/assistants/cursor'
      ) {
        authService.requireScope(auth, 'admin:settings')
        const limitRaw = url.searchParams.get('limit')
        const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined

        writeJson(
          res,
          200,
          await fetchAgentHubAssistants({
            cursor: url.searchParams.get('cursor') || undefined,
            limit: Number.isFinite(limit) ? limit : undefined,
            query: url.searchParams.get('query') || undefined,
            category: url.searchParams.get('category') || undefined,
          }),
        )
        return
      }

      const agentHubDetailMatch = pathname.match(
        /^\/api\/v1\/agent-hub\/assistants\/([^/]+)$/,
      )
      if (req.method === 'GET' && agentHubDetailMatch) {
        authService.requireScope(auth, 'admin:settings')
        const assistantId = decodeURIComponent(agentHubDetailMatch[1] || '')
        writeJson(res, 200, await fetchAgentHubAssistantDetail(assistantId))
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/agent-hub/skills/by-ids') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        const skillIds = Array.isArray(body.skillIds)
          ? body.skillIds
              .map(skillId => String(skillId || '').trim())
              .filter(Boolean)
          : []
        writeJson(res, 200, await fetchAgentHubSkillDetailsByIds(skillIds))
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/agents/installed') {
        const filter = authService.buildVisibilityFilter(auth)
        const all = await getInstalledAssistants()
        writeJson(res, 200, all.filter(a => isVisibleTo(a.visibleTo, filter)))
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/agents/install') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        const assistantMeta = isJsonBody(body.assistantMeta)
          ? (body.assistantMeta as AgentHubAssistant)
          : null
        const selectedSkillIds = Array.isArray(body.selectedSkillIds)
          ? body.selectedSkillIds
              .map(skillId => String(skillId || '').trim())
              .filter(Boolean)
          : []

        writeJson(
          res,
          200,
          await installHubAssistant({
            assistantName:
              typeof body.assistantName === 'string' ? body.assistantName : '',
            sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : '',
            version: typeof body.version === 'string' ? body.version : undefined,
            checksum:
              typeof body.checksum === 'string' ? body.checksum : undefined,
            assistantMeta,
            selectedSkillIds,
          }),
        )
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/agents/create') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)

        const result = await createCustomAssistant({
          name: typeof body.name === 'string' ? body.name : '',
          displayName: typeof body.displayName === 'string' ? body.displayName : '',
          description: typeof body.description === 'string' ? body.description : undefined,
          avatar: typeof body.avatar === 'string' ? body.avatar : undefined,
          emoji: typeof body.emoji === 'string' ? body.emoji : undefined,
          rules: typeof body.rules === 'string' ? body.rules : '',
          skills: Array.isArray(body.skills)
            ? body.skills.filter((s): s is string => typeof s === 'string')
            : undefined,
          agent_type:
            body.agent_type === 'chat' || body.agent_type === 'workflow'
              ? body.agent_type
              : undefined,
          memory_mode:
            body.memory_mode === 'session' || body.memory_mode === 'user'
              ? body.memory_mode
              : undefined,
          visible_to:
            body.visible_to !== undefined
              ? (body.visible_to as AssistantStoreMeta['visible_to'])
              : undefined,
          workflow:
            body.workflow !== undefined
              ? (body.workflow as AssistantStoreMeta['workflow'])
              : undefined,
        })

        writeJson(res, 200, { success: true, data: result })
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/agents/uninstall') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        await uninstallAssistant({
          assistantName:
            typeof body.assistantName === 'string' ? body.assistantName : '',
          sourcePath:
            typeof body.sourcePath === 'string' ? body.sourcePath : undefined,
        })
        writeJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'PATCH' && pathname === '/api/v1/agents/meta') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        const updates = isJsonBody(body.updates) ? body.updates : {}

        await updateInstalledAssistantMeta({
          assistantName:
            typeof body.assistantName === 'string' ? body.assistantName : '',
          updates: {
            display_name:
              typeof updates.display_name === 'string'
                ? updates.display_name
                : undefined,
            description:
              typeof updates.description === 'string'
                ? updates.description
                : undefined,
            avatar:
              typeof updates.avatar === 'string' ? updates.avatar : undefined,
            emoji:
              typeof updates.emoji === 'string' ? updates.emoji : undefined,
            agent_type:
              updates.agent_type === 'chat' || updates.agent_type === 'workflow'
                ? updates.agent_type
                : undefined,
            memory_mode:
              updates.memory_mode === 'session' || updates.memory_mode === 'user'
                ? updates.memory_mode
                : undefined,
            visible_to:
              updates.visible_to !== undefined
                ? (updates.visible_to as AssistantStoreMeta['visible_to'])
                : undefined,
            workflow:
              updates.workflow !== undefined
                ? (updates.workflow as AssistantStoreMeta['workflow'])
                : undefined,
            enabledSkills:
              Array.isArray(updates.enabledSkills)
                ? updates.enabledSkills.filter((s: unknown) => typeof s === 'string')
                : undefined,
            enabledWikis:
              Array.isArray(updates.enabledWikis)
                ? updates.enabledWikis.filter((s: unknown) => typeof s === 'string')
                : undefined,
            skills:
              Array.isArray(updates.skills)
                ? updates.skills.filter((s: unknown) => typeof s === 'string')
                : undefined,
          },
        })
        writeJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'PATCH' && pathname === '/api/v1/agents/visibility') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        await updateInstalledAssistantMeta({
          assistantName: typeof body.assistantName === 'string' ? body.assistantName : '',
          updates: { visible_to: (body.visible_to ?? null) as AssistantStoreMeta['visible_to'] },
        })
        writeJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/agents/sync-from-hub') {
        authService.requireScope(auth, 'admin:settings')
        if (getAgentSyncProgress().status === 'running') {
          writeJson(res, 409, { error: 'Sync already in progress' })
          return
        }
        resetAgentSyncProgress()
        updateAgentSyncProgress({ status: 'running', startedAt: Date.now() })
        batchSyncAssistants({
          onProgress: (processed, total) => {
            updateAgentSyncProgress({ processed, total })
          },
        }).then(result => {
          updateAgentSyncProgress({
            status: 'done',
            total: result.installed.length + result.updated.length + result.skipped.length + result.failed.length,
            processed: result.installed.length + result.updated.length + result.skipped.length + result.failed.length,
            installed: result.installed.length,
            updated: result.updated.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
          })
        }).catch(err => {
          updateAgentSyncProgress({ status: 'error', error: err instanceof Error ? err.message : String(err) })
        })
        writeJson(res, 200, { started: true })
        return
      }

      // backward compat alias
      if (req.method === 'POST' && pathname === '/api/v1/agents/sync') {
        authService.requireScope(auth, 'admin:settings')
        if (getAgentSyncProgress().status === 'running') {
          writeJson(res, 409, { error: 'Sync already in progress' })
          return
        }
        resetAgentSyncProgress()
        updateAgentSyncProgress({ status: 'running', startedAt: Date.now() })
        batchSyncAssistants({
          onProgress: (processed, total) => {
            updateAgentSyncProgress({ processed, total })
          },
        }).then(result => {
          updateAgentSyncProgress({
            status: 'done',
            total: result.installed.length + result.updated.length + result.skipped.length + result.failed.length,
            processed: result.installed.length + result.updated.length + result.skipped.length + result.failed.length,
            installed: result.installed.length,
            updated: result.updated.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
          })
        }).catch(err => {
          updateAgentSyncProgress({ status: 'error', error: err instanceof Error ? err.message : String(err) })
        })
        writeJson(res, 200, { started: true })
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/agents/sync-status') {
        authService.requireScope(auth, 'admin:settings')
        writeJson(res, 200, getAgentSyncProgress())
        return
      }

      // POST /api/v1/agents/custom - Upload custom assistant
      if (req.method === 'POST' && pathname === '/api/v1/agents/custom') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        const fileBase64 = typeof body.file === 'string' ? body.file : ''
        const fileBuffer = Buffer.from(fileBase64, 'base64')
        const enabledSkills = Array.isArray(body.enabledSkills)
          ? body.enabledSkills.filter((s: unknown) => typeof s === 'string')
          : []
        const result = await uploadCustomAssistant({
          file: fileBuffer,
          name: typeof body.name === 'string' ? body.name : '',
          displayName: typeof body.displayName === 'string' ? body.displayName : '',
          description: typeof body.description === 'string' ? body.description : undefined,
          version: typeof body.version === 'string' ? body.version : undefined,
          enabledSkills,
          memoryMode: body.memoryMode === 'user' ? 'user' : 'session',
          userId: auth.userId,
        })
        writeJson(res, 200, result)
        return
      }

      // GET /api/v1/agents/tenant - List tenant assistants
      if (req.method === 'GET' && pathname === '/api/v1/agents/tenant') {
        const status = url.searchParams.get('status') || undefined
        const allRows = runtime.store.listTenantAssistants(status)
        // Filter by visibility for non-admin users
        const filter = authService.buildVisibilityFilter(auth)
        const isAdmin = hasScope(auth.scopes, 'admin:settings')
        const rows = allRows.filter((row: Record<string, unknown>) => {
          // Pending records are only visible to admins
          if (row.status === 'pending' && !isAdmin) return false
          // Approved records are filtered by visibility
          if (row.status === 'approved') {
            const visibleTo = typeof row.visible_to === 'string' ? JSON.parse(row.visible_to) : null
            return isVisibleTo(visibleTo, filter)
          }
          return true
        })
        writeJson(res, 200, rows)
        return
      }

      // GET /api/v1/agents/installed/:id/download - Download installed assistant
      const agentDownloadMatch = pathname.match(/^\/api\/v1\/agents\/installed\/([^/]+)\/download$/)
      if (req.method === 'GET' && agentDownloadMatch) {
        const assistantId = agentDownloadMatch[1] || ''
        try {
          const zipBuffer = await packageAssistantZip(assistantId)
          res.setHeader('Content-Type', 'application/zip')
          res.setHeader('Content-Disposition', `attachment; filename="${assistantId}.zip"`)
          res.end(zipBuffer)
        } catch (error) {
          throw new HttpError(404, `Assistant not found: ${assistantId}`)
        }
        return
      }

      // POST /api/v1/agents/tenant/publish - Publish tenant assistant request
      if (req.method === 'POST' && pathname === '/api/v1/agents/tenant/publish') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        const assistantName = typeof body.assistantName === 'string' ? body.assistantName : ''
        const assistantId = typeof body.assistantId === 'string' ? body.assistantId : assistantName
        const publishNote = typeof body.publishNote === 'string' ? body.publishNote : undefined

        // Check if assistant exists
        const assistantResult = await findAssistantDir(assistantId)
        if (!assistantResult) {
          throw new HttpError(404, `Assistant not found: ${assistantId}`)
        }

        // Read assistant metadata
        const meta = await readAssistantMeta(assistantResult.dir)

        // Get author name from user info
        const authorUser = authService.getUserOrNull(auth.userId, auth.orgId, auth)
        const authorName = authorUser?.name || undefined

        // Create tenant assistant record with metadata from source assistant
        const id = `tenant-assistant-${Date.now()}`
        runtime.store.createTenantAssistant({
          id,
          name: assistantId,
          display_name: meta?.display_name || assistantId,
          description: meta?.description || undefined,
          version: meta?.installed_version || undefined,
          enabled_skills: meta?.enabledSkills || meta?.skills ? JSON.stringify(meta?.enabledSkills || meta?.skills) : null,
          memory_mode: meta?.memory_mode || 'session',
          agent_type: meta?.agent_type || 'chat',
          publish_note: publishNote,
          author_id: auth.userId,
          author_name: authorName,
          status: 'pending',
        })
        writeJson(res, 200, { id, assistantId, status: 'pending', message: '发布申请已提交，等待管理员审批' })
        return
      }

      // POST /api/v1/admin/agents/tenant/:id/approve - Approve tenant assistant
      const agentApproveMatch = pathname.match(/^\/api\/v1\/admin\/agents\/tenant\/([^/]+)\/approve$/)
      if (req.method === 'POST' && agentApproveMatch) {
        authService.requireScope(auth, 'admin:settings')
        const tenantAssistantId = agentApproveMatch[1] || ''
        const body = await readJsonBody(req)
        const approved = body.approved === true
        const reviewNote = typeof body.reviewNote === 'string' ? body.reviewNote : undefined

        const tenantAssistant = runtime.store.getTenantAssistant(tenantAssistantId)
        if (!tenantAssistant) {
          throw new HttpError(404, `Tenant assistant not found: ${tenantAssistantId}`)
        }

        if (approved) {
          // Update status to approved
          runtime.store.updateTenantAssistantStatus(tenantAssistantId, 'approved', auth.userId, reviewNote)
          // Set visibility to all users (null)
          runtime.store.updateTenantAssistantMeta(tenantAssistantId, { visible_to: null })
          // Copy assistant to tenant directory
          const assistantName = tenantAssistant.name as string
          await copyAssistantToTenantDir(assistantName)
        } else {
          runtime.store.updateTenantAssistantStatus(tenantAssistantId, 'rejected', auth.userId, reviewNote)
        }

        writeJson(res, 200, { id: tenantAssistantId, status: approved ? 'approved' : 'rejected' })
        return
      }

      // PATCH /api/v1/agents/tenant/:id - Update tenant assistant meta
      const agentTenantPatchMatch = pathname.match(/^\/api\/v1\/agents\/tenant\/([^/]+)$/)
      if (req.method === 'PATCH' && agentTenantPatchMatch) {
        authService.requireScope(auth, 'admin:settings')
        const tenantAssistantId = agentTenantPatchMatch[1] || ''
        const body = await readJsonBody(req)

        const updates: { enabled?: number; visible_to?: string | null; enabled_skills?: string | null } = {}
        if (typeof body.enabled === 'boolean') {
          updates.enabled = body.enabled ? 1 : 0
        }
        if (body.visible_to !== undefined) {
          updates.visible_to = body.visible_to ? JSON.stringify(body.visible_to) : null
        }
        if (Array.isArray(body.enabledSkills)) {
          updates.enabled_skills = JSON.stringify(body.enabledSkills.filter((s: unknown) => typeof s === 'string'))
        }

        runtime.store.updateTenantAssistantMeta(tenantAssistantId, updates)

        // Sync enabled/visible_to/enabledSkills to file metadata
        const tenantAssistant = runtime.store.getTenantAssistant(tenantAssistantId)
        if (tenantAssistant && tenantAssistant.status === 'approved') {
          const assistantName = tenantAssistant.name as string
          const MOSS_HOME_LOCAL = process.env.MOSS_HOME || join(os.homedir(), '.moss')
          const ASSISTANT_TENANT_DIR = join(MOSS_HOME_LOCAL, 'assistants', 'tenant')
          const assistantDir = join(ASSISTANT_TENANT_DIR, assistantName)
          if (existsSync(assistantDir)) {
            const meta = await readAssistantMeta(assistantDir)
            if (meta) {
              if (updates.enabled !== undefined) {
                meta.enabled = updates.enabled === 1
              }
              if (body.visible_to !== undefined) {
                meta.visible_to = body.visible_to as VisibleTo | null
              }
              if (body.enabledSkills !== undefined) {
                meta.enabledSkills = body.enabledSkills as string[]
              }
              await writeAssistantMeta(assistantDir, meta)
            }
          }
        }

        writeJson(res, 200, { ok: true })
        return
      }

      // DELETE /api/v1/agents/tenant/:id - Delete tenant assistant
      if (req.method === 'DELETE' && agentTenantPatchMatch) {
        authService.requireScope(auth, 'admin:settings')
        const tenantAssistantId = agentTenantPatchMatch[1] || ''
        const tenantAssistant = runtime.store.getTenantAssistant(tenantAssistantId)
        if (tenantAssistant) {
          const assistantName = tenantAssistant.name as string
          // Delete from tenant directory if exists
          const MOSS_HOME = process.env.MOSS_HOME || join(os.homedir(), '.moss')
          const ASSISTANT_TENANT_DIR = join(MOSS_HOME, 'assistants', 'tenant')
          const assistantDir = join(ASSISTANT_TENANT_DIR, assistantName)
          if (existsSync(assistantDir)) {
            rmSync(assistantDir, { recursive: true, force: true })
          }
        }
        runtime.store.deleteTenantAssistant(tenantAssistantId)
        writeJson(res, 200, { ok: true })
        return
      }

      // GET /api/v1/agents/tenant/:id/download - Download tenant assistant
      const tenantAgentDownloadMatch = pathname.match(/^\/api\/v1\/agents\/tenant\/([^/]+)\/download$/)
      if (req.method === 'GET' && tenantAgentDownloadMatch) {
        const tenantAssistantId = tenantAgentDownloadMatch[1] || ''
        const tenantAssistant = runtime.store.getTenantAssistant(tenantAssistantId)
        if (!tenantAssistant || tenantAssistant.status !== 'approved') {
          throw new HttpError(404, `Tenant assistant not found or not approved: ${tenantAssistantId}`)
        }
        const assistantName = tenantAssistant.name as string
        try {
          const zipBuffer = await packageAssistantZip(assistantName)
          res.setHeader('Content-Type', 'application/zip')
          res.setHeader('Content-Disposition', `attachment; filename="${assistantName}.zip"`)
          res.end(zipBuffer)
        } catch (error) {
          throw new HttpError(404, `Assistant not found: ${assistantName}`)
        }
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/skill-hub/categories') {
        authService.requireScope(auth, 'admin:settings')
        writeJson(res, 200, await fetchSkillHubCategories())
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/skill-hub/skills/cursor') {
        authService.requireScope(auth, 'admin:settings')
        const category =
          typeof url.searchParams.get('category') === 'string'
            ? url.searchParams.get('category') || ''
            : typeof url.searchParams.get('categories') === 'string'
              ? url.searchParams.get('categories') || ''
              : ''
        const limitRaw = url.searchParams.get('limit')
        const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined

        writeJson(
          res,
          200,
          await fetchSkillHubSkills({
            cursor: url.searchParams.get('cursor') || undefined,
            limit: Number.isFinite(limit) ? limit : undefined,
            query: url.searchParams.get('query') || undefined,
            category: category || undefined,
            tenantId: url.searchParams.get('tenant_id') || undefined,
          }),
        )
        return
      }

      const skillHubDetailMatch = pathname.match(/^\/api\/v1\/skill-hub\/skills\/([^/]+)$/)
      if (req.method === 'GET' && skillHubDetailMatch) {
        authService.requireScope(auth, 'admin:settings')
        const skillId = decodeURIComponent(skillHubDetailMatch[1] || '')
        writeJson(res, 200, await fetchSkillHubSkillDetail(skillId))
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/skills/installed') {
        authService.requireScope(auth, 'admin:settings')
        const filter = authService.buildVisibilityFilter(auth)
        const all = await getInstalledSkills()
        writeJson(res, 200, all.filter(s => isVisibleTo(s.visibleTo, filter)))
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/skills/install') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        const skillMeta = isJsonBody(body.skillMeta)
          ? (body.skillMeta as SkillHubSkill)
          : null
        writeJson(
          res,
          200,
          await installHubSkill({
            skillName: typeof body.skillName === 'string' ? body.skillName : '',
            sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : '',
            version: typeof body.version === 'string' ? body.version : undefined,
            checksum:
              typeof body.checksum === 'string' ? body.checksum : undefined,
            skillMeta,
          }),
        )
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/skills/uninstall') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        await uninstallSkill({
          skillName: typeof body.skillName === 'string' ? body.skillName : '',
          sourcePath:
            typeof body.sourcePath === 'string' ? body.sourcePath : undefined,
        })
        writeJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'PATCH' && pathname === '/api/v1/skills/enabled') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        if (typeof body.enabled !== 'boolean') {
          throw new HttpError(400, 'enabled must be a boolean')
        }
        await setInstalledSkillEnabled({
          skillName: typeof body.skillName === 'string' ? body.skillName : '',
          enabled: body.enabled,
          sourcePath:
            typeof body.sourcePath === 'string' ? body.sourcePath : undefined,
        })
        writeJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/skills/import/archive') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        writeJson(
          res,
          200,
          await importLocalSkillArchive({
            fileName: typeof body.fileName === 'string' ? body.fileName : '',
            archiveBase64:
              typeof body.archiveBase64 === 'string' ? body.archiveBase64 : '',
          }),
        )
        return
      }

      if (
        req.method === 'POST' &&
        pathname === '/api/v1/skills/import/directory'
      ) {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        const entries = Array.isArray(body.entries)
          ? body.entries
              .filter(isJsonBody)
              .map(entry => ({
                path: typeof entry.path === 'string' ? entry.path : '',
                contentBase64:
                  typeof entry.contentBase64 === 'string'
                    ? entry.contentBase64
                    : '',
              }))
              .filter(entry => entry.path && entry.contentBase64)
          : []
        writeJson(
          res,
          200,
          await importLocalSkillDirectory({
            entries,
          }),
        )
        return
      }

      if (req.method === 'PATCH' && pathname === '/api/v1/skills/visibility') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        const skillName =
          typeof body.skillName === 'string' ? body.skillName : ''
        const visibleTo = body.visible_to ?? null
        await setInstalledSkillMeta(skillName, {
          visible_to: visibleTo as SkillStoreMeta['visible_to'],
        })
        writeJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/skills/sync-from-hub') {
        authService.requireScope(auth, 'admin:settings')
        if (getSkillSyncProgress().status === 'running') {
          writeJson(res, 409, { error: 'Sync already in progress' })
          return
        }
        const body = await readJsonBody(req)
        const tenantId =
          typeof body.tenantId === 'string' ? body.tenantId : undefined
        resetSkillSyncProgress()
        updateSkillSyncProgress({ status: 'running', startedAt: Date.now() })
        batchSyncSkills({
          tenantId,
          onProgress: (processed, total) => {
            updateSkillSyncProgress({ processed, total })
          },
        }).then(result => {
          updateSkillSyncProgress({
            status: 'done',
            total: result.installed.length + result.updated.length + result.skipped.length + result.failed.length,
            processed: result.installed.length + result.updated.length + result.skipped.length + result.failed.length,
            installed: result.installed.length,
            updated: result.updated.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
          })
        }).catch(err => {
          updateSkillSyncProgress({ status: 'error', error: err instanceof Error ? err.message : String(err) })
        })
        writeJson(res, 200, { started: true })
        return
      }

      // backward compat alias
      if (req.method === 'POST' && pathname === '/api/v1/skills/sync') {
        authService.requireScope(auth, 'admin:settings')
        if (getSkillSyncProgress().status === 'running') {
          writeJson(res, 409, { error: 'Sync already in progress' })
          return
        }
        const body = await readJsonBody(req)
        const tenantId =
          typeof body.tenantId === 'string' ? body.tenantId : undefined
        resetSkillSyncProgress()
        updateSkillSyncProgress({ status: 'running', startedAt: Date.now() })
        batchSyncSkills({
          tenantId,
          onProgress: (processed, total) => {
            updateSkillSyncProgress({ processed, total })
          },
        }).then(result => {
          updateSkillSyncProgress({
            status: 'done',
            total: result.installed.length + result.updated.length + result.skipped.length + result.failed.length,
            processed: result.installed.length + result.updated.length + result.skipped.length + result.failed.length,
            installed: result.installed.length,
            updated: result.updated.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
          })
        }).catch(err => {
          updateSkillSyncProgress({ status: 'error', error: err instanceof Error ? err.message : String(err) })
        })
        writeJson(res, 200, { started: true })
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/skills/sync-status') {
        authService.requireScope(auth, 'admin:settings')
        writeJson(res, 200, getSkillSyncProgress())
        return
      }

      // POST /api/v1/skills/custom - Upload custom skill
      if (req.method === 'POST' && pathname === '/api/v1/skills/custom') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        const fileBase64 = typeof body.file === 'string' ? body.file : ''
        const fileBuffer = Buffer.from(fileBase64, 'base64')
        const result = await uploadCustomSkill({
          file: fileBuffer,
          name: typeof body.name === 'string' ? body.name : '',
          displayName: typeof body.displayName === 'string' ? body.displayName : '',
          description: typeof body.description === 'string' ? body.description : undefined,
          version: typeof body.version === 'string' ? body.version : undefined,
          userId: auth.userId,
        })
        writeJson(res, 200, result)
        return
      }

      // GET /api/v1/skills/tenant - List tenant skills
      if (req.method === 'GET' && pathname === '/api/v1/skills/tenant') {
        const status = url.searchParams.get('status') || undefined
        const allRows = runtime.store.listTenantSkills(status)
        // Filter by visibility for non-admin users
        const filter = authService.buildVisibilityFilter(auth)
        const isAdmin = hasScope(auth.scopes, 'admin:settings')
        const rows = allRows.filter((row: Record<string, unknown>) => {
          // Pending records are only visible to admins
          if (row.status === 'pending' && !isAdmin) return false
          // Approved records are filtered by visibility
          if (row.status === 'approved') {
            const visibleTo = typeof row.visible_to === 'string' ? JSON.parse(row.visible_to) : null
            return isVisibleTo(visibleTo, filter)
          }
          return true
        })
        writeJson(res, 200, rows)
        return
      }

      // GET /api/v1/skills/installed/:id/download - Download installed skill
      const skillDownloadMatch = pathname.match(/^\/api\/v1\/skills\/installed\/([^/]+)\/download$/)
      if (req.method === 'GET' && skillDownloadMatch) {
        const skillId = skillDownloadMatch[1] || ''
        try {
          const zipBuffer = await packageSkillZip(skillId)
          res.setHeader('Content-Type', 'application/zip')
          res.setHeader('Content-Disposition', `attachment; filename="${skillId}.zip"`)
          res.end(zipBuffer)
        } catch (error) {
          throw new HttpError(404, `Skill not found: ${skillId}`)
        }
        return
      }

      // POST /api/v1/skills/tenant/publish - Publish tenant skill request
      if (req.method === 'POST' && pathname === '/api/v1/skills/tenant/publish') {
        authService.requireScope(auth, 'admin:settings')
        const body = await readJsonBody(req)
        const skillName = typeof body.skillName === 'string' ? body.skillName : ''
        const skillId = typeof body.skillId === 'string' ? body.skillId : skillName
        const publishNote = typeof body.publishNote === 'string' ? body.publishNote : undefined

        // Check if skill exists in custom directory
        const skillPath = await findInstalledSkillPath(skillId)
        if (!skillPath) {
          throw new HttpError(404, `Skill not found: ${skillId}`)
        }

        // Read skill metadata
        const meta = await readSkillMeta(skillPath)
        const version = await readSkillVersion(skillPath)

        // Get author name from user info
        const authorUser = authService.getUserOrNull(auth.userId, auth.orgId, auth)
        const authorName = authorUser?.name || undefined

        // Create tenant skill record with metadata from source skill
        const id = `tenant-skill-${Date.now()}`
        runtime.store.createTenantSkill({
          id,
          name: skillId,
          display_name: meta?.display_name || skillId,
          description: meta?.description || undefined,
          version: version || meta?.installed_version || undefined,
          publish_note: publishNote,
          author_id: auth.userId,
          author_name: authorName,
          status: 'pending',
        })
        writeJson(res, 200, { id, skillId, status: 'pending', message: '发布申请已提交，等待管理员审批' })
        return
      }

      // POST /api/v1/admin/skills/tenant/:id/approve - Approve tenant skill
      const skillApproveMatch = pathname.match(/^\/api\/v1\/admin\/skills\/tenant\/([^/]+)\/approve$/)
      if (req.method === 'POST' && skillApproveMatch) {
        authService.requireScope(auth, 'admin:settings')
        const tenantSkillId = skillApproveMatch[1] || ''
        const body = await readJsonBody(req)
        const approved = body.approved === true
        const reviewNote = typeof body.reviewNote === 'string' ? body.reviewNote : undefined

        const tenantSkill = runtime.store.getTenantSkill(tenantSkillId)
        if (!tenantSkill) {
          throw new HttpError(404, `Tenant skill not found: ${tenantSkillId}`)
        }

        if (approved) {
          // Update status to approved
          runtime.store.updateTenantSkillStatus(tenantSkillId, 'approved', auth.userId, reviewNote)
          // Set visibility to all users (null)
          runtime.store.updateTenantSkillMeta(tenantSkillId, { visible_to: null })
          // Copy skill to tenant directory
          const skillName = tenantSkill.name as string
          await copySkillToTenantDir(skillName)
        } else {
          runtime.store.updateTenantSkillStatus(tenantSkillId, 'rejected', auth.userId, reviewNote)
        }

        writeJson(res, 200, { id: tenantSkillId, status: approved ? 'approved' : 'rejected' })
        return
      }

      // PATCH /api/v1/skills/tenant/:id - Update tenant skill meta
      const skillTenantPatchMatch = pathname.match(/^\/api\/v1\/skills\/tenant\/([^/]+)$/)
      if (req.method === 'PATCH' && skillTenantPatchMatch) {
        authService.requireScope(auth, 'admin:settings')
        const tenantSkillId = skillTenantPatchMatch[1] || ''
        const body = await readJsonBody(req)

        const updates: { enabled?: number; visible_to?: string | null } = {}
        if (typeof body.enabled === 'boolean') {
          updates.enabled = body.enabled ? 1 : 0
        }
        if (body.visible_to !== undefined) {
          updates.visible_to = body.visible_to ? JSON.stringify(body.visible_to) : null
        }

        runtime.store.updateTenantSkillMeta(tenantSkillId, updates)

        // Sync enabled/visible_to to file metadata
        const tenantSkill = runtime.store.getTenantSkill(tenantSkillId)
        if (tenantSkill && tenantSkill.status === 'approved') {
          const skillName = tenantSkill.name as string
          const skillDir = join(MOSS_SKILLS_TENANT_DIR, skillName)
          if (existsSync(skillDir)) {
            const meta = await readSkillMeta(skillDir)
            if (meta) {
              if (updates.enabled !== undefined) {
                meta.enabled = updates.enabled === 1
              }
              if (body.visible_to !== undefined) {
                meta.visible_to = body.visible_to || null
              }
              await writeSkillMeta(skillDir, meta)
            }
          }
        }

        writeJson(res, 200, { ok: true })
        return
      }

      // DELETE /api/v1/skills/tenant/:id - Delete tenant skill
      if (req.method === 'DELETE' && skillTenantPatchMatch) {
        authService.requireScope(auth, 'admin:settings')
        const tenantSkillId = skillTenantPatchMatch[1] || ''
        const tenantSkill = runtime.store.getTenantSkill(tenantSkillId)
        if (tenantSkill) {
          const skillName = tenantSkill.name as string
          // Delete from tenant directory if exists
          const skillDir = join(MOSS_SKILLS_TENANT_DIR, skillName)
          if (existsSync(skillDir)) {
            rmSync(skillDir, { recursive: true, force: true })
          }
        }
        runtime.store.deleteTenantSkill(tenantSkillId)
        writeJson(res, 200, { ok: true })
        return
      }

      // GET /api/v1/skills/tenant/:id/download - Download tenant skill
      const tenantSkillDownloadMatch = pathname.match(/^\/api\/v1\/skills\/tenant\/([^/]+)\/download$/)
      if (req.method === 'GET' && tenantSkillDownloadMatch) {
        const tenantSkillId = tenantSkillDownloadMatch[1] || ''
        const tenantSkill = runtime.store.getTenantSkill(tenantSkillId)
        if (!tenantSkill || tenantSkill.status !== 'approved') {
          throw new HttpError(404, `Tenant skill not found or not approved: ${tenantSkillId}`)
        }
        const skillName = tenantSkill.name as string
        try {
          const zipBuffer = await packageSkillZip(skillName)
          res.setHeader('Content-Type', 'application/zip')
          res.setHeader('Content-Disposition', `attachment; filename="${skillName}.zip"`)
          res.end(zipBuffer)
        } catch (error) {
          throw new HttpError(404, `Skill not found: ${skillName}`)
        }
        return
      }

      if (pathname === '/api/v1/adapters/all') {
        authService.requireScope(auth, 'admin:settings')
        const rows = adaptersApi.listAll(auth.orgId)
        writeJson(res, 200, rows)
        return
      }

      if (pathname === '/api/v1/adapters') {
        const targetUserId = resolveAdapterTargetUserId(
          auth,
          authService,
          url.searchParams.get('userId'),
        )
        if (req.method === 'GET') {
          const result = adaptersApi.list(auth.orgId, targetUserId)
          writeJson(res, 200, result)
          return
        }
        if (req.method === 'PUT') {
          const body = await readJsonBody(req)
          const {
            platform: rawPlatform,
            userId: _ignoredUserId,
            ...patch
          } = body
          const platform =
            rawPlatform === 'feishu' ? 'feishu' : 'telegram'
          const result = adaptersApi.upsert(
            auth.orgId,
            targetUserId,
            platform,
            patch as Record<string, unknown>,
          )
          if ('error' in result) {
            writeJson(res, 400, result)
            return
          }
          writeJson(res, 200, result)
          return
        }
        throw new HttpError(405, `Method ${req.method} not allowed`)
      }

      // PUT /api/v1/adapters/:platform — platform-specific upsert
      const adapterPlatformMatch = pathname.match(/^\/api\/v1\/adapters\/(telegram|feishu)$/)
      if (adapterPlatformMatch) {
        const platform = adapterPlatformMatch[1]!
        const targetUserId = resolveAdapterTargetUserId(
          auth,
          authService,
          url.searchParams.get('userId'),
        )

        if (req.method === 'GET') {
          const result = adaptersApi.list(auth.orgId, targetUserId)
          writeJson(res, 200, result)
          return
        }
        if (req.method === 'PUT') {
          const body = await readJsonBody(req)
          const {
            userId: _ignoredUserId,
            platform: _ignoredPlatform,
            ...patch
          } = body
          const result = adaptersApi.upsert(
            auth.orgId,
            targetUserId,
            platform,
            patch as Record<string, unknown>,
          )
          if ('error' in result) {
            writeJson(res, 400, result)
            return
          }
          writeJson(res, 200, result)
          return
        }
        if (req.method === 'DELETE') {
          const result = adaptersApi.remove(auth.orgId, targetUserId, platform)
          writeJson(res, 200, result)
          return
        }
        throw new HttpError(405, `Method ${req.method} not allowed`)
      }

      if (pathname === '/api/v1/adapters/processes') {
        const targetUserId = resolveAdapterTargetUserId(
          auth,
          authService,
          url.searchParams.get('userId'),
        )
        writeJson(
          res,
          200,
          listAdapterProcessStatusesForUser(auth.orgId, targetUserId),
        )
        return
      }

      if (pathname === '/api/v1/adapters/processes/restart' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const adapter = typeof body.adapter === 'string' ? body.adapter : ''
        const userId = resolveAdapterTargetUserId(
          auth,
          authService,
          typeof body.userId === 'string' ? body.userId : undefined,
        )
        if (adapter !== 'telegram' && adapter !== 'feishu') {
          throw new HttpError(400, 'Invalid adapter name, must be "telegram" or "feishu"')
        }
        await adapterProcessManager.restart(adapter as 'telegram' | 'feishu', auth.orgId, userId)
        writeJson(res, 200, { ok: true })
        return
      }

      if (pathname === '/api/v1/adapters/processes/start' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const adapter = typeof body.adapter === 'string' ? body.adapter : ''
        const userId = resolveAdapterTargetUserId(
          auth,
          authService,
          typeof body.userId === 'string' ? body.userId : undefined,
        )
        if (adapter !== 'telegram' && adapter !== 'feishu') {
          throw new HttpError(400, 'Invalid adapter name, must be "telegram" or "feishu"')
        }
        await adapterProcessManager.start(adapter as 'telegram' | 'feishu', auth.orgId, userId)
        writeJson(res, 200, { ok: true })
        return
      }

      if (pathname === '/api/v1/adapters/processes/stop' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const adapter = typeof body.adapter === 'string' ? body.adapter : ''
        const userId = resolveAdapterTargetUserId(
          auth,
          authService,
          typeof body.userId === 'string' ? body.userId : undefined,
        )
        if (adapter !== 'telegram' && adapter !== 'feishu') {
          throw new HttpError(400, 'Invalid adapter name, must be "telegram" or "feishu"')
        }
        await adapterProcessManager.stop(adapter as 'telegram' | 'feishu', auth.orgId, userId)
        writeJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/sessions') {
        authService.requireAnyScope(auth, ['sessions:list', 'sessions:list:any'])
        const activeOnly = url.searchParams.get('active_only') === 'true'
        const sessions = runtime.listSessions({
          orgId: auth.orgId,
          userId: hasScope(auth.scopes, 'sessions:list:any') ? undefined : auth.userId,
          activeOnly,
        })
        writeJson(res, 200, { sessions })
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/dashboard/stats') {
        authService.requireAnyScope(auth, ['sessions:list', 'sessions:list:any'])
        const from = parseOptionalTimestampQuery(
          url.searchParams.get('from'),
          'from',
        )
        const to = parseOptionalTimestampQuery(url.searchParams.get('to'), 'to')
        if (from !== null && to !== null && from > to) {
          throw new HttpError(400, 'Invalid dashboard stats range')
        }

        const sessions = runtime
          .listSessionRecords({
            orgId: auth.orgId,
            userId: hasScope(auth.scopes, 'sessions:list:any')
              ? undefined
              : auth.userId,
          })
          .filter(session => {
            if (from !== null && session.createdAt < from) {
              return false
            }
            if (to !== null && session.createdAt > to) {
              return false
            }
            return true
          })

        const stats = await loadDashboardStats(sessions)
        writeJson(res, 200, stats)
        return
      }

      if (req.method === 'GET' && pathname === '/api/v1/budget/stats') {
        authService.requireAnyScope(auth, ['sessions:list', 'sessions:list:any'])
        const sessions = runtime.listSessionRecords({
          orgId: auth.orgId,
          userId: hasScope(auth.scopes, 'sessions:list:any')
            ? undefined
            : auth.userId,
        })

        const stats = await loadBudgetStats(sessions)
        writeJson(res, 200, stats)
        return
      }

      const sessionContextMatch = pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/context$/)
      if (req.method === 'GET' && sessionContextMatch) {
        const sessionId = sessionContextMatch[1] || ''
        const session = runtime.getSession(sessionId)
        if (!session) {
          throw new HttpError(404, 'Session not found')
        }
        if (!canAccessSession(auth, session, 'sessions:attach:any')) {
          throw new HttpError(403, 'Forbidden')
        }
        const context = await loadSessionContextFromTranscript(session)
        if (!context) {
          throw new HttpError(404, 'Session context not found')
        }
        writeJson(res, 200, {
          session: serializeSession(session),
          usage: context.usage,
          context: {
            customTitle: context.customTitle,
            tag: context.tag,
            summary: context.summary,
            messages: context.messages,
          },
        })
        return
      }

      const sessionResumeMatch = pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/resume$/)
      if (req.method === 'POST' && sessionResumeMatch) {
        const sessionId = sessionResumeMatch[1] || ''
        const session = runtime.getSession(sessionId)
        if (!session) {
          throw new HttpError(404, 'Session not found')
        }
        if (!canAccessSession(auth, session, 'sessions:attach:any')) {
          throw new HttpError(403, 'Forbidden')
        }
        const ready = await runtime.ensureSessionReady(sessionId)
        writeJson(res, 200, {
          session: serializeSession(ready.session),
          ws_url: buildWsUrl(server, config, sessionId),
        })
        return
      }

      const sessionTerminateMatch = pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/terminate$/)
      if (req.method === 'POST' && sessionTerminateMatch) {
        const sessionId = sessionTerminateMatch[1] || ''
        const session = runtime.getSession(sessionId)
        if (!session) {
          throw new HttpError(404, 'Session not found')
        }
        if (!canAccessSession(auth, session, 'sessions:terminate:any')) {
          throw new HttpError(403, 'Forbidden')
        }
        await runtime.terminateSession(sessionId)
        writeJson(res, 200, { ok: true })
        return
      }

      const sessionIdMatch = pathname.match(/^\/api\/v1\/sessions\/([^/]+)$/)
      if (req.method === 'GET' && sessionIdMatch) {
        const sessionId = sessionIdMatch[1] || ''
        const session = runtime.getSession(sessionId)
        if (!session) {
          throw new HttpError(404, 'Session not found')
        }
        if (!canAccessSession(auth, session, 'sessions:attach:any')) {
          throw new HttpError(403, 'Forbidden')
        }
        const ready =
          session.desiredState === 'active'
            ? await runtime.ensureSessionReady(sessionId)
            : { session, attempt: null }
        writeJson(res, 200, {
          session: serializeSession(ready.session),
          ws_url: buildWsUrl(server, config, ready.session.sessionId),
        })
        return
      }

      if (req.method === 'POST' && pathname === '/api/v1/sessions') {
        authService.requireScope(auth, 'sessions:create')
        const body = await readJsonBody(req)
        const fallbackCwd = config.workspace || process.cwd()
        const normalizeCwd = (p: string) => p === '/' ? os.homedir() : p
        const requestedCwd =
          typeof body.cwd === 'string' && body.cwd.trim()
            ? body.cwd
            : fallbackCwd
        const cwd = normalizeCwd(existsSync(requestedCwd) ? requestedCwd : fallbackCwd)
        const dangerouslySkipPermissions =
          body.dangerously_skip_permissions === true
        const runtimeOptions = parseRuntimeOptions(body)
        const assistantName =
          typeof body.assistant_name === 'string' && body.assistant_name.trim()
            ? body.assistant_name.trim()
            : undefined
        const created = await runtime.createSession({
          cwd,
          dangerouslySkipPermissions,
          userId: auth.userId,
          orgId: auth.orgId,
          role: auth.role,
          scopes: auth.scopes,
          runtime: runtimeOptions,
          assistantName,
        })
        writeJson(res, 200, {
          session_id: created.sessionId,
          ws_url: buildWsUrl(server, config, created.sessionId),
          work_dir: created.cwd,
          runtime: created.runtime,
        })
        return
      }

      throw new HttpError(404, 'Not found')
    } catch (error) {
      writeError(logger, res, error)
    }
  })

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      try {
        process.stderr.write(`[WS Upgrade] Incoming request: ${req.url}\n`)
        let token = getBearerToken(req)
        let auth = token ? authService.verifyAccessToken(token) : null

        // If access_token is expired, try refreshing with refresh_token from query param
        if (token && !auth) {
          const url = new URL(req.url || '/', 'http://localhost')
          const refreshToken = url.searchParams.get('refresh_token')
          if (refreshToken) {
            try {
              const refreshed = authService.refreshToken(refreshToken)
              auth = authService.verifyAccessToken(refreshed.access_token)
              if (auth) {
                token = refreshed.access_token
                process.stderr.write(`[WS Upgrade] Token refreshed successfully for user: ${auth.userId}\n`)
              }
            } catch (refreshError) {
              process.stderr.write(`[WS Upgrade] Token refresh failed: ${refreshError}\n`)
            }
          }
        }

        if (!auth) {
          process.stderr.write(`[WS Upgrade Auth Failed v2] Token: ${token ? (token.slice(0, 10) + '...') : 'MISSING'}, URL: ${req.url}\n`)
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
          socket.destroy()
          return
        }

        process.stderr.write(`[WS Upgrade Auth Success v2] User: ${auth.userId}, Org: ${auth.orgId}\n`)

        const url = new URL(req.url || '/', 'http://localhost')
        const pathname = url.pathname

        // Handle /ws/sessions/:sessionId for session WebSocket
        const match = pathname.match(/^\/ws\/sessions\/([^/]+)$/)
        if (!match) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
          socket.destroy()
          return
        }

        const sessionId = match[1] || ''
        const session = runtime.getSession(sessionId)
        if (!session) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
          socket.destroy()
          return
        }
        if (!canAccessSession(auth, session, 'sessions:attach:any')) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
          socket.destroy()
          return
        }

        const ready = await runtime.ensureSessionReady(sessionId)
        wss.handleUpgrade(req, socket, head, ws => {
          void runtime.connectToAttempt(ready.attempt).then((runnerSocket: net.Socket) => {
            let buffer = ''
            const sendToRunner = (payload: Record<string, unknown>) => {
              if (!runnerSocket.destroyed) {
                runnerSocket.write(`${jsonStringify(payload)}\n`)
              }
            }

            ws.on('message', data => {
              const text =
                typeof data === 'string'
                  ? data
                  : Buffer.from(data).toString('utf8')
              sendToRunner({
                type: 'stdin',
                data: text.endsWith('\n') ? text : `${text}\n`,
              })
            })
            ws.on('close', () => {
              runnerSocket.destroy()
            })
            ws.on('error', () => {
              runnerSocket.destroy()
            })

            runnerSocket.on('data', chunk => {
              buffer += Buffer.from(chunk).toString('utf8')
              while (true) {
                const idx = buffer.indexOf('\n')
                if (idx < 0) {
                  break
                }
                const line = buffer.slice(0, idx)
                buffer = buffer.slice(idx + 1)
                if (!line.trim()) {
                  continue
                }

                let parsed: { type?: string; line?: string }
                try {
                  parsed = jsonParse(line) as { type?: string; line?: string }
                } catch {
                  continue
                }

                if (parsed.type === 'stdout' && typeof parsed.line === 'string') {
                  if (ws.readyState === ws.OPEN) {
                    ws.send(parsed.line)
                  }
                }
                if (parsed.type === 'exit') {
                  ws.close()
                }
              }
            })

            runnerSocket.on('close', () => {
              if (ws.readyState === ws.OPEN) {
                ws.close()
              }
            })
            runnerSocket.on('error', () => {
              if (ws.readyState === ws.OPEN) {
                ws.close()
              }
            })

            wss.emit('connection', ws, req)
          }).catch(error => {
            logger.error(error instanceof Error ? error.message : String(error))
            ws.close()
          })
        })
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error))
        socket.destroy()
      }
    })()
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

  server.listen(config.port, config.host)

  return {
    port: null,
    ready,
    stop: async () => {
      wss.close()
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
