import type { Database, SqlRow, SqlValue, WriteResult } from '../database.js'

export class CloudStorageRepository {
  constructor(readonly db: Database) {}
  async hasPendingUploads(): Promise<boolean> {
    return Boolean(
      await this.db
        .prepare(
          "SELECT id FROM cloud_uploads WHERE state IN ('preparing','uploading','completing','cancelling') LIMIT 1",
        )
        .get(),
    )
  }
  async filesForVerification(): Promise<
    Array<{ objectKey: string; size: number; revision: string }>
  > {
    return (await this.db
      .prepare(
        "SELECT objectKey,size,revision FROM cloud_files WHERE kind='file' AND state IN ('ready','deleting')",
      )
      .all()) as Array<{ objectKey: string; size: number; revision: string }>
  }
  async setTarget(identity: string): Promise<void> {
    await this.db
      .prepare(
        this.db.sql(
          "INSERT INTO cloud_settings (`key`,value) VALUES ('target',?) ON CONFLICT(`key`) DO UPDATE SET value=excluded.value",
          "INSERT INTO cloud_settings (`key`,value) VALUES ('target',?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
        ),
      )
      .run(identity)
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return await this.db.transaction(fn)
  }
  async getTarget<T = SqlRow>(...values: SqlValue[]): Promise<T | undefined> {
    return (await this.db
      .prepare('SELECT value FROM cloud_settings WHERE `key`=?')
      .get(...values)) as T | undefined
  }
  async insertTarget(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        this.db.sql(
          'INSERT OR IGNORE INTO cloud_settings (`key`,value) VALUES (?,?)',
          'INSERT INTO cloud_settings (`key`,value) VALUES (?,?) ON DUPLICATE KEY UPDATE `key`=`key`',
        ),
      )
      .run(...values)
  }
  async getOwnedFile<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        'SELECT * FROM cloud_files WHERE id=? AND orgId=? AND ownerUserId=?',
      )
      .get(...values)) as T | undefined
  }
  async sumUsedBytes<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        "SELECT COALESCE(SUM(size),0) n FROM cloud_files WHERE orgId=? AND ownerUserId=? AND state IN ('ready','deleting')",
      )
      .get(...values)) as T | undefined
  }
  async sumReservedBytes<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        "SELECT COALESCE(SUM(size),0) n FROM cloud_uploads WHERE orgId=? AND ownerUserId=? AND state IN ('preparing','uploading','completing','cancelling')",
      )
      .get(...values)) as T | undefined
  }
  async listChildren<T = SqlRow>(...values: SqlValue[]): Promise<T[]> {
    return (await this.db
      .prepare(
        "SELECT * FROM cloud_files WHERE orgId=? AND ownerUserId=? AND parentId=? AND state='ready' AND id>? ORDER BY id LIMIT ?",
      )
      .all(...values)) as T[]
  }
  async insertFile(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        'INSERT INTO cloud_files (id,orgId,ownerUserId,parentId,name,kind,size,revision,objectKey,state,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(...values)
  }
  async updateFile(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        'UPDATE cloud_files SET name=?,parentId=?,updatedAt=? WHERE id=?',
      )
      .run(...values)
  }
  async findLiveChild<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        "SELECT id FROM cloud_files WHERE parentId=? AND state IN ('ready','pending') LIMIT 1",
      )
      .get(...values)) as T | undefined
  }
  async markFileDeleting(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare("UPDATE cloud_files SET state='deleting',updatedAt=? WHERE id=?")
      .run(...values)
  }
  async completeFileDeletion(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        "UPDATE cloud_files SET state='deleted' WHERE id=? AND state='deleting'",
      )
      .run(...values)
  }
  async getOwnedUpload<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        'SELECT * FROM cloud_uploads WHERE id=? AND orgId=? AND ownerUserId=?',
      )
      .get(...values)) as T | undefined
  }
  async listParts<T = SqlRow>(...values: SqlValue[]): Promise<T[]> {
    return (await this.db
      .prepare(
        'SELECT number,size,etag FROM cloud_parts WHERE uploadId=? ORDER BY number',
      )
      .all(...values)) as T[]
  }
  async findUploadByRequest<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        'SELECT * FROM cloud_uploads WHERE orgId=? AND ownerUserId=? AND requestKey=?',
      )
      .get(...values)) as T | undefined
  }
  async insertUpload(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        'INSERT INTO cloud_uploads (id,orgId,ownerUserId,fileId,requestKey,signature,size,partSize,s3Id,state,expiresAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(...values)
  }
  async markUploading(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare("UPDATE cloud_uploads SET state='uploading',s3Id=? WHERE id=?")
      .run(...values)
  }
  async upsertPart(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        this.db.sql(
          'INSERT OR REPLACE INTO cloud_parts (uploadId,number,size,etag) VALUES (?,?,?,?)',
          'INSERT INTO cloud_parts (uploadId,number,size,etag) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE uploadId=VALUES(uploadId), number=VALUES(number), size=VALUES(size), etag=VALUES(etag)',
        ),
      )
      .run(...values)
  }
  async markCompleting(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare("UPDATE cloud_uploads SET state='completing' WHERE id=?")
      .run(...values)
  }
  async getFile<T = SqlRow>(...values: SqlValue[]): Promise<T | undefined> {
    return (await this.db
      .prepare('SELECT * FROM cloud_files WHERE id=?')
      .get(...values)) as T | undefined
  }
  async markCancelling(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare("UPDATE cloud_uploads SET state='cancelling' WHERE id=?")
      .run(...values)
  }
  async deletePart(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare('DELETE FROM cloud_parts WHERE uploadId=? AND number=?')
      .run(...values)
  }
  async retryUpload(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare("UPDATE cloud_uploads SET state='uploading' WHERE id=?")
      .run(...values)
  }
  async publishFile(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        "UPDATE cloud_files SET state='ready',updatedAt=? WHERE id=? AND state='pending'",
      )
      .run(...values)
  }
  async markCompleted(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare("UPDATE cloud_uploads SET state='completed' WHERE id=?")
      .run(...values)
  }
  async scheduleMultipartCleanup(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        this.db.sql(
          'INSERT OR REPLACE INTO cloud_multipart_cleanup (uploadId,dueAt) VALUES (?,?)',
          'INSERT INTO cloud_multipart_cleanup (uploadId,dueAt) VALUES (?,?) ON DUPLICATE KEY UPDATE uploadId=VALUES(uploadId), dueAt=VALUES(dueAt)',
        ),
      )
      .run(...values)
  }
  async markFileDeleted(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare("UPDATE cloud_files SET state='deleted' WHERE id=?")
      .run(...values)
  }
  async markCancelled(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare("UPDATE cloud_uploads SET state='cancelled' WHERE id=?")
      .run(...values)
  }
  async deleteParts(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare('DELETE FROM cloud_parts WHERE uploadId=?')
      .run(...values)
  }
  async listPendingUploads<T = SqlRow>(...values: SqlValue[]): Promise<T[]> {
    return (await this.db
      .prepare(
        "SELECT * FROM cloud_uploads WHERE state IN ('completing','cancelling') OR (expiresAt<? AND state IN ('preparing','uploading'))",
      )
      .all(...values)) as T[]
  }
  async getUpload<T = SqlRow>(...values: SqlValue[]): Promise<T | undefined> {
    return (await this.db
      .prepare('SELECT * FROM cloud_uploads WHERE id=?')
      .get(...values)) as T | undefined
  }
  async listDeletingFiles<T = SqlRow>(...values: SqlValue[]): Promise<T[]> {
    return (await this.db
      .prepare("SELECT * FROM cloud_files WHERE state='deleting'")
      .all(...values)) as T[]
  }
  async listMultipartCleanup<T = SqlRow>(...values: SqlValue[]): Promise<T[]> {
    return (await this.db
      .prepare(
        'SELECT c.uploadId,f.objectKey FROM cloud_multipart_cleanup c JOIN cloud_uploads u ON u.id=c.uploadId JOIN cloud_files f ON f.id=u.fileId WHERE c.dueAt<? LIMIT 100',
      )
      .all(...values)) as T[]
  }
  async deleteMultipartCleanup(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare('DELETE FROM cloud_multipart_cleanup WHERE uploadId=?')
      .run(...values)
  }
}
