import { ServerCredentialStore } from '../security/credentialStore.js'
import type { AuthContext } from '../auth/token.js'
import type { ServerConfig } from '../types.js'

type LiteLLMUserInfo = Record<string, unknown>

function trimUrl(value: string): string { return value.replace(/\/+$/, '') }

export class LiteLLMService {
  private readonly credentials: ServerCredentialStore
  constructor(private readonly config: ServerConfig['litellm'], rootDir: string) {
    this.credentials = new ServerCredentialStore(rootDir)
  }

  enabled(): boolean {
    return Boolean(this.config.enabled && this.config.baseUrl && this.config.masterKey)
  }

  private async request(path: string, init: RequestInit = {}): Promise<any> {
    if (!this.enabled()) throw Object.assign(new Error('LiteLLM gateway is not configured'), { statusCode: 503 })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)
    try {
      const response = await fetch(`${trimUrl(this.config.baseUrl!)}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.config.masterKey}`, 'content-type': 'application/json', ...(init.headers || {}) },
        signal: controller.signal,
      })
      const raw = await response.text()
      let body: any = null
      try { body = raw ? JSON.parse(raw) : null } catch { body = { raw } }
      if (!response.ok) throw Object.assign(new Error(String(body?.error?.message || body?.detail || body?.message || raw || response.statusText)), { statusCode: response.status })
      return body
    } finally { clearTimeout(timer) }
  }

  private userId(auth: AuthContext): string { return `${auth.orgId}:${auth.userId}` }

  async ensureUserKey(auth: AuthContext): Promise<{ url: string; apiKey: string; model: string; fastModel: string; expiresAt: number }> {
    const userId = this.userId(auth)
    const cached = await this.credentials.get('litellm-user-key', userId)
    const now = Date.now()
    if (cached.key && Number(cached.expiresAt) > now + 60_000) return { url: this.config.publicBaseUrl || this.config.baseUrl!, apiKey: cached.key, model: this.config.defaultModel, fastModel: this.config.fastModel, expiresAt: Number(cached.expiresAt) }
    await this.request('/user/new', { method: 'POST', body: JSON.stringify({ user_id: userId }) }).catch(error => { if (Number(error?.statusCode) !== 409) throw error })
    const duration = `${Math.max(5, Math.ceil(this.config.keyTtlSec / 60))}m`
    const generated = await this.request('/key/generate', { method: 'POST', body: JSON.stringify({ user_id: userId, models: [this.config.defaultModel, this.config.fastModel], duration }) })
    const key = String(generated?.key || generated?.token || '').trim()
    if (!key) throw Object.assign(new Error('LiteLLM did not return a virtual key'), { statusCode: 502 })
    const expiresAt = now + this.config.keyTtlSec * 1000
    await this.credentials.set('litellm-user-key', userId, { key, expiresAt: String(expiresAt) })
    return { url: this.config.publicBaseUrl || this.config.baseUrl!, apiKey: key, model: this.config.defaultModel, fastModel: this.config.fastModel, expiresAt }
  }

  async userInfo(auth: AuthContext): Promise<LiteLLMUserInfo> {
    return await this.request(`/user/info?user_id=${encodeURIComponent(this.userId(auth))}`)
  }
}
