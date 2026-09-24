import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AgentMailService } from '../agentMail/agentMailService.js'
import { createAuthService } from '../auth/service.js'
import type { AuthContext } from '../auth/token.js'
import type { ObjectStore } from '../cloudStorage/s3.js'
import { CloudStorageService } from '../cloudStorage/service.js'
import { readServerConfig } from '../config.js'
import { DatabaseError } from '../model/errors.js'
import {
  initializeDatabase,
  openDatabase,
  requireSchema,
} from '../model/index.js'
import { acquireDatabaseOwner } from '../model/maintenance.js'
import { AgentMailRepository } from '../model/repositories/agentMail.js'
import { AuthRepository } from '../model/repositories/auth.js'
import { CloudStorageRepository } from '../model/repositories/cloudStorage.js'
import { RagflowRepository } from '../model/repositories/ragflow.js'
import { SessionRepository } from '../model/repositories/session.js'
import type { RuntimeService } from '../runtimeService.js'
import { startServer } from '../server.js'
import { startStandaloneDirectConnectServer } from '../startStandaloneServer.js'
import { openTestDatabase, testDatabaseConfig } from './databaseTestUtils.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { promise, resolve }
}

function auth(userId: string): AuthContext {
  return {
    rawToken: 'test',
    userId,
    orgId: 'org',
    role: 'user',
    keyId: 'key',
    scopes: ['agent-mail:send', 'agent-mail:receive'],
  }
}

async function seed(db: Awaited<ReturnType<typeof openDatabase>>) {
  await db
    .prepare(
      "INSERT INTO organizations (id,name,created_at) VALUES ('org','Organization',1)",
    )
    .run()
  await db
    .prepare(
      `INSERT INTO users (id,org_id,email,name,role,status,created_at) VALUES
    ('alice','org','alice@example.test','Alice','user','active',1),
    ('bob','org','bob@example.test','Bob','user','active',1)`,
    )
    .run()
}

await test('initialization is repeatable; unrecognized databases are preserved and rejected', async () => {
  const config = await testDatabaseConfig()
  const db = await openDatabase(config)
  try {
    await db.exec('CREATE TABLE unrelated_data (id INTEGER PRIMARY KEY)')
    await db.prepare('INSERT INTO unrelated_data VALUES (7)').run()
    await assert.rejects(initializeDatabase(db), /fresh database/)
    assert.equal(
      (await db.prepare('SELECT id FROM unrelated_data').get())?.id,
      7,
    )
  } finally {
    await db.close()
  }
  const fresh = await openTestDatabase()
  try {
    await initializeDatabase(fresh)
    await requireSchema(fresh)
    assert.equal(
      (await fresh.prepare('SELECT version FROM model_schema WHERE id=1').get())
        ?.version,
      4,
    )
    await fresh.prepare('UPDATE model_schema SET version=99 WHERE id=1').run()
    await assert.rejects(
      initializeDatabase(fresh),
      /Unsupported database schema version/,
    )
  } finally {
    await fresh.close()
  }
})

await test('rollback, nested savepoints and unrelated async writes stay isolated', async () => {
  const db = await openTestDatabase()
  const repository = new AuthRepository(db)
  try {
    await db.transaction(async () => {
      await repository.setConfig('outer', 'kept')
      await assert.rejects(
        db.transaction(async () => {
          await repository.setConfig('nested', 'discarded')
          throw new Error('rollback nested')
        }),
        /rollback nested/,
      )
      await repository.setConfig('after', 'kept')
    })
    assert.equal(await repository.getConfig('outer'), 'kept')
    assert.equal(await repository.getConfig('nested'), null)
    assert.equal(await repository.getConfig('after'), 'kept')
    const entered = deferred(),
      release = deferred()
    const transaction = db.transaction(async () => {
      await repository.setConfig('rolled-back', 'discarded')
      entered.resolve()
      await release.promise
      throw new Error('rollback outer')
    })
    const rejected = assert.rejects(transaction, /rollback outer/)
    await entered.promise
    const unrelated = repository.setConfig('unrelated', 'kept')
    release.resolve()
    await rejected
    await unrelated
    assert.equal(await repository.getConfig('rolled-back'), null)
    assert.equal(await repository.getConfig('unrelated'), 'kept')
  } finally {
    await db.close()
  }
})

await test('concurrent OAuth completion and code redemption each succeed exactly once', async () => {
  const config = await testDatabaseConfig()
  const db = await openDatabase(config, { initialize: true })
  // MySQL must coordinate separate pools, as Server and Runner do in production.
  const peer = db.dialect === 'mysql' ? await openDatabase(config) : db
  try {
    await seed(db)
    const repositories = [new AuthRepository(db), new AuthRepository(peer)]
    const expiresAt = Date.now() + 60000
    const request = {
      id: 'request',
      redirectUri: 'http://localhost/callback',
      state: 'state',
      codeChallenge: 'challenge',
      expiresAt,
      passwordAttempts: 0,
    }
    await repositories[0]!.createOAuthAuthorizationRequest(request)
    const authorization = {
      code: 'code',
      redirectUri: request.redirectUri,
      state: request.state,
      codeChallenge: request.codeChallenge,
      userId: 'alice',
      orgId: 'org',
      expiresAt,
    }
    const completed = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        repositories[i % 2]!.completeOAuthAuthorization(
          request.id,
          authorization,
          Date.now(),
        ),
      ),
    )
    assert.equal(completed.filter(Boolean).length, 1)
    const redeemed = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        repositories[i % 2]!.consumeOAuthAuthorizationCode('code', Date.now()),
      ),
    )
    assert.equal(redeemed.filter(Boolean).length, 1)
  } finally {
    if (peer !== db) await peer.close()
    await db.close()
  }
})

