import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, mkdir, mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { CloudStorageHost } from '../../../ui/src/apps/cloud-storage.mjs'
import { createAuthService } from '../auth/service.js'
import { cloudStorageCommand } from '../cloudStorage/adminCli.js'
import {
  S3ObjectStore,
  type ObjectStore,
  type Part,
} from '../cloudStorage/s3.js'
import { CloudStorageService } from '../cloudStorage/service.js'
import { readServerConfig } from '../config.js'
import { AuthRepository } from '../model/repositories/auth.js'
import { CloudStorageRepository } from '../model/repositories/cloudStorage.js'
import { ServerCredentialStore } from '../security/credentialStore.js'
import { startServer } from '../server.js'
import { openTestDatabase, testDatabaseConfig } from './databaseTestUtils.js'

class MemoryStore implements ObjectStore {
  identity = 'memory'
  failDelete = false
  loseCompletion = false
  objects = new Map<string, { data: Buffer; revision: string }>()
  uploads = new Map<
    string,
    { key: string; revision: string; parts: Map<number, Buffer> }
  >()
  async ready() {}
  async head(key: string) {
    const o = this.objects.get(key)
    return o ? { size: o.data.length, revision: o.revision } : null
  }
  async get(key: string, range?: string) {
    let b = this.objects.get(key)!.data
    if (range) {
      const m = /bytes=(\d+)-(\d+)/.exec(range)!
      b = b.subarray(+m[1]!, +m[2]! + 1)
    }
    return Readable.from(b)
  }
  async putEmpty(key: string, revision: string) {
    this.objects.set(key, { data: Buffer.alloc(0), revision })
  }
  async delete(key: string) {
    if (this.failDelete) throw new Error('Unavailable')
    this.objects.delete(key)
  }
  async initiate(key: string, revision: string) {
    const id = randomUUID()
    this.uploads.set(id, { key, revision, parts: new Map() })
    return id
  }
  async part(_key: string, id: string, number: number, body: Readable) {
    const data: Buffer[] = []
    for await (const chunk of body) data.push(Buffer.from(chunk))
    const b = Buffer.concat(data)
    this.uploads.get(id)!.parts.set(number, b)
    return createHash('md5').update(b).digest('hex')
  }
  async parts(_key: string, id: string): Promise<Part[]> {
    if (!this.uploads.has(id))
      throw Object.assign(new Error('missing'), { name: 'NoSuchUpload' })
    return [...this.uploads.get(id)!.parts]
      .sort(([a], [b]) => a - b)
      .map(([number, b]) => ({
        number,
        size: b.length,
        etag: createHash('md5').update(b).digest('hex'),
      }))
  }
  async complete(key: string, id: string) {
    const u = this.uploads.get(id)!
    this.objects.set(key, {
      data: Buffer.concat(
        [...u.parts].sort(([a], [b]) => a - b).map(([, b]) => b),
      ),
      revision: u.revision,
    })
    this.uploads.delete(id)
    if (this.loseCompletion) {
      this.loseCompletion = false
      throw new Error('Completion response lost')
    }
  }
  async abort(_key: string, id: string) {
    this.uploads.delete(id)
  }
  async multipart(key: string) {
    return [...this.uploads].filter(([, u]) => u.key === key).map(([id]) => id)
  }
  close() {}
}
const root = await mkdtemp(join(tmpdir(), 'moss-cloud-test-'))
const db = await openTestDatabase(join(root, 'metadata.db'))
const docker = (...args: string[]) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
const real = process.env.MOSS_CLOUD_SILO_TEST === '1'
const image = 'docker.1ms.run/pgsty/silo:RELEASE.2026-08-06T00-00-00Z'
let container = '',
  network = '',
  restoreContainer = '',
  host: CloudStorageHost | undefined,
  moss: ReturnType<typeof startServer> | undefined
