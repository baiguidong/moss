import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuthService } from '../auth/service.js'
import { initializeDatabase, requireSchema } from '../model/index.js'
import { AuthRepository } from '../model/repositories/auth.js'
import { SessionRepository } from '../model/repositories/session.js'
import { RuntimeService } from '../runtimeService.js'
import { startServer } from '../server.js'
import type { ServerConfig } from '../types.js'
import { openTestDatabase } from './databaseTestUtils.js'

const root = await mkdtemp(join(tmpdir(), 'moss-user-deletion-'))
const db = await openTestDatabase(':memory:')
try {
  const { service: auth } = await createAuthService({
    db, tokenTtlSec: 3600,
    bootstrapAdmin: { username: 'admin', password: 'admin-password' },
  })
  const repo = new AuthRepository(db)
  const adminLogin = await auth.issueTokenFromPassword({ username: 'admin', password: 'admin-password' })
  const admin = (await auth.verifyAccessToken(adminLogin.access_token))!

  // Upgrade an existing v2 database containing users and credentials, including
  // retry after MySQL has committed DDL but not the version update.
  await db.exec('ALTER TABLE users DROP COLUMN deleted_at')
  await db.prepare('UPDATE model_schema SET version=2 WHERE id=1').run()
  await initializeDatabase(db)
  await db.prepare('UPDATE model_schema SET version=2 WHERE id=1').run()
  await initializeDatabase(db)
  await requireSchema(db)
  assert.ok(await auth.verifyAccessToken(adminLogin.access_token))

  const department = (await auth.createDepartment({ orgId: admin.orgId, name: 'Sales' })).department
  const childDepartment = (await auth.createDepartment({
    orgId: admin.orgId, name: 'Sales child', parentId: department.id,
  })).department
  const otherDepartment = (await auth.createDepartment({ orgId: admin.orgId, name: 'Other' })).department
  const createUser = async (name: string, departmentId: string | null, role = 'user') =>
    (await auth.createUser({
      orgId: admin.orgId, name, email: `${name}@example.test`, password: 'password', departmentId, role,
    }, admin)).user
  const manager = await createUser('manager', department.id, 'dept_admin')
  const victim = await createUser('victim', childDepartment.id)
  const outsider = await createUser('outsider', otherDepartment.id)
  const secondAdmin = await createUser('second-admin', department.id, 'admin')
  const managerLogin = await auth.issueTokenFromPassword({ username: manager.name, password: 'password' })
  const victimLogin = await auth.issueTokenFromPassword({ username: victim.name, password: 'password' })
  const key = await auth.createApiKey({ orgId: admin.orgId, userId: victim.id, name: 'test', scopes: ['sessions:list'] }, admin)
  const keyLogin = await auth.issueTokenFromApiKey(key.plain_text_key)
  await repo.createOAuthIdentity({
    providerId: 'test', subject: 'subject', userId: victim.id, email: victim.email!,
    apiKeyId: key.api_key.id, createdAt: Date.now(), lastLoginAt: Date.now(),
  })
  await auth.createOAuthAuthorizationRequest({
    id: 'pending-request', redirectUri: 'http://localhost/callback', state: 'state',
    codeChallenge: 'challenge', expiresAt: Date.now() + 60000, passwordAttempts: 0,
  })
  await auth.completeOAuthAuthorization('pending-request', {
    code: 'pending-code', redirectUri: 'http://localhost/callback', state: 'state',
    codeChallenge: 'challenge', userId: victim.id, orgId: admin.orgId, expiresAt: Date.now() + 60000,
  }, Date.now())

  const store = new SessionRepository(db)
  await store.createSession({
    sessionId: 'history', transcriptSessionId: 'history', transcriptPath: join(root, 'history.jsonl'),
    userId: victim.id, orgId: admin.orgId, role: 'user', scopes: ['sessions:attach'], cwd: root,
    runtime: { backend: 'docker', dockerImage: 'test', workspaceDir: root, profileDir: root, transcriptDir: root },
    status: 'active', desiredState: 'active',
  })
  await db.prepare(`INSERT INTO cron_tasks
    (id, org_id, user_id, owner_session_id, cron, timezone, prompt, recurring, created_at)
    VALUES ('user-task', ?, ?, 'history', '0 12 * * *', 'Asia/Shanghai', 'test', 1, ?)
  `).run(admin.orgId, victim.id, Date.now())
  await db.prepare(`INSERT INTO agent_mail_messages
    (id, org_id, from_user_id, to_user_id, client_message_id, subject, content, thread_id, status, created_at, expires_at)
    VALUES ('mail', ?, ?, ?, 'client-mail', 'history', 'keep message', 'mail', 'completed', 1, 9999999999999)
  `).run(admin.orgId, admin.userId, victim.id)
  await writeFile(join(root, 'history.jsonl'), 'keep transcript')
  const config: ServerConfig = {
    host: '127.0.0.1', port: 0, authMode: 'local', tokenTtlSec: 3600,
    bootstrapAdmin: { username: 'admin' }, idleTimeoutMs: 600000, maxSessions: 4,
    rootDir: root, database: { driver: 'sqlite', filename: ':memory:' },
    dataDir: join(root, 'data'), runDir: join(root, 'run'), logDir: join(root, 'logs'),
    dockerStopTimeoutSec: 1, dockerLabels: {}, startupPolicy: 'reattach-or-resume',
    heartbeatTimeoutMs: 30000, reattachProbeTimeoutMs: 100, resumeOnMissingRuntime: true, logLevel: 'error',
  }
  const runtime = new RuntimeService({ config, store, serverInstanceId: 'test-server' })
  const server = startServer(config, runtime, auth)
  try {
    const baseUrl = `http://127.0.0.1:${await server.ready}/api/v1`
    const remove = (id: string, token?: string) => fetch(`${baseUrl}/users/${id}`, {
      method: 'DELETE', headers: token ? { authorization: `Bearer ${token}` } : {},
    })
    assert.equal((await remove(victim.id)).status, 401)
    assert.equal((await remove(outsider.id, victimLogin.access_token)).status, 403)
    assert.equal((await remove(outsider.id, managerLogin.access_token)).status, 403)
    assert.equal((await remove(secondAdmin.id, managerLogin.access_token)).status, 403)
    assert.equal((await remove(admin.userId, adminLogin.access_token)).status, 409)
    assert.equal((await remove('missing', adminLogin.access_token)).status, 404)
    assert.equal((await remove(secondAdmin.id, adminLogin.access_token)).status, 200)
    await assert.rejects(auth.deleteUser({ orgId: admin.orgId, userId: admin.userId }), /至少需要保留/)
    assert.ok(await repo.getUserById(victim.id))
    assert.ok(await repo.findActiveApiKey(key.plain_text_key))

    // A token issued to a former system admin cannot retain global delete access.
    const formerAdmin = await createUser('former-admin', department.id, 'admin')
    const formerLogin = await auth.issueTokenFromPassword({ username: formerAdmin.name, password: 'password' })
    await auth.updateUser({ orgId: admin.orgId, userId: formerAdmin.id, role: 'dept_admin' }, admin)
    assert.equal((await remove(outsider.id, formerLogin.access_token)).status, 403)

    const response = await remove(victim.id, managerLogin.access_token)
    assert.equal(response.status, 200, await response.clone().text())
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal((await remove(victim.id, adminLogin.access_token)).status, 404)
    assert.equal((await auth.listUsers(admin.orgId)).users.some(user => user.id === victim.id), false)
    assert.equal((await auth.listDirectory(admin.orgId)).users.some(user => user.id === victim.id), false)
    assert.equal((await auth.listDepartments(admin.orgId)).departments.find(item => item.id === childDepartment.id)?.userCount, 0)
    assert.equal(await repo.getUserById(victim.id), null)
    for (const token of [victimLogin.access_token, keyLogin.access_token]) {
      assert.equal(await auth.verifyAccessToken(token), null)
      assert.deepEqual(await auth.introspect(token), { active: false })
      assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${token}` } })).status, 401)
      assert.equal((await fetch(`${baseUrl}/sessions`, { headers: { authorization: `Bearer ${token}` } })).status, 401)
    }
    await assert.rejects(auth.issueTokenFromPassword({ username: victim.name, password: 'password' }))
    await assert.rejects(auth.issueTokenFromApiKey(key.plain_text_key))
    await assert.rejects(auth.updateUser({ orgId: admin.orgId, userId: victim.id, status: 'active' }, admin))
    assert.equal(await repo.findActiveApiKey(key.plain_text_key), null)
    assert.deepEqual(await repo.listRolesForUser(victim.id), [])
    assert.equal(await db.prepare('SELECT * FROM oauth_identities WHERE user_id=?').get(victim.id), undefined)
    assert.equal(await db.prepare('SELECT * FROM oauth_authorization_codes WHERE user_id=?').get(victim.id), undefined)
    assert.equal(Number((await db.prepare("SELECT enabled FROM cron_tasks WHERE id='user-task'").get())?.enabled), 0)
    assert.equal((await store.getSession('history'))?.desiredState, 'terminated')
    assert.equal((await store.listSessionsToRecover()).length, 0)
    assert.equal(await readFile(join(root, 'history.jsonl'), 'utf8'), 'keep transcript')
    assert.equal((await db.prepare("SELECT content FROM agent_mail_messages WHERE id='mail'").get())?.content, 'keep message')
    await auth.deleteDepartment({ orgId: admin.orgId, departmentId: childDepartment.id })
    const replacement = await createUser(victim.name, department.id)
    assert.notEqual(replacement.id, victim.id)
    assert.equal(replacement.email, victim.email)
    assert.ok(await auth.verifyAccessToken(adminLogin.access_token))
  } finally {
    await server.stop()
  }
} finally {
  await db.close()
  await rm(root, { recursive: true, force: true })
}
