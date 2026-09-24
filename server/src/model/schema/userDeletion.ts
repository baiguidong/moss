import type { Database } from '../database.js'

export async function installUserDeletionSchema(db: Database): Promise<void> {
  const columns = await db.prepare(db.sql(
    'PRAGMA table_info(users)',
    "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'",
  )).all()
  // MySQL DDL may commit before the schema version is updated.
  if (!columns.some(column => column.name === 'deleted_at')) {
    await db.exec('ALTER TABLE users ADD COLUMN deleted_at BIGINT')
  }
}
