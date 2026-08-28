import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { createAuthService } from '../auth/service.js'
import { startServer } from '../server.js'
import type { RuntimeService } from '../runtimeService.js'
import type { ServerConfig } from '../types.js'

const db = new DatabaseSync(':memory:')
try {
  const { service } = await createAuthService({
    db,
    dbPath: ':memory:',
    tokenTtlSec: 3_600,
    bootstrapAdmin: {
      username: 'admin',
      password: 'admin-password',
      email: 'admin@example.com',
    },
  })
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 0,
    authMode: 'local',
    tokenTtlSec: 3_600,
    bootstrapAdmin: { username: 'admin' },
    idleTimeoutMs: 600_000,
    maxSessions: 32,
    rootDir: '/tmp/moss-oauth-http-test',
    dbPath: ':memory:',
    dataDir: '/tmp/moss-oauth-http-test/data',
    runDir: '/tmp/moss-oauth-http-test/run',
    logDir: '/tmp/moss-oauth-http-test/log',
    dockerStopTimeoutSec: 10,
    dockerLabels: {},
    startupPolicy: 'reattach-or-resume',
    heartbeatTimeoutMs: 30_000,
    reattachProbeTimeoutMs: 3_000,
    resumeOnMissingRuntime: true,
    logLevel: 'error',
  }
  const runtime = {
    store: { db },
    countActiveSessions: () => 0,
  } as unknown as RuntimeService
  const moss = startServer(config, runtime, service)
  try {
    const mossPort = await moss.ready
    assert.ok(mossPort)
    const baseUrl = `http://127.0.0.1:${mossPort}`
    const redirectUri = 'http://127.0.0.1:54321/callback'
    const state = 's'.repeat(43)
    const codeVerifier = 'v'.repeat(43)
    const codeChallenge = createHash('sha256')
      .update(codeVerifier, 'ascii')
      .digest('base64url')

    const login = async () => {
      const startResponse = await fetch(`${baseUrl}/api/v1/auth/oauth/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirect_uri: redirectUri,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        }),
      })
      assert.equal(startResponse.status, 200)
      assert.equal(startResponse.headers.get('cache-control'), 'no-store')
      const started = await startResponse.json() as { authorization_url: string }
      const authorizationUrl = new URL(started.authorization_url, baseUrl)

      const pageResponse = await fetch(authorizationUrl)
      assert.equal(pageResponse.status, 200)
      assert.equal(pageResponse.headers.get('cache-control'), 'no-store')
      assert.ok(
        (pageResponse.headers.get('content-security-policy') || '')
          .includes(`form-action 'self' ${redirectUri}`),
      )
      const page = await pageResponse.text()
      assert.match(page, /登录到 Moss Server/)
      assert.doesNotMatch(page, /admin-password/)
      const transactionId = authorizationUrl.pathname.split('/').at(-1)
      assert.ok(transactionId)

      const legacyPage = await fetch(
        `${baseUrl}/api/v1/auth/oauth/authorize?transaction_id=${transactionId}`,
      )
      assert.equal(legacyPage.status, 404)
      assert.doesNotMatch(await legacyPage.text(), /name="transaction_id"/)

      const failedLogin = await fetch(`${baseUrl}/api/v1/auth/oauth/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          transaction_id: transactionId,
          login_identifier: 'admin@example.com',
          password: 'wrong-password',
          action: 'authorize',
        }),
        redirect: 'manual',
      })
      assert.equal(failedLogin.status, 401)
      assert.equal(failedLogin.headers.get('cache-control'), 'no-store')
      assert.ok(
        (failedLogin.headers.get('content-security-policy') || '')
          .includes(`form-action 'self' ${redirectUri}`),
      )
      const failedPage = await failedLogin.text()
      assert.match(failedPage, /用户名、邮箱或密码不正确/)
      assert.match(failedPage, /value="admin@example\.com"/)

      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/oauth/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          transaction_id: transactionId,
          login_identifier: 'admin@example.com',
          password: 'admin-password',
          action: 'authorize',
        }),
        redirect: 'manual',
      })
      assert.equal(loginResponse.status, 303)
      assert.equal(loginResponse.headers.get('cache-control'), 'no-store')
      const callback = new URL(loginResponse.headers.get('location') || '')
      assert.equal(callback.origin + callback.pathname, redirectUri)
      assert.equal(callback.searchParams.get('state'), state)
      const code = callback.searchParams.get('code')
      assert.ok(code)

      const exchangeResponse = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
        }),
      })
      assert.equal(exchangeResponse.status, 200)
      assert.equal(exchangeResponse.headers.get('cache-control'), 'no-store')
      return await exchangeResponse.json() as {
        api_key: string
        key: { id: string }
        user: { id: string }
      }
    }

    const first = await login()
    assert.match(first.api_key, /^moss_sk_/)
    assert.equal(service.issueTokenFromApiKey(first.api_key).user.id, first.user.id)
    const stored = db.prepare('SELECT secret_hash FROM api_keys WHERE id = ?').get(first.key.id) as {
      secret_hash: string
    }
    assert.ok(stored.secret_hash)
    assert.equal(JSON.stringify(stored).includes(first.api_key), false)

    const second = await login()
    assert.notEqual(second.api_key, first.api_key)
    assert.throws(() => service.issueTokenFromApiKey(first.api_key), /Invalid API key/)
    assert.equal(service.issueTokenFromApiKey(second.api_key).user.id, first.user.id)

    const canceledStart = await fetch(`${baseUrl}/api/v1/auth/oauth/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }),
    })
    const canceledAuthorization = await canceledStart.json() as { authorization_url: string }
    const canceled = await fetch(`${baseUrl}/api/v1/auth/oauth/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uri: redirectUri, state }),
    })
    assert.equal(canceled.status, 200)
    assert.deepEqual(await canceled.json(), { canceled: true })
    const canceledPage = await fetch(new URL(canceledAuthorization.authorization_url, baseUrl))
    assert.equal(canceledPage.status, 404)
    assert.ok(
      (canceledPage.headers.get('content-security-policy') || '')
        .includes("form-action 'none'"),
    )
    assert.match(await canceledPage.text(), /授权请求无效或已过期/)

    const invalidRedirect = await fetch(`${baseUrl}/api/v1/auth/oauth/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uri: 'https://attacker.example.com/callback',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }),
    })
    assert.equal(invalidRedirect.status, 400)
    assert.equal(invalidRedirect.headers.get('cache-control'), 'no-store')
  } finally {
    await moss.stop()
  }
} finally {
  db.close()
}
