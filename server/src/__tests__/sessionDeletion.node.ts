import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuthService } from '../auth/service.js'
import { SessionRepository } from '../model/repositories/session.js'
import { RuntimeService } from '../runtimeService.js'
import { startServer } from '../server.js'
import type { ServerConfig } from '../types.js'
import { openTestDatabase } from './databaseTestUtils.js'

const root = await mkdtemp(join(tmpdir(), 'moss-session-deletion-'))
const db = await openTestDatabase(':memory:')
try {
  const { service: auth } = await createAuthService({
    db, tokenTtlSec: 3600,
    bootstrapAdmin: { username: 'alice', password: 'alice-password', email: 'alice@example.test' },
  })
  const aliceLogin = await auth.issueTokenFromPassword({ username: 'alice', password: 'alice-password' })
  const alice = await auth.verifyAccessToken(aliceLogin.access_token)
  assert.ok(alice)
  const bob = (await auth.createUser({
    orgId: alice.orgId, email: 'bob@example.test', name: 'Bob', role: 'user', password: 'bob-password',
  }, alice)).user
  const bobKey = await auth.issuePermanentApiKeyForOAuthUser({ userId: bob.id, orgId: alice.orgId })
  const bobLogin = await auth.issueTokenFromApiKey(bobKey.api_key)
  const store = new SessionRepository(db)
  const config: ServerConfig = {
    host: '127.0.0.1', port: 0, authMode: 'local', tokenTtlSec: 3600,
    bootstrapAdmin: { username: 'alice' }, idleTimeoutMs: 600000, maxSessions: 4,
    rootDir: root, database: { driver: 'sqlite', filename: ':memory:' },
    dataDir: join(root, 'data'), runDir: join(root, 'run'), logDir: join(root, 'logs'),
    dockerStopTimeoutSec: 1, dockerLabels: {}, startupPolicy: 'reattach-or-resume',
    heartbeatTimeoutMs: 30000, reattachProbeTimeoutMs: 100, resumeOnMissingRuntime: true,
    logLevel: 'error',
  }
  const runtime = new RuntimeService({ config, store, serverInstanceId: 'test-server' })
  for (const [id, userId, orgId] of [
    ['alice-session', alice.userId, alice.orgId],
    ['bob-session', bob.id, alice.orgId],
    ['other-org-session', alice.userId, 'other-org'],
  ]) {
    await store.createSession({
      sessionId: id!, transcriptSessionId: id!, transcriptPath: join(root, `${id}.jsonl`),
      userId: userId!, orgId: orgId!, role: 'user', scopes: ['sessions:attach'], cwd: root,
      runtime: { backend: 'docker', dockerImage: 'test', workspaceDir: root, profileDir: root, transcriptDir: root },
      status: 'active', desiredState: 'active',
    })
  }
  await writeFile(join(root, 'keep.txt'), 'workspace data')
  const moss = startServer(config, runtime, auth)
  try {
    const baseUrl = `http://127.0.0.1:${await moss.ready}/api/v1/sessions`
    const aliceHeaders = { authorization: `Bearer ${aliceLogin.access_token}` }
    const bobHeaders = { authorization: `Bearer ${bobLogin.access_token}` }
    assert.equal((await fetch(`${baseUrl}/bob-session`, { method: 'DELETE' })).status, 401)
    assert.equal((await fetch(`${baseUrl}/alice-session`, { method: 'DELETE', headers: bobHeaders })).status, 403)
    assert.equal((await fetch(`${baseUrl}/other-org-session`, { method: 'DELETE', headers: aliceHeaders })).status, 403)
    assert.ok(await store.getSession('alice-session'))
    assert.ok(await store.getSession('other-org-session'))

    const response = await fetch(`${baseUrl}/bob-session`, { method: 'DELETE', headers: bobHeaders })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal(await store.getSession('bob-session'), null)
    const deleted = (await store.listSessionRecords({ orgId: alice.orgId, userId: bob.id, includeDeleted: true }))[0]
    assert.equal(deleted?.desiredState, 'terminated')
    assert.ok(deleted?.deletedAt)
    assert.equal((await store.listSessionsToRecover()).some(session => session.sessionId === 'bob-session'), false)
    const listed = await fetch(baseUrl, { headers: bobHeaders })
    assert.deepEqual(await listed.json(), { sessions: [] })
    for (const suffix of ['', '/context', '/resume']) {
      assert.equal((await fetch(`${baseUrl}/bob-session${suffix}`, {
        method: suffix === '/resume' ? 'POST' : 'GET', headers: bobHeaders,
      })).status, 404)
    }
    assert.equal((await fetch(`${baseUrl}/bob-session`, { method: 'DELETE', headers: bobHeaders })).status, 200)
    assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'workspace data')
  } finally {
    await moss.stop()
  }
} finally {
  await db.close()
  await rm(root, { recursive: true, force: true })
}
