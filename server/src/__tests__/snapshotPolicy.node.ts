import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuthService } from '../auth/service.js'
import { startServer } from '../server.js'
import type { ServerConfig } from '../types.js'
import type { RuntimeService } from '../runtimeService.js'
import { openTestDatabase } from './databaseTestUtils.js'
const root = await mkdtemp(join(tmpdir(), 'moss-snapshot-http-'))
process.env.MOSS_SERVER_HOME = root
const db = await openTestDatabase(':memory:')
try {
  const { service: auth } = await createAuthService({ db, tokenTtlSec: 3600, bootstrapAdmin: { username: 'admin', password: 'fixture-password', email: 'admin@example.test' } })
  const admin = await auth.issueTokenFromPassword({ username: 'admin', password: 'fixture-password' })
  const principal = await auth.verifyAccessToken(admin.access_token)
  assert.ok(principal)
  await auth.createUser({ orgId: principal.orgId, name: 'reader', email: 'reader@example.test', role: 'user', password: 'reader-password' }, principal)
  const reader = await auth.issueTokenFromPassword({ username: 'reader', password: 'reader-password' })
  const config: ServerConfig = { host: '127.0.0.1', port: 0, authMode: 'local', tokenTtlSec: 3600, bootstrapAdmin: { username: 'admin' }, idleTimeoutMs: 600000,
    maxSessions: 4, rootDir: root, database: { driver: 'sqlite', filename: ':memory:' }, dataDir: join(root, 'data'), runDir: join(root, 'run'), logDir: join(root, 'log'),
    dockerStopTimeoutSec: 1, dockerLabels: {}, startupPolicy: 'reattach-or-resume', heartbeatTimeoutMs: 30000, reattachProbeTimeoutMs: 100, resumeOnMissingRuntime: true, logLevel: 'error' }
  const app = startServer(config, { store: { db }, countActiveSessions: () => 0 } as unknown as RuntimeService, auth)
  try {
    const base = `http://127.0.0.1:${await app.ready}`
    const call = (route: string, token?: string, body?: unknown) => fetch(base + route, { method: body ? 'PATCH' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    assert.equal((await call('/api/v1/webui/snapshot-policy')).status, 401)
    assert.equal((await call('/api/v1/settings/system', reader.access_token)).status, 403)
    assert.equal((await call('/api/v1/settings/system', reader.access_token, { webui: { snapshots: { maxSnapshotsPerEnvironment: 99 } } })).status, 403)
    const saved = await call('/api/v1/settings/system', admin.access_token, { apiKey: 'private-model-secret', webui: { snapshots: { maxSnapshotsPerEnvironment: 3 } } })
    assert.equal(saved.status, 200)
    const policy = await call('/api/v1/webui/snapshot-policy', reader.access_token)
    assert.equal(policy.status, 200)
    assert.deepEqual(await policy.json(), { maxSnapshotsPerEnvironment: 3, maxBytesPerEnvironment: 21474836480 })
    assert.equal((await call('/api/v1/settings/system', admin.access_token, { webui: { snapshots: { maxSnapshotsPerEnvironment: -1 } } })).status, 400)
    console.log('snapshot policy HTTP: authentication, admin-only mutation, secret isolation and strict validation passed')
  } finally { await app.stop() }
} finally { await db.close(); await rm(root, { recursive: true, force: true }) }
