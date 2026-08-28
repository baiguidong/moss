import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AuthService } from '../auth/service.js'
import { OAuthLoginError, OAuthLoginService } from '../auth/oauth.js'
import type { ServerOAuthConfig } from '../types.js'

function oauthConfig(overrides: Partial<ServerOAuthConfig> = {}): ServerOAuthConfig {
  return {
    enabled: true,
    providerId: 'test-idp',
    authorizationUrl: 'https://idp.example.com/oauth/authorize',
    tokenUrl: 'https://idp.example.com/oauth/token',
    userInfoUrl: 'https://idp.example.com/oauth/userinfo',
    clientId: 'moss-client',
    clientSecret: 'moss-secret',
    redirectUri: 'https://moss.example.com/api/v1/auth/oauth/callback',
    scopes: ['openid', 'profile', 'email'],
    tokenEndpointAuthMethod: 'client_secret_post',
    autoProvision: true,
    defaultRole: 'user',
    requireVerifiedEmail: true,
    allowedEmailDomains: [],
    ...overrides,
  }
}

function authService() {
  let sequence = 0
  const activeKeys = new Set<string>()
  let currentKey: string | null = null
  const user = {
    id: 'oauth-user',
    orgId: 'org-1',
    email: 'user@example.com',
    name: 'OAuth User',
    departmentId: null,
    role: 'user',
    status: 'active' as const,
    tokenLimit: null,
    createdAt: 1,
    passwordUpdatedAt: null,
    lastLoginAt: 1,
  }
  const service = {
    issuePermanentApiKeyFromOAuth(input: { requireVerifiedEmail: boolean; emailVerified: boolean }) {
      if (input.requireVerifiedEmail && !input.emailVerified) {
        const error = new OAuthLoginError(403, 'OAuth email is not verified')
        error.name = 'AuthServiceError'
        throw error
      }
      if (currentKey) activeKeys.delete(currentKey)
      sequence += 1
      currentKey = `moss_sk_key-${sequence}.secret-${sequence}`
      activeKeys.add(currentKey)
      return {
        api_key: currentKey,
        key: {
          id: `key-${sequence}`,
          orgId: 'org-1',
          userId: user.id,
          name: 'oauth:test-idp',
          prefix: currentKey.slice(0, 16),
          scopes: ['sessions:create', 'sessions:attach', 'sessions:list'],
          status: 'active' as const,
          createdAt: sequence,
          lastUsedAt: null,
        },
        user,
        organization: { id: 'org-1', name: 'Default Organization', createdAt: 1 },
        scopes: ['sessions:create', 'sessions:attach', 'sessions:list'],
      }
    },
  } as unknown as AuthService
  return {
    service,
    isActive(apiKey: string) {
      return activeKeys.has(apiKey)
    },
  }
}

function providerFetch(profile: Record<string, unknown> = {
  sub: 'subject-1',
  email: 'user@example.com',
  email_verified: true,
  name: 'OAuth User',
}) {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.endsWith('/oauth/token')) {
      return Response.json({ access_token: 'provider-access-token', token_type: 'Bearer' })
    }
    if (url.endsWith('/oauth/userinfo')) {
      return Response.json(profile)
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return { fetchImpl, requests }
}

