import type { Database } from '../database.js'

// Additive migration: existing sessions and user data remain untouched.
export async function installCronSchema(db: Database): Promise<void> {
  const text = db.dialect === 'mysql' ? 'VARCHAR(128)' : 'TEXT'
  const long = db.dialect === 'mysql' ? 'LONGTEXT' : 'TEXT'
  const engine = db.dialect === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin' : ''
  await db.exec(`CREATE TABLE IF NOT EXISTS cron_tasks (
    id ${text} PRIMARY KEY, org_id ${text} NOT NULL, user_id ${text} NOT NULL,
    owner_session_id ${text} NOT NULL, execution_session_id ${text},
    cron VARCHAR(255) NOT NULL, timezone VARCHAR(128) NOT NULL, prompt ${long} NOT NULL,
    recurring INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'idle', created_at BIGINT NOT NULL,
    next_run_at BIGINT, last_fired_at BIGINT, last_completed_at BIGINT,
    last_error ${long}, run_id ${text}, run_host ${text}, lease_until BIGINT,
    agent_id ${text}
  )${engine}`)
  await db.exec(`CREATE TABLE IF NOT EXISTS cron_session_links (
    session_id ${text} PRIMARY KEY, task_id ${text} NOT NULL, source_session_id ${text} NOT NULL
  )${engine}`)
  for (const [name, columns] of [['cron_due_idx', 'enabled, next_run_at'], ['cron_user_idx', 'org_id, user_id']]) {
    try { await db.exec(`CREATE INDEX ${db.dialect === 'sqlite' ? 'IF NOT EXISTS ' : ''}${name} ON cron_tasks (${columns})`) }
    catch (error) { if ((error as { code?: string }).code !== 'ER_DUP_KEYNAME') throw error }
  }
}