await test('concurrent mail sends are idempotent and only one consumer acquires the lease', async () => {
  const db = await openTestDatabase()
  const mail = new AgentMailService(new AgentMailRepository(db))
  try {
    await seed(db)
    const sent = await Promise.all(
      Array.from({ length: 8 }, () =>
        mail.send(auth('alice'), {
          toUserId: 'bob',
          clientMessageId: 'one-message',
          content: '你好，SQLite 和 MySQL 👋',
        }),
      ),
    )
    assert.equal(sent.filter(v => !v.duplicate).length, 1)
    assert.equal(new Set(sent.map(v => v.message.messageId)).size, 1)
    const pulled = await Promise.allSettled(
      ['first', 'second'].map(consumerId =>
        mail.pull(auth('bob'), { consumerId, waitMs: 0, limit: 10 }),
      ),
    )
    assert.equal(pulled.filter(v => v.status === 'fulfilled').length, 1)
    const success = pulled.find(
      v => v.status === 'fulfilled',
    ) as PromiseFulfilledResult<Awaited<ReturnType<typeof mail.pull>>>
    assert.equal(success.value.messages.length, 1)
    const failure = pulled.find(
      v => v.status === 'rejected',
    ) as PromiseRejectedResult
    assert.equal(failure.reason.code, 'AGENT_MAIL_CONSUMER_ACTIVE')
  } finally {
    mail.dispose()
    await db.close()
  }
})

await test('concurrent session attempts allocate distinct ordered generations', async () => {
  const db = await openTestDatabase()
  const sessions = new SessionRepository(db)
  try {
    await sessions.createSession({
      sessionId: 'session',
      transcriptSessionId: 'transcript',
      transcriptPath: '/tmp/session.jsonl',
      orgId: 'org',
      userId: 'alice',
      role: 'user',
      scopes: [],
      cwd: '/tmp',
      runtime: {
        backend: 'docker',
        profileDir: '/tmp/profile',
        transcriptDir: '/tmp/transcripts',
      },
      status: 'creating',
      desiredState: 'active',
      title: '多语言长标题👋'.repeat(100),
    })
    assert.equal(
      (await sessions.getSession('session'))?.title,
      '多语言长标题👋'.repeat(100),
    )
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        sessions.createNextAttempt({
          attemptId: `attempt-${i}`,
          sessionId: 'session',
          resumeTranscriptSessionId: 'transcript',
          serverInstanceId: 'server',
          attemptDir: `/tmp/attempt-${i}`,
          manifestPath: `/tmp/attempt-${i}/manifest.json`,
        }),
      ),
    )
    assert.deepEqual(
      attempts.map(a => a.generation).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8],
    )
    assert.equal(
      (await sessions.getSession('session'))?.currentAttemptId,
      attempts.find(a => a.generation === 8)?.attemptId,
    )
  } finally {
    await db.close()
  }
})

await test('cloud quota, active names and folder deletion remain atomic under concurrent requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-model-cloud-'))
  const db = await openTestDatabase()
  let cloud: CloudStorageService | undefined
  try {
    await writeFile(join(root, 'server.json'), '{}')
    const { config } = await readServerConfig(join(root, 'server.json'))
    config.cloudStorage = {
      enabled: true,
      quotaBytes: 100,
      uploadTtlMs: 60000,
      bucket: 'test',
      region: 'test',
      forcePathStyle: true,
    }
    const store = {
      identity: 'model-test',
      ready: async () => {},
      multipart: async () => [],
      initiate: async () => 'multipart',
      abort: async () => {},
      delete: async () => {},
      close: () => {},
    } as unknown as ObjectStore
    cloud = new CloudStorageService(
      new CloudStorageRepository(db),
      config,
      async () => {},
      store,
    )
    await cloud.ensure()
    const reserved = await Promise.allSettled(
      [1, 2].map(i =>
        cloud!.start(auth('alice'), {
          name: `file-${i}`,
          size: 60,
          requestKey: `upload-${i}`,
        }),
      ),
    )
    assert.equal(reserved.filter(v => v.status === 'fulfilled').length, 1)
    assert.equal(
      (reserved.find(v => v.status === 'rejected') as PromiseRejectedResult)
        .reason.code,
      'QUOTA_EXCEEDED',
    )
    assert.equal((await cloud.quota(auth('alice'))).reservedBytes, 60)
    const folders = await Promise.allSettled(
      [1, 2].map(() => cloud!.folder(auth('alice'), { name: '同名目录' })),
    )
    assert.equal(folders.filter(v => v.status === 'fulfilled').length, 1)
    assert.equal(
      (folders.find(v => v.status === 'rejected') as PromiseRejectedResult)
        .reason.code,
      'NAME_CONFLICT',
    )
    const directory = (
      folders.find(v => v.status === 'fulfilled') as PromiseFulfilledResult<
        Awaited<ReturnType<typeof cloud.folder>>
      >
    ).value
    const mutation = await Promise.allSettled([
      cloud.delete(auth('alice'), directory.id),
      cloud.folder(auth('alice'), { name: 'child', parentId: directory.id }),
    ])
    assert.equal(mutation.filter(v => v.status === 'fulfilled').length, 1)
    // Deleted names may be reused, while case and trailing spaces remain significant.
    await cloud.folder(auth('alice'), { name: 'Case' })
    await cloud.folder(auth('alice'), { name: 'case' })
    await cloud.folder(auth('alice'), { name: 'Case ' })
    const disposable = await cloud.folder(auth('alice'), { name: 'reuse' })
    await cloud.delete(auth('alice'), disposable.id)
    await cloud.folder(auth('alice'), { name: 'reuse' })
  } finally {
    await cloud?.close()
    await db.close()
    await rm(root, { recursive: true, force: true })
  }
})

