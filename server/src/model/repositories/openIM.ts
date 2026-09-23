import type { Database, SqlRow, SqlValue, WriteResult } from '../database.js'

export class OpenIMRepository {
  constructor(readonly db: Database) {}
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return await this.db.transaction(fn)
  }
  async getBinding<T = SqlRow>(...values: SqlValue[]): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      SELECT * FROM openim_bindings
      WHERE org_id = ? AND user_id = ? AND instance_id = ?
      LIMIT 1
    `,
      )
      .get(...values)) as T | undefined
  }
  async getBindingByOpenIMUserId<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      SELECT * FROM openim_bindings
      WHERE instance_id = ? AND openim_user_id = ?
      LIMIT 1
    `,
      )
      .get(...values)) as T | undefined
  }
  async ensureBinding(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        this.db.sql(
          `
      INSERT OR IGNORE INTO openim_bindings (
        id, org_id, user_id, instance_id, openim_user_id,
        profile_hash, provisioned_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
          `
      INSERT INTO openim_bindings (
        id, org_id, user_id, instance_id, openim_user_id,
        profile_hash, provisioned_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id=id`,
        ),
      )
      .run(...values)
  }
  async provision(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        `
      UPDATE openim_bindings
      SET profile_hash = ?, provisioned_at = ?, updated_at = ?
      WHERE id = ?
    `,
      )
      .run(...values)
  }
  async getGroupOrg<T = SqlRow>(...values: SqlValue[]): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      SELECT org_id FROM openim_group_bindings
      WHERE instance_id = ? AND openim_group_id = ?
      LIMIT 1
    `,
      )
      .get(...values)) as T | undefined
  }
  async bindGroup(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        this.db.sql(
          `
      INSERT INTO openim_group_bindings (
        id, org_id, instance_id, openim_group_id,
        created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(instance_id, openim_group_id) DO UPDATE SET
        org_id = excluded.org_id,
        created_by_user_id = excluded.created_by_user_id,
        updated_at = excluded.updated_at
    `,
          `
      INSERT INTO openim_group_bindings (
        id, org_id, instance_id, openim_group_id,
        created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        org_id = VALUES(org_id),
        created_by_user_id = VALUES(created_by_user_id),
        updated_at = VALUES(updated_at)
    `,
        ),
      )
      .run(...values)
  }
}
