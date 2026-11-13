import { createSign, generateKeyPairSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { ServerConfig } from '../types.js'
import type { AuthService } from './service.js'
import { OAuthLoginError, OAuthLoginService, requireOAuthRedirectUri } from './oauth.js'

const OIDC_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function json(value: unknown): string {
  return base64Url(JSON.stringify(value))
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

type OidcClient = {
  id: string
  secret?: string
  pkce: boolean
  redirectUris: string[]
}

export class OidcService {
  private readonly issuer: string
  private readonly clients: OidcClient[]
  private readonly key = generateKeyPairSync('rsa', { modulusLength: 2048 })
  private readonly keyId = randomBytes(12).toString('base64url')

  constructor(
    private readonly config: ServerConfig,
    private readonly authService: AuthService,
    private readonly oauth: OAuthLoginService,
    private readonly origin: string,
  ) {
    this.issuer = (config.oidc.issuer || origin).replace(/\/+$/, '')
    const trusted = [...config.oidc.trustedRedirectUris]
    this.clients = [
      {
        id: config.oidc.newApiClientId,
        secret: config.oidc.newApiClientSecret,
        pkce: false,
        redirectUris: trusted,
      },
      {
        id: config.oidc.desktopClientId,
        pkce: true,
        redirectUris: [],
      },
      {
        id: config.oidc.webClientId,
        secret: config.oidc.webClientSecret,
        pkce: true,
        redirectUris: trusted,
      },
    ]
  }

  discovery(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/oidc/authorize`,
      token_endpoint: `${this.issuer}/oidc/token`,
      userinfo_endpoint: `${this.issuer}/oidc/userinfo`,
      jwks_uri: `${this.issuer}/oidc/jwks.json`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'name', 'email', 'preferred_username'],
      desktop_client_id: this.config.oidc.desktopClientId,
      web_client_id: this.config.oidc.webClientId,
    }
  }

  jwks(): Record<string, unknown> {
    const jwk = this.key.publicKey.export({ format: 'jwk' }) as Record<string, unknown>
    return { keys: [{ ...jwk, kid: this.keyId, alg: 'RS256', use: 'sig', kty: 'RSA' }] }
  }

  async authorize(params: URLSearchParams): Promise<{ location: string }> {
    const client = this.client(params.get('client_id') || '')
    const redirectUri = this.redirect(client, params.get('redirect_uri') || '')
    if (params.get('response_type') !== 'code') throw new OAuthLoginError(400, 'response_type must be code')
    const scope = (params.get('scope') || '').split(/\s+/).filter(Boolean)
    if (!scope.includes('openid')) throw new OAuthLoginError(400, 'scope must include openid')
    const state = params.get('state') || ''
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) throw new OAuthLoginError(400, 'Invalid state')
    const challenge = params.get('code_challenge') || randomBytes(32).toString('base64url')
    const started = await this.oauth.start({
      redirectUri,
      state,
      codeChallenge: challenge,
      codeChallengeMethod: params.get('code_challenge_method') || 'S256',
    })
    return { location: new URL(started.authorization_url, this.issuer).toString() }
  }

  async token(params: URLSearchParams, authorization: string | undefined): Promise<Record<string, unknown>> {
    const clientId = params.get('client_id') || this.basicClientId(authorization)
    const client = this.client(clientId)
    this.checkSecret(client, params.get('client_secret'), authorization)
    if (params.get('grant_type') !== 'authorization_code') throw new OAuthLoginError(400, 'grant_type must be authorization_code')
    const code = params.get('code') || ''
    if (!OIDC_CODE_PATTERN.test(code)) throw new OAuthLoginError(400, 'Invalid code')
    const redirectUri = this.redirect(client, params.get('redirect_uri') || '')
    const result = await this.oauth.exchange({
      code,
      codeVerifier: params.get('code_verifier') || undefined,
      redirectUri,
      allowWithoutPkce: !client.pkce,
    })
    const now = Math.floor(Date.now() / 1000)
    const user = result.user
    const subject = `${user.orgId}:${user.id}`
    const idToken = this.signIdToken({
      iss: this.issuer,
      sub: subject,
      aud: client.id,
      iat: now,
      exp: now + result.expires_in,
      name: user.name,
      ...(user.email ? { email: user.email, email_verified: true } : {}),
      preferred_username: user.name,
    })
    return {
      access_token: result.access_token,
      token_type: 'Bearer',
      expires_in: result.expires_in,
      id_token: idToken,
      scope: 'openid profile email',
    }
  }

  async userinfo(token: string): Promise<Record<string, unknown>> {
    const auth = await this.authService.verifyAccessToken(token)
    if (!auth) throw new OAuthLoginError(401, 'Invalid access token')
    const me = await this.authService.getMe(auth)
    const user = me.user
    if (!user) throw new OAuthLoginError(401, 'User is unavailable')
    const email = user.email || `${auth.userId}@users.internal.moss`
    return {
      sub: `${auth.orgId}:${auth.userId}`,
      name: user.name,
      preferred_username: user.name,
      email,
      email_verified: Boolean(user.email),
      org_id: auth.orgId,
      role: me.role,
    }
  }

  private client(id: string): OidcClient {
    const client = this.clients.find(item => item.id === id)
    if (!client) throw new OAuthLoginError(400, 'Unknown client_id')
    return client
  }

  private redirect(client: OidcClient, value: string): string {
    const redirect = requireOAuthRedirectUri(value, client.redirectUris)
    if (client.redirectUris.includes(redirect)) return redirect
    if (client.id === this.config.oidc.desktopClientId) return redirect
    throw new OAuthLoginError(400, 'redirect_uri is not registered')
  }

  private basicClientId(header: string | undefined): string {
    if (!header?.startsWith('Basic ')) throw new OAuthLoginError(401, 'Client authentication required')
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      const [id] = decoded.split(':', 1)
      return id || ''
    } catch {
      throw new OAuthLoginError(401, 'Invalid client authentication')
    }
  }

  private checkSecret(client: OidcClient, formSecret: string | null, header: string | undefined): void {
    let secret = formSecret
    if (header?.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      const [, basicSecret = ''] = decoded.split(':')
      secret = basicSecret
    }
    if (client.secret && (!secret || !constantTimeEqual(secret, client.secret))) throw new OAuthLoginError(401, 'Invalid client_secret')
  }

  private signIdToken(claims: Record<string, unknown>): string {
    const header = json({ alg: 'RS256', typ: 'JWT', kid: this.keyId })
    const payload = json(claims)
    const input = `${header}.${payload}`
    const signer = createSign('RSA-SHA256')
    signer.update(input)
    signer.end()
    return `${input}.${base64Url(signer.sign(this.key.privateKey))}`
  }
}
