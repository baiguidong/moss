import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAuthService } from '../auth/service.js'
import { initializeDatabase, openDatabase, requireSchema } from '../model/index.js'
import { AuthRepository } from '../model/repositories/auth.js'
import { SessionRepository } from '../model/repositories/session.js'
import { UsageRepository } from '../model/repositories/usage.js'
import { DirectEmbeddedBackend, registerDirectRuntimeModule } from '../backends/directEmbeddedBackend.js'
import { RuntimeService } from '../runtimeService.js'
import { startServer } from '../server.js'
import { recordRunnerUsage, UsageService } from '../usageService.js'
import type { ModelUsageEvent, UsageOverview } from '../usageTypes.js'
import type { ServerConfig } from '../types.js'
import { testDatabaseConfig } from './databaseTestUtils.js'

const root = await mkdtemp(join(tmpdir(), 'moss-user-usage-'))
const databaseConfig = await testDatabaseConfig(join(root, 'usage.db'))
let db = await openDatabase(databaseConfig, { initialize: true })
try {
  const { service: auth } = await createAuthService({
    db, tokenTtlSec: 3600, bootstrapAdmin: { username: 'admin', password: 'password' },
  })
  const login = await auth.issueTokenFromPassword({ username: 'admin', password: 'password' })
  const admin = (await auth.verifyAccessToken(login.access_token))!
  for (const table of ['usage_events', 'usage_metadata', 'usage_imports']) await db.exec(`DROP TABLE ${table}`)
  await db.prepare('UPDATE model_schema SET version=3 WHERE id=1').run()
  await initializeDatabase(db)
  await requireSchema(db)
  const cutoff = Date.parse('2026-09-24T00:00:00Z')
  await db.prepare('UPDATE usage_metadata SET history_before=?, timezone=? WHERE id=1').run(cutoff, 'Asia/Shanghai')
  await db.prepare('UPDATE model_schema SET version=3 WHERE id=1').run()
  await initializeDatabase(db)
  assert.equal(Number((await db.prepare('SELECT history_before FROM usage_metadata WHERE id=1').get())?.history_before), cutoff)
  assert.ok(await auth.verifyAccessToken(login.access_token))

  const dep = (await auth.createDepartment({ orgId: admin.orgId, name: 'Sales' })).department
  const child = (await auth.createDepartment({ orgId: admin.orgId, name: 'Child', parentId: dep.id })).department
  const other = (await auth.createDepartment({ orgId: admin.orgId, name: 'Other' })).department
  const createUser = async (name: string, departmentId: string, role = 'user') =>
    (await auth.createUser({ orgId: admin.orgId, name, departmentId, role, password: 'password' }, admin)).user
  const alice = await createUser('Alice', child.id)
  const bob = await createUser('Bob', other.id)
  const manager = await createUser('Manager', dep.id, 'dept_admin')
  const aliceLogin = await auth.issueTokenFromPassword({ username: 'Alice', password: 'password' })
  const managerLogin = await auth.issueTokenFromPassword({ username: 'Manager', password: 'password' })
  const authRepo = new AuthRepository(db)
  await authRepo.createOrganization('other-org', 'Other organization', 1)
  await authRepo.ensureBuiltinRoles('other-org')
  const foreign = (await auth.createUser({ orgId: 'other-org', name: 'Foreign', password: 'password' })).user
  const owner = { orgId: admin.orgId, userId: alice.id }
  const sessions = new SessionRepository(db)
  const createSession = async (id: string, userId = alice.id) => {
    const transcriptDir = join(root, id)
    await mkdir(transcriptDir, { recursive: true })
    const session = await sessions.createSession({
      sessionId: id, transcriptSessionId: id, transcriptPath: join(transcriptDir, `${id}.jsonl`),
      orgId: admin.orgId, userId, role: 'user', scopes: ['sessions:attach'], cwd: root,
      runtime: { backend: 'docker', profileDir: root, transcriptDir, workspaceDir: root },
      status: 'ended', desiredState: 'ended',
    })
    await db.prepare('UPDATE sessions SET created_at=? WHERE session_id=?').run(cutoff - 86400000, id)
    return session
  }
  const history = await createSession('history')
  const fork = await createSession('fork')
  const missing = await createSession('missing', bob.id)
  const entry = (id: string, timestamp: string, input = 100, output = 50, read = 20, write = 5) => ({
    type: 'assistant', uuid: `uuid-${id}`, requestId: id, timestamp,
    message: { id: `msg-${id}`, model: 'model-a', usage: {
      input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write,
    } },
  })
  const first = entry('request-1', '2026-09-18T16:30:00Z')
  await writeFile(history.transcriptPath, [
    entry('request-1', '2026-09-18T16:29:00Z', 100, 25), first, first,
    entry('request-2', '2026-09-19T16:30:00Z', 10, 5, 0, 0),
    { ...entry('synthetic', '2026-09-18T00:00:00Z'), message: { model: '<synthetic>', usage: first.message.usage } },
    entry('after-cutoff', '2026-09-24T01:00:00Z', 99999),
  ].map(value => JSON.stringify(value)).join('\n'))
  await writeFile(fork.transcriptPath, JSON.stringify({ ...first, forkedFrom: { sessionId: 'history' } }))
  const subagents = join(root, 'history', 'history', 'subagents')
  await mkdir(subagents, { recursive: true })
  await writeFile(join(subagents, 'agent.jsonl'), JSON.stringify({
    ...entry('subagent', '2026-09-19T16:45:00Z', 2, 3, 0, 0), isSidechain: true,
  }))
  await sessions.deleteSession(history.sessionId)

  const usage = new UsageRepository(db)
  const event: ModelUsageEvent = {
    eventId: 'live-request', occurredAt: cutoff + 3600000, model: 'model-a', querySource: 'agent:worker',
    inputTokens: 1000, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 40,
  }
  await usage.record(owner, fork.sessionId, { ...event, outputTokens: 50 })
  // Exercise the same onUsage -> runner stdout -> persistent ledger path used
  // for interactive sessions, background work and server cron execution.
  class FakeSession {
    constructor(private options: { onUsage?: (event: ModelUsageEvent) => void }) {}
    async *send() {
      this.options.onUsage?.(event)
      this.options.onUsage?.(event)
      yield { type: 'result' }
    }
    abort() {}
    dispose() {}
    setPermissionMode() {}
  }
  registerDirectRuntimeModule({ ClaudeSession: FakeSession, resumeClaudeSession: async () => null })
  const handle = await new DirectEmbeddedBackend().spawn({
    sessionId: fork.sessionId, cwd: root, runtime: { ...fork.runtime, backend: 'host' },
    systemSettings: { model: 'model-a', fastModel: '', maxTurns: 10, thinkingMode: 'disabled',
      thinkingBudgetTokens: 1024, url: '', apiKey: '', bypassPermissions: true },
  })
  try {
    let recorded = Promise.resolve()
    await new Promise<void>((resolve, reject) => {
      handle.onStdoutLine(line => {
        recorded = recorded.then(async () => {
          if (await recordRunnerUsage(line, { ...owner, sessionId: fork.sessionId }, usage)) return
          if (JSON.parse(line).type === 'result') resolve()
        }).catch(reject)
      })
      handle.writeStdin(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } })}\n`)
    })
    await recorded
  } finally { handle.destroy() }
  await recordRunnerUsage(JSON.stringify({ type: 'moss_usage', userId: bob.id, event }), { ...owner, sessionId: 'reconnected-session' }, usage)
  await usage.record(owner, fork.sessionId, { ...event, outputTokens: 1 })
  assert.equal(await recordRunnerUsage('{"type":"assistant"}', { ...owner, sessionId: 'fork' }, usage), false)
  await usage.record({ orgId: 'other-org', userId: foreign.id }, 'foreign', event)

  const config: ServerConfig = {
    host: '127.0.0.1', port: 0, authMode: 'local', tokenTtlSec: 3600, bootstrapAdmin: { username: 'admin' },
    idleTimeoutMs: 600000, maxSessions: 4, rootDir: root, database: databaseConfig,
    dataDir: join(root, 'data'), runDir: join(root, 'run'), logDir: join(root, 'logs'),
    dockerStopTimeoutSec: 1, dockerLabels: {}, startupPolicy: 'reattach-or-resume',
    heartbeatTimeoutMs: 30000, reattachProbeTimeoutMs: 100, resumeOnMissingRuntime: true, logLevel: 'error',
  }
  const runtime = new RuntimeService({ config, store: sessions, serverInstanceId: 'test-server' })
  const server = startServer(config, runtime, auth)
  let expected: UsageOverview['totals']
  try {
    const base = `http://127.0.0.1:${await server.ready}/api/v1`
    const get = (path: string, token?: string) => fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
    assert.equal((await get('/usage')).status, 401)
    assert.equal((await get(`/users/${bob.id}/usage`, aliceLogin.access_token)).status, 403)
    assert.equal((await get(`/users/${bob.id}/usage`, managerLogin.access_token)).status, 404)
    assert.equal((await get(`/users/${foreign.id}/usage`, login.access_token)).status, 404)
    assert.equal((await get('/users/missing-user/usage', login.access_token)).status, 404)
    const empty = await (await get('/usage', login.access_token)).json() as UsageOverview
    assert.equal(empty.totals.totalTokens, 0)
    assert.equal(empty.totals.peakDay, null)
    assert.deepEqual(empty.daily, [])
    const response = await get('/usage', aliceLogin.access_token)
    assert.equal(response.status, 200, await response.clone().text())
    const overview = await response.json() as UsageOverview
    assert.equal(overview.historyIncomplete, false)
    assert.equal(overview.timezone, 'Asia/Shanghai')
    expected = { inputTokens: 1112, outputTokens: 258, cacheReadTokens: 320, cacheWriteTokens: 45,
      totalTokens: 1735, requestCount: 4, activeDays: 3, peakDay: '2026-09-24', peakTokens: 1540 }
    assert.deepEqual(overview.totals, expected)
    assert.deepEqual(overview.daily.map(day => day.day), ['2026-09-19', '2026-09-20', '2026-09-24'])
    for (const token of [login.access_token, managerLogin.access_token, aliceLogin.access_token]) {
      const result = await get(`/users/${alice.id}/usage`, token)
      assert.equal(result.status, 200)
      assert.deepEqual((await result.json() as UsageOverview).totals, expected)
    }
    const partial = await (await get(`/users/${bob.id}/usage`, login.access_token)).json() as UsageOverview
    assert.equal(partial.historyIncomplete, true)
    const custom = (await auth.createRole({ orgId: admin.orgId, name: 'User manager', permissions: ['admin:users'] })).role
    await auth.setUserRoles({ orgId: admin.orgId, userId: manager.id, roleIds: [custom.id] }, admin)
    assert.equal((await get('/usage', managerLogin.access_token)).status, 200)
    assert.equal((await get(`/users/${bob.id}/usage`, managerLogin.access_token)).status, 404)
    await writeFile(missing.transcriptPath, JSON.stringify(entry('recovered', '2026-09-20T00:00:00Z', 1, 1, 0, 0)))
    const recovered = await new UsageService(usage, sessions).getOverview({ orgId: admin.orgId, userId: bob.id })
    assert.equal(recovered.historyIncomplete, false)
    assert.equal(recovered.totals.totalTokens, 2)
    await sessions.deleteSession(fork.sessionId)
    assert.deepEqual((await new UsageService(usage, sessions).getOverview(owner)).totals, expected)
  } finally { await server.stop() }
  await db.close()
  db = await openDatabase(databaseConfig, { initialize: true })
  assert.deepEqual((await new UsageRepository(db).getOverview(owner)).totals, expected!)
} finally {
  await db.close()
  await rm(root, { recursive: true, force: true })
}
