import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AuthService } from './service.js'

const AUTHORIZATION_TTL_MS = 10 * 60 * 1000
const CODE_TTL_MS = 2 * 60 * 1000
const MAX_PENDING_RECORDS = 1_000
const MAX_PASSWORD_ATTEMPTS = 5
const RANDOM_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/
const STATE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/

type PermanentApiKeyResult = ReturnType<AuthService['issuePermanentApiKeyForOAuthUser']>

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

function valuesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'ascii')
  const rightBuffer = Buffer.from(right, 'ascii')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function requireValue(value: string, name: string, pattern: RegExp): string {
  const normalized = value.trim()
  if (!pattern.test(normalized)) {
    throw new OAuthLoginError(400, `Invalid ${name}`)
  }
  return normalized
}

function requireLoopbackRedirectUri(value: string): string {
  const normalized = value.trim()
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new OAuthLoginError(400, 'Invalid redirect_uri')
  }
  const loopbackHosts = new Set(['127.0.0.1', '[::1]'])
  if (
    url.protocol !== 'http:' ||
    !loopbackHosts.has(url.hostname) ||
    !url.port ||
    url.pathname !== '/callback' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new OAuthLoginError(
      400,
      'redirect_uri must be an HTTP loopback URL with a port and /callback path',
    )
  }
  return url.toString()
}

function appendCallbackParams(
  redirectUri: string,
  params: Record<string, string>,
): string {
  const url = new URL(redirectUri)
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value)
  }
  return url.toString()
}

function controlledAuthStatus(error: unknown): number | undefined {
  if (!(error instanceof Error) || error.name !== 'AuthServiceError') return undefined
  const statusCode = (error as Error & { statusCode?: unknown }).statusCode
  return statusCode === 400 || statusCode === 401
    ? statusCode
    : undefined
}

export class OAuthLoginService {
  constructor(
    private readonly authService: AuthService,
    private readonly now: () => number = Date.now,
  ) {}

  start(input: {
    redirectUri: string
    state: string
    codeChallenge: string
    codeChallengeMethod: string
  }): {
    authorization_url: string
    expires_in: number
  } {
    this.pruneExpired()
    if (this.authService.countOAuthAuthorizationRecords() >= MAX_PENDING_RECORDS) {
      throw new OAuthLoginError(503, '认证请求过多，请稍后重试。')
    }
    if (input.codeChallengeMethod !== 'S256') {
      throw new OAuthLoginError(400, 'code_challenge_method must be S256')
    }

    const redirectUri = requireLoopbackRedirectUri(input.redirectUri)
    const state = requireValue(input.state, 'state', STATE_PATTERN)
    const codeChallenge = requireValue(
      input.codeChallenge,
      'code_challenge',
      RANDOM_ID_PATTERN,
    )
    const id = randomBase64Url()
    this.authService.createOAuthAuthorizationRequest({
      id,
      redirectUri,
      state,
      codeChallenge,
      expiresAt: this.now() + AUTHORIZATION_TTL_MS,
      passwordAttempts: 0,
    })

    return {
      authorization_url:
        `/api/v1/auth/oauth/authorize/${encodeURIComponent(id)}`,
      expires_in: Math.floor(AUTHORIZATION_TTL_MS / 1000),
    }
  }

  getAuthorizationRequest(transactionId: string): {
    transactionId: string
    redirectUri: string
  } {
    this.pruneExpired()
    const request = this.authService.getOAuthAuthorizationRequest(
      transactionId.trim(),
      this.now(),
    )
    if (!request) {
      throw new OAuthLoginError(404, '授权请求无效或已过期，请返回 Moss 客户端重新认证。')
    }
    return {
      transactionId: request.id,
      redirectUri: request.redirectUri,
    }
  }

