import { randomUUID } from 'crypto'
import type { DatabaseSync } from 'node:sqlite'
import { hasScope, issueAccessToken, verifyAccessToken, type AuthContext } from './token.js'
import {
  AuthCenterDb,
  type AuthCenterApiKey,
  type AuthCenterBootstrap,
  type BootstrapAdminConfig,
  type AuthCenterUser,
  createApiKeyRecord,
  hashPassword,
  sanitizeApiKey,
  sanitizeUser,
  verifyPassword,
} from '../authCenter/db.js'

export type AuthRole = 'admin' | 'viewer' | 'member'

export type AuthServiceOptions = {
  db: DatabaseSync
  dbPath: string
  tokenTtlSec: number
  bootstrapAdmin: BootstrapAdminConfig
}

export class AuthServiceError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'AuthServiceError'
  }
}

function defaultScopesForRole(role: string): string[] {
  if (role === 'admin') {
    return ['*']
  }
  if (role === 'viewer') {
    return ['sessions:list', 'sessions:attach']
  }
  return ['sessions:create', 'sessions:attach', 'sessions:list']
}

async function initializeStore(
  db: AuthCenterDb,
  bootstrapAdmin: BootstrapAdminConfig,
): Promise<AuthCenterBootstrap> {
  if (!db.isInitialized()) {
    return db.bootstrap(bootstrapAdmin)
  }

  return db.ensureBootstrapAdmin(bootstrapAdmin)
}

function isAuthRole(value: string): value is AuthRole {
  return value === 'admin' || value === 'viewer' || value === 'member'
}

function isUserStatus(value: string): value is 'active' | 'disabled' {
  return value === 'active' || value === 'disabled'
}

export async function createAuthService(
  options: AuthServiceOptions,
): Promise<{
  service: AuthService
  bootstrap: AuthCenterBootstrap
}> {
  const db = new AuthCenterDb(options.db, options.dbPath)
  const bootstrap = await initializeStore(
    db,
    options.bootstrapAdmin,
  )
  return {
    service: new AuthService(db, options.tokenTtlSec),
    bootstrap,
  }
}

export class AuthService {
  constructor(
    private readonly db: AuthCenterDb,
    private readonly tokenTtlSec: number,
  ) {}

  verifyAccessToken(token: string): AuthContext | null {
    return verifyAccessToken(token, this.db.getJwtSecret(), this.db.getIssuer())
  }

  introspect(token: string): {
    active: boolean
    sub?: string
    org_id?: string
    role?: string
    scopes?: string[]
    key_id?: string
  } {
    const auth = this.verifyAccessToken(token)
    if (!auth) {
      return { active: false }
    }
    return {
      active: true,
      sub: auth.userId,
      org_id: auth.orgId,
      role: auth.role,
      scopes: auth.scopes,
      key_id: auth.keyId,
    }
  }

  issueTokenFromPassword(input: {
    username?: string
    email: string
    password: string
  }): {
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    user: Omit<AuthCenterUser, 'passwordHash'>
    organization: { id: string; name: string; createdAt: number } | null
    scopes: string[]
  } {
    const username = input.username?.trim() || ''
    const email = input.email.trim()
    if ((!username && !email) || !input.password) {
      throw new AuthServiceError(400, 'Missing username/email or password')
    }

    const user = username
      ? this.getUniqueUserByName(username)
      : this.db.getUserByEmail(email)
    if (
      !user ||
      user.status !== 'active' ||
      !verifyPassword(input.password, user.passwordHash)
    ) {
      throw new AuthServiceError(401, 'Invalid username/email or password')
    }

    this.db.updateUserLastLogin(user.id)
    return this.issueToken({
      user,
      scopes: defaultScopesForRole(user.role),
      keyId: 'password-login',
    })
  }

