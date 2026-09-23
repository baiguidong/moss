import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OAuthLoginError, OAuthLoginService } from '../auth/oauth.js'
import type { AuthService } from '../auth/service.js'
import { buildNodeFixture } from './buildNodeFixture.js'

const REDIRECT_URI = 'http://127.0.0.1:54321/callback'
const STATE = 's'.repeat(43)
const CODE_VERIFIER = 'v'.repeat(64)
const CODE_CHALLENGE = createHash('sha256')
  .update(CODE_VERIFIER, 'ascii')
  .digest('base64url')

function authService() {
  let sequence = 0
  let currentKey: string | null = null
  const activeKeys = new Set<string>()
  const authorizationRequests = new Map<
    string,
    {
      id: string
      redirectUri: string
      state: string
      codeChallenge: string
      expiresAt: number
      passwordAttempts: number
    }
  >()
  const authorizationCodes = new Map<
    string,
    {
      code: string
      redirectUri: string
      state: string
      codeChallenge: string
      userId: string
      orgId: string
      expiresAt: number
    }
  >()
  const user = {
    id: 'user-1',
    orgId: 'org-1',
    email: 'user@example.com',
    name: 'Moss User',
    departmentId: null,
    role: 'user',
    status: 'active' as const,
    tokenLimit: null,
    createdAt: 1,
    passwordUpdatedAt: 1,
    lastLoginAt: 1,
  }
  const service = {
    pruneOAuthAuthorizationRecords(currentTime: number) {
      for (const [id, request] of authorizationRequests) {
        if (request.expiresAt <= currentTime) authorizationRequests.delete(id)
      }
      for (const [code, authorization] of authorizationCodes) {
        if (authorization.expiresAt <= currentTime)
          authorizationCodes.delete(code)
      }
    },
    countOAuthAuthorizationRecords() {
      return authorizationRequests.size + authorizationCodes.size
    },
    createOAuthAuthorizationRequest(request: any) {
      authorizationRequests.set(request.id, { ...request })
    },
    getOAuthAuthorizationRequest(id: string, currentTime: number) {
      const request = authorizationRequests.get(id)
      return request && request.expiresAt > currentTime ? { ...request } : null
    },
    incrementOAuthAuthorizationAttempts(id: string, currentTime: number) {
      const request = authorizationRequests.get(id)
      if (!request || request.expiresAt <= currentTime) return null
      request.passwordAttempts += 1
      return { ...request }
    },
    deleteOAuthAuthorizationRequest(id: string) {
      authorizationRequests.delete(id)
    },
    deleteOAuthAuthorizationRequestByState(state: string, redirectUri: string) {
      let deleted = false
      for (const [id, request] of authorizationRequests) {
        if (request.state === state && request.redirectUri === redirectUri) {
          authorizationRequests.delete(id)
          deleted = true
        }
      }
      return deleted
    },
    consumeOAuthAuthorizationRequest(id: string, currentTime: number) {
      const request = authorizationRequests.get(id)
      authorizationRequests.delete(id)
      return request && request.expiresAt > currentTime ? { ...request } : null
    },
    completeOAuthAuthorization(
      requestId: string,
      authorization: any,
      currentTime: number,
    ) {
      const request = authorizationRequests.get(requestId)
      if (!request || request.expiresAt <= currentTime) return false
      authorizationRequests.delete(requestId)
      authorizationCodes.set(authorization.code, { ...authorization })
      return true
    },
    consumeOAuthAuthorizationCode(code: string, currentTime: number) {
      const authorization = authorizationCodes.get(code)
      authorizationCodes.delete(code)
      return authorization && authorization.expiresAt > currentTime
        ? { ...authorization }
        : null
    },
    deleteOAuthAuthorizationCode(code: string, redirectUri: string) {
      const authorization = authorizationCodes.get(code)
      if (!authorization || authorization.redirectUri !== redirectUri)
        return false
      authorizationCodes.delete(code)
      return true
    },
    deleteOAuthAuthorizationCodeByState(state: string, redirectUri: string) {
      let deleted = false
      for (const [code, authorization] of authorizationCodes) {
        if (
          authorization.state === state &&
          authorization.redirectUri === redirectUri
        ) {
          authorizationCodes.delete(code)
          deleted = true
        }
      }
      return deleted
    },
    authenticatePasswordForOAuth(input: { password: string }) {
      if (input.password !== 'correct-password') {
        const error = new OAuthLoginError(
          401,
          'Invalid username/email or password',
        )
        error.name = 'AuthServiceError'
        throw error
      }
      return {
        user,
        organization: {
          id: 'org-1',
          name: 'Default Organization',
          createdAt: 1,
        },
        scopes: ['sessions:create', 'sessions:attach', 'sessions:list'],
      }
    },
    issuePermanentApiKeyForOAuthUser() {
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
          name: 'oauth:browser-login',
          prefix: currentKey.slice(0, 16),
          scopes: ['sessions:create', 'sessions:attach', 'sessions:list'],
          status: 'active' as const,
          createdAt: sequence,
          lastUsedAt: null,
        },
        user,
        organization: {
          id: 'org-1',
          name: 'Default Organization',
          createdAt: 1,
        },
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

async function start(
  service: OAuthLoginService,
  overrides: Record<string, string> = {},
) {
  return await service.start({
    redirectUri: REDIRECT_URI,
    state: STATE,
    codeChallenge: CODE_CHALLENGE,
    codeChallengeMethod: 'S256',
    ...overrides,
  })
}

function transactionId(authorizationUrl: string): string {
  const url = new URL(authorizationUrl, 'http://moss.local')
  return url.pathname.split('/').pop() || ''
}

describe('OAuth browser login service', () => {
  test('accepts only a loopback callback and PKCE S256', async () => {
    const service = new OAuthLoginService(authService().service)
    await expect(
      (async () =>
        await start(service, {
          redirectUri: 'https://attacker.example.com/callback',
        }))(),
    ).rejects.toThrow('redirect_uri must be an HTTP loopback URL')
    await expect(
      (async () =>
        await start(service, {
          codeChallengeMethod: 'plain',
        }))(),
    ).rejects.toThrow('code_challenge_method must be S256')
  })

  test('authenticates in the browser and exchanges a code exactly once', async () => {
    const auth = authService()
    const service = new OAuthLoginService(auth.service)
    const started = await start(service)
    const id = transactionId(started.authorization_url)
    expect(await service.getAuthorizationRequest(id)).toEqual({
      transactionId: id,
      redirectUri: REDIRECT_URI,
    })

    const callbackUrl = new URL(
      await service.authorizeWithPassword({
        transactionId: id,
        loginIdentifier: 'user@example.com',
        password: 'correct-password',
      }),
    )
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(REDIRECT_URI)
    expect(callbackUrl.searchParams.get('state')).toBe(STATE)
    const code = callbackUrl.searchParams.get('code') || ''

    const result = await service.exchange({
      code,
      codeVerifier: CODE_VERIFIER,
      redirectUri: REDIRECT_URI,
    })
    expect(result.api_key).toStartWith('moss_sk_')
    expect(result.key).not.toHaveProperty('secretHash')
    expect(auth.isActive(result.api_key)).toBe(true)
    await expect(
      (async () =>
        await service.exchange({
          code,
          codeVerifier: CODE_VERIFIER,
          redirectUri: REDIRECT_URI,
        }))(),
    ).rejects.toThrow('授权码无效或已过期')
  })

  test('survives an OAuth service restart through the shared store', async () => {
    const auth = authService()
    const firstProcess = new OAuthLoginService(auth.service)
    const started = await start(firstProcess)
    const id = transactionId(started.authorization_url)

    const secondProcess = new OAuthLoginService(auth.service)
    expect(await secondProcess.getAuthorizationRequest(id)).toEqual({
      transactionId: id,
      redirectUri: REDIRECT_URI,
    })
    const callback = new URL(
      await secondProcess.authorizeWithPassword({
        transactionId: id,
        loginIdentifier: 'user@example.com',
        password: 'correct-password',
      }),
    )

    const thirdProcess = new OAuthLoginService(auth.service)
    const result = await thirdProcess.exchange({
      code: callback.searchParams.get('code') || '',
      codeVerifier: CODE_VERIFIER,
      redirectUri: REDIRECT_URI,
    })
    expect(result.api_key).toStartWith('moss_sk_')
  })

  test('allows a retry after an invalid password', async () => {
    const service = new OAuthLoginService(authService().service)
    const started = await start(service)
    const id = transactionId(started.authorization_url)
    await expect(
      (async () =>
        await service.authorizeWithPassword({
          transactionId: id,
          loginIdentifier: 'user@example.com',
          password: 'wrong-password',
        }))(),
    ).rejects.toThrow('用户名、邮箱或密码不正确')
    expect(
      await service.authorizeWithPassword({
        transactionId: id,
        loginIdentifier: 'user@example.com',
        password: 'correct-password',
      }),
    ).toContain('code=')
  })

  test('removes a pending request when the desktop client cancels', async () => {
    const service = new OAuthLoginService(authService().service)
    const started = await start(service)
    const id = transactionId(started.authorization_url)
    expect(
      await service.cancelClientRequest({
        state: STATE,
        redirectUri: REDIRECT_URI,
      }),
    ).toEqual({ canceled: true })
    expect(
      await service.cancelClientRequest({
        state: STATE,
        redirectUri: REDIRECT_URI,
      }),
    ).toEqual({ canceled: false })
    await expect(
      (async () => await service.getAuthorizationRequest(id))(),
    ).rejects.toThrow('授权请求无效或已过期')
  })

  test('still removes a pending request when cancellation contains a malformed code', async () => {
    const service = new OAuthLoginService(authService().service)
    const started = await start(service)
    const id = transactionId(started.authorization_url)
    await expect(
      (async () =>
        await service.cancelClientRequest({
          state: STATE,
          redirectUri: REDIRECT_URI,
          code: 'malformed',
        }))(),
    ).rejects.toThrow('Invalid code')
    await expect(
      (async () => await service.getAuthorizationRequest(id))(),
    ).rejects.toThrow('授权请求无效或已过期')
  })

  test('removes an issued code when the desktop client cancels during exchange', async () => {
    const service = new OAuthLoginService(authService().service)
    const started = await start(service)
    const callback = new URL(
      await service.authorizeWithPassword({
        transactionId: transactionId(started.authorization_url),
        loginIdentifier: 'user@example.com',
        password: 'correct-password',
      }),
    )
    const code = callback.searchParams.get('code') || ''
    expect(
      await service.cancelClientRequest({
        state: STATE,
        redirectUri: REDIRECT_URI,
        code,
      }),
    ).toEqual({ canceled: true })
    await expect(
      (async () =>
        await service.exchange({
          code,
          codeVerifier: CODE_VERIFIER,
          redirectUri: REDIRECT_URI,
        }))(),
    ).rejects.toThrow('授权码无效或已过期')
  })

  test('removes an issued code by state when the callback never reaches the client', async () => {
    const service = new OAuthLoginService(authService().service)
    const started = await start(service)
    const callback = new URL(
      await service.authorizeWithPassword({
        transactionId: transactionId(started.authorization_url),
        loginIdentifier: 'user@example.com',
        password: 'correct-password',
      }),
    )
    const code = callback.searchParams.get('code') || ''
    expect(
      await service.cancelClientRequest({
        state: STATE,
        redirectUri: REDIRECT_URI,
      }),
    ).toEqual({ canceled: true })
    await expect(
      (async () =>
        await service.exchange({
          code,
          codeVerifier: CODE_VERIFIER,
          redirectUri: REDIRECT_URI,
        }))(),
    ).rejects.toThrow('授权码无效或已过期')
  })

  test('consumes a code when PKCE or redirect verification fails', async () => {
    const service = new OAuthLoginService(authService().service)
    const started = await start(service)
    const callback = new URL(
      await service.authorizeWithPassword({
        transactionId: transactionId(started.authorization_url),
        loginIdentifier: 'user@example.com',
        password: 'correct-password',
      }),
    )
    const code = callback.searchParams.get('code') || ''
    await expect(
      (async () =>
        await service.exchange({
          code,
          codeVerifier: 'x'.repeat(64),
          redirectUri: REDIRECT_URI,
        }))(),
    ).rejects.toThrow('授权码校验失败')
    await expect(
      (async () =>
        await service.exchange({
          code,
          codeVerifier: CODE_VERIFIER,
          redirectUri: REDIRECT_URI,
        }))(),
    ).rejects.toThrow('授权码无效或已过期')
  })

  test('returns an access_denied callback when the user cancels', async () => {
    const service = new OAuthLoginService(authService().service)
    const started = await start(service)
    const id = transactionId(started.authorization_url)
    const callback = new URL(await service.cancel(id))
    expect(callback.searchParams.get('error')).toBe('access_denied')
    expect(callback.searchParams.get('state')).toBe(STATE)
    await expect(
      (async () => await service.getAuthorizationRequest(id))(),
    ).rejects.toThrow('授权请求无效或已过期')
  })

  test('rotates the prior browser-login API key', async () => {
    const auth = authService()
    const service = new OAuthLoginService(auth.service)
    const login = async () => {
      const started = await start(service)
      const callback = new URL(
        await service.authorizeWithPassword({
          transactionId: transactionId(started.authorization_url),
          loginIdentifier: 'user@example.com',
          password: 'correct-password',
        }),
      )
      return await service.exchange({
        code: callback.searchParams.get('code') || '',
        codeVerifier: CODE_VERIFIER,
        redirectUri: REDIRECT_URI,
      })
    }
    const first = await login()
    const second = await login()
    expect(second.api_key).not.toBe(first.api_key)
    expect(auth.isActive(first.api_key)).toBe(false)
    expect(auth.isActive(second.api_key)).toBe(true)
  })

  test('persists only the API key hash and completes the HTTP flow in Node', async () => {
    const outdir = await mkdtemp(join(tmpdir(), 'moss-oauth-node-test-'))
    try {
      const entrypoint = join(
        dirname(fileURLToPath(import.meta.url)),
        'oauthPersistence.node.ts',
      )
      const build = await buildNodeFixture({
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
        env: { ...Bun.env, NODE_NO_WARNINGS: '1' },
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
  }, 15_000)
})
