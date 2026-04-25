import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export type AuthCenterOrganization = {
  id: string
  name: string
  createdAt: number
}

export type AuthCenterUser = {
  id: string
  orgId: string
  email: string
  name: string
  role: string
  status: 'active' | 'disabled'
  createdAt: number
  passwordHash: string | null
  passwordUpdatedAt: number | null
  lastLoginAt: number | null
}

export type AuthCenterApiKey = {
  id: string
  orgId: string
  userId: string
  name: string
  prefix: string
  secretHash: string
  scopes: string[]
  status: 'active' | 'revoked'
  createdAt: number
  lastUsedAt: number | null
}

export type AuthCenterStore = {
  version: 2
  issuer: string
  jwtSecret: string
  organizations: AuthCenterOrganization[]
  users: AuthCenterUser[]
  apiKeys: AuthCenterApiKey[]
}

export type AuthCenterBootstrap = {
  created: boolean
  bootstrapAdminUsername?: string
  bootstrapAdminApiKey?: string
  bootstrapAdminEmail?: string
  bootstrapAdminPassword?: string
}

export type BootstrapAdminConfig = {
  username: string
  password?: string
  email?: string
}

type SqlRow = Record<string, unknown>

function now(): number {
  return Date.now()
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') {
    return []
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : []
  } catch {
    return []
  }
}

function mapOrganization(row: SqlRow): AuthCenterOrganization {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: Number(row.created_at),
  }
}

function mapUser(row: SqlRow): AuthCenterUser {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    email: String(row.email),
    name: String(row.name),
    role: String(row.role),
    status: String(row.status) as 'active' | 'disabled',
    createdAt: Number(row.created_at),
    passwordHash: row.password_hash == null ? null : String(row.password_hash),
    passwordUpdatedAt: row.password_updated_at == null ? null : Number(row.password_updated_at),
    lastLoginAt: row.last_login_at == null ? null : Number(row.last_login_at),
  }
}

function mapApiKey(row: SqlRow): AuthCenterApiKey {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    userId: String(row.user_id),
    name: String(row.name),
    prefix: String(row.prefix),
    secretHash: String(row.secret_hash),
    scopes: parseJsonArray(row.scopes_json),
    status: String(row.status) as 'active' | 'revoked',
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
  }
}

export function getDefaultAuthCenterDbPath(): string {
  return join(getClaudeConfigHomeDir(), 'authcenter.db')
}

export function getDefaultAuthCenterJsonPath(): string {
  return join(getClaudeConfigHomeDir(), 'auth-center', 'store.json')
}

export class AuthCenterDb {
  readonly db: DatabaseSync
  readonly dbPath: string
  readonly #ownsConnection: boolean

  constructor(dbOrPath: string | DatabaseSync, dbPath?: string) {
    if (typeof dbOrPath === 'string') {
      this.dbPath = dbOrPath
      mkdirSync(dirname(dbOrPath), { recursive: true })
      this.db = new DatabaseSync(dbOrPath)
      this.#ownsConnection = true
    } else {
      this.db = dbOrPath
      this.dbPath = dbPath ?? ':memory:'
      this.#ownsConnection = false
    }
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
    `)
    this.initTables()
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        password_hash TEXT,
        password_updated_at INTEGER,
        last_login_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS server_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS users_org_idx ON users (org_id);
      CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
      CREATE INDEX IF NOT EXISTS api_keys_org_idx ON api_keys (org_id);
      CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id);
    `)