  issueTokenFromApiKey(apiKeyValue: string): {
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    user: Omit<AuthCenterUser, 'passwordHash'>
    organization: { id: string; name: string; createdAt: number } | null
    scopes: string[]
  } {
    const value = apiKeyValue.trim()
    if (!value) {
      throw new AuthServiceError(400, 'Missing api_key')
    }

    const apiKey = this.db.findActiveApiKey(value)
    if (!apiKey) {
      throw new AuthServiceError(401, 'Invalid API key')
    }

    const user = this.db.getUserById(apiKey.userId)
    const organization = this.db.getOrganization(apiKey.orgId)
    if (!user || user.status !== 'active' || !organization) {
      throw new AuthServiceError(401, 'API key owner is invalid')
    }

    this.db.updateApiKeyLastUsed(apiKey.id)
    return this.issueToken({
      user,
      scopes: apiKey.scopes,
      keyId: apiKey.id,
    })
  }

  getMe(auth: AuthContext): {
    user: Omit<AuthCenterUser, 'passwordHash'> | null
    organization: { id: string; name: string; createdAt: number } | null
    scopes: string[]
    role: string
    key_id: string
  } {
    return {
      user: this.getUserOrNull(auth.userId, auth.orgId),
      organization: this.db.getOrganization(auth.orgId),
      scopes: auth.scopes,
      role: auth.role,
      key_id: auth.keyId,
    }
  }

  listUsers(orgId: string): {
    users: Array<Omit<AuthCenterUser, 'passwordHash'>>
  } {
    return {
      users: this.db.listUsersByOrg(orgId).map(user => sanitizeUser(user)),
    }
  }

  getUserOrNull(
    userId: string,
    orgId: string,
  ): Omit<AuthCenterUser, 'passwordHash'> | null {
    const user = this.db.getUserByIdAndOrg(userId, orgId)
    return user ? sanitizeUser(user) : null
  }

  createUser(input: {
    orgId: string
    email: string
    name: string
    role: string
    password: string
  }): {
    user: Omit<AuthCenterUser, 'passwordHash'>
  } {
    const email = input.email.trim()
    const name = input.name.trim()
    const role = input.role.trim()
    if (!email || !name || !input.password) {
      throw new AuthServiceError(400, 'Missing email, name, or password')
    }
    if (!isAuthRole(role)) {
      throw new AuthServiceError(400, `Unsupported role: ${role}`)
    }

    const existingUser = this.db.getUserByEmail(email)
    if (existingUser) {
      throw new AuthServiceError(409, 'User email already exists')
    }
    if (this.db.listUsersByName(name).length > 0) {
      throw new AuthServiceError(409, 'Username already exists')
    }

    const createdAt = Date.now()
    const user: AuthCenterUser = {
      id: randomUUID(),
      orgId: input.orgId,
      email,
      name,
      role,
      status: 'active',
      createdAt,
      passwordHash: hashPassword(input.password),
      passwordUpdatedAt: createdAt,
      lastLoginAt: null,
    }
    this.db.createUser(user)
    return { user: sanitizeUser(user) }
  }

  updateUser(input: {
    orgId: string
    userId: string
    name?: string
    role?: string
    status?: string
  }): {
    user: Omit<AuthCenterUser, 'passwordHash'>
  } {
    const user = this.db.getUserByIdAndOrg(input.userId, input.orgId)
    if (!user) {
      throw new AuthServiceError(404, 'Unknown user_id')
    }

    const patch: {
      name?: string
      role?: AuthRole
      status?: 'active' | 'disabled'
    } = {}

    if (typeof input.name === 'string') {
      const name = input.name.trim()
      if (!name) {
        throw new AuthServiceError(400, 'Name cannot be empty')
      }
      const conflictingUsers = this.db
        .listUsersByName(name)
        .filter(existingUser => existingUser.id !== user.id)
      if (conflictingUsers.length > 0) {
        throw new AuthServiceError(409, 'Username already exists')
      }
      patch.name = name
    }
    if (typeof input.role === 'string') {
      const role = input.role.trim()
      if (!isAuthRole(role)) {
        throw new AuthServiceError(400, `Unsupported role: ${role}`)
      }
      patch.role = role
    }
    if (typeof input.status === 'string') {
      const status = input.status.trim()
      if (!isUserStatus(status)) {
        throw new AuthServiceError(400, `Unsupported status: ${status}`)
      }
      patch.status = status
    }

    if (
      patch.name === undefined &&
      patch.role === undefined &&
      patch.status === undefined
    ) {
      throw new AuthServiceError(400, 'Missing user update fields')
    }

    this.db.updateUser(user.id, patch)
    return {
      user: sanitizeUser(this.db.getUserByIdAndOrg(user.id, input.orgId) ?? user),
    }
  }

