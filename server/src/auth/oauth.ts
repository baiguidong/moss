import { createHash, randomBytes } from 'node:crypto'
import type { ServerOAuthConfig } from '../types.js'
import type { AuthService } from './service.js'

const LOGIN_TTL_MS = 10 * 60 * 1000
const RESULT_TTL_MS = 5 * 60 * 1000
const MAX_TRANSACTIONS = 1_000
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/

type OAuthLoginResult = ReturnType<AuthService['issuePermanentApiKeyFromOAuth']>

type OAuthTransaction = {
  id: string
  state: string
  codeVerifier: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  expiresAt: number
  providerId?: string
  subject?: string
  result?: OAuthLoginResult
  error?: string
  errorStatusCode?: number
}

type FetchLike = typeof fetch

export class OAuthLoginError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'OAuthLoginError'
  }
}

function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value, 'ascii').digest('base64url')
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OAuthLoginError(502, 'OAuth provider returned an invalid response')
  }
  return value as Record<string, unknown>
}

function stringClaim(record: Record<string, unknown>, name: string): string {
  const value = record[name]
  return typeof value === 'string' ? value.trim() : ''
}

function identifierClaim(record: Record<string, unknown>, name: string): string {
  const value = record[name]
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return ''
}

function booleanClaim(record: Record<string, unknown>, name: string): boolean {
  const value = record[name]
  return value === true || value === 'true'
}

function formUrlEncode(value: string): string {
  return new URLSearchParams({ value }).toString().slice('value='.length)
}

function controlledErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined
  if (error instanceof OAuthLoginError) return error.statusCode
  if (error.name !== 'AuthServiceError') return undefined
  const statusCode = (error as Error & { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : undefined
}

export class OAuthLoginService {
  private readonly transactions = new Map<string, OAuthTransaction>()
  private readonly transactionIdByState = new Map<string, string>()

  constructor(
    private readonly config: ServerOAuthConfig,
    private readonly authService: AuthService,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  isEnabled(): boolean {
    return this.config.enabled
  }

  start(): {
    authorization_url: string
    transaction_id: string
    expires_in: number
  } {
    this.requireEnabled()
    this.pruneExpired()
    if (this.transactions.size >= MAX_TRANSACTIONS) {
      throw new OAuthLoginError(503, 'Too many OAuth login attempts')
    }

    const id = randomBase64Url()
    const state = randomBase64Url()
    const codeVerifier = randomBase64Url(48)
    const transaction: OAuthTransaction = {
      id,
      state,
      codeVerifier,
      status: 'pending',
      expiresAt: this.now() + LOGIN_TTL_MS,
    }
    this.transactions.set(id, transaction)
    this.transactionIdByState.set(state, id)

    const authorizationUrl = new URL(this.config.authorizationUrl)
    authorizationUrl.searchParams.set('response_type', 'code')
    authorizationUrl.searchParams.set('client_id', this.config.clientId)
    authorizationUrl.searchParams.set('redirect_uri', this.config.redirectUri)
    authorizationUrl.searchParams.set('scope', this.config.scopes.join(' '))
    authorizationUrl.searchParams.set('state', state)
    authorizationUrl.searchParams.set('code_challenge', sha256Base64Url(codeVerifier))
    authorizationUrl.searchParams.set('code_challenge_method', 'S256')

    return {
      authorization_url: authorizationUrl.toString(),
      transaction_id: id,
      expires_in: Math.floor(LOGIN_TTL_MS / 1000),
    }
  }

  async completeCallback(input: {
    state: string
    code?: string
    error?: string
  }): Promise<{ ok: boolean }> {
    this.requireEnabled()
    this.pruneExpired()
    const state = input.state.trim()
    const transactionId = this.transactionIdByState.get(state)
    const transaction = transactionId ? this.transactions.get(transactionId) : undefined
    if (!transaction || transaction.status !== 'pending' || transaction.expiresAt <= this.now()) {
      throw new OAuthLoginError(400, 'OAuth state is invalid or expired')
    }

    transaction.status = 'processing'
    this.transactionIdByState.delete(transaction.state)

    if (input.error) {
      transaction.status = 'failed'
      transaction.codeVerifier = ''
      transaction.error = 'OAuth authorization was denied'
      transaction.errorStatusCode = 401
      transaction.expiresAt = this.now() + RESULT_TTL_MS
      return { ok: false }
    }

    const code = input.code?.trim() || ''
    if (!code) {
      transaction.status = 'failed'
      transaction.codeVerifier = ''
      transaction.error = 'OAuth provider did not return an authorization code'
      transaction.errorStatusCode = 400
      transaction.expiresAt = this.now() + RESULT_TTL_MS
      return { ok: false }
    }

    try {
      const accessToken = await this.exchangeAuthorizationCode(code, transaction.codeVerifier)
      transaction.codeVerifier = ''
      const profile = await this.fetchUserProfile(accessToken)
      const result = this.authService.issuePermanentApiKeyFromOAuth({
        providerId: this.config.providerId,
        subject: profile.subject,
        email: profile.email,
        emailVerified: profile.emailVerified,
        name: profile.name,
        organizationId: this.config.organizationId,
        autoProvision: this.config.autoProvision,
        requireVerifiedEmail: this.config.requireVerifiedEmail,
        allowedEmailDomains: this.config.allowedEmailDomains,
      })
      transaction.providerId = this.config.providerId
      transaction.subject = profile.subject
      transaction.result = result
      transaction.status = 'completed'
      transaction.expiresAt = this.now() + RESULT_TTL_MS
      this.supersedeOlderCompletedTransactions(transaction)
      return { ok: true }
    } catch (error) {
      const statusCode = controlledErrorStatus(error)
      transaction.status = 'failed'
      transaction.codeVerifier = ''
      transaction.error = statusCode !== undefined && error instanceof Error
        ? error.message
        : 'OAuth login failed'
      transaction.errorStatusCode = statusCode ?? 502
      transaction.expiresAt = this.now() + RESULT_TTL_MS
      return { ok: false }
    }
  }

  exchange(transactionId: string):
    | { pending: true; retry_after: number }
    | ({ pending: false } & OAuthLoginResult) {
    this.requireEnabled()
    this.pruneExpired()
    const id = transactionId.trim()
    if (!id) {
      throw new OAuthLoginError(400, 'Missing transaction_id')
    }
    if (!TRANSACTION_ID_PATTERN.test(id)) {
      throw new OAuthLoginError(404, 'OAuth login transaction was not found or has expired')
    }
    const transaction = this.transactions.get(id)
    if (!transaction) {
      throw new OAuthLoginError(404, 'OAuth login transaction was not found or has expired')
    }
    if (transaction.status === 'pending' || transaction.status === 'processing') {
      return { pending: true, retry_after: 1 }
    }
    this.transactions.delete(id)
    this.transactionIdByState.delete(transaction.state)
    if (transaction.status === 'failed' || !transaction.result) {
      throw new OAuthLoginError(
        transaction.errorStatusCode ?? 401,
        transaction.error || 'OAuth login failed',
      )
    }
    return { pending: false, ...transaction.result }
  }

  private async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: codeVerifier,
    })
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    }
    if (this.config.tokenEndpointAuthMethod === 'client_secret_basic') {
      headers.authorization = `Basic ${Buffer.from(
        `${formUrlEncode(this.config.clientId)}:${formUrlEncode(this.config.clientSecret)}`,
      ).toString('base64')}`
    } else {
      body.set('client_id', this.config.clientId)
      body.set('client_secret', this.config.clientSecret)
    }

    const response = await this.fetchImpl(this.config.tokenUrl, {
      method: 'POST',
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      throw new OAuthLoginError(502, 'OAuth token exchange failed')
    }
    const tokenResponse = asRecord(await response.json())
    const accessToken = stringClaim(tokenResponse, 'access_token')
    if (!accessToken) {
      throw new OAuthLoginError(502, 'OAuth provider response is missing access_token')
    }
    return accessToken
  }

  private async fetchUserProfile(accessToken: string): Promise<{
    subject: string
    email: string
    emailVerified: boolean
    name: string
  }> {
    const response = await this.fetchImpl(this.config.userInfoUrl, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      throw new OAuthLoginError(502, 'OAuth user info request failed')
    }
    const profile = asRecord(await response.json())
    const subject = identifierClaim(profile, 'sub') || identifierClaim(profile, 'id')
    const email = stringClaim(profile, 'email')
    const name = stringClaim(profile, 'name') || stringClaim(profile, 'preferred_username') || email
    if (!subject || !email) {
      throw new OAuthLoginError(401, 'OAuth provider did not return sub/id and email claims')
    }
    return {
      subject,
      email,
      emailVerified: booleanClaim(profile, 'email_verified'),
      name,
    }
  }

  private requireEnabled(): void {
    if (!this.config.enabled) {
      throw new OAuthLoginError(404, 'OAuth login is not enabled')
    }
  }

  private supersedeOlderCompletedTransactions(current: OAuthTransaction): void {
    for (const transaction of this.transactions.values()) {
      if (
        transaction === current ||
        transaction.status !== 'completed' ||
        transaction.providerId !== current.providerId ||
        transaction.subject !== current.subject
      ) {
        continue
      }
      transaction.status = 'failed'
      transaction.result = undefined
      transaction.error = 'OAuth login was superseded by a newer login'
      transaction.errorStatusCode = 409
    }
  }

  private pruneExpired(): void {
    const now = this.now()
    for (const [id, transaction] of this.transactions) {
      if (transaction.expiresAt > now) continue
      this.transactions.delete(id)
      this.transactionIdByState.delete(transaction.state)
    }
  }
}
