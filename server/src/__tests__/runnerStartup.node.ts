import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RuntimeService } from '../runtimeService.js'
import { SessionRepository } from '../model/repositories/session.js'
import type { ServerConfig } from '../types.js'
import { openTestDatabase } from './databaseTestUtils.js'

const root = process.env.MOSS_SERVER_ASSET_ROOT!
const db = await openTestDatabase(':memory:')
const store = new SessionRepository(db)
const config: ServerConfig = {
  host: '127.0.0.1', port: 0, authMode: 'local', tokenTtlSec: 3600,
  bootstrapAdmin: { username: 'test' }, idleTimeoutMs: 600000, maxSessions: 10,
  rootDir: root, dataDir: join(root, 'data'), runDir: join(root, 'run'), logDir: join(root, 'logs'),
  database: { driver: 'sqlite', filename: ':memory:' }, dockerStopTimeoutSec: 1, dockerLabels: {},
  startupPolicy: 'reattach-or-resume', heartbeatTimeoutMs: 30000,
  reattachProbeTimeoutMs: 100, resumeOnMissingRuntime: true, logLevel: 'error',
}
await mkdir(join(root, 'bin'))
await writeFile(join(root, 'bin', 'moss-session-runner.mjs'), `
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import net from 'node:net';
const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const mode = process.env.MOSS_TEST_RUNNER_MODE;
if (mode === 'crash') process.exit(3);
if (mode === 'timeout') process.on('SIGTERM', () => {});
setTimeout(() => {
  const path = manifest.attempt.attachPath;
  mkdirSync(dirname(path), { recursive: true });
  net.createServer(socket => socket.end()).listen(path, () => {
    writeFileSync(manifest.attempt.statusPath, JSON.stringify({ state: 'ready' }));
  });
}, mode === 'slow' ? 5300 : 2000);
`)
const input = { orgId: 'test-org', userId: 'test-user', role: 'user', scopes: ['sessions:create'] }
const runtime = new RuntimeService({ config, store, serverInstanceId: 'test' })
let livePid: number | null = null
try {
  process.env.MOSS_TEST_RUNNER_MODE = 'slow'
  const slow = await runtime.createSession(input)
  assert.equal(slow.status, 'active')
  livePid = (await store.getCurrentAttempt(slow.sessionId))!.runnerPid
  await runtime.deleteSession(slow.sessionId)

  // Deletion can arrive after spawning but before the runner PID is persisted.
  process.env.MOSS_TEST_RUNNER_MODE = 'normal'
  let started!: () => void
  let proceed!: () => void
  const startedPromise = new Promise<void>(resolve => { started = resolve })
  const gate = new Promise<void>(resolve => { proceed = resolve })
  const updateRunner = store.updateAttemptRunner.bind(store)
  let pendingAttemptId = ''
  store.updateAttemptRunner = async (attemptId, pid) => {
    pendingAttemptId = attemptId
    livePid = pid
    started()
    await gate
    await updateRunner(attemptId, pid)
  }
  try {
    const outcome = runtime.createSession(input).then(() => null, error => error)
    await startedPromise
    const pending = (await store.getAttempt(pendingAttemptId))!
    await runtime.deleteSession(pending.sessionId)
    proceed()
    assert.match(String(await outcome), /deleted or terminated/)
    assert.equal(await store.getSession(pending.sessionId), null)
    assert.throws(() => process.kill(livePid!, 0), /ESRCH/)
  } finally {
    proceed()
    store.updateAttemptRunner = updateRunner
  }

  for (const mode of ['crash', 'timeout']) {
    process.env.MOSS_TEST_RUNNER_MODE = mode
    const service = new RuntimeService({ config, store, serverInstanceId: 'test', runnerStartupTimeoutMs: mode === 'crash' ? 10000 : 500 })
    const started = Date.now()
    await assert.rejects(service.createSession(input), mode === 'crash' ? /Runner exited before attach/ : /Timed out/)
    assert.ok(Date.now() - started < 8000, 'Failed processes must not wait for the full startup timeout')
    assert.deepEqual(await store.listSessions(input), [])
    const failed = (await store.listSessionRecords({ ...input, includeDeleted: true })).find(s => s.status === 'failed' && s.title === null && s.createdAt >= started)!
    assert.ok(failed?.deletedAt)
    assert.equal(failed.desiredState, 'terminated')
    const attempt = (await store.getAttempt(failed.currentAttemptId!))!
    assert.equal(attempt.runtimeState, 'failed')
    assert.equal(attempt.stopReason, 'startup_failed')
    assert.throws(() => process.kill(attempt.runnerPid!, 0), /ESRCH/)
    assert.equal((await store.listSessionsToRecover()).some(s => s.sessionId === failed.sessionId), false)
  }
} finally {
  if (livePid) { try { process.kill(livePid, 'SIGKILL') } catch {} }
  await store.close()
}
