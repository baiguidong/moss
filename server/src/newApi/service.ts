import { randomBytes, createHash } from 'node:crypto'
import { ServerCredentialStore } from '../security/credentialStore.js'
import type { AuthContext } from '../auth/token.js'
import type { ServerConfig } from '../types.js'

type NewAPIUsage = Record<string, unknown>
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

  constructor(private readonly config: ServerConfig['newApi'], rootDir: string) {
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

  private adminKey(): string { return this.requireConfig().apiKey }

  private usernameFor(key: string): string {
    // New API limits usernames and display names to 20 characters.
    return `moss_${createHash('sha256').update(key).digest('hex').slice(0, 14)}`
  }

  private async createAccount(auth: AuthContext, key: string): Promise<NewAPIAccount> {
    const username = this.usernameFor(key)
    const password = randomBytes(32).toString('base64url')
    const adminKey = this.adminKey()
    const created = await this.request('/api/user/', adminKey, {
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
    if (this.config.initialQuota > 0) await this.changeQuota(userId, this.config.initialQuota)

    await this.request('/api/token/', userKey, {
      method: 'POST',
      body: JSON.stringify({
        name: `moss-${auth.orgId}-${auth.userId}`.slice(0, 50),
        unlimited_quota: true,
        allow_user_quota_query: true,
        expired_time: -1,
        group: 'auto',
        model_limits_enabled: true,
        model_limits: this.config.defaultModel,
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
    await this.request('/api/user/manage', this.adminKey(), {
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

  async ensureUserKey(auth: AuthContext): Promise<{ url: string; apiKey: string; model: string; fastModel: string; expiresAt: number }> {
    const account = await this.ensureAccount(auth)
    return { url: this.config.publicBaseUrl || this.config.baseUrl!, apiKey: account.apiKey, model: this.config.defaultModel, fastModel: this.config.fastModel, expiresAt: 0 }
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
