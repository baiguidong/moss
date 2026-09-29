import type { Database } from '../database.js'

export interface ShareRow {
  id: string; orgId: string; ownerUserId: string; fileId: string; revision: string
  name: string; size: number; tokenHash: string; secret: string; codeHash: string | null
  requestKey: string; signature: string; createdAt: number; expiresAt: number | null; revokedAt: number | null
}

export class CloudSharesRepository {
  constructor(readonly db: Database) {}
  async byRequest(orgId: string, userId: string, key: string) {
    return await this.db.prepare('SELECT * FROM cloud_shares WHERE orgId=? AND ownerUserId=? AND requestKey=?')
      .get(orgId, userId, key) as unknown as ShareRow | undefined
  }
  async owned(orgId: string, userId: string, id: string) {
    return await this.db.prepare('SELECT * FROM cloud_shares WHERE orgId=? AND ownerUserId=? AND id=?')
      .get(orgId, userId, id) as unknown as ShareRow | undefined
  }
  async byToken(hash: string) {
    return await this.db.prepare('SELECT * FROM cloud_shares WHERE tokenHash=?').get(hash) as unknown as ShareRow | undefined
  }
  async insert(row: ShareRow) {
    const keys = Object.keys(row)
    await this.db.prepare(`INSERT INTO cloud_shares (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...Object.values(row))
  }
  async revoke(id: string, now: number) {
    await this.db.prepare('UPDATE cloud_shares SET revokedAt=? WHERE id=? AND revokedAt IS NULL').run(now, id)
  }
  async list(orgId: string, userId: string, limit: number, fileId?: string, cursor?: ShareRow) {
    const params: Array<string | number> = [orgId, userId]
    let where = 'orgId=? AND ownerUserId=?'
    if (fileId) { where += ' AND fileId=?'; params.push(fileId) }
    if (cursor) { where += ' AND (createdAt<? OR (createdAt=? AND id<?))'; params.push(cursor.createdAt, cursor.createdAt, cursor.id) }
    return await this.db.prepare(`SELECT * FROM cloud_shares WHERE ${where} ORDER BY createdAt DESC,id DESC LIMIT ?`)
      .all(...params, limit) as unknown as ShareRow[]
  }
}
