import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels } from '../model/index.js'
import { createAuthService } from '../auth/service.js'
import { readServerConfig } from '../config.js'
import { startServer } from '../server.js'

const root = await mkdtemp(join(tmpdir(), 'moss-control-plane-'))
process.env.MOSS_SERVER_HOME = root
const models = await createModels({ driver: 'sqlite', filename: join(root, 'db.sqlite') })
const { service: auth } = await createAuthService({ db: models.db, tokenTtlSec: 3600,
  bootstrapAdmin: { username: 'admin', password: 'fixture-password', email: 'admin@example.test' } })
const admin = await auth.issueTokenFromPassword({ username: 'admin', password: 'fixture-password' })
const principal = (await auth.verifyAccessToken(admin.access_token))!
const created = await auth.createUser({ orgId: principal.orgId, name: 'Alice', email: 'alice@example.test', role: 'user', password: 'alice-password' }, principal)
const alice = await auth.issueTokenFromPassword({ email: 'alice@example.test', password: 'alice-password' })
const { config } = await readServerConfig(join(root, 'server.json'))
const app = startServer({ ...config, port: 0, host: '127.0.0.1' }, models, auth)
try {
  const base = `http://127.0.0.1:${await app.ready}`
  const call = async (route: string, token = admin.access_token, body?: unknown, method = body ? 'POST' : 'GET') => {
    const response = await fetch(base + route, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json() as any }
  }
  assert.equal((await call('/healthz')).body.role, 'control-plane')
  for (const [route, method] of [['/api/v1/sessions', 'GET'], ['/api/v1/sessions', 'POST'], ['/api/v1/sessions/old/resume', 'POST'], ['/api/v1/cron/tasks', 'GET']]) {
    const result = await call(route!, admin.access_token, undefined, method)
    assert.equal(result.status, 410); assert.equal(result.body.code, 'SERVER_EXECUTION_RETIRED')
  }
  const heartbeat = { id: 'desktop-alice', epoch: 'epoch-a', name: 'Alice laptop', kind: 'desktop', version: 'test', platform: 'linux', status: { activeSessions: 0 } }
  const enrollment = await call('/api/v1/hosts/enroll', alice.access_token, heartbeat)
  assert.equal(enrollment.status, 200)
  const deviceToken = enrollment.body.token
  assert.match(deviceToken, /^moss_host_/)
  assert.equal((await call('/api/v1/users', deviceToken)).status, 401)
  assert.equal((await call('/api/v1/hosts/heartbeat', deviceToken, { ...heartbeat, id: 'other-device' })).status, 403)
  assert.equal((await call('/api/v1/hosts/enroll', admin.access_token, heartbeat)).status, 403)
  assert.equal((await call('/api/v1/hosts', alice.access_token)).body.hosts.length, 1)
  assert.equal((await call('/api/v1/hosts?all=true', alice.access_token)).status, 403)
  const command = { id: 'command-one', action: 'pause' }
  assert.equal((await call('/api/v1/hosts/desktop-alice/commands', admin.access_token, command)).status, 202)
  assert.equal((await call('/api/v1/hosts/desktop-alice/commands', admin.access_token, command)).status, 202)
  assert.equal((await call('/api/v1/hosts/desktop-alice/commands', admin.access_token, { ...command, action: 'resume' })).status, 409)
  let report = await call('/api/v1/hosts/heartbeat', deviceToken, heartbeat)
  assert.equal(report.body.commands.length, 1)
  assert.equal((await call('/api/v1/hosts/heartbeat', deviceToken, heartbeat)).body.commands.length, 0)
  assert.equal((await call('/api/v1/hosts/desktop-alice/commands/command-one', deviceToken, { epoch: 'epoch-a', state: 'succeeded' })).body.ok, true)
  assert.equal((await call('/api/v1/hosts/desktop-alice/commands', admin.access_token)).body.commands[0].state, 'succeeded')
  await call('/api/v1/hosts/desktop-alice/commands', admin.access_token, { id: 'command-two', action: 'pause' })
  await call('/api/v1/hosts/heartbeat', deviceToken, heartbeat)
  await call('/api/v1/hosts/heartbeat', deviceToken, { ...heartbeat, epoch: 'epoch-b' })
  assert.equal((await call('/api/v1/hosts/desktop-alice/commands', admin.access_token)).body.commands.find((c: any) => c.id === 'command-two').state, 'failed')
  assert.equal((await call('/api/v1/host-policy', alice.access_token, { settings: {} }, 'PUT')).status, 403)
  assert.equal((await call('/api/v1/host-policy', admin.access_token, { settings: { shell: 'rm' } }, 'PUT')).status, 400)
  assert.equal((await call('/api/v1/host-policy', admin.access_token, { settings: { bypassPermissions: false } }, 'PUT')).status, 200)
  report = await call('/api/v1/hosts/heartbeat', deviceToken, { ...heartbeat, epoch: 'epoch-b' })
  assert.deepEqual(report.body.policy, { revision: 1, settings: { bypassPermissions: false } })
  const event = { eventId: 'usage-one', sessionId: 'session-one', model: 'test', occurredAt: Date.now(), inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }
  for (let i = 0; i < 2; i++) assert.equal((await call('/api/v1/hosts/desktop-alice/usage', deviceToken, { events: [event] })).status, 200)
  assert.equal((await call('/api/v1/usage', alice.access_token)).body.totals.totalTokens, 15)
  assert.equal((await call('/api/v1/hosts/desktop-alice/usage', deviceToken, { events: [{ ...event, inputTokens: -1 }] })).status, 400)
  await auth.updateUser({ orgId: principal.orgId, userId: created.user.id, status: 'disabled' }, principal)
  assert.equal((await call('/api/v1/hosts/heartbeat', deviceToken, heartbeat)).status, 401)
  console.log('Control plane: retired execution, device ownership, commands, crash recovery, policy, usage and revocation passed')
} finally { await app.stop(); await models.close(); await rm(root, { recursive: true, force: true }) }
