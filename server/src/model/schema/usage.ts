import type { Database } from '../database.js'

export async function installUsageSchema(db: Database): Promise<void> {
  const text = db.dialect === 'mysql' ? 'VARCHAR(128)' : 'TEXT'
  const engine = db.dialect === 'mysql'
    ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin'
    : ''
  await db.exec(`CREATE TABLE IF NOT EXISTS usage_events (
    org_id ${text} NOT NULL, event_key ${text} NOT NULL,
    user_id ${text} NOT NULL, session_id ${text} NOT NULL,
    occurred_at BIGINT NOT NULL, day VARCHAR(10) NOT NULL,
    input_tokens BIGINT NOT NULL, output_tokens BIGINT NOT NULL,
    cache_read_tokens BIGINT NOT NULL, cache_write_tokens BIGINT NOT NULL,
    PRIMARY KEY (org_id, event_key)
  )${engine}`)
  try {
    await db.exec(`CREATE INDEX ${db.dialect === 'sqlite' ? 'IF NOT EXISTS ' : ''}usage_user_day_idx
      ON usage_events (org_id, user_id, day)`)
  } catch (error) {
    if ((error as { code?: string }).code !== 'ER_DUP_KEYNAME') throw error
  }
  await db.exec(`CREATE TABLE IF NOT EXISTS usage_metadata (
    id INTEGER PRIMARY KEY, history_before BIGINT NOT NULL, timezone VARCHAR(128) NOT NULL
  )${engine}`)
  await db.prepare(db.sql(
    'INSERT OR IGNORE INTO usage_metadata (id, history_before, timezone) VALUES (1, ?, ?)',
    'INSERT INTO usage_metadata (id, history_before, timezone) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE id=id',
  )).run(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)
  await db.exec(`CREATE TABLE IF NOT EXISTS usage_imports (
    org_id ${text} NOT NULL, user_id ${text} NOT NULL, completed_at BIGINT NOT NULL,
    PRIMARY KEY (org_id, user_id)
  )${engine}`)
}
