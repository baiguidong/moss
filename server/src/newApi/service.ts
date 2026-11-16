import { randomBytes, createHash } from 'node:crypto'
import { ServerCredentialStore } from '../security/credentialStore.js'
import type { AuthContext } from '../auth/token.js'
import type { ServerConfig } from '../types.js'
import { getSystemSettings } from '../systemSettings.js'

type NewAPIUsage = Record<string, unknown>
type MossUsers = {
  getUserByIdAndOrg(userId: string, orgId: string): Promise<{ name: string } | null>
}
type NewAPIAccount = {
  userId: number
  username: string
  password: string
  apiKey: string
  tokenId: number
}

const NEW_API_QUOTA_PER_USD = 500_000

function quotaValue(usage: NewAPIUsage, name: 'total_available' | 'total_used'): number {
  const data = usage?.data as any
  const quota = data?.user_quota ?? data?.quota ?? data
  const value = Number(quota?.[name] ?? usage?.[name])
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function trimUrl(value: string): string { return value.replace(/\/+$/, '') }
function accountKey(auth: Pick<AuthContext, 'orgId' | 'userId'>): string { return `${auth.orgId}:${auth.userId}` }

/** New API owns routing, token accounting, quota and billing. */
export class NewAPIService {
  private readonly credentials: ServerCredentialStore
  private readonly accountLocks = new Map<string, Promise<NewAPIAccount>>()
  private adminSession: { token: string; expiresAt: number } | null = null
  private adminSessionPromise: Promise<string> | null = null

  constructor(private readonly config: ServerConfig['newApi'], rootDir: string, private readonly users: MossUsers) {
    this.credentials = new ServerCredentialStore(rootDir)
  }

  enabled(): boolean {
    return Boolean(this.config.enabled && this.config.baseUrl && this.config.apiKey)
  }

  private requireConfig(): { baseUrl: string; apiKey: string } {
    if (!this.enabled()) throw Object.assign(new Error('New API gateway is not configured'), { statusCode: 503 })
    return { baseUrl: trimUrl(this.config.baseUrl!), apiKey: this.config.apiKey! }
  }

  private async request(path: string, key: string, init: RequestInit = {}): Promise<any> {
    const { baseUrl } = this.requireConfig()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
        signal: controller.signal,
      })
      const raw = await response.text()
      let body: any = null
      try { body = raw ? JSON.parse(raw) : null } catch { body = { raw } }
      if (!response.ok || body?.success === false) throw Object.assign(new Error(String(body?.message || body?.error?.message || body?.detail || raw || response.statusText)), { statusCode: response.status || 502 })
      return body
    } finally { clearTimeout(timer) }
  }

  private async adminKey(): Promise<string> {
    const { apiKey } = this.requireConfig()
    const username = this.config.adminUsername
    const password = this.config.adminPassword
    if (!username || !password) return apiKey
    const now = Date.now()
    if (this.adminSession && this.adminSession.expiresAt > now + 30_000) return this.adminSession.token
    if (this.adminSessionPromise) return this.adminSessionPromise
    this.adminSessionPromise = (async () => {
      const login = await this.request('/api/user/login', '', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      const token = String(login?.data?.access_token || login?.access_token || '').trim()
      if (!token) throw Object.assign(new Error('New API administrator login did not return an access token'), { statusCode: 502 })
      const expiresIn = Number(login?.data?.expires_in || login?.expires_in || 3600)
      this.adminSession = { token, expiresAt: now + Math.max(60, expiresIn) * 1000 }
      return token
    })().finally(() => { this.adminSessionPromise = null })
    return this.adminSessionPromise
  }

  private async adminRequest(path: string, init: RequestInit = {}): Promise<any> {
    try {
      return await this.request(path, await this.adminKey(), init)
    } catch (error) {
      // A New API login from its web console can revoke the previous admin
      // session. Re-authenticate once so Moss management actions keep working.
      if ((error as { statusCode?: number })?.statusCode !== 401 || !this.config.adminUsername || !this.config.adminPassword) throw error
      this.adminSession = null
      return await this.request(path, await this.adminKey(), init)
    }
  }

  private modelPolicy(catalog: string[]): { model: string; fastModel: string; allowed: string[] } {
    const settings = getSystemSettings()
    const visible = settings.availableModels.length
      ? settings.availableModels.filter(model => catalog.includes(model))
      : catalog
    const allowed = visible.length ? visible : catalog
    if (!allowed.length) throw Object.assign(new Error('New API 没有返回可用模型，请先配置渠道'), { statusCode: 503 })
    const model = settings.model && allowed.includes(settings.model) ? settings.model : allowed[0]!
    const fastModel = settings.fastModel && allowed.includes(settings.fastModel) ? settings.fastModel : model
    return { model, fastModel, allowed }
  }

  async modelCatalog(auth: AuthContext): Promise<{ models: string[] }> {
    const account = await this.ensureAccount(auth)
    const catalog = await this.request('/v1/models', account.apiKey)
    const models = Array.from(new Set<string>((Array.isArray(catalog?.data) ? catalog.data : [])
      .map((item: any) => String(item?.id || '').trim()).filter(Boolean) as string[]))
    return { models }
  }

  async adminModelCatalog(auth: AuthContext): Promise<{ models: string[] }> {
    if (!this.config.catalogApiKey) return this.modelCatalog(auth)
    const catalog = await this.request('/v1/models', this.config.catalogApiKey)
    const models = Array.from(new Set<string>((Array.isArray(catalog?.data) ? catalog.data : [])
      .map((item: any) => String(item?.id || '').trim()).filter(Boolean) as string[]))
    if (!models.length) throw Object.assign(new Error('New API 没有返回可用模型，请先配置渠道'), { statusCode: 503 })
    return { models }
  }

  private async syncTokenModelPolicy(account: NewAPIAccount, _allowed: string[]): Promise<void> {
    // Model visibility is controlled by Moss Server's model policy. Keep the
    // New API user key unrestricted so /v1/models remains the full gateway
    // catalog and the key can serve any model allowed by Moss.
    const enabled = false
    let currentResponse: any
    try {
      currentResponse = await this.request(`/api/token/${account.tokenId}`, account.apiKey)
    } catch {
      // Some New API deployments do not grant API-key management scope to
      // runtime keys. Model access must remain available in that case; the
      // gateway still enforces its existing token policy.
      return
    }
    const current = currentResponse?.data || currentResponse?.token || currentResponse
    if (!current || Number(current?.id || current?.Id) !== account.tokenId) return
    const normalize = (value: unknown): string => Array.isArray(value)
      ? value.map(item => String(item).trim()).filter(Boolean).sort().join(',')
      : String(value || '').split(',').map(item => item.trim()).filter(Boolean).sort().join(',')
    if (Boolean(current.model_limits_enabled) === enabled && normalize(current.model_limits) === '') return
    try {
      await this.request('/api/token/', account.apiKey, {
        method: 'PUT',
        body: JSON.stringify({
          id: account.tokenId,
          name: current.name || `moss-${account.userId}`,
          expired_time: Number(current.expired_time ?? -1),
          remain_quota: Number(current.remain_quota ?? 0),
          unlimited_quota: Boolean(current.unlimited_quota),
          model_limits_enabled: enabled,
          model_limits: '',
          allow_ips: current.allow_ips || '',
          group: current.group || 'default',
          cross_group_retry: Boolean(current.cross_group_retry),
          allow_user_quota_query: current.allow_user_quota_query !== false,
        }),
      })
    } catch {
      // Keep model access usable when policy synchronization is unavailable.
    }
  }

  private async usernameFor(auth: AuthContext, key: string): Promise<string> {
    const user = await this.users.getUserByIdAndOrg(auth.userId, auth.orgId)
    if (!user) throw Object.assign(new Error('Moss user is unavailable'), { statusCode: 404 })
    // New API limits usernames and display names to 20 characters.
    const name = Array.from(user.name.normalize('NFKC').replace(/[^\p{L}\p{N}_.-]+/gu, '_').replace(/^_+|_+$/g, ''))
    const digest = createHash('sha256').update(key).digest('hex')
    const fallback = name.length
      ? `moss_${name.slice(0, 6).join('')}_${digest.slice(0, 8)}`
      : `moss_${digest.slice(0, 14)}`
    if (!name.length || name.length > 15) return fallback
    const username = `moss_${name.join('')}`
    for (let page = 1; ; page++) {
      const response = await this.adminRequest(`/api/user/search?keyword=${encodeURIComponent(username)}&p=${page}&page_size=100`)
      const items = Array.isArray(response?.data?.items) ? response.data.items : []
      if (items.some((item: any) => String(item.username).toLowerCase() === username.toLowerCase())) return fallback
      if (!items.length || page * Number(response?.data?.page_size || items.length) >= Number(response?.data?.total || 0)) return username
    }
  }

  private async createAccount(auth: AuthContext, key: string): Promise<NewAPIAccount> {
    const username = await this.usernameFor(auth, key)
    const password = randomBytes(32).toString('base64url')
    const created = await this.adminRequest('/api/user/', {
      method: 'POST',
      body: JSON.stringify({ username, password, display_name: username, role: 1 }),
    })
    // New API returns the numeric id for newly created users in some versions;
    // login is the stable API across versions and also validates the mapping.
    const login = await this.request('/api/user/login', '', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    const userKey = String(login?.data?.access_token || login?.access_token || '').trim()
    if (!userKey) throw Object.assign(new Error('New API user login did not return an access token'), { statusCode: 502 })
    const userId = Number(login?.data?.user?.id || created?.data?.id || created?.user?.id)
    if (!Number.isSafeInteger(userId) || userId <= 0) throw Object.assign(new Error('New API user response did not include a numeric user id'), { statusCode: 502 })
    // The create endpoint drops identity fields. Keep the stable Moss identity
    // in the admin-only remark so the DB synchronizer can bind OIDC independently
    // of the readable username. The internal credential key remains orgId:userId.
    await this.adminRequest('/api/user/', {
      method: 'PUT',
      body: JSON.stringify({ id: userId, username, display_name: username, group: 'default', remark: `moss:${key}` }),
    })
    if (this.config.initialQuota > 0) await this.changeQuota(userId, this.config.initialQuota)

    await this.request('/api/token/', userKey, {
      method: 'POST',
      body: JSON.stringify({
        name: `moss-${auth.orgId}-${auth.userId}`.slice(0, 50),
        unlimited_quota: true,
        allow_user_quota_query: true,
        expired_time: -1,
        group: 'default',
        model_limits_enabled: false,
        model_limits: '',
      }),
    })
    const tokens = await this.request('/api/token/?p=1&size=100', userKey)
    const items = Array.isArray(tokens?.data?.items) ? tokens.data.items : []
    const token = items.find((item: any) => String(item?.name || '').startsWith(`moss-${auth.orgId}-${auth.userId}`)) || items.at(-1)
    const tokenId = Number(token?.id || token?.Id)
    if (!Number.isSafeInteger(tokenId) || tokenId <= 0) throw Object.assign(new Error('New API token creation did not return a token id'), { statusCode: 502 })
    const tokenResponse = await this.request(`/api/token/${tokenId}/key`, userKey, { method: 'POST' })
    const apiKey = String(tokenResponse?.data?.key || tokenResponse?.key || '').trim()
    if (!apiKey) throw Object.assign(new Error('New API did not return the generated API token'), { statusCode: 502 })
    const result = { userId: String(userId), username, password, apiKey, tokenId: String(tokenId) }
    await this.credentials.set('new-api-user', key, result)
    return { ...result, userId, tokenId } as NewAPIAccount
  }

  private async changeQuota(userId: number, quota: number): Promise<void> {
    await this.adminRequest('/api/user/manage', {
      method: 'POST',
      body: JSON.stringify({ id: userId, action: 'add_quota', mode: 'add', value: quota }),
    })
  }

  private async ensureAccount(auth: AuthContext): Promise<NewAPIAccount> {
    const key = accountKey(auth)
    const cached = await this.credentials.get('new-api-user', key)
    if (cached.userId && cached.apiKey && cached.username && cached.password && cached.tokenId) return { ...cached, userId: Number(cached.userId), tokenId: Number(cached.tokenId) } as NewAPIAccount
    const existing = this.accountLocks.get(key)
    if (existing) return existing
    const creating = this.createAccount(auth, key).finally(() => this.accountLocks.delete(key))
    this.accountLocks.set(key, creating)
    return creating
  }

  async ensureUserKey(auth: AuthContext): Promise<{ url: string; apiKey: string; model: string; availableModels: string[]; fastModel: string; expiresAt: number }> {
    const account = await this.ensureAccount(auth)
    const catalog = this.config.catalogApiKey
      ? await this.adminModelCatalog(auth)
      : await this.modelCatalog(auth)
    const policy = this.modelPolicy(catalog.models)
    await this.syncTokenModelPolicy(account, policy.allowed)
    return { url: this.config.publicBaseUrl || this.config.baseUrl!, apiKey: account.apiKey, model: policy.model, availableModels: policy.allowed, fastModel: policy.fastModel, expiresAt: 0 }
  }

  async userInfo(auth: AuthContext): Promise<NewAPIUsage> {
    const account = await this.ensureAccount(auth)
    return await this.request('/api/usage/token/', account.apiKey)
  }

  async userInfoById(userId: string, orgId?: string): Promise<NewAPIUsage | null> {
    if (!orgId) return null
    const cached = await this.credentials.get('new-api-user', `${orgId}:${userId}`)
    if (!cached.apiKey) return null
    return await this.request('/api/usage/token/', String(cached.apiKey))
  }

  /** Keep an existing New API account's login status aligned with Moss. */
  async syncUserStatus(
    userId: string,
    orgId: string,
    status: 'active' | 'disabled',
  ): Promise<void> {
    const cached = await this.credentials.get('new-api-user', `${orgId}:${userId}`)
    const newApiUserId = Number(cached.userId)
    if (!Number.isSafeInteger(newApiUserId) || newApiUserId <= 0) return
    await this.adminRequest('/api/user/manage', {
      method: 'POST',
      body: JSON.stringify({
        id: newApiUserId,
        action: status === 'disabled' ? 'disable' : 'enable',
      }),
    })
  }

  async balanceById(userId: string, orgId: string): Promise<{ availableUsd: number; usedUsd: number; totalUsd: number }> {
    const usage = await this.userInfoById(userId, orgId)
    if (!usage) return { availableUsd: 0, usedUsd: 0, totalUsd: 0 }
    const availableUsd = quotaValue(usage, 'total_available') / NEW_API_QUOTA_PER_USD
    const usedUsd = quotaValue(usage, 'total_used') / NEW_API_QUOTA_PER_USD
    return {
      availableUsd: Number(availableUsd.toFixed(6)),
      usedUsd: Number(usedUsd.toFixed(6)),
      totalUsd: Number((availableUsd + usedUsd).toFixed(6)),
    }
  }

  async recharge(auth: AuthContext, userId: string, orgId: string, amountUsd: number): Promise<{ ok: true; amountUsd: number }> {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw Object.assign(new Error('充值金额必须是正数（美元）'), { statusCode: 400 })
    const quota = Math.round(amountUsd * NEW_API_QUOTA_PER_USD)
    if (!Number.isSafeInteger(quota) || quota <= 0) throw Object.assign(new Error('充值金额超出范围'), { statusCode: 400 })
    const account = await this.ensureAccount({ ...auth, userId, orgId })
    await this.changeQuota(account.userId, quota)
    return { ok: true, amountUsd: Number((quota / NEW_API_QUOTA_PER_USD).toFixed(6)) }
  }
}
