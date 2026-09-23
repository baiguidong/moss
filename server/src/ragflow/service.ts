import {
  constants,
  createHash,
  publicEncrypt,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { AuthServiceError } from '../auth/service.js'
import { hasScope, type AuthContext } from '../auth/token.js'
import { RagflowRepository } from '../model/repositories/ragflow.js'
import { ServerCredentialStore } from '../security/credentialStore.js'
import type { ServerConfig } from '../types.js'

export type RagflowPermission = 'readonly' | 'manager'

type SqlRow = Record<string, unknown>

type RagflowBinding = {
  id: string
  orgId: string
  userId: string
  instanceId: string
  ragflowUsername: string
  ragflowUserId: string | null
  createdAt: number
  updatedAt: number
}

type RagflowSecrets = {
  apiKey: string
  password: string
}

type ProvisionedAccount = {
  binding: RagflowBinding
  secrets: RagflowSecrets
}

export type RagflowAccountStatus = {
  enabled: boolean
  instance_id: string
  user_id: string
  provisioned: boolean
  ragflow_username: string | null
  ragflow_user_id: string | null
  password_ready: boolean
  api_key_ready: boolean
  updated_at: number | null
}

export type RagflowResolvedIdentity = {
  instance_id: string
  user_id: string
  ragflow_user_id: string | null
  ragflow_username: string
  ragflow_api_key: string
  permission: RagflowPermission
  scopes: Array<'read' | 'write' | 'agent' | 'admin'>
}

const RAGFLOW_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArq9XTUSeYr2+N1h3Afl/
z8Dse/2yD0ZGrKwx+EEEcdsBLca9Ynmx3nIB5obmLlSfmskLpBo0UACBmB5rEjBp
2Q2f3AG3Hjd4B+gNCG6BDaawuDlgANIhGnaTLrIqWrrcm4EMzJOnAOI1fgzJRsOO
UEfaS318Eq9OVO3apEyCCt0lOQK6PuksduOjVxtltDav+guVAA068NrPYmRNabVK
RNLJpL8w4D44sfth5RvZ3q9t+6RTArpEtc5sh5ChzvqPOzKGMXW83C95TxmXqpbK
6olN4RevSfVjEAgCydH6HN6OhtOQEcnrU97r9H0iZOWwbw3pVrZiUkuRD1R56Wzs
2wIDAQAB
-----END PUBLIC KEY-----`

function mapBinding(row: SqlRow): RagflowBinding {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    userId: String(row.user_id),
    instanceId: String(row.instance_id),
    ragflowUsername: String(row.ragflow_username),
    ragflowUserId:
      row.ragflow_user_id == null ? null : String(row.ragflow_user_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function encryptRagflowPassword(password: string): string {
  const encoded = Buffer.from(password, 'utf8').toString('base64')
  return publicEncrypt(
    { key: RAGFLOW_PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(encoded, 'utf8'),
  ).toString('base64')
}

function messageFromPayload(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const message = (payload as Record<string, unknown>).message
  return typeof message === 'string' && message.trim() ? message : fallback
}

function randomLetterPassword(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  return Array.from(
    { length },
    () => alphabet[randomInt(alphabet.length)],
  ).join('')
}

function usernameLocalPart(
  name: string,
  email: string,
  userId: string,
): string {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 48)
  return (
    normalize(name) ||
    normalize(email.split('@')[0] || '') ||
    `user-${userId.slice(0, 8)}`
  )
}

class RagflowAdminClient {
  constructor(private readonly config: ServerConfig['ragflow']) {
    if (!config.adminUrl || !config.adminPassword) {
      throw new AuthServiceError(
        503,
        'RAGFlow adminUrl and adminPassword are required for account management',
      )
    }
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<{
    response: Response
    payload: Record<string, unknown>
  }> {
    let response: Response
    try {
      response = await fetch(`${this.config.adminUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        headers: {
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
      })
    } catch (error) {
      throw new AuthServiceError(
        502,
        `RAGFlow Admin API request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    let payload: Record<string, unknown>
    try {
      payload = (await response.json()) as Record<string, unknown>
    } catch {
      throw new AuthServiceError(
        502,
        `RAGFlow Admin API returned HTTP ${response.status} with a non-JSON response`,
      )
    }
    return { response, payload }
  }

  private async login(): Promise<string> {
    const { response, payload } = await this.request('/api/v1/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        email: this.config.adminEmail,
        password: encryptRagflowPassword(this.config.adminPassword || ''),
      }),
    })
    const authorization = response.headers.get('authorization')?.trim() || ''
    if (!response.ok || Number(payload.code) !== 0 || !authorization) {
      throw new AuthServiceError(
        502,
        messageFromPayload(payload, 'RAGFlow admin login failed'),
      )
    }
    return authorization
  }

  async createUser(
    username: string,
    password: string,
  ): Promise<{ ragflowUserId: string | null }> {
    const authorization = await this.login()
    const created = await this.request('/api/v1/admin/users', {
      method: 'POST',
      headers: { authorization },
      body: JSON.stringify({
        username,
        password: encryptRagflowPassword(password),
        role: 'user',
      }),
    })
    if (!created.response.ok || Number(created.payload.code) !== 0) {
      const message = messageFromPayload(
        created.payload,
        'RAGFlow user provisioning failed',
      )
      const statusCode =
        created.response.status === 409 || /already|exist/i.test(message)
          ? 409
          : 502
      throw new AuthServiceError(statusCode, message)
    }
    const data = created.payload.data
    const record =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
    return { ragflowUserId: typeof record.id === 'string' ? record.id : null }
  }

  async generateKey(
    username: string,
  ): Promise<{ apiKey: string; ragflowUserId: string | null }> {
    const authorization = await this.login()
    const generated = await this.request(
      `/api/v1/admin/users/${encodeURIComponent(username)}/keys`,
      { method: 'POST', headers: { authorization } },
    )
    const data = generated.payload.data
    const record =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
    const apiKey = typeof record.token === 'string' ? record.token.trim() : ''
    if (
      !generated.response.ok ||
      Number(generated.payload.code) !== 0 ||
      !apiKey
    ) {
      throw new AuthServiceError(
        502,
        messageFromPayload(
          generated.payload,
          'RAGFlow API key generation failed',
        ),
      )
    }
    return {
      apiKey,
      ragflowUserId:
        typeof record.tenant_id === 'string' ? record.tenant_id : null,
    }
  }

  async resetPassword(username: string, password: string): Promise<void> {
    const authorization = await this.login()
    const updated = await this.request(
      `/api/v1/admin/users/${encodeURIComponent(username)}/password`,
      {
        method: 'PUT',
        headers: { authorization },
        body: JSON.stringify({
          new_password: encryptRagflowPassword(password),
        }),
      },
    )
    if (!updated.response.ok || Number(updated.payload.code) !== 0) {
      throw new AuthServiceError(
        502,
        messageFromPayload(updated.payload, 'RAGFlow password update failed'),
      )
    }
  }

  async revokeKey(username: string, apiKey: string): Promise<void> {
    const authorization = await this.login()
    const removed = await this.request(
      `/api/v1/admin/users/${encodeURIComponent(username)}/keys/${encodeURIComponent(apiKey)}`,
      { method: 'DELETE', headers: { authorization } },
    )
    if (!removed.response.ok || Number(removed.payload.code) !== 0) {
      throw new AuthServiceError(
        502,
        messageFromPayload(
          removed.payload,
          'RAGFlow API key revocation failed',
        ),
      )
    }
  }

  async deleteUser(username: string): Promise<void> {
    const authorization = await this.login()
    const encodedUsername = encodeURIComponent(username)
    const disabled = await this.request(
      `/api/v1/admin/users/${encodedUsername}/activate`,
      {
        method: 'PUT',
        headers: { authorization },
        body: JSON.stringify({ activate_status: 'off' }),
      },
    )
    if (!disabled.response.ok || Number(disabled.payload.code) !== 0) {
      throw new AuthServiceError(
        502,
        messageFromPayload(
          disabled.payload,
          'RAGFlow user deactivation failed',
        ),
      )
    }
    const removed = await this.request(
      `/api/v1/admin/users/${encodedUsername}`,
      { method: 'DELETE', headers: { authorization } },
    )
    if (!removed.response.ok || Number(removed.payload.code) !== 0) {
      throw new AuthServiceError(
        502,
        messageFromPayload(removed.payload, 'RAGFlow user cleanup failed'),
      )
    }
  }
}

export class RagflowIntegrationService {
  private readonly credentials: ServerCredentialStore
  private readonly pending = new Map<string, Promise<ProvisionedAccount>>()

  constructor(
    private readonly input: {
      repository: RagflowRepository
      rootDir: string
      config: ServerConfig['ragflow']
    },
  ) {
    this.credentials = new ServerCredentialStore(input.rootDir)
  }

  get enabled(): boolean {
    return this.input.config.enabled
  }

  authorizeGateway(token: string): boolean {
    const expected = this.input.config.gatewayToken || ''
    const actual = token.trim()
    if (!expected || !actual) return false
    const expectedBuffer = Buffer.from(expected, 'utf8')
    const actualBuffer = Buffer.from(actual, 'utf8')
    return (
      expectedBuffer.length === actualBuffer.length &&
      timingSafeEqual(expectedBuffer, actualBuffer)
    )
  }

  private assertEnabled(): void {
    if (!this.enabled)
      throw new AuthServiceError(503, 'RAGFlow integration is disabled')
  }

  private permissionFor(auth: AuthContext): RagflowPermission {
    if (hasScope(auth.scopes, 'ragflow:manage')) return 'manager'
    if (hasScope(auth.scopes, 'ragflow:read')) return 'readonly'
    throw new AuthServiceError(403, 'Knowledge base permission is required')
  }

  private async getBinding(
    orgId: string,
    userId: string,
  ): Promise<RagflowBinding | null> {
    const row = (await this.input.repository.getBinding(
      orgId,
      userId,
      this.input.config.instanceId,
    )) as SqlRow | undefined
    return row ? mapBinding(row) : null
  }

  private async getUser(
    orgId: string,
    userId: string,
  ): Promise<{ id: string; name: string; email: string }> {
    const row = (await this.input.repository.getUser(orgId, userId)) as
      SqlRow | undefined
    if (!row) throw new AuthServiceError(404, 'Unknown user_id')
    return {
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
    }
  }

  private async readSecrets(
    binding: RagflowBinding,
  ): Promise<RagflowSecrets | null> {
    const stored = await this.credentials.get('ragflow-bindings', binding.id)
    const apiKey = stored.apiKey?.trim() || ''
    const password = stored.password || ''
    return apiKey && password ? { apiKey, password } : null
  }

  private async candidateUsername(
    orgId: string,
    userId: string,
    fallback = false,
  ): Promise<string> {
    const user = await this.getUser(orgId, userId)
    const configuredDomain = (this.input.config.userDomain || 'ragflow.com')
      .trim()
      .toLowerCase()
    if (!/^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(configuredDomain)) {
      throw new AuthServiceError(500, 'Invalid RAGFlow user domain')
    }
    const local = usernameLocalPart(user.name, user.email, user.id)
    const suffix = fallback
      ? `.${createHash('sha256').update(`${orgId}:${userId}`).digest('hex').slice(0, 8)}`
      : ''
    return `${local}${suffix}@${configuredDomain}`
  }

  private async createAccount(
    orgId: string,
    userId: string,
  ): Promise<ProvisionedAccount> {
    const client = new RagflowAdminClient(this.input.config)
    const password = randomLetterPassword(this.input.config.passwordLength || 6)
    let username = await this.candidateUsername(orgId, userId)
    let remoteCreated = false
    try {
      let created: { ragflowUserId: string | null }
      try {
        created = await client.createUser(username, password)
      } catch (error) {
        if (!(error instanceof AuthServiceError) || error.statusCode !== 409)
          throw error
        username = await this.candidateUsername(orgId, userId, true)
        created = await client.createUser(username, password)
      }
      remoteCreated = true
      const generated = await client.generateKey(username)
      const timestamp = Date.now()
      const binding: RagflowBinding = {
        id: randomUUID(),
        orgId,
        userId,
        instanceId: this.input.config.instanceId,
        ragflowUsername: username,
        ragflowUserId: generated.ragflowUserId || created.ragflowUserId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const secrets = { apiKey: generated.apiKey, password }
      await this.credentials.set('ragflow-bindings', binding.id, secrets)
      try {
        await this.input.repository.createAccount(
          binding.id,
          binding.orgId,
          binding.userId,
          binding.instanceId,
          binding.ragflowUsername,
          binding.ragflowUserId,
          binding.createdAt,
          binding.updatedAt,
        )
      } catch (error) {
        await this.credentials.remove('ragflow-bindings', binding.id)
        throw error
      }
      try {
        await this.audit(orgId, userId, userId, 'ragflow.account.provision')
      } catch {}
      return { binding, secrets }
    } catch (error) {
      if (remoteCreated)
        await client.deleteUser(username).catch(() => undefined)
      throw error
    }
  }

  private async ensureAccount(
    orgId: string,
    userId: string,
  ): Promise<ProvisionedAccount> {
    this.assertEnabled()
    const existing = await this.getBinding(orgId, userId)
    if (existing) {
      const secrets = await this.readSecrets(existing)
      if (secrets) return { binding: existing, secrets }
      throw new AuthServiceError(
        409,
        'RAGFlow binding is incomplete; clear the development data and provision again',
      )
    }
    const pendingKey = `${this.input.config.instanceId}:${orgId}:${userId}`
    const current = this.pending.get(pendingKey)
    if (current) return current
    const operation = this.createAccount(orgId, userId).finally(() =>
      this.pending.delete(pendingKey),
    )
    this.pending.set(pendingKey, operation)
    return operation
  }

  private async audit(
    orgId: string,
    actorUserId: string,
    targetUserId: string,
    action: string,
  ): Promise<void> {
    await this.input.repository.audit(
      randomUUID(),
      orgId,
      actorUserId,
      targetUserId,
      action,
      Date.now(),
    )
  }

  async resolve(auth: AuthContext): Promise<RagflowResolvedIdentity> {
    const permission = this.permissionFor(auth)
    const account = await this.ensureAccount(auth.orgId, auth.userId)
    return {
      instance_id: account.binding.instanceId,
      user_id: auth.userId,
      ragflow_user_id: account.binding.ragflowUserId,
      ragflow_username: account.binding.ragflowUsername,
      ragflow_api_key: account.secrets.apiKey,
      permission,
      scopes:
        permission === 'manager'
          ? ['read', 'write', 'agent', 'admin']
          : ['read'],
    }
  }

  async getUserStatus(
    orgId: string,
    userId: string,
  ): Promise<RagflowAccountStatus> {
    const binding = await this.getBinding(orgId, userId)
    const secrets = binding ? await this.readSecrets(binding) : null
    return {
      enabled: this.enabled,
      instance_id: this.input.config.instanceId,
      user_id: userId,
      provisioned: Boolean(binding && secrets),
      ragflow_username: binding?.ragflowUsername ?? null,
      ragflow_user_id: binding?.ragflowUserId ?? null,
      password_ready: Boolean(secrets?.password),
      api_key_ready: Boolean(secrets?.apiKey),
      updated_at: binding?.updatedAt ?? null,
    }
  }

  async provisionForUser(
    orgId: string,
    userId: string,
    actorUserId: string,
  ): Promise<RagflowAccountStatus> {
    await this.ensureAccount(orgId, userId)
    await this.audit(orgId, actorUserId, userId, 'ragflow.account.ensure')
    return await this.getUserStatus(orgId, userId)
  }

  async revealCredentials(
    orgId: string,
    userId: string,
    actorUserId: string,
  ): Promise<{
    username: string
    password: string
    api_key: string
  }> {
    const account = await this.ensureAccount(orgId, userId)
    await this.audit(orgId, actorUserId, userId, 'ragflow.credentials.reveal')
    return {
      username: account.binding.ragflowUsername,
      password: account.secrets.password,
      api_key: account.secrets.apiKey,
    }
  }

  async rotatePassword(
    orgId: string,
    userId: string,
    actorUserId: string,
  ): Promise<{
    username: string
    password: string
  }> {
    const account = await this.ensureAccount(orgId, userId)
    const password = randomLetterPassword(this.input.config.passwordLength || 6)
    await new RagflowAdminClient(this.input.config).resetPassword(
      account.binding.ragflowUsername,
      password,
    )
    await this.credentials.set('ragflow-bindings', account.binding.id, {
      ...account.secrets,
      password,
    })
    await this.audit(orgId, actorUserId, userId, 'ragflow.password.rotate')
    return { username: account.binding.ragflowUsername, password }
  }

  async rotateApiKey(
    orgId: string,
    userId: string,
    actorUserId: string,
  ): Promise<{
    username: string
    api_key: string
  }> {
    const account = await this.ensureAccount(orgId, userId)
    const client = new RagflowAdminClient(this.input.config)
    const generated = await client.generateKey(account.binding.ragflowUsername)
    await this.credentials.set('ragflow-bindings', account.binding.id, {
      ...account.secrets,
      apiKey: generated.apiKey,
    })
    await client.revokeKey(
      account.binding.ragflowUsername,
      account.secrets.apiKey,
    )
    await this.audit(orgId, actorUserId, userId, 'ragflow.api-key.rotate')
    return {
      username: account.binding.ragflowUsername,
      api_key: generated.apiKey,
    }
  }

  async getStatus(): Promise<{
    enabled: boolean
    instance_id: string
    base_url: string | null
    admin_url: string | null
    user_domain: string
    reachable: boolean
  }> {
    let reachable = false
    if (this.enabled && this.input.config.baseUrl) {
      try {
        const response = await fetch(
          `${this.input.config.baseUrl}/api/v1/system/healthz`,
          {
            signal: AbortSignal.timeout(
              Math.min(this.input.config.requestTimeoutMs, 5_000),
            ),
          },
        )
        reachable = response.ok
      } catch {}
    }
    return {
      enabled: this.enabled,
      instance_id: this.input.config.instanceId,
      base_url: this.input.config.baseUrl ?? null,
      admin_url: this.input.config.adminUrl ?? null,
      user_domain: this.input.config.userDomain || 'ragflow.com',
      reachable,
    }
  }
}
