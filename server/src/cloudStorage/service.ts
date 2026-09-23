import { randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { AuthContext } from '../auth/token.js'
import { CloudStorageRepository } from '../model/repositories/cloudStorage.js'
import type { ServerConfig } from '../types.js'
import { createObjectStore, type ObjectStore, type Part } from './s3.js'

export class CloudError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new CloudError(status, code, message)
}
export type FileRow = {
  id: string
  orgId: string
  ownerUserId: string
  parentId: string
  name: string
  kind: 'file' | 'folder'
  size: number
  revision: string
  objectKey: string
  state: string
  createdAt: number
  updatedAt: number
}
type Upload = {
  id: string
  orgId: string
  ownerUserId: string
  fileId: string
  requestKey: string
  signature: string
  size: number
  partSize: number
  s3Id: string | null
  state: string
  expiresAt: number
}
export function fileInfo(f: FileRow) {
  return {
    id: f.id,
    parentId: f.parentId || null,
    name: f.name,
    kind: f.kind,
    size: f.size,
    revision: f.revision,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }
}
export function validName(v: unknown): string {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    Buffer.byteLength(v) > 255 ||
    /[\x00-\x1f\x7f/\\]/u.test(v) ||
    v === '.' ||
    v === '..'
  )
    return fail(400, 'INVALID_NAME', 'Invalid file name')
  return v.normalize('NFC')
}
function id(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v !== 'string' || v.length > 128)
    return fail(400, 'INVALID_INPUT', 'Invalid ID')
  return v
}

