import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { createAuthService } from '../auth/service.js'
import { startServer } from '../server.js'
import type { RuntimeService } from '../runtimeService.js'
import type { ServerConfig } from '../types.js'

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
}

function writeJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

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
  const login = () => service.issuePermanentApiKeyFromOAuth({
    providerId: 'test-idp',
    subject: 'subject-1',
    email: 'oauth-user@example.com',
    emailVerified: true,
    name: 'OAuth User',
    autoProvision: true,
    requireVerifiedEmail: true,
    allowedEmailDomains: ['example.com'],
  })

  const first = login()
  assert.match(first.api_key, /^moss_sk_/)
  assert.equal(service.issueTokenFromApiKey(first.api_key).user.id, first.user.id)
  const stored = db.prepare('SELECT secret_hash FROM api_keys WHERE id = ?').get(first.key.id) as {
    secret_hash: string
  }
  assert.ok(stored.secret_hash)
  assert.equal(JSON.stringify(stored).includes(first.api_key), false)

  const second = login()
  assert.notEqual(second.api_key, first.api_key)
  assert.equal(second.user.id, first.user.id)
  assert.throws(() => service.issueTokenFromApiKey(first.api_key), /Invalid API key/)
  assert.equal(service.issueTokenFromApiKey(second.api_key).user.id, first.user.id)

  const admin = db.prepare(
    'SELECT id FROM users WHERE email = ?',
  ).get('admin@example.com') as { id: string }
  const keyCountBeforeLinkAttempt = Number((db.prepare(
    'SELECT COUNT(*) AS count FROM api_keys',
  ).get() as { count: number }).count)
  const unverifiedLogin = service.issuePermanentApiKeyFromOAuth({
    providerId: 'test-idp',
    subject: 'unverified-admin-subject',
    email: 'admin@example.com',
    emailVerified: false,
    name: 'Unverified Admin',
    autoProvision: true,
    requireVerifiedEmail: false,
    allowedEmailDomains: ['example.com'],
  })
  assert.notEqual(unverifiedLogin.user.id, admin.id)
  assert.equal(unverifiedLogin.user.role, 'user')
  assert.equal(unverifiedLogin.user.email, null)
  assert.deepEqual(unverifiedLogin.scopes, [
    'sessions:create',
    'sessions:attach',
    'sessions:list',
  ])
  const keyCountAfterLinkAttempt = Number((db.prepare(
    'SELECT COUNT(*) AS count FROM api_keys',
  ).get() as { count: number }).count)
  assert.equal(keyCountAfterLinkAttempt, keyCountBeforeLinkAttempt + 1)
  const isolatedIdentity = db.prepare(`
    SELECT user_id
    FROM oauth_identities
    WHERE provider_id = 'test-idp' AND subject = 'unverified-admin-subject'
  `).get() as { user_id: string }
  assert.equal(isolatedIdentity.user_id, unverifiedLogin.user.id)

  const provider = createServer(async (request, response) => {
    if (request.url === '/token' && request.method === 'POST') {
      for await (const _chunk of request) {}
      writeJson(response, { access_token: 'provider-access-token', token_type: 'Bearer' })
      return
    }
    if (
      request.url === '/userinfo' &&
      request.headers.authorization === 'Bearer provider-access-token'
    ) {
      writeJson(response, {
        sub: 'http-subject',
        email: 'http-user@example.com',
        email_verified: true,
        name: 'HTTP OAuth User',
      })
      return
    }
    response.writeHead(404)
    response.end()
  })
  const providerPort = await listen(provider)
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 0,
    authMode: 'local',
    tokenTtlSec: 3_600,
    oauth: {
      enabled: true,
      providerId: 'http-test-idp',
      authorizationUrl: `http://127.0.0.1:${providerPort}/authorize`,
      tokenUrl: `http://127.0.0.1:${providerPort}/token`,
      userInfoUrl: `http://127.0.0.1:${providerPort}/userinfo`,
      clientId: 'moss-http-test',
      clientSecret: 'moss-http-secret',
      redirectUri: 'http://127.0.0.1/api/v1/auth/oauth/callback',
      scopes: ['openid', 'profile', 'email'],
      tokenEndpointAuthMethod: 'client_secret_post',
      autoProvision: true,
      defaultRole: 'user',
      requireVerifiedEmail: true,
      allowedEmailDomains: ['example.com'],
    },
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
    config.oauth.redirectUri = `${baseUrl}/api/v1/auth/oauth/callback`

    const startResponse = await fetch(`${baseUrl}/api/v1/auth/oauth/start`, {
      method: 'POST',
    })
    assert.equal(startResponse.status, 200)
    assert.equal(startResponse.headers.get('cache-control'), 'no-store')
    const started = await startResponse.json() as {
      authorization_url: string
      transaction_id: string
    }
    const state = new URL(started.authorization_url).searchParams.get('state')
    assert.ok(state)

    const pendingResponse = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transaction_id: started.transaction_id }),
    })
    assert.equal(pendingResponse.status, 202)
    assert.equal(pendingResponse.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await pendingResponse.json(), { pending: true, retry_after: 1 })

    const callbackResponse = await fetch(
      `${baseUrl}/api/v1/auth/oauth/callback?state=${encodeURIComponent(state)}&code=http-code`,
    )
    assert.equal(callbackResponse.status, 200)
    assert.equal(callbackResponse.headers.get('cache-control'), 'no-store')
    assert.match(callbackResponse.headers.get('content-type') || '', /^text\/html/)
    assert.doesNotMatch(await callbackResponse.text(), /moss_sk_/)

    const exchangeResponse = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transaction_id: started.transaction_id }),
    })
    assert.equal(exchangeResponse.status, 200)
    assert.equal(exchangeResponse.headers.get('cache-control'), 'no-store')
    const exchanged = await exchangeResponse.json() as { api_key: string }
    assert.match(exchanged.api_key, /^moss_sk_/)
    assert.equal(service.issueTokenFromApiKey(exchanged.api_key).user.email, 'http-user@example.com')

    const replayResponse = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transaction_id: started.transaction_id }),
    })
    assert.equal(replayResponse.status, 404)
    assert.equal(replayResponse.headers.get('cache-control'), 'no-store')
    assert.doesNotMatch(await replayResponse.text(), /moss_sk_/)

    const invalidBodyResponse = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    assert.equal(invalidBodyResponse.status, 400)
    assert.equal(invalidBodyResponse.headers.get('cache-control'), 'no-store')

    const oversizedBodyResponse = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transaction_id: 'x'.repeat(5_000) }),
    })
    assert.equal(oversizedBodyResponse.status, 413)
    assert.equal(oversizedBodyResponse.headers.get('cache-control'), 'no-store')

    const invalidCallback = await fetch(
      `${baseUrl}/api/v1/auth/oauth/callback?state=invalid&code=http-code`,
    )
    assert.equal(invalidCallback.status, 400)
    assert.equal(invalidCallback.headers.get('cache-control'), 'no-store')
    assert.match(invalidCallback.headers.get('content-type') || '', /^text\/html/)
  } finally {
    await moss.stop()
    await close(provider)
  }
} finally {
  db.close()
}
