import type { Database } from '../database.js'

export async function installCloudSharesSchema(db: Database): Promise<void> {
  const id = db.dialect === 'mysql' ? 'VARCHAR(128)' : 'TEXT'
  const text = db.dialect === 'mysql' ? 'LONGTEXT' : 'TEXT'
  const engine = db.dialect === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin' : ''
  await db.exec(`CREATE TABLE IF NOT EXISTS cloud_shares (
    id ${id} PRIMARY KEY, orgId ${id} NOT NULL, ownerUserId ${id} NOT NULL,
    fileId ${id} NOT NULL, revision ${id} NOT NULL, name ${text} NOT NULL, size BIGINT NOT NULL,
    tokenHash VARCHAR(64) NOT NULL UNIQUE, secret ${text} NOT NULL, codeHash ${text},
    requestKey ${id} NOT NULL, signature VARCHAR(64) NOT NULL,
    createdAt BIGINT NOT NULL, expiresAt BIGINT, revokedAt BIGINT,
    UNIQUE (orgId, ownerUserId, requestKey)
  )${engine}`)
  // Grant the new personal capability once to existing built-in roles that
  // already read cloud files. Custom roles and API-key scopes remain explicit.
  await db.prepare(db.sql(
    "INSERT OR IGNORE INTO role_permissions (role_id,permission) SELECT r.id,'cloud-storage:share' FROM roles r WHERE r.system_key IN ('user','dept_admin') AND EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id=r.id AND p.permission='cloud-storage:read')",
    "INSERT IGNORE INTO role_permissions (role_id,permission) SELECT r.id,'cloud-storage:share' FROM roles r WHERE r.system_key IN ('user','dept_admin') AND EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id=r.id AND p.permission='cloud-storage:read')",
  )).run()
  try {
    await db.exec(`CREATE INDEX ${db.dialect === 'sqlite' ? 'IF NOT EXISTS ' : ''}cloud_shares_owner
      ON cloud_shares (orgId, ownerUserId, createdAt, id)`)
  } catch (error) {
    if ((error as { code?: string }).code !== 'ER_DUP_KEYNAME') throw error
  }
}