// Database transactions cover reservations and publication; object-store I/O stays outside them.
export class CloudStorageService {
  private store: ObjectStore | null = null
  private loaded = false
  private stopped = false
  private timer: ReturnType<typeof setInterval>
  private sweepRunning = false
  private busy = new Set<string>()
  private streams = new Map<
    string,
    { owner: string; controller: AbortController }
  >()
  private healthAt = 0
  private healthy = false
  private loading: Promise<ObjectStore | null> | null = null
  private checking: Promise<void> | null = null
  constructor(
    private readonly repository: CloudStorageRepository,
    readonly config: ServerConfig,
    readonly authorize: (auth: AuthContext, scope: string) => Promise<void>,
    private readonly suppliedStore?: ObjectStore,
  ) {
    this.timer = setInterval(() => {
      void this.reconcile().catch(() => {})
    }, 60000)
    this.timer.unref()
  }
  async status() {
    if (!this.config.cloudStorage?.enabled)
      return { state: 'disabled', version: 1 }
    if (this.stopped) return { state: 'unavailable', version: 1 }
    try {
      if (!this.loaded || !this.store) {
        this.loading ??= this.suppliedStore
          ? Promise.resolve(this.suppliedStore)
          : createObjectStore(this.config)
        try {
          this.store = await this.loading
          this.loaded = true
        } finally {
          this.loading = null
        }
      }
      if (!this.store) return { state: 'unconfigured', version: 1 }
      const target = await this.repository.getTarget<{ value: string }>(
        'target',
      )
      if (target && target.value !== this.store.identity)
        return { state: 'target_mismatch', version: 1 }
      if (!target)
        await this.repository.insertTarget('target', this.store.identity)
      if (Date.now() - this.healthAt > 5000 && !this.checking) {
        this.checking = this.store
          .ready()
          .then(
            () => {
              this.healthy = true
            },
            () => {
              this.healthy = false
            },
          )
          .finally(() => {
            this.healthAt = Date.now()
            this.checking = null
          })
      }
      if (this.checking) await this.checking
      return { state: this.healthy ? 'ready' : 'unavailable', version: 1 }
    } catch {
      return { state: 'unavailable', version: 1 }
    }
  }
  async ensure() {
    const state = (await this.status()).state
    if (state !== 'ready')
      return fail(
        503,
        `STORAGE_${state.toUpperCase()}`,
        `Cloud storage is ${state}`,
      )
    return this.store!
  }
  async check(
    auth: AuthContext,
    permission: 'read' | 'write' | 'delete',
  ): Promise<void> {
    await this.authorize(auth, `cloud-storage:${permission}`)
  }
  async file(
    auth: AuthContext,
    fileId: string,
    pending = false,
  ): Promise<FileRow> {
    const f = await this.repository.getOwnedFile<FileRow>(
      fileId,
      auth.orgId,
      auth.userId,
    )
    if (!f || !(pending ? ['pending', 'ready'] : ['ready']).includes(f.state))
      return fail(404, 'FILE_NOT_FOUND', 'File not found')
    return f
  }
  private async parent(auth: AuthContext, parentId: string) {
    if (parentId && (await this.file(auth, parentId)).kind !== 'folder')
      fail(400, 'NOT_A_FOLDER', 'Parent must be a folder')
  }
  async quota(auth: AuthContext) {
    const used = (await this.repository.sumUsedBytes<{ n: number }>(
      auth.orgId,
      auth.userId,
    ))!.n
    const reserved = (await this.repository.sumReservedBytes<{ n: number }>(
      auth.orgId,
      auth.userId,
    ))!.n
    return {
      usedBytes: used,
      reservedBytes: reserved,
      limitBytes: this.config.cloudStorage!.quotaBytes,
    }
  }
  async list(
    auth: AuthContext,
    parentId: unknown,
    cursor?: string,
    limit = 100,
  ) {
    const parent = id(parentId)
    await this.parent(auth, parent)
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      fail(400, 'INVALID_INPUT', 'Limit must be 1..200')
    const rows = await this.repository.listChildren<FileRow>(
      auth.orgId,
      auth.userId,
      parent,
      id(cursor),
      limit + 1,
    )
    return {
      files: rows.slice(0, limit).map(fileInfo),
      nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
    }
  }
  private async insert(f: FileRow) {
    try {
      await this.repository.insertFile(
        f.id,
        f.orgId,
        f.ownerUserId,
        f.parentId,
        f.name,
        f.kind,
        f.size,
        f.revision,
        f.objectKey,
        f.state,
        f.createdAt,
        f.updatedAt,
      )
    } catch (e: any) {
      if (/UNIQUE constraint/.test(e.message))
        fail(409, 'NAME_CONFLICT', 'A file with this name already exists')
      throw e
    }
  }
  async folder(auth: AuthContext, body: Record<string, unknown>) {
    return await this.repository.transaction(async () => {
      const parentId = id(body.parentId)
      await this.parent(auth, parentId)
      const f: FileRow = {
        id: randomUUID(),
        orgId: auth.orgId,
        ownerUserId: auth.userId,
        parentId,
        name: validName(body.name),
        kind: 'folder',
        size: 0,
        revision: randomUUID(),
        objectKey: '',
        state: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      await this.insert(f)
      return fileInfo(f)
    })
  }
  async update(
    auth: AuthContext,
    fileId: string,
    body: Record<string, unknown>,
  ) {
    return await this.repository.transaction(async () => {
      const f = await this.file(auth, fileId)
      const parentId =
        body.parentId === undefined ? f.parentId : id(body.parentId)
      const name = body.name === undefined ? f.name : validName(body.name)
      await this.parent(auth, parentId)
      let ancestor = parentId
      while (ancestor) {
        if (ancestor === f.id)
          fail(
            409,
            'FOLDER_CYCLE',
            'Cannot move a folder into itself or its descendants',
          )
        ancestor = (await this.file(auth, ancestor)).parentId
      }
      try {
        await this.repository.updateFile(name, parentId, Date.now(), f.id)
      } catch (e: any) {
        if (/UNIQUE constraint/.test(e.message))
          fail(409, 'NAME_CONFLICT', 'A file with this name already exists')
        throw e
      }
      return fileInfo(await this.file(auth, fileId))
    })
  }
  async delete(auth: AuthContext, fileId: string) {
    const f = await this.repository.transaction(async () => {
      const f = await this.file(auth, fileId)
      if (await this.repository.findLiveChild(f.id))
        fail(409, 'FOLDER_NOT_EMPTY', 'Folder is not empty')
      await this.repository.markFileDeleting(Date.now(), f.id)
      return f
    })
    // Access is revoked immediately. Cleanup and quota release can safely retry.
    for (const [key, stream] of this.streams)
      if (key.startsWith(`download:${f.id}:`)) stream.controller.abort()
    await this.cleanupFile(f).catch(() => {})
    return { ok: true }
  }
  private async cleanupFile(f: FileRow) {
    if (f.objectKey) await this.store!.delete(f.objectKey)
    await this.repository.completeFileDeletion(f.id)
  }
  private async upload(auth: AuthContext, uploadId: string) {
    const u = await this.repository.getOwnedUpload<Upload>(
      uploadId,
      auth.orgId,
      auth.userId,
    )
    if (!u) return fail(404, 'UPLOAD_NOT_FOUND', 'Upload not found')
    return u
  }
  async uploadInfo(auth: AuthContext, uploadId: string) {
    const u = await this.upload(auth, uploadId)
    return {
      id: u.id,
      fileId: u.fileId,
      state: u.state,
      size: u.size,
      partSize: u.partSize,
      expiresAt: u.expiresAt,
      parts: await this.repository.listParts<Part>(u.id),
    }
  }
  async uploadByRequest(auth: AuthContext, requestKey: unknown) {
    const key = id(requestKey)
    if (!key) fail(400, 'INVALID_INPUT', 'requestKey is required')
    const u = await this.repository.findUploadByRequest<Upload>(
      auth.orgId, auth.userId, key,
    )
    if (!u) return fail(404, 'UPLOAD_NOT_FOUND', 'Upload not found')
    return this.uploadInfo(auth, u.id)
  }
  async start(auth: AuthContext, body: Record<string, unknown>) {
    const name = validName(body.name),
      parentId = id(body.parentId),
      size = body.size
    if (
      !Number.isSafeInteger(size) ||
      (size as number) < 0 ||
      (size as number) > 5 * 1024 ** 4
    )
      fail(400, 'INVALID_SIZE', 'Invalid size (maximum 5 TiB)')
    const requestKey = id(body.requestKey)
    if (!requestKey)
      fail(400, 'INVALID_INPUT', 'requestKey is required for idempotency')
    const signature = JSON.stringify([name, parentId, size])
    let u = await this.repository.findUploadByRequest<Upload>(
      auth.orgId,
      auth.userId,
      requestKey,
    )
    if (u && u.signature !== signature)
      fail(
        409,
        'IDEMPOTENCY_CONFLICT',
        'requestKey was used with different input',
      )
    if (!u) {
      u = await this.repository.transaction(async () => {
        const existing = await this.repository.findUploadByRequest<Upload>(
          auth.orgId,
          auth.userId,
          requestKey,
        )
        if (existing) {
          if (existing.signature !== signature)
            fail(
              409,
              'IDEMPOTENCY_CONFLICT',
              'requestKey was used with different input',
            )
          return existing
        }
        await this.parent(auth, parentId)
        const quota = await this.quota(auth)
        if (
          quota.usedBytes + quota.reservedBytes + (size as number) >
          quota.limitBytes
        )
          fail(413, 'QUOTA_EXCEEDED', 'Cloud storage quota exceeded')
        const f: FileRow = {
          id: randomUUID(),
          orgId: auth.orgId,
          ownerUserId: auth.userId,
          parentId,
          name,
          kind: 'file',
          size: size as number,
          revision: randomUUID(),
          objectKey: `data/${encodeURIComponent(auth.orgId)}/${encodeURIComponent(auth.userId)}/${randomUUID()}`,
          state: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        await this.insert(f)
        const upload: Upload = {
          id: randomUUID(),
          orgId: auth.orgId,
          ownerUserId: auth.userId,
          fileId: f.id,
          requestKey,
          signature,
          size: f.size,
          partSize: Math.max(
            16 * 1024 ** 2,
            Math.ceil(f.size / 10000 / 1024 ** 2) * 1024 ** 2,
          ),
          s3Id: null,
          state: 'preparing',
          expiresAt: Date.now() + this.config.cloudStorage!.uploadTtlMs,
        }
        await this.repository.insertUpload(
          upload.id,
          upload.orgId,
          upload.ownerUserId,
          upload.fileId,
          requestKey,
          signature,
          upload.size,
          upload.partSize,
          null,
          upload.state,
          upload.expiresAt,
        )
        return upload
      })
    }
    if (u.state === 'preparing')
      await this.exclusive(u.id, async () => {
        const f = await this.file(auth, u!.fileId, true)
        // Recover a lost CreateMultipartUpload response before starting another one.
        const ids = u!.size ? await this.store!.multipart(f.objectKey) : []
        const s3Id = u!.size
          ? ids[0] || (await this.store!.initiate(f.objectKey, f.revision))
          : null
        for (const orphan of ids.slice(1))
          await this.store!.abort(f.objectKey, orphan)
        await this.repository.markUploading(s3Id, u!.id)
      })
    return await this.uploadInfo(auth, u.id)
  }
  private assertUploading(u: Upload) {
    if (u.expiresAt < Date.now())
      fail(410, 'UPLOAD_EXPIRED', 'Upload session expired')
    if (u.state !== 'uploading')
      fail(409, 'UPLOAD_STATE', `Upload is ${u.state}`)
  }
  async exclusive<T>(key: string, fn: () => Promise<T>) {
    if (
      this.busy.has(key) ||
      [...this.streams.keys()].some(k => k.startsWith(`${key}:`))
    )
      return fail(409, 'UPLOAD_BUSY', 'Upload has an active operation')
    this.busy.add(key)
    try {
      return await fn()
    } finally {
      this.busy.delete(key)
    }
  }
  acquire(
    auth: AuthContext,
    key: string,
    permission: 'read' | 'write',
    upstream?: AbortSignal,
  ) {
    const owner = JSON.stringify([auth.orgId, auth.userId])
    if (
      this.streams.size >= 24 ||
      [...this.streams.values()].filter(v => v.owner === owner).length >= 3
    )
      fail(429, 'TRANSFER_LIMIT', 'Too many concurrent transfers')
    if (this.streams.has(key))
      fail(409, 'UPLOAD_BUSY', 'Part is already in flight')
    const controller = new AbortController()
    const abort = () => controller.abort()
    upstream?.addEventListener('abort', abort, { once: true })
    if (upstream?.aborted) abort()
    this.streams.set(key, { owner, controller })
    const timeout = setTimeout(abort, 15 * 60000)
    let checking = false
    const authTimer = setInterval(() => {
      if (checking) return
      checking = true
      void this.check(auth, permission)
        .catch(abort)
        .finally(() => {
          checking = false
        })
    }, 2000)
    return {
      signal: controller.signal,
      release: () => {
        clearTimeout(timeout)
        clearInterval(authTimer)
        upstream?.removeEventListener('abort', abort)
        this.streams.delete(key)
      },
    }
  }
  async part(
    auth: AuthContext,
    uploadId: string,
    number: number,
    size: number,
    source: Readable,
    signal?: AbortSignal,
  ) {
    const u = await this.upload(auth, uploadId)
    this.assertUploading(u)
    const count = Math.ceil(u.size / u.partSize)
    if (!Number.isInteger(number) || number < 1 || number > count)
      fail(400, 'INVALID_PART', 'Invalid part number')
    const expected = Math.min(u.partSize, u.size - (number - 1) * u.partSize)
    if (size !== -1 && size !== expected)
      fail(400, 'PART_SIZE', 'Part Content-Length does not match expected size')
    if (this.busy.has(u.id)) fail(409, 'UPLOAD_BUSY', 'Upload is being changed')
    const lease = this.acquire(auth, `${u.id}:${number}`, 'write', signal)
    let bytes = 0
    const counter = new Transform({
      transform(chunk, _encoding, cb) {
        bytes += chunk.length
        cb(
          bytes > expected
            ? new CloudError(400, 'PART_SIZE', 'Part is too large')
            : null,
          chunk,
        )
      },
      flush(cb) {
        cb(
          bytes !== expected
            ? new CloudError(400, 'PART_SIZE', 'Incomplete part')
            : null,
        )
      },
    })
    try {
      const f = await this.file(auth, u.fileId, true)
      const [, etag] = await Promise.all([
        pipeline(source, counter, { signal: lease.signal }),
        this.store!.part(
          f.objectKey,
          u.s3Id!,
          number,
          counter,
          expected,
          lease.signal,
        ).catch(e => {
          counter.destroy(e)
          throw e
        }),
      ])
      if (bytes !== expected) fail(400, 'PART_SIZE', 'Incomplete part')
      await this.check(auth, 'write')
      await this.repository.upsertPart(u.id, number, bytes, etag)
      return { number, size: bytes, etag }
    } finally {
      counter.destroy()
      lease.release()
    }
  }
  async complete(auth: AuthContext, uploadId: string) {
    return await this.exclusive(uploadId, async () => {
      const u = await this.upload(auth, uploadId)
      if (u.state === 'completed')
        return fileInfo(await this.file(auth, u.fileId))
      if (u.state !== 'completing') this.assertUploading(u)
      await this.repository.markCompleting(u.id)
      await this.finish(u, () => this.check(auth, 'write'))
      return fileInfo(await this.file(auth, u.fileId))
    })
  }
  private async finish(
    u: Upload,
    beforePublish: () => Promise<void> = async () => {},
  ): Promise<void> {
    const f = (await this.repository.getFile<FileRow>(u.fileId))!
    let head = await this.store!.head(f.objectKey)
    if (!head) {
      if (!u.size) await this.store!.putEmpty(f.objectKey, f.revision)
      else {
        let actual: Part[]
        try {
          actual = (await this.store!.parts(f.objectKey, u.s3Id!)).sort(
            (a, b) => a.number - b.number,
          )
        } catch (e: any) {
          if (e.name !== 'NoSuchUpload') throw e
          // A lost Complete response may have raced the earlier HEAD.
          if (await this.store!.head(f.objectKey))
            return await this.finish(u, beforePublish)
          await this.repository.markCancelling(u.id)
          return fail(
            410,
            'UPLOAD_EXPIRED',
            'The storage upload session no longer exists',
          )
        }
        const recorded = await this.repository.listParts<Part>(u.id)
        const count = Math.ceil(u.size / u.partSize)
        if (
          actual.length !== count ||
          actual.some(
            (p, i) =>
              p.number !== i + 1 ||
              p.size !== Math.min(u.partSize, u.size - i * u.partSize) ||
              p.etag !== recorded[i]?.etag,
          )
        ) {
          for (const p of recorded) {
            if (
              !actual.some(
                a =>
                  a.number === p.number &&
                  a.etag === p.etag &&
                  a.size === p.size,
              )
            )
              await this.repository.deletePart(u.id, p.number)
          }
          await this.repository.retryUpload(u.id)
          fail(
            409,
            'PARTS_INCOMPLETE',
            'Upload parts are missing or inconsistent',
          )
        }
        await this.store!.complete(f.objectKey, u.s3Id!, actual)
      }
      head = await this.store!.head(f.objectKey)
    }
    if (!head || head.size !== u.size || head.revision !== f.revision) {
      await this.repository.markCancelling(u.id)
      fail(502, 'OBJECT_MISMATCH', 'Stored object does not match the upload')
    }
    await beforePublish()
    await this.repository.transaction(async () => {
      await this.repository.publishFile(Date.now(), f.id)
      await this.repository.markCompleted(u.id)
      await this.repository.scheduleMultipartCleanup(
        u.id,
        Date.now() + 16 * 60000,
      )
    })
  }
  async cancel(auth: AuthContext, uploadId: string) {
    return await this.exclusive(uploadId, async () => {
      const u = await this.upload(auth, uploadId)
      if (u.state === 'completed')
        fail(
          409,
          'UPLOAD_COMPLETED',
          'Completed uploads must be deleted as files',
        )
      if (u.state === 'cancelled') return { ok: true }
      if (u.state === 'completing')
        fail(409, 'UPLOAD_BUSY', 'Completion is being reconciled')
      await this.repository.markCancelling(u.id)
      await this.cleanupUpload(u)
      return { ok: true }
    })
  }
  private async cleanupUpload(u: Upload) {
    const f = (await this.repository.getFile<FileRow>(u.fileId))!
    const ids = new Set([
      ...(await this.store!.multipart(f.objectKey)),
      ...(u.s3Id ? [u.s3Id] : []),
    ])
    for (const uploadId of ids) await this.store!.abort(f.objectKey, uploadId)
    await this.store!.delete(f.objectKey)
    await this.repository.transaction(async () => {
      await this.repository.markFileDeleted(f.id)
      await this.repository.markCancelled(u.id)
      await this.repository.deleteParts(u.id)
      await this.repository.scheduleMultipartCleanup(
        u.id,
        Date.now() + 16 * 60000,
      )
    })
  }
  async reconcile() {
    if (this.stopped || this.sweepRunning) return
    this.sweepRunning = true
    try {
      await this.ensure()
      for (const u of await this.repository.listPendingUploads<Upload>(
        Date.now(),
      )) {
        if (this.stopped) break
        await this.exclusive(u.id, async () => {
          // Another upload may have completed while the previous row was cleaned.
          const current = (await this.repository.getUpload<Upload>(u.id))!
          if (current.state === 'completing') await this.finish(current)
          else if (
            current.state === 'cancelling' ||
            (['preparing', 'uploading'].includes(current.state) &&
              current.expiresAt < Date.now())
          ) {
            await this.repository.markCancelling(current.id)
            await this.cleanupUpload(current)
          }
        }).catch(() => {})
      }
      for (const f of await this.repository.listDeletingFiles<FileRow>()) {
        if (this.stopped) break
        await this.cleanupFile(f).catch(() => {})
      }
      // Revisit after the maximum request lifetime: an S3 initiate/part response
      // can arrive after the HTTP caller has disconnected or timed out.
      for (const job of await this.repository.listMultipartCleanup<{
        uploadId: string
        objectKey: string
      }>(Date.now())) {
        if (this.stopped) break
        try {
          for (const uploadId of await this.store!.multipart(job.objectKey))
            await this.store!.abort(job.objectKey, uploadId)
          await this.repository.deleteMultipartCleanup(job.uploadId)
        } catch {
          /* Keep the job durable while the storage service is offline. */
        }
      }
    } catch {
      /* Storage downtime leaves durable work for the next sweep. */
    } finally {
      this.sweepRunning = false
    }
  }
  async close() {
    this.stopped = true
    clearInterval(this.timer)
    for (const s of this.streams.values()) s.controller.abort()
    while (this.busy.size || this.streams.size || this.sweepRunning)
      await new Promise(resolve => setTimeout(resolve, 20))
    this.store?.close()
  }
}
