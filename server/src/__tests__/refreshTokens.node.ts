import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createAuthService } from '../auth/service.js'
import { OAuthLoginService } from '../auth/oauth.js'
import { OidcService } from '../auth/oidc.js'
import { initializeDatabase, requireSchema } from '../model/index.js'
import { openTestDatabase, serverTestModels } from './databaseTestUtils.js'
import { startServer } from '../server.js'
import type { ServerConfig } from '../types.js'

const DAY = 86400_000
const originalNow = Date.now
const oidcConfig = {
  enabled: true, newApiClientId: 'new-api', desktopClientId: 'custom-desktop',
  webClientId: 'moss-web', webClientSecret: 'a-secret-long-enough', trustedRedirectUris: [],
}

async function fixture(sessionOptions: { refreshTokenIdleTtlSec?: number; sessionMaxTtlSec?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'moss-refresh-'))
  const filename = join(root, 'server.db')
  let db = await openTestDatabase(filename)
  const setup = async () => {
    const { service } = await createAuthService({
      db, tokenTtlSec: 3600,
      ...sessionOptions,
      bootstrapAdmin: { username: 'admin', password: 'admin-password' },
    })
    const oauth = new OAuthLoginService(service)
    const oidc = new OidcService({ oidc: oidcConfig } as ServerConfig, service, oauth, 'https://moss.example')
    return { service, oauth, oidc }
  }
  const services = await setup()
  return {
    ...services,
    get db() { return db },
    root,
    async restart() { await db.close(); db = await openTestDatabase(filename); return setup() },
    async close() { Date.now = originalNow; await db.close(); await rm(root, { recursive: true, force: true }) },
  }
}

async function login(f: Awaited<ReturnType<typeof fixture>>) {
  const verifier = 'v'.repeat(64)
  const redirectUri = 'http://127.0.0.1:54321/callback'
  const started = await f.oauth.start({
    redirectUri, state: 's'.repeat(43),
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256',
  })
  const callback = new URL(await f.oauth.authorizeWithPassword({
    transactionId: started.authorization_url.split('/').at(-1)!,
    loginIdentifier: 'admin', password: 'admin-password',
  }))
  return f.oidc.token(new URLSearchParams({
    grant_type: 'authorization_code', client_id: oidcConfig.desktopClientId,
    code: callback.searchParams.get('code')!, redirect_uri: redirectUri, code_verifier: verifier,
  }), undefined)
}

async function refresh(oidc: OidcService, token: unknown, clientId = oidcConfig.desktopClientId) {
  return oidc.token(new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: String(token) }), undefined)
}

test('OIDC refresh survives restart and access expiry; only token hashes are stored', async () => {
  const f = await fixture()
  try {
    const first = await login(f)
    assert.equal(first.expires_in, 3600)
    assert.equal(first.refresh_token_expires_in, 30 * 86400)
    assert.equal(first.session_expires_in, 90 * 86400)
    const rows = await f.db.prepare('SELECT * FROM oauth_refresh_tokens').all()
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.token_hash, createHash('sha256').update(String(first.refresh_token)).digest('hex'))
    assert.ok(!JSON.stringify(rows).includes(String(first.refresh_token)))
    const start = originalNow()
    Date.now = () => start + 2 * 3600_000
    const restarted = await f.restart()
    assert.equal(await restarted.service.verifyAccessToken(String(first.access_token)), null)
    const next = await refresh(restarted.oidc, first.refresh_token)
    assert.notEqual(next.refresh_token, first.refresh_token)
    assert.ok(await restarted.service.verifyAccessToken(String(next.access_token)))
    assert.ok((restarted.oidc.discovery().grant_types_supported as string[]).includes('refresh_token'))
  } finally { await f.close() }
})

test('refresh extends the 30-day idle window but never the 90-day absolute limit', async () => {
  const f = await fixture()
  const start = originalNow()
  Date.now = () => start
  try {
    let result = await login(f)
    for (const day of [29, 58, 87]) {
      Date.now = () => start + day * DAY
      result = await refresh(f.oidc, result.refresh_token)
      assert.equal(result.session_expires_in, (90 - day) * 86400)
    }
    Date.now = () => start + 90 * DAY - 1800_000
    result = await refresh(f.oidc, result.refresh_token)
    assert.ok(Number(result.expires_in) <= 1800)
    assert.equal(result.refresh_token_expires_in, 1800)
    Date.now = () => start + 90 * DAY
    await assert.rejects(refresh(f.oidc, result.refresh_token), /invalid_grant/)
    assert.equal(await f.service.verifyAccessToken(String(result.access_token)), null)
  } finally { await f.close() }
})

test('30 days without refresh requires a fresh login', async () => {
  const f = await fixture()
  const start = originalNow()
  Date.now = () => start
  try {
    const result = await login(f)
    Date.now = () => start + 30 * DAY
    await assert.rejects(refresh(f.oidc, result.refresh_token), /invalid_grant/)
  } finally { await f.close() }
})

test('configured session limits also cap the first access token', async () => {
  const f = await fixture({ refreshTokenIdleTtlSec: 60, sessionMaxTtlSec: 120 })
  const start = originalNow()
  Date.now = () => start
  try {
    const first = await login(f)
    assert.equal(first.expires_in, 120)
    assert.equal(first.refresh_token_expires_in, 60)
    assert.equal(first.session_expires_in, 120)
  } finally { await f.close() }
})

