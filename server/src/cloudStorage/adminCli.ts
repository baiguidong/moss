// Deployment-only commands. Normal storage runtime never provisions Silo IAM.
import { randomBytes, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { readServerConfig } from '../config.js'
import { openDatabase, requireSchema } from '../model/index.js'
import { acquireDatabaseOwner } from '../model/maintenance.js'
import { CloudStorageRepository } from '../model/repositories/cloudStorage.js'
import { ServerCredentialStore } from '../security/credentialStore.js'
import { createObjectStore } from './s3.js'

export async function cloudStorageCommand(command: string) {
  const { config } = await readServerConfig()
  const secrets = new ServerCredentialStore(config.rootDir)
  if (command === 'init-credentials') {
    if (
      !config.cloudStorage?.enabled ||
      config.cloudStorage.endpoint !== 'http://silo:9000'
    )
      throw new Error('Bundled Silo is not configured')
    let values = await secrets.get('cloud-storage', 's3')
    if (!values.accessKeyId || !values.secretAccessKey) {
      values = {
        accessKeyId: `moss${randomBytes(10).toString('hex')}`,
        secretAccessKey: randomBytes(32).toString('hex'),
      }
      await secrets.set('cloud-storage', 's3', values)
    }
    if (/[\r\n]/.test(values.accessKeyId! + values.secretAccessKey!))
      throw new Error('Invalid Silo credentials')
    process.stdout.write(`${values.accessKeyId}\n${values.secretAccessKey}\n`)
  } else if (command === 'set-credentials') {
    let input = ''
    for await (const chunk of process.stdin) {
      input += chunk
      if (input.length > 16384) throw new Error('Credential input too large')
    }
    const values = JSON.parse(input)
    if (
      typeof values.accessKeyId !== 'string' ||
      !values.accessKeyId ||
      typeof values.secretAccessKey !== 'string' ||
      !values.secretAccessKey
    )
      throw new Error('Expected accessKeyId and secretAccessKey on stdin')
    await secrets.set('cloud-storage', 's3', {
      accessKeyId: values.accessKeyId,
      secretAccessKey: values.secretAccessKey,
    })
  } else if (command === 'probe') {
    const store = await createObjectStore(config, false)
    if (!store)
      throw new Error('Cloud storage is disabled or has no credentials')
    const key = `data/.probe/${randomUUID()}`,
      revision = randomUUID()
    let uploadId: string | undefined
    try {
      await store.ready()
      await store.putEmpty(key, revision)
      if ((await store.head(key))?.size !== 0)
        throw new Error('Empty-object probe failed')
      await store.delete(key)
      uploadId = await store.initiate(key, revision)
      const data = Buffer.from('moss-s3-probe')
      await store.part(
        key,
        uploadId,
        1,
        Readable.from(data),
        data.length,
        AbortSignal.timeout(30000),
      )
      const parts = await store.parts(key, uploadId)
      await store.complete(key, uploadId, parts)
      const received: Buffer[] = []
      for await (const chunk of await store.get(key))
        received.push(Buffer.from(chunk))
      if (!Buffer.concat(received).equals(data))
        throw new Error('Multipart probe failed')
      await store.delete(key)
      await secrets.set('cloud-storage', 's3', {
        ...(await secrets.get('cloud-storage', 's3')),
        verifiedTarget: store.identity,
      })
      process.stdout.write('S3 write/read/delete/multipart probe passed\n')
    } finally {
      if (uploadId) await store.abort(key, uploadId).catch(() => {})
      await store.delete(key).finally(() => store.close())
    }
  } else if (command === 'verify-target') {
    const store = await createObjectStore(config)
    if (!store)
      throw new Error(
        'Run probe successfully before accepting a migrated target',
      )
    let release: (() => Promise<void>) | undefined
    let db: Awaited<ReturnType<typeof openDatabase>> | undefined
    try {
      release = await acquireDatabaseOwner(config.rootDir)
      db = await openDatabase(config.database)
      await requireSchema(db)
      const repository = new CloudStorageRepository(db)
      if (await repository.hasPendingUploads())
        throw new Error(
          'Finish or cancel all pending uploads before changing storage',
        )
      const files = await repository.filesForVerification()
      for (const file of files) {
        const actual = await store.head(file.objectKey)
        if (
          !actual ||
          actual.size !== file.size ||
          actual.revision !== file.revision
        )
          throw new Error(
            'Migration verification failed: missing or mismatched object',
          )
      }
      await repository.transaction(async () => {
        await repository.setTarget(store.identity)
      })
      process.stdout.write(
        `Verified ${files.length} objects; migrated storage target accepted\n`,
      )
    } finally {
      try {
        await db?.close()
      } finally {
        store.close()
        await release?.()
      }
    }
  } else
    throw new Error(
      'Expected cloud-storage init-credentials, set-credentials, probe or verify-target',
    )
}