await test('RAGFlow stores local bindings and audit records with normalized constraint errors', async () => {
  const db = await openTestDatabase()
  try {
    await seed(db)
    const ragflow = new RagflowRepository(db)
    await ragflow.createAccount(
      'binding',
      'org',
      'alice',
      'external',
      'alice@ragflow.test',
      'remote-user',
      1,
      2,
    )
    assert.equal(
      (await ragflow.getBinding('org', 'alice', 'external'))?.ragflow_user_id,
      'remote-user',
    )
    assert.equal(
      await ragflow.getBinding('another-org', 'alice', 'external'),
      undefined,
    )
    await assert.rejects(
      ragflow.createAccount(
        'duplicate',
        'org',
        'alice',
        'external',
        'another@ragflow.test',
        null,
        1,
        2,
      ),
      (error: unknown) =>
        error instanceof DatabaseError && error.code === 'UNIQUE_CONSTRAINT',
    )
    await assert.rejects(
      ragflow.createAccount(
        'unknown',
        'org',
        'missing-user',
        'external',
        'missing@ragflow.test',
        null,
        1,
        2,
      ),
      (error: unknown) =>
        error instanceof DatabaseError &&
        error.code === 'FOREIGN_KEY_CONSTRAINT',
    )
    await ragflow.audit(
      'audit',
      'org',
      'alice',
      'alice',
      'ragflow.account.ensure',
      Date.now(),
    )
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) AS count FROM ragflow_audit_events')
          .get()
      )?.count,
      1,
    )
  } finally {
    await db.close()
  }
})

await test('fresh standalone startup, readiness and owner lock survive stop and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-model-start-'))
  let server:
    Awaited<ReturnType<typeof startStandaloneDirectConnectServer>> | undefined
  try {
    await writeFile(
      join(root, 'server.json'),
      JSON.stringify({
        server: { host: '127.0.0.1', port: 0 },
        storage: {
          rootDir: root,
          dataDir: join(root, 'data'),
          runDir: join(root, 'run'),
          logDir: join(root, 'log'),
        },
      }),
    )
    const { config } = await readServerConfig(join(root, 'server.json'))
    config.database = await testDatabaseConfig(join(root, 'metadata.db'))
    config.cloudStorage.enabled = false
    server = await startStandaloneDirectConnectServer(config)
    assert.equal((await fetch(`${server.httpUrl}/readyz`)).status, 200)
    assert.equal((await fetch(`${server.httpUrl}/healthz`)).status, 200)
    await assert.rejects(acquireDatabaseOwner(root), /already running/)
    await server.stop()
    server = await startStandaloneDirectConnectServer(config)
    assert.equal(server.bootstrapAdminPassword, undefined)
    assert.equal((await fetch(`${server.httpUrl}/readyz`)).status, 200)
  } finally {
    await server?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

await test('readiness fails when the database is unavailable while liveness stays healthy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-model-ready-'))
  const db = await openTestDatabase()
  let server: ReturnType<typeof startServer> | undefined
  try {
    await writeFile(join(root, 'server.json'), '{}')
    const { config } = await readServerConfig(join(root, 'server.json'))
    config.host = '127.0.0.1'
    config.port = 0
    config.cloudStorage.enabled = false
    const { service } = await createAuthService({
      db,
      tokenTtlSec: 3600,
      bootstrapAdmin: { username: 'admin' },
    })
    server = startServer(
      config,
      { store: { db } } as unknown as RuntimeService,
      service,
    )
    const url = `http://127.0.0.1:${await server.ready}`
    await db.close()
    assert.equal((await fetch(`${url}/readyz`)).status, 503)
    assert.equal((await fetch(`${url}/healthz`)).status, 200)
  } finally {
    await server?.stop()
    await db.close()
    await rm(root, { recursive: true, force: true })
  }
})