test('wrong clients cannot refresh; reuse revokes every successor in the session', async () => {
  const f = await fixture()
  try {
    const first = await login(f)
    await assert.rejects(refresh(f.oidc, first.refresh_token, 'new-api'), /invalid_grant/)
    await assert.rejects(refresh(f.oidc, first.refresh_token, 'moss-web'), /Invalid client_secret/)
    const second = await refresh(f.oidc, first.refresh_token)
    await assert.rejects(refresh(f.oidc, first.refresh_token), /invalid_grant/)
    await assert.rejects(refresh(f.oidc, second.refresh_token), /invalid_grant/)
  } finally { await f.close() }
})

test('concurrent refreshes consume the old token only once', async () => {
  const f = await fixture()
  try {
    const first = await login(f)
    const results = await Promise.allSettled([refresh(f.oidc, first.refresh_token), refresh(f.oidc, first.refresh_token)])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter(result => result.status === 'rejected').length, 1)
    const winner = results.find(result => result.status === 'fulfilled')!
    if (winner.status === 'fulfilled') await assert.rejects(refresh(f.oidc, winner.value.refresh_token), /invalid_grant/)
  } finally { await f.close() }
})

test('logout revokes the session even when the provided token was already rotated', async () => {
  const f = await fixture()
  try {
    const first = await login(f)
    const next = await refresh(f.oidc, first.refresh_token)
    await f.service.revokeRefreshToken(String(first.refresh_token), 'new-api')
    const latest = await refresh(f.oidc, next.refresh_token)
    await f.oidc.revoke(new URLSearchParams({ token: String(first.refresh_token), client_id: oidcConfig.desktopClientId }), undefined)
    const restarted = await f.restart()
    await assert.rejects(refresh(restarted.oidc, latest.refresh_token), /invalid_grant/)
    await restarted.service.revokeRefreshToken(String(first.refresh_token), oidcConfig.desktopClientId)
    await restarted.service.revokeRefreshToken('unknown-token', oidcConfig.desktopClientId)
  } finally { await f.close() }
})

test('refresh uses current permissions and rejects disabled users and password changes', async () => {
  const f = await fixture()
  try {
    const first = await login(f)
    await f.db.prepare('DELETE FROM role_permissions').run()
    const next = await refresh(f.oidc, first.refresh_token)
    assert.deepEqual((await f.service.verifyAccessToken(String(next.access_token)))?.scopes, [])
    await f.db.prepare("UPDATE users SET status = 'disabled'").run()
    await assert.rejects(refresh(f.oidc, next.refresh_token), /invalid_grant/)
    await f.db.prepare("UPDATE users SET status = 'active'").run()
    const another = await login(f)
    await f.db.prepare('UPDATE users SET password_updated_at = password_updated_at + 1').run()
    await assert.rejects(refresh(f.oidc, another.refresh_token), /invalid_grant/)
  } finally { await f.close() }
})

test('version 8 upgrades refresh storage without losing data and remains repeatable', async () => {
  const f = await fixture()
  try {
    await f.db.exec('DROP TABLE oauth_refresh_tokens')
    await f.db.prepare('UPDATE model_schema SET version=8 WHERE id=1').run()
    await initializeDatabase(f.db)
    await initializeDatabase(f.db)
    await requireSchema(f.db)
    assert.equal((await f.db.prepare('SELECT version FROM model_schema WHERE id=1').get())!.version, 9)
    assert.ok((await login(f)).refresh_token)
  } finally { await f.close() }
})

test('HTTP token endpoint returns no-store refresh responses and rejects invalid grants', async () => {
  const f = await fixture()
  const server = startServer({
    host: '127.0.0.1', port: 0, rootDir: f.root, dataDir: f.root,
    runDir: f.root, logDir: f.root, oidc: oidcConfig,
  } as ServerConfig, serverTestModels(f.db), f.service)
  try {
    const base = `http://127.0.0.1:${await server.ready}`
    const first = await login(f)
    const post = (token: unknown) => fetch(`${base}/oidc/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: oidcConfig.desktopClientId, refresh_token: String(token) }),
    })
    const response = await post(first.refresh_token)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const next = await response.json() as Record<string, unknown>
    assert.ok(next.access_token && next.refresh_token)
    const reused = await post(first.refresh_token)
    assert.equal(reused.status, 400)
    assert.equal(reused.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await reused.json(), { error: 'invalid_grant' })
    const another = await login(f)
    const revoked = await fetch(`${base}/api/v1/auth/oauth/revoke`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: another.refresh_token }),
    })
    assert.equal(revoked.status, 200)
    assert.equal(revoked.headers.get('cache-control'), 'no-store')
    assert.equal((await post(another.refresh_token)).status, 400)
    const unknown = await fetch(`${base}/oidc/revoke`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: 'unknown', client_id: oidcConfig.desktopClientId }),
    })
    assert.equal(unknown.status, 200)
    assert.equal(unknown.headers.get('cache-control'), 'no-store')
  } finally { await server.stop(); await f.close() }
})
