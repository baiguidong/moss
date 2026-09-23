import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'crypto'
import {
  BUILTIN_ROLE_TEMPLATES,
  type BuiltinRoleKey,
} from '../../auth/permissions.js'
import type { Database } from '../database.js'

export type AuthCenterOrganization = {
  id: string
  name: string
  createdAt: number
}

export type AuthCenterDepartment = {
  id: string
  orgId: string
  parentId: string | null
  name: string
  tokenLimit: number | null
  createdAt: number
  updatedAt: number
}

export type AuthCenterUser = {
  id: string
  orgId: string
  email: string
  name: string
  departmentId: string | null
  role: string
  status: 'active' | 'disabled'
  tokenLimit: number | null
  createdAt: number
  passwordHash: string | null
  passwordUpdatedAt: number | null
  lastLoginAt: number | null
}

export type AuthCenterRole = {
  id: string
  orgId: string
  systemKey: BuiltinRoleKey | null
  name: string
  description: string
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
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

export type AuthCenterOAuthIdentity = {
  providerId: string
  subject: string
  userId: string
  email: string
  apiKeyId: string | null
  createdAt: number
  lastLoginAt: number
}

export type AuthCenterOAuthAuthorizationRequest = {
  id: string
  redirectUri: string
  state: string
  codeChallenge: string
  expiresAt: number
  passwordAttempts: number
}

export type AuthCenterOAuthAuthorizationCode = {
  code: string
  redirectUri: string
  state: string
  codeChallenge: string
  userId: string
  orgId: string
  expiresAt: number
}

export type SanitizedAuthCenterUser = Omit<
  AuthCenterUser,
  'passwordHash' | 'email'
> & {
  email: string | null
}

export type SanitizedAuthCenterDepartment = AuthCenterDepartment & {
  userCount: number
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

const INTERNAL_EMAIL_DOMAIN = 'users.internal.moss'

function now(): number {
  return Date.now()
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') {
    return []
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter(v => typeof v === 'string')
      : []
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

function mapDepartment(row: SqlRow): AuthCenterDepartment {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    parentId: row.parent_id == null ? null : String(row.parent_id),
    name: String(row.name),
    tokenLimit: row.token_limit == null ? null : Number(row.token_limit),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function mapUser(row: SqlRow): AuthCenterUser {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    email: String(row.email),
    name: String(row.name),
    departmentId: row.department_id == null ? null : String(row.department_id),
    role: String(row.role),
    status: String(row.status) as 'active' | 'disabled',
    tokenLimit: row.token_limit == null ? null : Number(row.token_limit),
    createdAt: Number(row.created_at),
    passwordHash: row.password_hash == null ? null : String(row.password_hash),
    passwordUpdatedAt:
      row.password_updated_at == null ? null : Number(row.password_updated_at),
    lastLoginAt: row.last_login_at == null ? null : Number(row.last_login_at),
  }
}

function mapRole(row: SqlRow): AuthCenterRole {
  const systemKey = row.system_key == null ? null : String(row.system_key)
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    systemKey:
      systemKey === 'admin' ||
      systemKey === 'dept_admin' ||
      systemKey === 'user'
        ? systemKey
        : null,
    name: String(row.name),
    description: String(row.description),
    isBuiltin: Number(row.is_builtin) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
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

function mapOAuthIdentity(row: SqlRow): AuthCenterOAuthIdentity {
  return {
    providerId: String(row.provider_id),
    subject: String(row.subject),
    userId: String(row.user_id),
    email: String(row.email),
    apiKeyId: row.api_key_id == null ? null : String(row.api_key_id),
    createdAt: Number(row.created_at),
    lastLoginAt: Number(row.last_login_at),
  }
}

function mapOAuthAuthorizationRequest(
  row: SqlRow,
): AuthCenterOAuthAuthorizationRequest {
  return {
    id: String(row.id),
    redirectUri: String(row.redirect_uri),
    state: String(row.state),
    codeChallenge: String(row.code_challenge),
    expiresAt: Number(row.expires_at),
    passwordAttempts: Number(row.password_attempts),
  }
}

function mapOAuthAuthorizationCode(
  row: SqlRow,
): AuthCenterOAuthAuthorizationCode {
  return {
    code: String(row.code),
    redirectUri: String(row.redirect_uri),
    state: String(row.state),
    codeChallenge: String(row.code_challenge),
    userId: String(row.user_id),
    orgId: String(row.org_id),
    expiresAt: Number(row.expires_at),
  }
}

export class AuthRepository {
  constructor(readonly db: Database) {}

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    return await this.db.transaction(operation)
  }

  // Organization operations
  async createOrganization(
    id: string,
    name: string,
    createdAt: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `
      INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)
    `,
      )
      .run(id, name, createdAt)
  }

  async getOrganization(id: string): Promise<AuthCenterOrganization | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT * FROM organizations WHERE id = ? LIMIT 1
    `,
      )
      .get(id)) as SqlRow | undefined
    return row ? mapOrganization(row) : null
  }

  async listOrganizations(): Promise<AuthCenterOrganization[]> {
    const rows = (await this.db
      .prepare(
        `
      SELECT * FROM organizations ORDER BY created_at ASC
    `,
      )
      .all()) as SqlRow[]
    return rows.map(mapOrganization)
  }

  // Role operations
  async ensureBuiltinRoles(orgId: string): Promise<void> {
    for (const template of BUILTIN_ROLE_TEMPLATES) {
      let role = await this.getRoleBySystemKey(orgId, template.key)
      if (!role) {
        const timestamp = now()
        role = {
          id: randomUUID(),
          orgId,
          systemKey: template.key,
          name: template.name,
          description: template.description,
          isBuiltin: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        await this.createRole(role, template.permissions)
      } else if (template.key === 'admin') {
        await this.setRolePermissions(role.id, ['*'])
      }
    }
  }

  async createRole(role: AuthCenterRole, permissions: string[]): Promise<void> {
    return await this.transaction(async () => {
      await this.db
        .prepare(
          `
      INSERT INTO roles (
        id, org_id, system_key, name, description, is_builtin, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
        )
        .run(
          role.id,
          role.orgId,
          role.systemKey,
          role.name,
          role.description,
          role.isBuiltin ? 1 : 0,
          role.createdAt,
          role.updatedAt,
        )
      await this.setRolePermissions(role.id, permissions)
    })
  }

  async getRoleByIdAndOrg(
    id: string,
    orgId: string,
  ): Promise<AuthCenterRole | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT * FROM roles WHERE id = ? AND org_id = ? LIMIT 1
    `,
      )
      .get(id, orgId)) as SqlRow | undefined
    return row ? mapRole(row) : null
  }

  async getRoleBySystemKey(
    orgId: string,
    systemKey: BuiltinRoleKey,
  ): Promise<AuthCenterRole | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT * FROM roles WHERE org_id = ? AND system_key = ? LIMIT 1
    `,
      )
      .get(orgId, systemKey)) as SqlRow | undefined
    return row ? mapRole(row) : null
  }

  async listRolesByOrg(orgId: string): Promise<AuthCenterRole[]> {
    const rows = (await this.db
      .prepare(
        `
      SELECT * FROM roles
      WHERE org_id = ?
      ORDER BY is_builtin DESC, created_at ASC
    `,
      )
      .all(orgId)) as SqlRow[]
    return rows.map(mapRole)
  }

  async updateRole(
    id: string,
    patch: { name?: string; description?: string },
  ): Promise<void> {
    const row = (await this.db
      .prepare('SELECT * FROM roles WHERE id = ? LIMIT 1')
      .get(id)) as SqlRow | undefined
    if (!row) return
    const role = mapRole(row)
    await this.db
      .prepare(
        `
      UPDATE roles SET name = ?, description = ?, updated_at = ? WHERE id = ?
    `,
      )
      .run(
        patch.name ?? role.name,
        patch.description ?? role.description,
        now(),
        id,
      )
  }

  async deleteRole(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM roles WHERE id = ?').run(id)
  }

  async setRolePermissions(
    roleId: string,
    permissions: string[],
  ): Promise<void> {
    return await this.transaction(async () => {
      await this.db
        .prepare('DELETE FROM role_permissions WHERE role_id = ?')
        .run(roleId)
      const insert = this.db.prepare(`
      INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)
    `)
      for (const permission of [...new Set(permissions)])
        await insert.run(roleId, permission)
    })
  }

  async listRolePermissions(roleId: string): Promise<string[]> {
    const rows = (await this.db
      .prepare(
        `
      SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission ASC
    `,
      )
      .all(roleId)) as SqlRow[]
    return rows.map(row => String(row.permission))
  }

  async listRolesForUser(userId: string): Promise<AuthCenterRole[]> {
    const rows = (await this.db
      .prepare(
        `
      SELECT r.* FROM roles r
      JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ?
      ORDER BY r.is_builtin DESC, r.created_at ASC
    `,
      )
      .all(userId)) as SqlRow[]
    return rows.map(mapRole)
  }

  async setUserRoleIds(userId: string, roleIds: string[]): Promise<void> {
    return await this.transaction(async () => {
      await this.db
        .prepare('DELETE FROM user_roles WHERE user_id = ?')
        .run(userId)
      const insert = this.db.prepare(`
      INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)
    `)
      const timestamp = now()
      for (const roleId of [...new Set(roleIds)])
        await insert.run(userId, roleId, timestamp)
    })
  }

  async countUsersForRole(roleId: string): Promise<number> {
    const row = (await this.db
      .prepare(
        `
      SELECT COUNT(*) AS count FROM user_roles WHERE role_id = ?
    `,
      )
      .get(roleId)) as SqlRow | undefined
    return Number(row?.count ?? 0)
  }

  async countActiveUsersWithSystemRole(
    orgId: string,
    systemKey: BuiltinRoleKey,
  ): Promise<number> {
    const row = (await this.db
      .prepare(
        `
      SELECT COUNT(DISTINCT u.id) AS count
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u.org_id = ? AND u.status = 'active' AND r.system_key = ?
    `,
      )
      .get(orgId, systemKey)) as SqlRow | undefined
    return Number(row?.count ?? 0)
  }

  // Department operations
  async createDepartment(department: AuthCenterDepartment): Promise<void> {
    await this.db
      .prepare(
        `
      INSERT INTO departments (
        id, org_id, parent_id, name, token_limit, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        department.id,
        department.orgId,
        department.parentId,
        department.name,
        department.tokenLimit,
        department.createdAt,
        department.updatedAt,
      )
  }

  async getDepartmentById(id: string): Promise<AuthCenterDepartment | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT * FROM departments WHERE id = ? LIMIT 1
    `,
      )
      .get(id)) as SqlRow | undefined
    return row ? mapDepartment(row) : null
  }

  async getDepartmentByIdAndOrg(
    id: string,
    orgId: string,
  ): Promise<AuthCenterDepartment | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT * FROM departments WHERE id = ? AND org_id = ? LIMIT 1
    `,
      )
      .get(id, orgId)) as SqlRow | undefined
    return row ? mapDepartment(row) : null
  }

  async listDepartmentsByOrg(orgId: string): Promise<AuthCenterDepartment[]> {
    const rows = (await this.db
      .prepare(
        `
      SELECT * FROM departments WHERE org_id = ? ORDER BY created_at ASC
    `,
      )
      .all(orgId)) as SqlRow[]
    return rows.map(mapDepartment)
  }

  async updateDepartment(
    id: string,
    patch: {
      name?: string
      parentId?: string | null
    },
  ): Promise<void> {
    const department = await this.getDepartmentById(id)
    if (!department) {
      return
    }

    await this.db
      .prepare(
        `
      UPDATE departments
      SET name = ?,
          parent_id = ?,
          updated_at = ?
      WHERE id = ?
    `,
      )
      .run(
        patch.name ?? department.name,
        patch.parentId === undefined ? department.parentId : patch.parentId,
        now(),
        id,
      )
  }

  async deleteDepartment(id: string): Promise<void> {
    await this.db
      .prepare(
        `
      DELETE FROM departments WHERE id = ?
    `,
      )
      .run(id)
  }

  // User operations
  async createUser(user: AuthCenterUser): Promise<void> {
    await this.db
      .prepare(
        `
      INSERT INTO users (
        id, org_id, email, name, department_id, role, status, token_limit,
        password_hash, password_updated_at, last_login_at, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        user.id,
        user.orgId,
        user.email,
        user.name,
        user.departmentId,
        user.role,
        user.status,
        user.tokenLimit,
        user.passwordHash,
        user.passwordUpdatedAt,
        user.lastLoginAt,
        user.createdAt,
      )
  }

  async getUserById(id: string): Promise<AuthCenterUser | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT * FROM users WHERE id = ? LIMIT 1
    `,
      )
      .get(id)) as SqlRow | undefined
    return row ? mapUser(row) : null
  }

  async getUserByEmail(email: string): Promise<AuthCenterUser | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT * FROM users WHERE email = ? LIMIT 1
    `,
      )
      .get(email)) as SqlRow | undefined
    return row ? mapUser(row) : null
  }

  async listUsersByName(name: string): Promise<AuthCenterUser[]> {
    const rows = (await this.db
      .prepare(
        `
      SELECT * FROM users WHERE name = ? ORDER BY created_at ASC
    `,
      )
      .all(name)) as SqlRow[]
    return rows.map(mapUser)
  }

  async getUserByIdAndOrg(
    id: string,
    orgId: string,
  ): Promise<AuthCenterUser | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT * FROM users WHERE id = ? AND org_id = ? LIMIT 1
    `,
      )
      .get(id, orgId)) as SqlRow | undefined
    return row ? mapUser(row) : null
  }

  async listUsersByOrg(orgId: string): Promise<AuthCenterUser[]> {
    const rows = (await this.db
      .prepare(
        `
      SELECT * FROM users WHERE org_id = ? ORDER BY created_at ASC
    `,
      )
      .all(orgId)) as SqlRow[]
    return rows.map(mapUser)
  }

  async listUsersByRole(role: string): Promise<AuthCenterUser[]> {
    const rows = (await this.db
      .prepare(
        `
      SELECT * FROM users WHERE role = ? ORDER BY created_at ASC
    `,
      )
      .all(role)) as SqlRow[]
    return rows.map(mapUser)
  }

  async updateUserPassword(
    id: string,
    passwordHash: string,
    updatedAt: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?
    `,
      )
      .run(passwordHash, updatedAt, id)
  }

  async updateUser(
    id: string,
    patch: {
      name?: string
      departmentId?: string | null
      role?: string
      status?: 'active' | 'disabled'
    },
  ): Promise<void> {
    const user = await this.getUserById(id)
    if (!user) {
      return
    }

    await this.db
      .prepare(
        `
      UPDATE users
      SET name = ?,
          department_id = ?,
          role = ?,
          status = ?
      WHERE id = ?
    `,
      )
      .run(
        patch.name ?? user.name,
        patch.departmentId === undefined
          ? user.departmentId
          : patch.departmentId,
        patch.role ?? user.role,
        patch.status ?? user.status,
        id,
      )
  }

  async updateUserLastLogin(id: string, lastLoginAt = now()): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE users SET last_login_at = ? WHERE id = ?
    `,
      )
      .run(lastLoginAt, id)
  }

  async setUserTokenLimit(
    id: string,
    tokenLimit: number | null,
  ): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE users SET token_limit = ? WHERE id = ?
    `,
      )
      .run(tokenLimit, id)
  }

  async setDepartmentTokenLimit(
    id: string,
    tokenLimit: number | null,
  ): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE departments SET token_limit = ? WHERE id = ?
    `,
      )
      .run(tokenLimit, id)
  }

  // API Key operations
  async createApiKey(apiKey: AuthCenterApiKey): Promise<void> {
    await this.db
      .prepare(
        `
      INSERT INTO api_keys (id, org_id, user_id, name, prefix, secret_hash,
                            scopes_json, status, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
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

  async getApiKeyById(id: string): Promise<AuthCenterApiKey | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT * FROM api_keys WHERE id = ? LIMIT 1
    `,
      )
      .get(id)) as SqlRow | undefined
    return row ? mapApiKey(row) : null
  }

  async findActiveApiKey(
    plainTextKey: string,
  ): Promise<AuthCenterApiKey | null> {
    const match = plainTextKey.match(/^moss_sk_([^\.]+)\.(.+)$/)
    if (!match) {
      return null
    }
    const [, id, secret] = match
    const apiKey = await this.getApiKeyById(id)
    if (!apiKey || apiKey.status !== 'active') {
      return null
    }
    return apiKey.secretHash === sha256(secret) ? apiKey : null
  }

  async listApiKeysByOrg(orgId: string): Promise<AuthCenterApiKey[]> {
    const rows = (await this.db
      .prepare(
        `
      SELECT * FROM api_keys WHERE org_id = ? ORDER BY created_at ASC
    `,
      )
      .all(orgId)) as SqlRow[]
    return rows.map(mapApiKey)
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE api_keys SET last_used_at = ? WHERE id = ?
    `,
      )
      .run(now(), id)
  }

  async updateApiKeyScopes(id: string, scopes: string[]): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE api_keys SET scopes_json = ? WHERE id = ?
    `,
      )
      .run(JSON.stringify(scopes), id)
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE api_keys SET status = 'revoked' WHERE id = ?
    `,
      )
      .run(id)
  }

  // OAuth identity operations
  async getOAuthIdentity(
    providerId: string,
    subject: string,
  ): Promise<AuthCenterOAuthIdentity | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT * FROM oauth_identities
      WHERE provider_id = ? AND subject = ?
      LIMIT 1
    `,
      )
      .get(providerId, subject)) as SqlRow | undefined
    return row ? mapOAuthIdentity(row) : null
  }

  async getOAuthIdentityByApiKeyId(
    apiKeyId: string,
  ): Promise<AuthCenterOAuthIdentity | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT * FROM oauth_identities WHERE api_key_id = ? LIMIT 1
    `,
      )
      .get(apiKeyId)) as SqlRow | undefined
    return row ? mapOAuthIdentity(row) : null
  }

  async createOAuthIdentity(identity: AuthCenterOAuthIdentity): Promise<void> {
    await this.db
      .prepare(
        `
      INSERT INTO oauth_identities (
        provider_id, subject, user_id, email, api_key_id, created_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        identity.providerId,
        identity.subject,
        identity.userId,
        identity.email,
        identity.apiKeyId,
        identity.createdAt,
        identity.lastLoginAt,
      )
  }

  async updateOAuthIdentityLogin(input: {
    providerId: string
    subject: string
    email: string
    apiKeyId: string
    lastLoginAt: number
  }): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE oauth_identities
      SET email = ?, api_key_id = ?, last_login_at = ?
      WHERE provider_id = ? AND subject = ?
    `,
      )
      .run(
        input.email,
        input.apiKeyId,
        input.lastLoginAt,
        input.providerId,
        input.subject,
      )
  }

  async pruneOAuthAuthorizationRecords(currentTime: number): Promise<void> {
    await this.db
      .prepare(
        `
      DELETE FROM oauth_authorization_requests WHERE expires_at <= ?
    `,
      )
      .run(currentTime)
    await this.db
      .prepare(
        `
      DELETE FROM oauth_authorization_codes WHERE expires_at <= ?
    `,
      )
      .run(currentTime)
  }

  async countOAuthAuthorizationRecords(): Promise<number> {
    const requests = (await this.db
      .prepare(
        `
      SELECT COUNT(*) AS count FROM oauth_authorization_requests
    `,
      )
      .get()) as SqlRow
    const codes = (await this.db
      .prepare(
        `
      SELECT COUNT(*) AS count FROM oauth_authorization_codes
    `,
      )
      .get()) as SqlRow
    return Number(requests.count) + Number(codes.count)
  }

  async createOAuthAuthorizationRequest(
    request: AuthCenterOAuthAuthorizationRequest,
  ): Promise<void> {
    await this.db
      .prepare(
        `
      INSERT INTO oauth_authorization_requests (
        id, redirect_uri, state, code_challenge, expires_at, password_attempts
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        request.id,
        request.redirectUri,
        request.state,
        request.codeChallenge,
        request.expiresAt,
        request.passwordAttempts,
      )
  }

  async getOAuthAuthorizationRequest(
    id: string,
    currentTime: number,
  ): Promise<AuthCenterOAuthAuthorizationRequest | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT * FROM oauth_authorization_requests
      WHERE id = ? AND expires_at > ?
      LIMIT 1
    `,
      )
      .get(id, currentTime)) as SqlRow | undefined
    return row ? mapOAuthAuthorizationRequest(row) : null
  }

  async incrementOAuthAuthorizationAttempts(
    id: string,
    currentTime: number,
  ): Promise<AuthCenterOAuthAuthorizationRequest | null> {
    return await this.transaction(async () => {
      const request = await this.getOAuthAuthorizationRequest(id, currentTime)
      if (!request) return null
      const passwordAttempts = request.passwordAttempts + 1
      await this.db
        .prepare(
          `
        UPDATE oauth_authorization_requests
        SET password_attempts = ?
        WHERE id = ?
      `,
        )
        .run(passwordAttempts, id)
      return { ...request, passwordAttempts }
    })
  }

  async deleteOAuthAuthorizationRequest(id: string): Promise<void> {
    await this.db
      .prepare(
        `
      DELETE FROM oauth_authorization_requests WHERE id = ?
    `,
      )
      .run(id)
  }

  async deleteOAuthAuthorizationRequestByState(
    state: string,
    redirectUri: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `
      DELETE FROM oauth_authorization_requests
      WHERE state = ? AND redirect_uri = ?
    `,
      )
      .run(state, redirectUri)
    return Number(result.changes) > 0
  }

  async consumeOAuthAuthorizationRequest(
    id: string,
    currentTime: number,
  ): Promise<AuthCenterOAuthAuthorizationRequest | null> {
    return await this.transaction(async () => {
      const request = await this.getOAuthAuthorizationRequest(id, currentTime)
      await this.deleteOAuthAuthorizationRequest(id)
      return request
    })
  }

  async completeOAuthAuthorization(
    requestId: string,
    authorization: AuthCenterOAuthAuthorizationCode,
    currentTime: number,
  ): Promise<boolean> {
    return await this.transaction(async () => {
      const result = await this.db
        .prepare(
          `
        DELETE FROM oauth_authorization_requests
        WHERE id = ? AND expires_at > ?
      `,
        )
        .run(requestId, currentTime)
      if (Number(result.changes) !== 1) return false
      await this.db
        .prepare(
          `
        INSERT INTO oauth_authorization_codes (
          code, redirect_uri, state, code_challenge, user_id, org_id, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          authorization.code,
          authorization.redirectUri,
          authorization.state,
          authorization.codeChallenge,
          authorization.userId,
          authorization.orgId,
          authorization.expiresAt,
        )
      return true
    })
  }

  async consumeOAuthAuthorizationCode(
    code: string,
    currentTime: number,
  ): Promise<AuthCenterOAuthAuthorizationCode | null> {
    return await this.transaction(async () => {
      const row = (await this.db
        .prepare(
          `
        SELECT * FROM oauth_authorization_codes
        WHERE code = ? AND expires_at > ?
        LIMIT 1
      `,
        )
        .get(code, currentTime)) as SqlRow | undefined
      await this.db
        .prepare(
          `
        DELETE FROM oauth_authorization_codes WHERE code = ?
      `,
        )
        .run(code)
      return row ? mapOAuthAuthorizationCode(row) : null
    })
  }

  async deleteOAuthAuthorizationCode(
    code: string,
    redirectUri: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `
      DELETE FROM oauth_authorization_codes
      WHERE code = ? AND redirect_uri = ?
    `,
      )
      .run(code, redirectUri)
    return Number(result.changes) > 0
  }

  async deleteOAuthAuthorizationCodeByState(
    state: string,
    redirectUri: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `
      DELETE FROM oauth_authorization_codes
      WHERE state = ? AND redirect_uri = ?
    `,
      )
      .run(state, redirectUri)
    return Number(result.changes) > 0
  }

  // Config operations
  async getConfig(key: string): Promise<string | null> {
    const row = (await this.db
      .prepare(
        `
      SELECT value FROM server_config WHERE \`key\` = ? LIMIT 1
    `,
      )
      .get(key)) as SqlRow | undefined
    return row ? String(row.value) : null
  }

  async setConfig(key: string, value: string): Promise<void> {
    await this.db
      .prepare(
        this.db.sql(
          `
      INSERT INTO server_config (\`key\`, value) VALUES (?, ?)
      ON CONFLICT(\`key\`) DO UPDATE SET value = excluded.value
    `,
          `
      INSERT INTO server_config (\`key\`, value) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE value = VALUES(value)
    `,
        ),
      )
      .run(key, value)
  }

  async getIssuer(): Promise<string> {
    return (await this.getConfig('issuer')) ?? 'moss-server'
  }

  async getJwtSecret(): Promise<string> {
    return (await this.getConfig('jwt_secret')) ?? ''
  }

  // Bootstrap - create initial admin user and org
  async bootstrap(
    config: BootstrapAdminConfig = { username: 'admin' },
  ): Promise<AuthCenterBootstrap> {
    const orgId = randomUUID()
    const adminUserId = randomUUID()
    const resolvedAdmin = resolveBootstrapAdminConfig(config)
    const { apiKey, plainTextKey } = createApiKeyRecord({
      orgId,
      userId: adminUserId,
      name: 'bootstrap-admin',
      scopes: ['*'],
    })

    await this.db.transaction(async () => {
      await this.createOrganization(orgId, 'Default Organization', now())
      await this.createUser({
        id: adminUserId,
        orgId,
        email: resolvedAdmin.email,
        name: resolvedAdmin.username,
        departmentId: null,
        role: 'admin',
        status: 'active',
        tokenLimit: null,
        createdAt: now(),
        passwordHash: hashPassword(resolvedAdmin.password),
        passwordUpdatedAt: now(),
        lastLoginAt: null,
      })
      await this.ensureBuiltinRoles(orgId)
      const adminRole = await this.getRoleBySystemKey(orgId, 'admin')
      if (!adminRole)
        throw new Error('Failed to initialize the system administrator role')
      await this.setUserRoleIds(adminUserId, [adminRole.id])
      await this.createApiKey(apiKey)
      await this.setConfig('issuer', 'moss-server')
      await this.setConfig('jwt_secret', randomBytes(32).toString('base64url'))
    })

    return {
      created: true,
      bootstrapAdminUsername: resolvedAdmin.username,
      bootstrapAdminApiKey: plainTextKey,
      bootstrapAdminEmail: resolvedAdmin.email,
      bootstrapAdminPassword: resolvedAdmin.password,
    }
  }

  async ensureBootstrapAdmin(
    config: BootstrapAdminConfig = { username: 'admin' },
  ): Promise<AuthCenterBootstrap> {
    if ((await this.listUsersByRole('admin')).length > 0) {
      return { created: false }
    }

    const resolvedAdmin = resolveBootstrapAdminConfig(config)
    const existingNameUser = (
      await this.listUsersByName(resolvedAdmin.username)
    )[0]
    if (existingNameUser) {
      return { created: false }
    }

    const existingEmailUser = await this.getUserByEmail(resolvedAdmin.email)
    if (existingEmailUser) {
      return { created: false }
    }

    const org = (await this.listOrganizations())[0]
    const orgId = org?.id ?? randomUUID()
    const adminUserId = randomUUID()
    const { apiKey, plainTextKey } = createApiKeyRecord({
      orgId,
      userId: adminUserId,
      name: 'bootstrap-admin',
      scopes: ['*'],
    })

    await this.db.transaction(async () => {
      if (!org) {
        await this.createOrganization(orgId, 'Default Organization', now())
      }
      await this.createUser({
        id: adminUserId,
        orgId,
        email: resolvedAdmin.email,
        name: resolvedAdmin.username,
        departmentId: null,
        role: 'admin',
        status: 'active',
        tokenLimit: null,
        createdAt: now(),
        passwordHash: hashPassword(resolvedAdmin.password),
        passwordUpdatedAt: now(),
        lastLoginAt: null,
      })
      await this.ensureBuiltinRoles(orgId)
      const adminRole = await this.getRoleBySystemKey(orgId, 'admin')
      if (!adminRole)
        throw new Error('Failed to initialize the system administrator role')
      await this.setUserRoleIds(adminUserId, [adminRole.id])
      await this.createApiKey(apiKey)
    })

    return {
      created: true,
      bootstrapAdminUsername: resolvedAdmin.username,
      bootstrapAdminApiKey: plainTextKey,
      bootstrapAdminEmail: resolvedAdmin.email,
      bootstrapAdminPassword: resolvedAdmin.password,
    }
  }

  async isInitialized(): Promise<boolean> {
    const row = (await this.db
      .prepare(
        `
      SELECT COUNT(*) AS count FROM server_config WHERE \`key\` = 'jwt_secret'
    `,
      )
      .get()) as SqlRow | undefined
    return Number(row?.count ?? 0) > 0
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
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function createTemporaryPassword(length = 20): string {
  return randomBytes(length).toString('base64url').slice(0, length)
}

function resolveBootstrapAdminConfig(config: BootstrapAdminConfig): {
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
        : 'password',
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

export function sanitizeApiKey(
  apiKey: AuthCenterApiKey,
): Omit<AuthCenterApiKey, 'secretHash'> {
  const { secretHash: _secretHash, ...rest } = apiKey
  return rest
}

export function sanitizeUser(user: AuthCenterUser): SanitizedAuthCenterUser {
  const { passwordHash: _passwordHash, email, ...rest } = user
  return {
    ...rest,
    email: sanitizePublicEmail(email),
  }
}

function sanitizePublicEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  const [, domain = ''] = normalized.split('@')
  if (domain === INTERNAL_EMAIL_DOMAIN || domain === 'local') {
    return null
  }

  return email
}

export function createSyntheticUserEmail(seed: string): string {
  const localPart = seed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${localPart || randomUUID()}@${INTERNAL_EMAIL_DOMAIN}`
}
