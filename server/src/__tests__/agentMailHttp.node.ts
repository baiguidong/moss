import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createAuthService } from '../auth/service.js'
import { startServer } from '../server.js'
import type { RuntimeService } from '../runtimeService.js'
import type { ServerConfig } from '../types.js'

const root = await mkdtemp(join(tmpdir(), 'moss-agent-mail-http-'))
const db = new DatabaseSync(':memory:')
try {
  const { service: authService } = await createAuthService({
    db,
    dbPath: ':memory:',
    tokenTtlSec: 3_600,
    bootstrapAdmin: {
      username: 'alice',
      password: 'alice-password',
      email: 'alice@example.test',
    },
  })
  const aliceLogin = authService.issueTokenFromPassword({ username: 'alice', password: 'alice-password' })
  const aliceAuth = authService.verifyAccessToken(aliceLogin.access_token)
  assert.ok(aliceAuth)
  const bob = authService.createUser({
    orgId: aliceAuth.orgId,
    email: 'bob@example.test',
    name: 'Bob',
    role: 'user',
    password: 'bob-password',
  }, aliceAuth).user
  const bobOAuthKey = authService.issuePermanentApiKeyForOAuthUser({
    userId: bob.id,
    orgId: aliceAuth.orgId,
  })
  db.prepare(`UPDATE api_keys SET scopes_json = ? WHERE id = ?`).run(
    JSON.stringify(['sessions:create', 'sessions:attach', 'sessions:list']),
    bobOAuthKey.key.id,
  )
  const bobLogin = authService.issueTokenFromApiKey(bobOAuthKey.api_key)
  const bobAuth = authService.verifyAccessToken(bobLogin.access_token)
  assert.ok(bobAuth)
  authService.requireScope(bobAuth, 'agent-mail:receive')
  assert.ok(bobLogin.scopes.includes('agent-mail:receive'))
  const migratedScopes = JSON.parse(String(
    (db.prepare(`SELECT scopes_json FROM api_keys WHERE id = ?`).get(bobOAuthKey.key.id) as any).scopes_json,
  ))
  assert.ok(migratedScopes.includes('agent-mail:receive'))

  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 0,
    authMode: 'local',
    tokenTtlSec: 3_600,
    bootstrapAdmin: { username: 'alice' },
    idleTimeoutMs: 600_000,
    maxSessions: 4,
    rootDir: root,
    dbPath: ':memory:',
    dataDir: join(root, 'data'),
    runDir: join(root, 'run'),
    logDir: join(root, 'logs'),
    dockerStopTimeoutSec: 1,
    dockerLabels: {},
    startupPolicy: 'reattach-or-resume',
    heartbeatTimeoutMs: 30_000,
    reattachProbeTimeoutMs: 100,
    resumeOnMissingRuntime: true,
    logLevel: 'error',
  }
  const runtime = {
    store: { db },
    countActiveSessions: () => 0,
  } as unknown as RuntimeService
  const moss = startServer(config, runtime, authService)
  try {
    const port = await moss.ready
    const baseUrl = `http://127.0.0.1:${port}`
    const aliceHeaders = {
      authorization: `Bearer ${aliceLogin.access_token}`,
      'content-type': 'application/json',
    }
    const bobHeaders = {
      authorization: `Bearer ${bobLogin.access_token}`,
      'content-type': 'application/json',
    }

    const bootstrap = await fetch(`${baseUrl}/api/v1/bootstrap`, { headers: aliceHeaders })
    assert.equal(bootstrap.status, 200)
    assert.equal((await bootstrap.json() as any).capabilities.agent_mail.version, 1)

    const sent = await fetch(`${baseUrl}/api/v1/agent-mail/messages`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        from_user_id: bob.id,
        to_user_id: bob.id,
        subject: 'HTTP integration',
        content: 'Authenticated sender must be Alice.',
        client_message_id: 'http-1',
      }),
    })
    assert.equal(sent.status, 201)
    const sentBody = await sent.json() as any
    assert.equal(sentBody.message.fromUserId, aliceAuth.userId)
    assert.equal(sentBody.message.toUserId, bob.id)

    const duplicate = await fetch(`${baseUrl}/api/v1/agent-mail/messages`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        to_user_id: bob.id,
        content: 'retry',
        client_message_id: 'http-1',
      }),
    })
    assert.equal(duplicate.status, 200)
    assert.equal((await duplicate.json() as any).duplicate, true)

    const pulled = await fetch(`${baseUrl}/api/v1/agent-mail/pull`, {
      method: 'POST',
      headers: bobHeaders,
      body: JSON.stringify({ consumer_id: 'bob-desktop', wait_ms: 0 }),
    })
    assert.equal(pulled.status, 200)
    const pulledBody = await pulled.json() as any
    assert.deepEqual(pulledBody.messages.map((message: any) => message.messageId), [sentBody.message.messageId])
    assert.equal(pulledBody.messages[0].deliveryMode, 'manual')

    const deletedFromOutbox = await fetch(
      `${baseUrl}/api/v1/agent-mail/messages/${encodeURIComponent(sentBody.message.messageId)}`,
      { method: 'DELETE', headers: aliceHeaders },
    )
    assert.equal(deletedFromOutbox.status, 200)
    assert.equal((await deletedFromOutbox.json() as any).deleted, true)
    const aliceOutbox = await fetch(`${baseUrl}/api/v1/agent-mail/outbox`, { headers: aliceHeaders })
    assert.equal((await aliceOutbox.json() as any).messages.length, 0)
    const bobInbox = await fetch(`${baseUrl}/api/v1/agent-mail/inbox`, { headers: bobHeaders })
    assert.equal((await bobInbox.json() as any).messages.length, 1)

    const deletedFromInbox = await fetch(
      `${baseUrl}/api/v1/agent-mail/messages/${encodeURIComponent(sentBody.message.messageId)}`,
      { method: 'DELETE', headers: bobHeaders },
    )
    assert.equal(deletedFromInbox.status, 200)
    assert.equal((await deletedFromInbox.json() as any).deleted, true)
    const bobInboxAfterDelete = await fetch(`${baseUrl}/api/v1/agent-mail/inbox`, { headers: bobHeaders })
    assert.equal((await bobInboxAfterDelete.json() as any).messages.length, 0)
  } finally {
    await moss.stop()
  }
} finally {
  db.close()
  await rm(root, { recursive: true, force: true })
}
