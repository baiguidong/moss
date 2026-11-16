import type { Database } from '../database.js'

export async function installRefreshTokenSchema(db: Database): Promise<void> {
  const columns = `
    token_hash VARCHAR(64) PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    client_id VARCHAR(191) NOT NULL,
    user_id VARCHAR(128) NOT NULL,
    org_id VARCHAR(128) NOT NULL,
    password_updated_at BIGINT,
    idle_expires_at BIGINT NOT NULL,
    absolute_expires_at BIGINT NOT NULL,
    consumed_at BIGINT,
    revoked INTEGER NOT NULL DEFAULT 0`
  await db.exec(db.sql(
    `CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (${columns})`,
    `CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (${columns},
      INDEX oauth_refresh_session_idx (session_id),
      INDEX oauth_refresh_expiry_idx (absolute_expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
  ))
  if (db.dialect === 'sqlite') {
    await db.exec('CREATE INDEX IF NOT EXISTS oauth_refresh_session_idx ON oauth_refresh_tokens (session_id)')
    await db.exec('CREATE INDEX IF NOT EXISTS oauth_refresh_expiry_idx ON oauth_refresh_tokens (absolute_expires_at)')
  }
}
