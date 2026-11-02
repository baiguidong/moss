import type { Database } from '../database.js'

export async function installControlPlaneSchema(db: Database) {
  await db.exec(`CREATE TABLE IF NOT EXISTS hosts (
    id VARCHAR(128) PRIMARY KEY, org_id VARCHAR(128) NOT NULL, user_id VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL, kind VARCHAR(16) NOT NULL, version VARCHAR(128) NOT NULL,
    platform VARCHAR(32) NOT NULL, epoch VARCHAR(128) NOT NULL, status_json TEXT NOT NULL,
    last_seen BIGINT NOT NULL, created_at BIGINT NOT NULL
  )`)
  await db.exec(`CREATE TABLE IF NOT EXISTS host_commands (
    id VARCHAR(128) PRIMARY KEY, host_id VARCHAR(128) NOT NULL, org_id VARCHAR(128) NOT NULL,
    actor_id VARCHAR(128) NOT NULL, action VARCHAR(32) NOT NULL, input_json TEXT NOT NULL,
    state VARCHAR(16) NOT NULL, epoch VARCHAR(128), result_json TEXT,
    created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`)
  await db.exec(`CREATE TABLE IF NOT EXISTS host_policies (
    org_id VARCHAR(128) PRIMARY KEY, revision BIGINT NOT NULL, settings_json TEXT NOT NULL,
    actor_id VARCHAR(128) NOT NULL, updated_at BIGINT NOT NULL
  )`)
  await db.exec(`CREATE TABLE IF NOT EXISTS host_credentials (
    token_hash VARCHAR(64) PRIMARY KEY, host_id VARCHAR(128) NOT NULL,
    created_at BIGINT NOT NULL
  )`)
  await db.exec(`CREATE TABLE IF NOT EXISTS host_access (
    host_id VARCHAR(128) PRIMARY KEY, revoked INTEGER NOT NULL, actor_id VARCHAR(128) NOT NULL, updated_at BIGINT NOT NULL
  )`)
  await db.exec(`CREATE TABLE IF NOT EXISTS host_mailboxes (
    org_id VARCHAR(128) NOT NULL, user_id VARCHAR(128) NOT NULL, host_id VARCHAR(128) NOT NULL,
    PRIMARY KEY (org_id,user_id)
  )`)
  await db.exec(`CREATE TABLE IF NOT EXISTS host_schedules (
    id VARCHAR(128) PRIMARY KEY, host_id VARCHAR(128) NOT NULL, org_id VARCHAR(128) NOT NULL,
    revision BIGINT NOT NULL, config_json TEXT NOT NULL, deleted INTEGER NOT NULL,
    applied_revision BIGINT NOT NULL, error TEXT, updated_at BIGINT NOT NULL
  )`)
}
