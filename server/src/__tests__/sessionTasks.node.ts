import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuthService } from '../auth/service.js'
import { SessionRepository } from '../model/repositories/session.js'
import { RuntimeService } from '../runtimeService.js'
import { startServer } from '../server.js'
import type { ServerConfig } from '../types.js'
import { openTestDatabase } from './databaseTestUtils.js'

const root = await mkdtemp(join(tmpdir(), 'moss-session-tasks-'))
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
  // Reading tasks must work without a live Docker container or an attach attempt.
  runtime.ensureSessionReady = async () => { throw new Error('Unexpected runtime startup') }
  const profileDir = join(root, 'profile')
  for (const [id, userId, orgId, transcriptId] of [
    ['alice-session', alice.userId, alice.orgId, 'alice-transcript'],
    ['bob-session', bob.id, alice.orgId, 'bob-session'],
    ['other-org-session', alice.userId, 'other-org', 'other-org-session'],
  ]) {
    await store.createSession({
      sessionId: id!, transcriptSessionId: transcriptId!, transcriptPath: join(root, `${transcriptId}.jsonl`),
      userId: userId!, orgId: orgId!, role: 'user', scopes: ['sessions:attach'], cwd: root,
      runtime: { backend: 'docker', dockerImage: 'test', workspaceDir: root, profileDir, transcriptDir: root },
      status: 'active', desiredState: 'active',
    })
  }
  const moss = startServer(config, runtime, auth)
  try {
    const baseUrl = `http://127.0.0.1:${await moss.ready}/api/v1/sessions`
    const aliceHeaders = { authorization: `Bearer ${aliceLogin.access_token}` }
    const bobHeaders = { authorization: `Bearer ${bobLogin.access_token}` }
    const list = async (id = 'alice-session') => {
      const response = await fetch(`${baseUrl}/${id}/tasks`, { headers: aliceHeaders })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      return (await response.json()).tasks
    }
    assert.equal((await fetch(`${baseUrl}/alice-session/tasks`)).status, 401)
    assert.equal((await fetch(`${baseUrl}/alice-session/tasks`, { headers: bobHeaders })).status, 403)
    assert.equal((await fetch(`${baseUrl}/other-org-session/tasks`, { headers: aliceHeaders })).status, 403)
    assert.equal((await fetch(`${baseUrl}/missing/tasks`, { headers: aliceHeaders })).status, 404)
    assert.deepEqual(await list(), [])

    const taskDir = join(profileDir, 'tasks', 'alice-transcript')
    await mkdir(taskDir, { recursive: true })
    const task = { id: '2', subject: '分析任务', description: '分析详情', status: 'pending', blocks: [], blockedBy: [] }
    await writeFile(join(taskDir, '2.json'), JSON.stringify(task))
    await writeFile(join(taskDir, '10.json'), JSON.stringify({ ...task, id: '10', subject: '验证任务', blockedBy: ['2', 3] }))
    await writeFile(join(taskDir, '3.json'), JSON.stringify({ ...task, id: '3', metadata: { _internal: true } }))
    await writeFile(join(taskDir, '4.json'), JSON.stringify({ subject: '无效任务' }))
    await writeFile(join(taskDir, '5.json'), '{incomplete')
    await writeFile(join(taskDir, '.lock.json'), JSON.stringify({ ...task, id: 'hidden' }))
    assert.deepEqual(await list(), [
      { id: '2', subject: '分析任务', description: '分析详情', status: 'pending', activeForm: '', owner: null, blockedBy: [] },
      { id: '10', subject: '验证任务', description: '分析详情', status: 'pending', activeForm: '', owner: null, blockedBy: ['2'] },
    ])
    assert.deepEqual(await list('bob-session'), [])
    await writeFile(join(taskDir, '2.json'), JSON.stringify({ ...task, status: 'in_progress', activeForm: '正在分析', owner: 'worker' }))
    assert.equal((await list())[0].status, 'in_progress')
    assert.equal((await list())[0].activeForm, '正在分析')
    await writeFile(join(taskDir, '2.json'), JSON.stringify({ ...task, status: 'completed' }))
    assert.equal((await list())[0].status, 'completed')

    const teamDir = join(profileDir, 'teams', 'analysis-team')
    const teamTasksDir = join(profileDir, 'tasks', 'analysis-team')
    await mkdir(teamDir, { recursive: true })
    await mkdir(teamTasksDir, { recursive: true })
    await writeFile(join(teamDir, 'config.json'), JSON.stringify({ leadSessionId: 'alice-transcript', createdAt: 1 }))
    await writeFile(join(teamTasksDir, '1.json'), JSON.stringify({ ...task, id: '1', subject: '团队任务' }))
    assert.equal((await list())[0].subject, '团队任务')
    assert.deepEqual(await list('bob-session'), [])
    await rm(teamDir, { recursive: true })
    assert.equal((await list())[0].subject, '分析任务')

    await rm(join(taskDir, '2.json'))
    await rm(join(taskDir, '10.json'))
    assert.deepEqual(await list(), [])
    assert.equal((await store.getSession('alice-session'))?.currentAttemptId, null)
    await fetch(`${baseUrl}/alice-session`, { method: 'DELETE', headers: aliceHeaders })
    assert.equal((await fetch(`${baseUrl}/alice-session/tasks`, { headers: aliceHeaders })).status, 404)
  } finally {
    await moss.stop()
  }
} finally {
  await db.close()
  await rm(root, { recursive: true, force: true })
}
