import { join } from 'node:path'
import type { DatabaseConfig } from './config.js'
import { Database } from './database.js'
import { AgentMailRepository } from './repositories/agentMail.js'
import { AuthRepository } from './repositories/auth.js'
import { CloudStorageRepository } from './repositories/cloudStorage.js'
import { OpenIMRepository } from './repositories/openIM.js'
import { RagflowRepository } from './repositories/ragflow.js'
import { SessionRepository } from './repositories/session.js'
import { mysqlSchema } from './schema/mysql.js'
import { sqliteSchema } from './schema/sqlite.js'

export type { DatabaseConfig } from './config.js'
export { Database } from './database.js'

export async function createModels(config: DatabaseConfig) {
  const db = await openDatabase(config, { initialize: true })
  return {
    db,
    sessions: new SessionRepository(db),
    auth: new AuthRepository(db),
    agentMail: new AgentMailRepository(db),
    openIM: new OpenIMRepository(db),
    ragflow: new RagflowRepository(db),
    cloudStorage: new CloudStorageRepository(db),
    close: async () => await db.close(),
  }
}

export async function openDatabase(
  config: DatabaseConfig,
  options: { initialize?: boolean } = {},
): Promise<Database> {
  const driver =
    config.driver === 'sqlite'
      ? new (await import('./drivers/sqlite.js')).SqliteDriver(
          config.filename || join(process.cwd(), 'moss-server.db'),
        )
      : new (await import('./drivers/mysql.js')).MysqlDriver(config)
  const db = new Database(driver)
  try {
    await db.check()
    if (options.initialize) await initializeDatabase(db)
    return db
  } catch (error) {
    await db.close().catch(() => {})
    throw error
  }
}

export async function initializeDatabase(db: Database): Promise<void> {
  await db.initializeSchema(async () => {
    const tables = await db
      .prepare(
        db.sql(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()',
        ),
      )
      .all()
    if (tables.length && !tables.some(row => row.name === 'model_schema')) {
      throw new Error(
        'This database contains an unsupported schema; configure a fresh database',
      )
    }
    await db.exec(
      'CREATE TABLE IF NOT EXISTS model_schema (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)',
    )
    const version = await db
      .prepare('SELECT version FROM model_schema WHERE id=1')
      .get()
    if (version && Number(version.version) === 1) return
    if (version && Number(version.version) !== 0)
      throw new Error('Unsupported database schema version')
    if (!version)
      await db
        .prepare('INSERT INTO model_schema (id,version) VALUES (1,0)')
        .run()
    await db.exec(
      'CREATE TABLE IF NOT EXISTS model_write_lock (id INTEGER PRIMARY KEY)',
    )
    await db
      .prepare(
        db.sql(
          'INSERT OR IGNORE INTO model_write_lock VALUES (1)',
          'INSERT INTO model_write_lock VALUES (1) ON DUPLICATE KEY UPDATE id=id',
        ),
      )
      .run()
    const statements = db.dialect === 'sqlite' ? sqliteSchema : mysqlSchema
    for (const sql of statements) {
      try {
        await db.exec(sql)
      } catch (error) {
        // MySQL DDL commits separately. Resume interrupted initial creation.
        if ((error as { code?: string }).code !== 'ER_DUP_KEYNAME') throw error
      }
    }
    await db.prepare('UPDATE model_schema SET version=1 WHERE id=1').run()
  })
}

export async function requireSchema(db: Database): Promise<void> {
  const row = await db
    .prepare('SELECT version FROM model_schema WHERE id=1')
    .get()
  if (Number(row?.version) !== 1)
    throw new Error('Database is not initialized by Moss Server')
}