try {
  const { config } = await readServerConfig(join(root, 'server.json'))
  config.host = '127.0.0.1'
  config.port = 0
  config.rootDir = root
  config.database = await testDatabaseConfig(join(root, 'metadata.db'))
  config.cloudStorage = {
    enabled: true,
    bucket: 'moss-cloud-storage',
    region: 'us-east-1',
    forcePathStyle: true,
    quotaBytes: 8 * 1024 ** 3,
    uploadTtlMs: 3600000,
  }
  let store: ObjectStore = new MemoryStore()
  if (real) {
    network = `moss-cloud-test-${randomUUID()}`
    container = network
    docker('network', 'create', network)
    docker(
      'run',
      '-d',
      '--name',
      container,
      '--network',
      network,
      '--network-alias',
      'silo',
      '-p',
      '127.0.0.1::9000',
      '-e',
      'MINIO_ROOT_USER=test-admin',
      '-e',
      'MINIO_ROOT_PASSWORD=test-admin-secret-only',
      image,
      'server',
      '/data',
    )
    for (let i = 0; ; i++) {
      try {
        docker('exec', container, 'silo', 'healthcheck', 'ready')
        break
      } catch (e) {
        if (i > 45) throw e
        await new Promise(r => setTimeout(r, 1000))
      }
    }
    await mkdir(join(root, 'init'))
    await writeFile(
      join(root, 'init', 'credentials'),
      'test-moss-service\ntest-moss-service-secret-only\n',
      { mode: 0o600 },
    )
    const initScript = join(process.cwd(), 'deploy/server/scripts/silo-init.sh')
    const runInit = () =>
      docker(
        'run',
        '--rm',
        '--network',
        network,
        '-e',
        'MINIO_ROOT_USER=test-admin',
        '-e',
        'MINIO_ROOT_PASSWORD=test-admin-secret-only',
        '-e',
        'CLOUD_BUCKET=moss-cloud-storage',
        '-v',
        `${initScript}:/scripts/init.sh:ro`,
        '-v',
        `${join(root, 'init')}:/run/cloud-init:ro`,
        '--entrypoint',
        '/bin/sh',
        image,
        '/scripts/init.sh',
      )
    runInit()
    runInit() // Provisioning must be repeatable with the same credentials.
    const port = docker('port', container, '9000/tcp').split(':').at(-1)
    config.cloudStorage.endpoint = `http://127.0.0.1:${port}`
    store = new S3ObjectStore(config.cloudStorage, {
      accessKeyId: 'test-moss-service',
      secretAccessKey: 'test-moss-service-secret-only',
    })
  }
  const { service: auth } = await createAuthService({
    db,
    tokenTtlSec: 3600,
    bootstrapAdmin: { username: 'alice', password: 'alice-password' },
  })
  const login = await auth.issueTokenFromPassword({
    username: 'alice',
    password: 'alice-password',
  })
  const identity = (await auth.verifyAccessToken(login.access_token))!
  const bob = (
    await auth.createUser(
      {
        orgId: identity.orgId,
        email: 'bob@example.test',
        name: 'Bob',
        role: 'user',
        password: 'bob-password',
      },
      identity,
    )
  ).user
  const authDb = new AuthRepository(db)
  const otherOrg = randomUUID()
  await authDb.createOrganization(otherOrg, 'Other organization', Date.now())
  await authDb.ensureBuiltinRoles(otherOrg)
  const foreignUser = (
    await auth.createUser({
      orgId: otherOrg,
      email: 'foreign@example.test',
      name: 'Foreign',
      role: 'admin',
      password: 'foreign-password',
    })
  ).user
  const foreignLogin = await auth.issueTokenFromPassword({
    email: foreignUser.email!,
    password: 'foreign-password',
  })
  const bobLogin = await auth.issueTokenFromPassword({
    email: bob.email!,
    password: 'bob-password',
  })
  const runtime = { store: { db }, countActiveSessions: () => 0 } as any
  moss = await startServer(
    config,
    runtime,
    auth,
    undefined,
    undefined,
    undefined,
    store,
  )
  let base = `http://127.0.0.1:${await moss.ready}`
  async function request(
    suffix: string,
    method = 'GET',
    data?: any,
    token = login.access_token,
    expected = 200,
    headers = {},
  ) {
    const response = await fetch(`${base}/api/v1/cloud-storage${suffix}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(Buffer.isBuffer(data)
          ? {}
          : { 'content-type': 'application/json' }),
        ...headers,
      },
      body:
        data === undefined
          ? undefined
          : Buffer.isBuffer(data)
            ? data
            : JSON.stringify(data),
    })
    if (response.status !== expected)
      throw new Error(
        `${method} ${suffix}: expected ${expected}, got ${response.status} ${await response.text()}`,
      )
    return response
  }
  const j = async (...args: Parameters<typeof request>) =>
    (await request(...args)).json() as Promise<any>
  assert.equal((await j('/status')).state, 'ready')
  const folder = await j(
    '/folders',
    'POST',
    { name: 'Docs' },
    login.access_token,
    201,
  )
  await request('/folders', 'POST', { name: 'Docs' }, login.access_token, 409)
  await request(
    `/files/${folder.id}`,
    'PATCH',
    { parentId: folder.id },
    login.access_token,
    409,
  )
  await request(
    `/files/${folder.id}`,
    'GET',
    undefined,
    bobLogin.access_token,
    404,
  )
  await request(
    `/files/${folder.id}`,
    'GET',
    undefined,
    foreignLogin.access_token,
    404,
  )
  await request(
    `/files?parentId=${folder.id}`,
    'GET',
    undefined,
    bobLogin.access_token,
    404,
  )
  await request(
    '/uploads',
    'POST',
    { name: 'bad', size: 1, requestKey: randomUUID(), ownerUserId: bob.id },
    login.access_token,
    400,
  )
  const reserve = await j('/uploads', 'POST', {
    name: 'reserve',
    size: 5 * 1024 ** 3,
    requestKey: randomUUID(),
  })
  await request(
    '/uploads',
    'POST',
    { name: 'exceeds', size: 5 * 1024 ** 3, requestKey: randomUUID() },
    login.access_token,
    413,
  )
  await request(`/uploads/${reserve.id}`, 'DELETE')
  const input = {
    name: 'test.bin',
    size: 33 * 1024 ** 2 + 17,
    parentId: folder.id,
    requestKey: randomUUID(),
  }
  const u = await j('/uploads', 'POST', input)
  assert.equal((await j('/uploads', 'POST', input)).id, u.id)
  await request(
    '/uploads',
    'POST',
    { ...input, size: 1 },
    login.access_token,
    409,
  )
  await request(
    `/files/${folder.id}`,
    'DELETE',
    undefined,
    login.access_token,
    409,
  )
  await request(
    `/uploads/${u.id}`,
    'GET',
    undefined,
    bobLogin.access_token,
    404,
  )
  await request(
    `/uploads/${u.id}/parts/1`,
    'PUT',
    Buffer.from('short'),
    login.access_token,
    400,
  )
  await request(
    `/uploads/${u.id}/complete`,
    'POST',
    {},
    login.access_token,
    409,
  )
  for (let number = 1; number <= Math.ceil(input.size / u.partSize); number++) {
    const length = Math.min(u.partSize, input.size - (number - 1) * u.partSize)
    await request(
      `/uploads/${u.id}/parts/${number}`,
      'PUT',
      Buffer.alloc(length, number),
    )
  }
  if (store instanceof MemoryStore) store.loseCompletion = true
  let file
  if (store instanceof MemoryStore) {
    await request(
      `/uploads/${u.id}/complete`,
      'POST',
      {},
      login.access_token,
      502,
    )
    await moss.stop()
    moss = await startServer(
      config,
      runtime,
      auth,
      undefined,
      undefined,
      undefined,
      store,
    )
    base = `http://127.0.0.1:${await moss.ready}`
    file = await j(`/uploads/${u.id}/complete`, 'POST', {})
  } else file = await j(`/uploads/${u.id}/complete`, 'POST', {})
  assert.equal((await j(`/uploads/${u.id}/complete`, 'POST', {})).id, file.id)
  assert.equal((await j('/quota')).reservedBytes, 0)
  const head = await request(`/files/${file.id}/content`, 'HEAD')
  assert.equal(Number(head.headers.get('content-length')), input.size)
  const ranged = await request(
    `/files/${file.id}/content`,
    'GET',
    undefined,
    login.access_token,
    206,
    { range: 'bytes=10-25' },
  )
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), Buffer.alloc(16, 1))
  await request(
    `/files/${file.id}/content`,
    'GET',
    undefined,
    login.access_token,
    416,
    { range: `bytes=${input.size}-` },
  )
  await request(
    `/files/${file.id}/content`,
    'GET',
    undefined,
    login.access_token,
    412,
    { 'if-match': '"wrong"' },
  )
  await request(
    `/files/${file.id}/content`,
    'GET',
    undefined,
    bobLogin.access_token,
    404,
  )
  const empty = await j('/uploads', 'POST', {
    name: 'empty',
    size: 0,
    requestKey: randomUUID(),
  })
  const emptyFile = await j(`/uploads/${empty.id}/complete`, 'POST', {})
  assert.equal(
    (await (await request(`/files/${emptyFile.id}/content`)).arrayBuffer())
      .byteLength,
    0,
  )
  if (real) {
    // Consistent stopped-service backup: metadata, objects, private IAM state and credentials.
    await new ServerCredentialStore(root).set('cloud-storage', 's3', {
      accessKeyId: 'test-moss-service',
      secretAccessKey: 'test-moss-service-secret-only',
    })
    await moss.stop()
    moss = undefined
    const backupDbPath = join(root, 'backup.db')
    await db.exec(`VACUUM INTO '${backupDbPath.replaceAll("'", "''")}'`)
    docker('stop', container)
    docker('cp', `${container}:/data`, join(root, 'backup-data'))
    docker('start', container)
    restoreContainer = `${container}-restore`
    docker(
      'create',
      '--name',
      restoreContainer,
      '-p',
      '127.0.0.1::9000',
      '-e',
      'MINIO_ROOT_USER=test-admin',
      '-e',
      'MINIO_ROOT_PASSWORD=test-admin-secret-only',
      image,
      'server',
      '/data',
    )
    docker('cp', `${join(root, 'backup-data')}/.`, `${restoreContainer}:/data`)
    docker('start', restoreContainer)
    for (let i = 0; ; i++) {
      try {
        docker('exec', restoreContainer, 'silo', 'healthcheck', 'ready')
        break
      } catch (e) {
        if (i > 45) throw e
        await delay(1000)
      }
    }
    const restoreEndpoint = `http://127.0.0.1:${docker('port', restoreContainer, '9000/tcp').split(':').at(-1)}`
    const restoreRoot = join(root, 'restore')
    const restoreConfig = {
      ...config,
      rootDir: restoreRoot,
      database: { driver: 'sqlite', filename: backupDbPath } as const,
      cloudStorage: { ...config.cloudStorage!, endpoint: restoreEndpoint },
    }
    await mkdir(restoreRoot)
    const credentialStore = new ServerCredentialStore(restoreRoot)
    await cp(join(root, 'credentials'), join(restoreRoot, 'credentials'), {
      recursive: true,
    })
    assert.equal(
      (await credentialStore.get('cloud-storage', 's3')).accessKeyId,
      'test-moss-service',
    )
    const restoreConfigPath = join(restoreRoot, 'server.json')
    await writeFile(
      restoreConfigPath,
      JSON.stringify({
        database: { driver: 'sqlite', filename: backupDbPath },
        storage: { rootDir: restoreRoot },
        cloudStorage: restoreConfig.cloudStorage,
      }),
    )
    const previousConfig = process.env.MOSS_SERVER_CONFIG
    process.env.MOSS_SERVER_CONFIG = restoreConfigPath
    try {
      await cloudStorageCommand('probe')
      await cloudStorageCommand('verify-target')
    } finally {
      if (previousConfig === undefined) delete process.env.MOSS_SERVER_CONFIG
      else process.env.MOSS_SERVER_CONFIG = previousConfig
    }
    const restoredDb = await openTestDatabase(backupDbPath)
    const restoredAuth = await createAuthService({
      db: restoredDb,
      tokenTtlSec: 3600,
      bootstrapAdmin: { username: 'alice' },
    })
    const restored = await startServer(
      restoreConfig,
      { store: { db: restoredDb }, countActiveSessions: () => 0 } as any,
      restoredAuth.service,
    )
    try {
      const restoredBase = `http://127.0.0.1:${await restored.ready}`
      const restoredContent = await fetch(
        `${restoredBase}/api/v1/cloud-storage/files/${file.id}/content`,
        { headers: { authorization: `Bearer ${login.access_token}` } },
      )
      assert.equal(restoredContent.status, 200)
      const hash = createHash('sha256')
      for await (const chunk of restoredContent.body! as any) hash.update(chunk)
      const originalHash = createHash('sha256')
      for (let n = 1; n <= Math.ceil(input.size / u.partSize); n++)
        originalHash.update(
          Buffer.alloc(
            Math.min(u.partSize, input.size - (n - 1) * u.partSize),
            n,
          ),
        )
      assert.equal(hash.digest('hex'), originalHash.digest('hex'))
    } finally {
      await restored.stop()
      await restoredDb.close()
    }
    docker('rm', '-f', restoreContainer)
    restoreContainer = ''
    config.cloudStorage!.endpoint = `http://127.0.0.1:${docker('port', container, '9000/tcp').split(':').at(-1)}`
    store = new S3ObjectStore(config.cloudStorage!, {
      accessKeyId: 'test-moss-service',
      secretAccessKey: 'test-moss-service-secret-only',
    })
    await store.ready()
    await db
      .prepare('UPDATE cloud_settings SET value=? WHERE key=?')
      .run(store.identity, 'target')
    moss = await startServer(
      config,
      runtime,
      auth,
      undefined,
      undefined,
      undefined,
      store,
    )
    base = `http://127.0.0.1:${await moss.ready}`
    process.stdout.write(
      'Stopped-service backup and restore content verification passed\n',
    )
  }
  // Current key validity is checked even while its JWT remains cryptographically valid.
  const key = await auth.issuePermanentApiKeyForOAuthUser({
    userId: bob.id,
    orgId: identity.orgId,
  })
  const keyLogin = await auth.issueTokenFromApiKey(key.api_key)
  await db
    .prepare("UPDATE api_keys SET status='revoked' WHERE id=?")
    .run(key.key.id)
  await request('/status', 'GET', undefined, keyLogin.access_token, 401)
  const cancelRequestKey = randomUUID()
  const pending = await j('/uploads', 'POST', {
    name: 'cancel',
    size: 123,
    requestKey: cancelRequestKey,
  })
  assert.equal(
    (await j(`/uploads?requestKey=${cancelRequestKey}`)).id,
    pending.id,
  )
  await request(
    `/uploads?requestKey=${cancelRequestKey}`,
    'GET',
    undefined,
    bobLogin.access_token,
    404,
  )
  await request(
    `/uploads?requestKey=${cancelRequestKey}`,
    'GET',
    undefined,
    foreignLogin.access_token,
    404,
  )
  await request(`/uploads/${pending.id}`, 'DELETE')
  assert.equal((await j('/quota')).reservedBytes, 0)
  if (store instanceof MemoryStore) store.failDelete = true
  await request(`/files/${file.id}`, 'DELETE')
  await request(`/files/${file.id}`, 'GET', undefined, login.access_token, 404)
  if (store instanceof MemoryStore) {
    assert.equal((await j('/quota')).usedBytes, input.size)
    store.failDelete = false
    const recovery = new CloudStorageService(
      new CloudStorageRepository(db),
      config,
      async (a, s) => await auth.requireCurrentScope(a, s),
      store,
    )
    await recovery.reconcile()
    await recovery.close()
    assert.equal((await j('/quota')).usedBytes, 0)
  }
  const missing = await j('/uploads', 'POST', {
    name: 'missing-multipart',
    size: 123,
    requestKey: randomUUID(),
  })
  const missingRow = (await db
    .prepare(
      'SELECT u.s3Id,f.objectKey FROM cloud_uploads u JOIN cloud_files f ON f.id=u.fileId WHERE u.id=?',
    )
    .get(missing.id)) as any
  await store.abort(missingRow.objectKey, missingRow.s3Id)
  await request(
    `/uploads/${missing.id}/complete`,
    'POST',
    {},
    login.access_token,
    410,
  )
  const orphanFile = (await db
    .prepare('SELECT objectKey,revision FROM cloud_files WHERE id=?')
    .get(emptyFile.id)) as any
  await store.initiate(orphanFile.objectKey, orphanFile.revision)
  await db.prepare('UPDATE cloud_multipart_cleanup SET dueAt=0').run()
  const maintenanceStore = real
    ? new S3ObjectStore(config.cloudStorage!, {
        accessKeyId: 'test-moss-service',
        secretAccessKey: 'test-moss-service-secret-only',
      })
    : store
  const maintenance = new CloudStorageService(
    new CloudStorageRepository(db),
    config,
    async (a, s) => await auth.requireCurrentScope(a, s),
    maintenanceStore,
  )
  await maintenance.reconcile()
  await maintenance.close()
  assert.equal((await j('/quota')).reservedBytes, 0)
  assert.equal((await store.multipart(orphanFile.objectKey)).length, 0)
  assert.ok(await store.head(orphanFile.objectKey))
  // Host integration: opaque handles, streaming, persistence, pause and account isolation.
  const sourcePath = join(root, 'source.bin'),
    destination = join(root, 'download.bin')
  const sourceSize =
    Number(process.env.MOSS_CLOUD_TEST_BYTES) ||
    (real ? 2 * 1024 ** 3 + 101 : 35 * 1024 ** 2 + 101)
  const src = await open(sourcePath, 'w')
  await src.truncate(sourceSize)
  await src.write(Buffer.from('moss-large-file-check'), 0, 21, sourceSize - 21)
  await src.close()
  let settings: any = {
    remoteEnabled: true,
    remoteDirect: {
      serverUrl: base,
      credentialMode: 'api-key',
      apiKey: 'test-host-key',
    },
  }
  let allowed = true,
    fetches = 0,
    holdParts = false,
    holdEveryPart = false
  const sentParts: number[] = []
  const context = { appId: 'com.test.cloud', instanceId: 'default' }
  const options = {
    directory: join(root, 'transfers'),
    getSettings: () => settings,
    resolveConnection: async () => ({
      serverUrl: base,
      userId:
        settings.remoteDirect.apiKey === 'test-host-key'
          ? identity.userId
          : bob.id,
      orgId: identity.orgId,
      authToken:
        settings.remoteDirect.apiKey === 'test-host-key'
          ? login.access_token
          : bobLogin.access_token,
    }),
    fetchImpl: async (...args: any[]) => {
      fetches++
      const part = /\/parts\/(\d+)$/.exec(String(args[0]))
      if (part) {
        sentParts.push(+part[1]!)
        if (holdEveryPart || (holdParts && +part[1]! > 1))
          await delay(2000, undefined, { signal: args[1].signal })
      }
      return fetch(...(args as [any, any]))
    },
    pickFiles: async () => [sourcePath],
    pickDestination: async () => destination,
    authorizeApp: async () => allowed,
  }
  host = new CloudStorageHost(options)
  const handle = await host.handle('local-files.pick', {}, context)
  assert.equal(JSON.stringify(handle).includes(root), false)
  await assert.rejects(() =>
    host!.handle(
      'uploads.start',
      { handle: handle.files[0].handle },
      { ...context, appId: 'com.other' },
    ),
  )
  let peakRSS = process.memoryUsage().rss
  const baselineRSS = peakRSS
  const memoryTimer = setInterval(() => {
    peakRSS = Math.max(peakRSS, process.memoryUsage().rss)
  }, 50)
  memoryTimer.unref()
  const transfer = await host.handle(
    'uploads.start',
    { handle: handle.files[0].handle },
    context,
  )
  const waitTask = async (id: string) => {
    for (let i = 0; i < 12000; i++) {
      const t = await host!.handle('transfers.get', { transferId: id }, context)
      if (t.state === 'completed') return t
      if (t.state === 'paused')
        throw new Error(`Transfer paused: ${JSON.stringify(t)}`)
      await new Promise(r => setTimeout(r, 25))
    }
    throw new Error('Transfer timed out')
  }
  const uploaded = await waitTask(transfer.transferId)
  const dl = await host.handle(
    'downloads.start',
    { fileId: uploaded.fileId },
    context,
  )
  await waitTask(dl.transferId)
  assert.equal((await stat(destination)).size, sourceSize)
  const hash = async (filename: string) => {
    const h = createHash('sha256')
    for await (const b of createReadStream(filename)) h.update(b)
    return h.digest('hex')
  }
  assert.equal(await hash(sourcePath), await hash(destination))
  clearInterval(memoryTimer)
  if (real)
    assert.ok(
      peakRSS - baselineRSS < 512 * 1024 ** 2,
      `Unbounded buffering: ${peakRSS - baselineRSS}`,
    )
  process.stdout.write(
    `Transfer size ${sourceSize}; peak RSS increase ${Math.round((peakRSS - baselineRSS) / 1024 ** 2)} MiB\n`,
  )
  // Pause while parts 2/3 are in flight. Only completed parts survive the retry.
  await writeFile(sourcePath, Buffer.alloc(35 * 1024 ** 2, 7))
  const again = await host.handle('local-files.pick', {}, context)
  holdParts = true
  sentParts.length = 0
  const interrupt = await host.handle(
    'uploads.start',
    { handle: again.files[0].handle, name: 'interrupt.bin' },
    context,
  )
  for (let i = 0; i < 200; i++) {
    const t = host.tasks.get(interrupt.transferId)
    if (t?.uploadId && (await j(`/uploads/${t.uploadId}`)).parts.length) break
    await delay(25)
  }
  await host.handle(
    'transfers.pause',
    { transferId: interrupt.transferId },
    context,
  )
  while (host.running.has(interrupt.transferId)) await delay(10)
  const firstPartAttempts = sentParts.filter(n => n === 1).length
  holdParts = false
  await host.handle(
    'transfers.resume',
    { transferId: interrupt.transferId },
    context,
  )
  await waitTask(interrupt.transferId)
  assert.equal(sentParts.filter(n => n === 1).length, firstPartAttempts)
  // Handles identify the original source, not whatever later occupies that path.
  await writeFile(sourcePath, 'changed')
  const changed = await host.handle(
    'uploads.start',
    { handle: again.files[0].handle, name: 'changed.bin' },
    context,
  )
  while (host.running.has(changed.transferId)) await delay(10)
  assert.equal(
    (
      await host.handle(
        'transfers.get',
        { transferId: changed.transferId },
        context,
      )
    ).error,
    'SOURCE_CHANGED',
  )
  const permissionHandle = await host.handle('local-files.pick', {}, context)
  holdEveryPart = true
  const permissionTask = await host.handle(
    'uploads.start',
    { handle: permissionHandle.files[0].handle, name: 'permission.bin' },
    context,
  )
  while (!host.tasks.get(permissionTask.transferId)?.uploadId) await delay(10)
  allowed = false
  await host.watch()
  while (host.running.has(permissionTask.transferId)) await delay(10)
  assert.equal(host.tasks.get(permissionTask.transferId).state, 'paused')
  assert.equal(
    host.tasks.get(permissionTask.transferId).error,
    'PERMISSION_DENIED',
  )
  allowed = true
  holdEveryPart = false
  await host.close()
  host = new CloudStorageHost(options)
  assert.equal(
    (
      await host.handle(
        'transfers.get',
        { transferId: transfer.transferId },
        context,
      )
    ).state,
    'completed',
  )
  settings = { ...settings, remoteEnabled: false }
  host.invalidate()
  const before = fetches
  assert.equal(
    (await host.handle('status.get', {}, context)).state,
    'remote_disabled',
  )
  assert.equal(fetches, before)
  settings = {
    ...settings,
    remoteEnabled: true,
    remoteDirect: { ...settings.remoteDirect, apiKey: 'different' },
  }
  host.invalidate()
  await assert.rejects(() =>
    host!.handle('transfers.get', { transferId: transfer.transferId }, context),
  )
  allowed = false
  await assert.rejects(() => host!.handle('files.list', {}, context))
  process.stdout.write(
    `Cloud suite passed (${real ? 'real Silo, upload/download SHA-256 matched' : 'memory store'})\n`,
  )
} finally {
  await host?.close().catch(() => {})
  await moss?.stop()
  await db.close()
  if (restoreContainer) {
    try {
      docker('rm', '-f', restoreContainer)
    } catch {}
  }
  if (container) {
    try {
      docker('rm', '-f', container)
    } catch {}
  }
  if (network) {
    try {
      docker('network', 'rm', network)
    } catch {}
  }
  for (const keyRoot of [root, join(root, 'restore')])
    await rm(
      join(
        homedir(),
        '.moss-credential-key-backup',
        `${createHash('sha256').update(keyRoot).digest('hex').slice(0, 16)}.key`,
      ),
      { force: true },
    )
  await rm(root, { recursive: true, force: true })
}