  authorizeWithPassword(input: {
    transactionId: string
    loginIdentifier: string
    password: string
  }): string {
    this.pruneExpired()
    const request = this.authService.incrementOAuthAuthorizationAttempts(
      input.transactionId.trim(),
      this.now(),
    )
    if (!request) {
      throw new OAuthLoginError(404, '授权请求无效或已过期，请返回 Moss 客户端重新认证。')
    }
    if (request.passwordAttempts > MAX_PASSWORD_ATTEMPTS) {
      this.authService.deleteOAuthAuthorizationRequest(request.id)
      throw new OAuthLoginError(429, '登录尝试次数过多，请返回 Moss 客户端重新认证。')
    }

    const loginIdentifier = input.loginIdentifier.trim()
    try {
      const authenticated = this.authService.authenticatePasswordForOAuth({
        username: loginIdentifier.includes('@') ? undefined : loginIdentifier,
        email: loginIdentifier.includes('@') ? loginIdentifier : undefined,
        password: input.password,
      })
      const code = randomBase64Url()
      const completed = this.authService.completeOAuthAuthorization(request.id, {
        code,
        redirectUri: request.redirectUri,
        state: request.state,
        codeChallenge: request.codeChallenge,
        userId: authenticated.user.id,
        orgId: authenticated.user.orgId,
        expiresAt: this.now() + CODE_TTL_MS,
      }, this.now())
      if (!completed) {
        throw new OAuthLoginError(404, '授权请求无效或已过期，请返回 Moss 客户端重新认证。')
      }
      return appendCallbackParams(request.redirectUri, {
        code,
        state: request.state,
      })
    } catch (error) {
      if (controlledAuthStatus(error) !== undefined) {
        throw new OAuthLoginError(401, '用户名、邮箱或密码不正确。')
      }
      throw error
    }
  }

  cancel(transactionId: string): string {
    this.pruneExpired()
    const id = transactionId.trim()
    const request = this.authService.consumeOAuthAuthorizationRequest(id, this.now())
    if (!request) {
      throw new OAuthLoginError(404, '授权请求无效或已过期，请返回 Moss 客户端重新认证。')
    }
    return appendCallbackParams(request.redirectUri, {
      error: 'access_denied',
      state: request.state,
    })
  }

  cancelClientRequest(input: {
    state: string
    redirectUri: string
    code?: string
  }): { canceled: boolean } {
    const state = requireValue(input.state, 'state', STATE_PATTERN)
    const redirectUri = requireLoopbackRedirectUri(input.redirectUri)
    const code = input.code?.trim()
    const requestCanceled = this.authService.deleteOAuthAuthorizationRequestByState(
      state,
      redirectUri,
    )
    const stateCodeCanceled = this.authService.deleteOAuthAuthorizationCodeByState(
      state,
      redirectUri,
    )
    if (code) requireValue(code, 'code', RANDOM_ID_PATTERN)
    const codeCanceled = code
      ? this.authService.deleteOAuthAuthorizationCode(code, redirectUri)
      : false
    return {
      canceled: requestCanceled || stateCodeCanceled || codeCanceled,
    }
  }

  exchange(input: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): PermanentApiKeyResult {
    this.pruneExpired()
    const code = requireValue(input.code, 'code', RANDOM_ID_PATTERN)
    const authorization = this.authService.consumeOAuthAuthorizationCode(code, this.now())
    if (!authorization) {
      throw new OAuthLoginError(400, '授权码无效或已过期，请重新认证。')
    }
    const redirectUri = requireLoopbackRedirectUri(input.redirectUri)
    const codeVerifier = requireValue(
      input.codeVerifier,
      'code_verifier',
      PKCE_VERIFIER_PATTERN,
    )
    if (
      redirectUri !== authorization.redirectUri ||
      !valuesMatch(sha256Base64Url(codeVerifier), authorization.codeChallenge)
    ) {
      throw new OAuthLoginError(400, '授权码校验失败，请重新认证。')
    }

    return this.authService.issuePermanentApiKeyForOAuthUser({
      userId: authorization.userId,
      orgId: authorization.orgId,
    })
  }

  private pruneExpired(): void {
    this.authService.pruneOAuthAuthorizationRecords(this.now())
  }
}