  setUserPassword(input: {
    orgId: string
    userId: string
    password: string
  }): { ok: true } {
    const user = this.db.getUserByIdAndOrg(input.userId, input.orgId)
    if (!user) {
      throw new AuthServiceError(404, 'Unknown user_id')
    }
    if (!input.password) {
      throw new AuthServiceError(400, 'Missing password')
    }

    this.db.updateUserPassword(
      input.userId,
      hashPassword(input.password),
      Date.now(),
    )
    return { ok: true }
  }

  listApiKeys(orgId: string): {
    api_keys: Array<Omit<AuthCenterApiKey, 'secretHash'>>
  } {
    return {
      api_keys: this.db
        .listApiKeysByOrg(orgId)
        .map(apiKey => sanitizeApiKey(apiKey)),
    }
  }

  createApiKey(input: {
    orgId: string
    userId: string
    name: string
    scopes: string[]
  }): {
    api_key: Omit<AuthCenterApiKey, 'secretHash'>
    plain_text_key: string
  } {
    const user = this.db.getUserByIdAndOrg(input.userId, input.orgId)
    if (!user) {
      throw new AuthServiceError(404, 'Unknown user_id')
    }

    const name = input.name.trim()
    const scopes = input.scopes
      .map(scope => scope.trim())
      .filter(Boolean)

    if (!name || scopes.length === 0) {
      throw new AuthServiceError(400, 'Missing name or scopes')
    }

    const created = createApiKeyRecord({
      orgId: input.orgId,
      userId: user.id,
      name,
      scopes,
    })
    this.db.createApiKey(created.apiKey)
    return {
      api_key: sanitizeApiKey(created.apiKey),
      plain_text_key: created.plainTextKey,
    }
  }

  revokeApiKey(input: {
    orgId: string
    keyId: string
  }): { ok: true } {
    const apiKey = this.db.getApiKeyById(input.keyId)
    if (!apiKey || apiKey.orgId !== input.orgId) {
      throw new AuthServiceError(404, 'Unknown key_id')
    }

    this.db.revokeApiKey(apiKey.id)
    return { ok: true }
  }

  requireScope(
    auth: AuthContext,
    scope: string,
  ): void {
    if (!hasScope(auth.scopes, scope)) {
      throw new AuthServiceError(403, `Missing scope: ${scope}`)
    }
  }

  requireAnyScope(
    auth: AuthContext,
    scopes: string[],
  ): void {
    if (!scopes.some(scope => hasScope(auth.scopes, scope))) {
      throw new AuthServiceError(403, `Missing any scope: ${scopes.join(', ')}`)
    }
  }

  private issueToken(input: {
    user: AuthCenterUser
    scopes: string[]
    keyId: string
  }): {
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    user: Omit<AuthCenterUser, 'passwordHash'>
    organization: { id: string; name: string; createdAt: number } | null
    scopes: string[]
  } {
    const issued = issueAccessToken(
      {
        iss: this.db.getIssuer(),
        sub: input.user.id,
        org_id: input.user.orgId,
        role: input.user.role,
        scopes: input.scopes,
        key_id: input.keyId,
      },
      this.db.getJwtSecret(),
      this.tokenTtlSec,
    )

    return {
      access_token: issued.token,
      token_type: 'Bearer',
      expires_in: issued.expiresAt - Math.floor(Date.now() / 1000),
      user: sanitizeUser(input.user),
      organization: this.db.getOrganization(input.user.orgId),
      scopes: input.scopes,
    }
  }

  private getUniqueUserByName(name: string): AuthCenterUser | null {
    const users = this.db.listUsersByName(name)
    if (users.length > 1) {
      throw new AuthServiceError(
        409,
        'Username is not unique; login with email is required',
      )
    }
    return users[0] ?? null
  }
}