describe('OAuth login service', () => {
  test('uses state and PKCE, then returns a permanent API key exactly once', async () => {
    const auth = authService()
    const provider = providerFetch()
    const service = new OAuthLoginService(oauthConfig(), auth.service, provider.fetchImpl)

    const started = service.start()
    const authorizationUrl = new URL(started.authorization_url)
    expect(authorizationUrl.searchParams.get('response_type')).toBe('code')
    expect(authorizationUrl.searchParams.get('state')).toBeTruthy()
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizationUrl.searchParams.get('code_challenge')).toHaveLength(43)
    expect(started.authorization_url).not.toContain('moss-secret')
    expect(service.exchange(started.transaction_id)).toEqual({ pending: true, retry_after: 1 })

    const callback = await service.completeCallback({
      state: authorizationUrl.searchParams.get('state') || '',
      code: 'authorization-code',
    })
    expect(callback).toEqual({ ok: true })

    const exchanged = service.exchange(started.transaction_id)
    expect(exchanged.pending).toBe(false)
    if (exchanged.pending) throw new Error('OAuth exchange remained pending')
    expect(exchanged.api_key).toStartWith('moss_sk_')
    expect(exchanged.key).not.toHaveProperty('secretHash')
    expect(exchanged.user).toMatchObject({ email: 'user@example.com', role: 'user' })
    expect(auth.isActive(exchanged.api_key)).toBe(true)
    expect(() => service.exchange(started.transaction_id)).toThrow('not found or has expired')

    const tokenRequest = provider.requests.find(request => request.url.endsWith('/oauth/token'))
    expect(String(tokenRequest?.init?.body)).toContain('code_verifier=')
    expect(tokenRequest?.init?.redirect).toBe('error')
    const userInfoRequest = provider.requests.find(request => request.url.endsWith('/oauth/userinfo'))
    expect((userInfoRequest?.init?.headers as Record<string, string>).authorization)
      .toBe('Bearer provider-access-token')
    expect(userInfoRequest?.init?.redirect).toBe('error')
  })

  test('rotates the OAuth-issued key on a later login', async () => {
    const auth = authService()
    const provider = providerFetch()
    const service = new OAuthLoginService(oauthConfig(), auth.service, provider.fetchImpl)

    const first = service.start()
    await service.completeCallback({
      state: new URL(first.authorization_url).searchParams.get('state') || '',
      code: 'code-1',
    })
    const firstResult = service.exchange(first.transaction_id)
    if (firstResult.pending) throw new Error('First login remained pending')

    const second = service.start()
    await service.completeCallback({
      state: new URL(second.authorization_url).searchParams.get('state') || '',
      code: 'code-2',
    })
    const secondResult = service.exchange(second.transaction_id)
    if (secondResult.pending) throw new Error('Second login remained pending')

    expect(secondResult.api_key).not.toBe(firstResult.api_key)
    expect(auth.isActive(firstResult.api_key)).toBe(false)
    expect(auth.isActive(secondResult.api_key)).toBe(true)
    expect(secondResult.user.id).toBe(firstResult.user.id)
  })

  test('rejects an unclaimed result after a newer login supersedes it', async () => {
    const auth = authService()
    const provider = providerFetch()
    const service = new OAuthLoginService(oauthConfig(), auth.service, provider.fetchImpl)

    const first = service.start()
    await service.completeCallback({
      state: new URL(first.authorization_url).searchParams.get('state') || '',
      code: 'code-1',
    })

    const second = service.start()
    await service.completeCallback({
      state: new URL(second.authorization_url).searchParams.get('state') || '',
      code: 'code-2',
    })

    expect(() => service.exchange(first.transaction_id)).toThrow('superseded by a newer login')
    const secondResult = service.exchange(second.transaction_id)
    if (secondResult.pending) throw new Error('Second login remained pending')
    expect(auth.isActive(secondResult.api_key)).toBe(true)
  })

  test('uses only HTTP Basic client authentication and accepts a numeric provider id', async () => {
    const auth = authService()
    const provider = providerFetch({
      id: 12345,
      email: 'user@example.com',
      email_verified: true,
      name: 'OAuth User',
    })
    const config = oauthConfig({
      clientId: 'moss client',
      clientSecret: 'secret: value~',
      tokenEndpointAuthMethod: 'client_secret_basic',
    })
    const service = new OAuthLoginService(config, auth.service, provider.fetchImpl)
    const started = service.start()

    expect(await service.completeCallback({
      state: new URL(started.authorization_url).searchParams.get('state') || '',
      code: 'authorization-code',
    })).toEqual({ ok: true })
    const result = service.exchange(started.transaction_id)
    expect(result.pending).toBe(false)

    const tokenRequest = provider.requests.find(request => request.url.endsWith('/oauth/token'))
    const tokenBody = new URLSearchParams(String(tokenRequest?.init?.body))
    expect(tokenBody.has('client_id')).toBe(false)
    expect(tokenBody.has('client_secret')).toBe(false)
    const encode = (value: string) =>
      new URLSearchParams({ value }).toString().slice('value='.length)
    expect((tokenRequest?.init?.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from(`${encode(config.clientId)}:${encode(config.clientSecret)}`).toString('base64')}`,
    )
  })

  test('rejects an unverified email without returning provider secrets', async () => {
    const auth = authService()
    const provider = providerFetch({
      sub: 'subject-2',
      email: 'unverified@example.com',
      email_verified: false,
    })
    const service = new OAuthLoginService(oauthConfig(), auth.service, provider.fetchImpl)
    const started = service.start()

    expect(await service.completeCallback({
      state: new URL(started.authorization_url).searchParams.get('state') || '',
      code: 'authorization-code',
    })).toEqual({ ok: false })
    expect(() => service.exchange(started.transaction_id)).toThrow('OAuth email is not verified')
  })

  test('preserves an upstream provider failure status for the exchange response', async () => {
    const auth = authService()
    const fetchImpl = (async () => new Response('unavailable', { status: 503 })) as typeof fetch
    const service = new OAuthLoginService(oauthConfig(), auth.service, fetchImpl)
    const started = service.start()

    expect(await service.completeCallback({
      state: new URL(started.authorization_url).searchParams.get('state') || '',
      code: 'authorization-code',
    })).toEqual({ ok: false })

    try {
      service.exchange(started.transaction_id)
      throw new Error('Expected OAuth exchange to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthLoginError)
      expect((error as OAuthLoginError).statusCode).toBe(502)
      expect((error as Error).message).toBe('OAuth token exchange failed')
    }
  })

  test('persists only the API key hash and rotates keys in Node SQLite', async () => {
    const outdir = await mkdtemp(join(tmpdir(), 'moss-oauth-node-test-'))
    try {
      const entrypoint = join(
        dirname(fileURLToPath(import.meta.url)),
        'oauthPersistence.node.ts',
      )
      const build = await Bun.build({
        entrypoints: [entrypoint],
        outdir,
        target: 'node',
        format: 'esm',
      })
      expect(build.success).toBe(true)
      const output = build.outputs[0]
      if (!output) throw new Error('Node OAuth persistence test did not build')
      const process = Bun.spawn(['node', output.path], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exitCode, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ])
      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
    } finally {
      await rm(outdir, { recursive: true, force: true })
    }
  })
})