    const legacyConfigTable = this.db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'app_config'
      LIMIT 1
    `).get() as SqlRow | undefined

    if (legacyConfigTable) {
      this.db.exec(`
        INSERT OR IGNORE INTO server_config (key, value)
        SELECT key, value
        FROM app_config
      `)
    }
  }

  close(): void {
    if (this.#ownsConnection) {
      this.db.close()
    }
  }

  // Organization operations
  createOrganization(id: string, name: string, createdAt: number): void {
    this.db.prepare(`
      INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)
    `).run(id, name, createdAt)
  }

  getOrganization(id: string): AuthCenterOrganization | null {
    const row = this.db.prepare(`
      SELECT * FROM organizations WHERE id = ? LIMIT 1
    `).get(id) as SqlRow | undefined
    return row ? mapOrganization(row) : null
  }

  listOrganizations(): AuthCenterOrganization[] {
    const rows = this.db.prepare(`
      SELECT * FROM organizations ORDER BY created_at ASC
    `).all() as SqlRow[]
    return rows.map(mapOrganization)
  }

  // User operations
  createUser(user: AuthCenterUser): void {
    this.db.prepare(`
      INSERT INTO users (id, org_id, email, name, role, status, password_hash,
                         password_updated_at, last_login_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      user.orgId,
      user.email,
      user.name,
      user.role,
      user.status,
      user.passwordHash,
      user.passwordUpdatedAt,
      user.lastLoginAt,
      user.createdAt,
    )
  }

  getUserById(id: string): AuthCenterUser | null {
    const row = this.db.prepare(`
      SELECT * FROM users WHERE id = ? LIMIT 1
    `).get(id) as SqlRow | undefined
    return row ? mapUser(row) : null
  }

  getUserByEmail(email: string): AuthCenterUser | null {
    const row = this.db.prepare(`
      SELECT * FROM users WHERE email = ? LIMIT 1
    `).get(email) as SqlRow | undefined
    return row ? mapUser(row) : null
  }

  listUsersByName(name: string): AuthCenterUser[] {
    const rows = this.db.prepare(`
      SELECT * FROM users WHERE name = ? ORDER BY created_at ASC
    `).all(name) as SqlRow[]
    return rows.map(mapUser)
  }

  getUserByIdAndOrg(id: string, orgId: string): AuthCenterUser | null {
    const row = this.db.prepare(`
      SELECT * FROM users WHERE id = ? AND org_id = ? LIMIT 1
    `).get(id, orgId) as SqlRow | undefined
    return row ? mapUser(row) : null
  }

  listUsersByOrg(orgId: string): AuthCenterUser[] {
    const rows = this.db.prepare(`
      SELECT * FROM users WHERE org_id = ? ORDER BY created_at ASC
    `).all(orgId) as SqlRow[]
    return rows.map(mapUser)
  }

  listUsersByRole(role: string): AuthCenterUser[] {
    const rows = this.db.prepare(`
      SELECT * FROM users WHERE role = ? ORDER BY created_at ASC
    `).all(role) as SqlRow[]
    return rows.map(mapUser)
  }

  updateUserPassword(id: string, passwordHash: string, updatedAt: number): void {
    this.db.prepare(`
      UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?
    `).run(passwordHash, updatedAt, id)
  }

  updateUser(
    id: string,
    patch: {
      name?: string
      role?: string
      status?: 'active' | 'disabled'
    },
  ): void {
    this.db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          role = COALESCE(?, role),
          status = COALESCE(?, status)
      WHERE id = ?
    `).run(
      patch.name ?? null,
      patch.role ?? null,
      patch.status ?? null,
      id,
    )
  }

  updateUserLastLogin(id: string): void {
    this.db.prepare(`
      UPDATE users SET last_login_at = ? WHERE id = ?
    `).run(now(), id)
  }

  // API Key operations
  createApiKey(apiKey: AuthCenterApiKey): void {
    this.db.prepare(`
      INSERT INTO api_keys (id, org_id, user_id, name, prefix, secret_hash,
                            scopes_json, status, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      apiKey.id,
      apiKey.orgId,
      apiKey.userId,
      apiKey.name,
      apiKey.prefix,
      apiKey.secretHash,
      JSON.stringify(apiKey.scopes),
      apiKey.status,
      apiKey.createdAt,
      apiKey.lastUsedAt,
    )
  }

  getApiKeyById(id: string): AuthCenterApiKey | null {
    const row = this.db.prepare(`
      SELECT * FROM api_keys WHERE id = ? LIMIT 1
    `).get(id) as SqlRow | undefined
    return row ? mapApiKey(row) : null
  }

  findActiveApiKey(plainTextKey: string): AuthCenterApiKey | null {
    const match = plainTextKey.match(/^moss_sk_([^\.]+)\.(.+)$/)
    if (!match) {
      return null
    }
    const [, id, secret] = match
    const apiKey = this.getApiKeyById(id)
    if (!apiKey || apiKey.status !== 'active') {
      return null
    }
    return apiKey.secretHash === sha256(secret) ? apiKey : null
  }

  listApiKeysByOrg(orgId: string): AuthCenterApiKey[] {
    const rows = this.db.prepare(`
      SELECT * FROM api_keys WHERE org_id = ? ORDER BY created_at ASC
    `).all(orgId) as SqlRow[]
    return rows.map(mapApiKey)
  }

  updateApiKeyLastUsed(id: string): void {
    this.db.prepare(`
      UPDATE api_keys SET last_used_at = ? WHERE id = ?
    `).run(now(), id)
  }

  revokeApiKey(id: string): void {
    this.db.prepare(`
      UPDATE api_keys SET status = 'revoked' WHERE id = ?
    `).run(id)
  }

  // Config operations
  getConfig(key: string): string | null {
    const row = this.db.prepare(`
      SELECT value FROM server_config WHERE key = ? LIMIT 1
    `).get(key) as SqlRow | undefined
    return row ? String(row.value) : null
  }

  setConfig(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO server_config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  getIssuer(): string {
    return this.getConfig('issuer') ?? 'moss-server'
  }

  getJwtSecret(): string {
    return this.getConfig('jwt_secret') ?? ''
  }

  // Bootstrap - create initial admin user and org
  bootstrap(config: BootstrapAdminConfig = { username: 'admin' }): AuthCenterBootstrap {
    const orgId = randomUUID()
    const adminUserId = randomUUID()
    const resolvedAdmin = resolveBootstrapAdminConfig(config)
    const { apiKey, plainTextKey } = createApiKeyRecord({
      orgId,
      userId: adminUserId,
      name: 'bootstrap-admin',
      scopes: ['*'],
    })

    this.db.exec('BEGIN TRANSACTION')
    try {
      this.createOrganization(orgId, 'Default Organization', now())
      this.createUser({
        id: adminUserId,
        orgId,
        email: resolvedAdmin.email,
        name: resolvedAdmin.username,
        role: 'admin',
        status: 'active',
        createdAt: now(),
        passwordHash: hashPassword(resolvedAdmin.password),
        passwordUpdatedAt: now(),
        lastLoginAt: null,
      })
      this.createApiKey(apiKey)
      this.setConfig('issuer', 'moss-server')
      this.setConfig('jwt_secret', randomBytes(32).toString('base64url'))
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    return {
      created: true,
      bootstrapAdminUsername: resolvedAdmin.username,
      bootstrapAdminApiKey: plainTextKey,
      bootstrapAdminEmail: resolvedAdmin.email,
      bootstrapAdminPassword: resolvedAdmin.password,
    }
  }

  ensureBootstrapAdmin(config: BootstrapAdminConfig = { username: 'admin' }): AuthCenterBootstrap {
    if (this.listUsersByRole('admin').length > 0) {
      return { created: false }
    }

    const resolvedAdmin = resolveBootstrapAdminConfig(config)
    const existingNameUser = this.listUsersByName(resolvedAdmin.username)[0]
    if (existingNameUser) {
      throw new Error(
        `Cannot create bootstrap admin: username already exists (${resolvedAdmin.username})`,
      )
    }

    const existingEmailUser = this.getUserByEmail(resolvedAdmin.email)
    if (existingEmailUser) {
      throw new Error(
        `Cannot create bootstrap admin: email already exists (${resolvedAdmin.email})`,
      )
    }

    const org = this.listOrganizations()[0]
    const orgId = org?.id ?? randomUUID()
    const adminUserId = randomUUID()
    const { apiKey, plainTextKey } = createApiKeyRecord({
      orgId,
      userId: adminUserId,
      name: 'bootstrap-admin',
      scopes: ['*'],
    })

    this.db.exec('BEGIN TRANSACTION')
    try {
      if (!org) {
        this.createOrganization(orgId, 'Default Organization', now())
      }
      this.createUser({
        id: adminUserId,
        orgId,
        email: resolvedAdmin.email,
        name: resolvedAdmin.username,
        role: 'admin',
        status: 'active',
        createdAt: now(),
        passwordHash: hashPassword(resolvedAdmin.password),
        passwordUpdatedAt: now(),
        lastLoginAt: null,
      })
      this.createApiKey(apiKey)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    return {
      created: true,
      bootstrapAdminUsername: resolvedAdmin.username,
      bootstrapAdminApiKey: plainTextKey,
      bootstrapAdminEmail: resolvedAdmin.email,
      bootstrapAdminPassword: resolvedAdmin.password,
    }
  }

  isInitialized(): boolean {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM server_config WHERE key = 'jwt_secret'
    `).get() as SqlRow | undefined
    return Number(row?.count ?? 0) > 0
  }

  // Migration from JSON store
  migrateFromJson(jsonStore: AuthCenterStore): void {
    this.db.exec('BEGIN TRANSACTION')
    try {
      // Migrate organizations
      for (const org of jsonStore.organizations) {
        this.createOrganization(org.id, org.name, org.createdAt)
      }

      // Migrate users
      for (const user of jsonStore.users) {
        this.createUser(user)
      }

      // Migrate api keys
      for (const apiKey of jsonStore.apiKeys) {
        this.createApiKey(apiKey)
      }

      // Migrate config
      this.setConfig('issuer', jsonStore.issuer)
      this.setConfig('jwt_secret', jsonStore.jwtSecret)

      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function toPasswordHashRecord(password: string, salt?: string): string {
  const actualSalt = salt ?? randomBytes(16).toString('hex')
  const derived = scryptSync(password, actualSalt, 64).toString('hex')
  return `scrypt$${actualSalt}$${derived}`
}

export function hashPassword(password: string): string {
  return toPasswordHashRecord(password)
}

export function verifyPassword(
  password: string,
  passwordHash: string | null | undefined,
): boolean {
  if (!passwordHash) {
    return false
  }
  const match = passwordHash.match(/^scrypt\$([^$]+)\$([0-9a-f]+)$/)
  if (!match) {
    return false
  }
  const [, salt, expectedHex] = match
  const actual = Buffer.from(
    toPasswordHashRecord(password, salt).split('$')[2] || '',
    'hex',
  )
  const expected = Buffer.from(expectedHex || '', 'hex')
  return (
    actual.length === expected.length && timingSafeEqual(actual, expected)
  )
}

export function createTemporaryPassword(length = 20): string {
  return randomBytes(length).toString('base64url').slice(0, length)
}

function resolveBootstrapAdminConfig(
  config: BootstrapAdminConfig,
): {
  username: string
  email: string
  password: string
} {
  const username = config.username.trim() || 'admin'
  return {
    username,
    email: resolveBootstrapAdminEmail(username, config.email),
    password:
      typeof config.password === 'string' && config.password.length > 0
        ? config.password
        : createTemporaryPassword(),
  }
}

function resolveBootstrapAdminEmail(
  username: string,
  configuredEmail?: string,
): string {
  const email = configuredEmail?.trim()
  if (email) {
    return email
  }

  const localPart = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${localPart || 'admin'}@local`
}

function createApiKeyValue(id: string, secret: string): string {
  return `moss_sk_${id}.${secret}`
}

export function createApiKeyRecord(input: {
  orgId: string
  userId: string
  name: string
  scopes: string[]
}): {
  apiKey: AuthCenterApiKey
  plainTextKey: string
} {
  const id = randomUUID()
  const secret = randomBytes(24).toString('base64url')
  const plainTextKey = createApiKeyValue(id, secret)

  return {
    apiKey: {
      id,
      orgId: input.orgId,
      userId: input.userId,
      name: input.name,
      prefix: plainTextKey.slice(0, 16),
      secretHash: sha256(secret),
      scopes: input.scopes,
      status: 'active',
      createdAt: Date.now(),
      lastUsedAt: null,
    },
    plainTextKey,
  }
}

// JSON store compatibility - for migration detection
export async function readJsonAuthCenterStore(
  jsonPath: string,
): Promise<AuthCenterStore> {
  const { readFile } = await import('fs/promises')
  const raw = await readFile(jsonPath, 'utf8')
  const parsed = JSON.parse(raw) as AuthCenterStore
  if (
    (parsed.version !== 1 && parsed.version !== 2) ||
    typeof parsed.issuer !== 'string' ||
    typeof parsed.jwtSecret !== 'string' ||
    !Array.isArray(parsed.organizations) ||
    !Array.isArray(parsed.users) ||
    !Array.isArray(parsed.apiKeys)
  ) {
    throw new Error(`Invalid auth center store: ${jsonPath}`)
  }
  return {
    version: 2,
    issuer: parsed.issuer,
    jwtSecret: parsed.jwtSecret,
    organizations: parsed.organizations,
    users: parsed.users.map(user => ({
      ...user,
      passwordHash: user.passwordHash ?? null,
      passwordUpdatedAt: user.passwordUpdatedAt ?? null,
      lastLoginAt: user.lastLoginAt ?? null,
    })),
    apiKeys: parsed.apiKeys,
  }
}

export function sanitizeApiKey(apiKey: AuthCenterApiKey): Omit<
  AuthCenterApiKey,
  'secretHash'
> {
  const { secretHash: _secretHash, ...rest } = apiKey
  return rest
}

export function sanitizeUser(
  user: AuthCenterUser,
): Omit<AuthCenterUser, 'passwordHash'> {
  const { passwordHash: _passwordHash, ...rest } = user
  return rest
}
