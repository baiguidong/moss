import type { Database, SqlRow, SqlValue, WriteResult } from '../database.js'

export class RagflowRepository {
  constructor(readonly db: Database) {}
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return await this.db.transaction(fn)
  }
  async getBinding<T = SqlRow>(...values: SqlValue[]): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      SELECT * FROM ragflow_bindings
      WHERE org_id = ? AND user_id = ? AND instance_id = ? LIMIT 1
    `,
      )
      .get(...values)) as T | undefined
  }
  async getUser<T = SqlRow>(...values: SqlValue[]): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      SELECT id, name, email FROM users WHERE org_id = ? AND id = ? LIMIT 1
    `,
      )
      .get(...values)) as T | undefined
  }
  async createAccount(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        `
          INSERT INTO ragflow_bindings (
            id, org_id, user_id, instance_id, ragflow_username, ragflow_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(...values)
  }
  async audit(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        `
      INSERT INTO ragflow_audit_events (
        id, org_id, actor_user_id, target_user_id, action, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(...values)
  }
}
