import { randomUUID } from 'crypto'
import type { DatabaseSync } from 'node:sqlite'
import { hasScope, issueAccessToken, verifyAccessToken, type AuthContext } from './token.js'
import {
  AuthCenterDb,
  type AuthCenterApiKey,
  type AuthCenterBootstrap,
  type AuthCenterDepartment,
  type AuthCenterOAuthAuthorizationCode,
  type AuthCenterOAuthAuthorizationRequest,
  type AuthCenterRole,
  type BootstrapAdminConfig,
  type AuthCenterUser,
  type SanitizedAuthCenterDepartment,
  type SanitizedAuthCenterUser,
  createApiKeyRecord,
  createSyntheticUserEmail,
  hashPassword,
  sanitizeApiKey,
  sanitizeUser,
  verifyPassword,
} from '../authCenter/db.js'
import {
  BUILTIN_ROLE_TEMPLATES,
  normalizePermissions,
  permissionCatalog,
  type BuiltinRoleKey,
} from './permissions.js'

export type AuthRole = 'admin' | 'dept_admin' | 'user'

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

export type RoleDefinition = AuthCenterRole & {
  permissions: string[]
  assignedCount: number
}

export type UserWithRoles = SanitizedAuthCenterUser & {
  roleIds: string[]
  roles: Array<Pick<AuthCenterRole, 'id' | 'systemKey' | 'name' | 'isBuiltin'>>
  effectiveScopes: string[]
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
  return value === 'admin' || value === 'dept_admin' || value === 'user'
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
    email?: string
    password: string
  }): {
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    user: UserWithRoles
    organization: { id: string; name: string; createdAt: number } | null
    scopes: string[]
  } {
    const user = this.authenticatePasswordUser(input)
    const loggedInAt = Date.now()
    this.db.updateUserLastLogin(user.id, loggedInAt)
    return this.issueToken({
      user: { ...user, lastLoginAt: loggedInAt },
      scopes: this.getEffectiveScopes(user.id),
      keyId: 'password-login',
    })
  }

  authenticatePasswordForOAuth(input: {
    username?: string
    email?: string
    password: string
  }): {
    user: UserWithRoles
    organization: { id: string; name: string; createdAt: number }
    scopes: string[]
  } {
    const user = this.authenticatePasswordUser(input)
    const organization = this.db.getOrganization(user.orgId)
    if (!organization) {
      throw new AuthServiceError(401, 'User organization is invalid')
    }
    const loggedInAt = Date.now()
    this.db.updateUserLastLogin(user.id, loggedInAt)
    return {
      user: this.withRoles({ ...user, lastLoginAt: loggedInAt }),
      organization,
      scopes: this.getEffectiveScopes(user.id),
    }
  }

  pruneOAuthAuthorizationRecords(currentTime: number): void {
    this.db.pruneOAuthAuthorizationRecords(currentTime)
  }

  countOAuthAuthorizationRecords(): number {
    return this.db.countOAuthAuthorizationRecords()
  }

  createOAuthAuthorizationRequest(request: AuthCenterOAuthAuthorizationRequest): void {
    this.db.createOAuthAuthorizationRequest(request)
  }

  getOAuthAuthorizationRequest(
    id: string,
    currentTime: number,
  ): AuthCenterOAuthAuthorizationRequest | null {
    return this.db.getOAuthAuthorizationRequest(id, currentTime)
  }

  incrementOAuthAuthorizationAttempts(
    id: string,
    currentTime: number,
  ): AuthCenterOAuthAuthorizationRequest | null {
    return this.db.incrementOAuthAuthorizationAttempts(id, currentTime)
  }

  deleteOAuthAuthorizationRequest(id: string): void {
    this.db.deleteOAuthAuthorizationRequest(id)
  }

  deleteOAuthAuthorizationRequestByState(state: string, redirectUri: string): boolean {
    return this.db.deleteOAuthAuthorizationRequestByState(state, redirectUri)
  }

  consumeOAuthAuthorizationRequest(
    id: string,
    currentTime: number,
  ): AuthCenterOAuthAuthorizationRequest | null {
    return this.db.consumeOAuthAuthorizationRequest(id, currentTime)
  }

  completeOAuthAuthorization(
    requestId: string,
    authorization: AuthCenterOAuthAuthorizationCode,
    currentTime: number,
  ): boolean {
    return this.db.completeOAuthAuthorization(requestId, authorization, currentTime)
  }

  consumeOAuthAuthorizationCode(
    code: string,
    currentTime: number,
  ): AuthCenterOAuthAuthorizationCode | null {
    return this.db.consumeOAuthAuthorizationCode(code, currentTime)
  }

  deleteOAuthAuthorizationCode(code: string, redirectUri: string): boolean {
    return this.db.deleteOAuthAuthorizationCode(code, redirectUri)
  }

  deleteOAuthAuthorizationCodeByState(state: string, redirectUri: string): boolean {
    return this.db.deleteOAuthAuthorizationCodeByState(state, redirectUri)
  }

  issueTokenFromApiKey(apiKeyValue: string): {
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    user: UserWithRoles
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

    // Browser OAuth keys are managed login credentials, so their scopes track
    // the user's current role. Explicitly created API keys remain fixed-scope.
    const oauthIdentity = this.db.getOAuthIdentityByApiKeyId(apiKey.id)
    const scopes = oauthIdentity?.providerId === 'moss-server'
      ? this.getEffectiveScopes(user.id)
      : apiKey.scopes
    if (oauthIdentity && JSON.stringify(scopes) !== JSON.stringify(apiKey.scopes)) {
      this.db.updateApiKeyScopes(apiKey.id, scopes)
    }
    this.db.updateApiKeyLastUsed(apiKey.id)
    return this.issueToken({
      user,
      scopes,
      keyId: apiKey.id,
    })
  }

  issuePermanentApiKeyForOAuthUser(input: {
    userId: string
    orgId: string
  }): {
    api_key: string
    key: Omit<AuthCenterApiKey, 'secretHash'>
    user: UserWithRoles
    organization: { id: string; name: string; createdAt: number }
    scopes: string[]
  } {
    return this.db.transaction(() => {
      const user = this.db.getUserByIdAndOrg(input.userId, input.orgId)
      const organization = this.db.getOrganization(input.orgId)
      if (!user || user.status !== 'active' || !organization) {
        throw new AuthServiceError(403, 'OAuth user is disabled')
      }

      const providerId = 'moss-server'
      const subject = user.id
      let identity = this.db.getOAuthIdentity(providerId, subject)
      if (!identity) {
        const createdAt = Date.now()
        identity = {
          providerId,
          subject,
          userId: user.id,
          email: user.email,
          apiKeyId: null,
          createdAt,
          lastLoginAt: createdAt,
        }
        this.db.createOAuthIdentity(identity)
      }
      if (identity?.apiKeyId) {
        this.db.revokeApiKey(identity.apiKeyId)
      }
      const scopes = this.getEffectiveScopes(user.id)
      const created = createApiKeyRecord({
        orgId: user.orgId,
        userId: user.id,
        name: 'oauth:browser-login',
        scopes,
      })
      const loggedInAt = Date.now()
      this.db.createApiKey(created.apiKey)
      this.db.updateOAuthIdentityLogin({
        providerId,
        subject,
        email: user.email,
        apiKeyId: created.apiKey.id,
        lastLoginAt: loggedInAt,
      })
      this.db.updateUserLastLogin(user.id, loggedInAt)

      return {
        api_key: created.plainTextKey,
        key: sanitizeApiKey(created.apiKey),
        user: this.withRoles({ ...user, lastLoginAt: loggedInAt }),
        organization,
        scopes,
      }
    })
  }

  getMe(auth: AuthContext): {
    user: UserWithRoles | null
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

  listUsers(
    orgId: string,
    auth?: AuthContext,
  ): {
    users: UserWithRoles[]
  } {
    return {
      users: this.listVisibleUsers(orgId, auth).map(user => this.withRoles(user)),
    }
  }

  listDepartments(
    orgId: string,
    auth?: AuthContext,
  ): {
    departments: SanitizedAuthCenterDepartment[]
  } {
    const userCountByDepartment = this.listVisibleUsers(orgId, auth).reduce(
      (counts, user) => {
        if (user.departmentId) {
          counts.set(user.departmentId, (counts.get(user.departmentId) ?? 0) + 1)
        }
        return counts
      },
      new Map<string, number>(),
    )

    const visibleDepartmentIds = this.getVisibleDepartmentIds(orgId, auth)
    const visibleDepartments = this.db.listDepartmentsByOrg(orgId).filter(department =>
      visibleDepartmentIds === null ? true : visibleDepartmentIds.has(department.id),
    )

    return {
      departments: visibleDepartments.map(department => ({
        ...department,
        userCount: userCountByDepartment.get(department.id) ?? 0,
      })),
    }
  }

  listRoles(orgId: string): { roles: RoleDefinition[] } {
    return { roles: this.db.listRolesByOrg(orgId).map(role => this.roleDefinition(role)) }
  }

  listPermissions(): { permissions: ReturnType<typeof permissionCatalog> } {
    return { permissions: permissionCatalog() }
  }

  createRole(input: {
    orgId: string
    name: string
    description?: string
    permissions: string[]
  }): { role: RoleDefinition } {
    const name = input.name.trim()
    if (!name) throw new AuthServiceError(400, 'Missing role name')
    if (this.db.listRolesByOrg(input.orgId).some(role => role.name === name)) {
      throw new AuthServiceError(409, 'Role name already exists')
    }
    let permissions: string[]
    try {
      permissions = normalizePermissions(input.permissions)
    } catch (error) {
      throw new AuthServiceError(400, error instanceof Error ? error.message : String(error))
    }
    if (permissions.includes('admin:roles')) {
      throw new AuthServiceError(400, 'The protected role-management permission cannot be assigned to a custom role')
    }
    const timestamp = Date.now()
    const role: AuthCenterRole = {
      id: randomUUID(),
      orgId: input.orgId,
      systemKey: null,
      name,
      description: input.description?.trim() || '',
      isBuiltin: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.db.createRole(role, permissions)
    return { role: this.roleDefinition(role) }
  }

  updateRole(input: {
    orgId: string
    roleId: string
    name?: string
    description?: string
    permissions?: string[]
  }): { role: RoleDefinition } {
    const role = this.db.getRoleByIdAndOrg(input.roleId, input.orgId)
    if (!role) throw new AuthServiceError(404, 'Unknown role_id')
    if (role.systemKey === 'admin') {
      throw new AuthServiceError(409, 'The system administrator role is protected')
    }
    const name = input.name?.trim()
    if (role.isBuiltin && name && name !== role.name) {
      throw new AuthServiceError(409, 'Built-in roles cannot be renamed')
    }
    if (name && this.db.listRolesByOrg(input.orgId).some(item => item.id !== role.id && item.name === name)) {
      throw new AuthServiceError(409, 'Role name already exists')
    }
    let permissions: string[] | undefined
    if (input.permissions) {
      try {
        permissions = normalizePermissions(input.permissions)
      } catch (error) {
        throw new AuthServiceError(400, error instanceof Error ? error.message : String(error))
      }
      if (permissions.includes('admin:roles')) {
        throw new AuthServiceError(400, 'The protected role-management permission is reserved for system administrators')
      }
    }
    this.db.updateRole(role.id, {
      name: role.isBuiltin ? undefined : name,
      description: input.description?.trim(),
    })
    if (permissions) this.db.setRolePermissions(role.id, permissions)
    const updated = this.db.getRoleByIdAndOrg(role.id, input.orgId) ?? role
    return { role: this.roleDefinition(updated) }
  }

  deleteRole(input: { orgId: string; roleId: string }): { ok: true } {
    const role = this.db.getRoleByIdAndOrg(input.roleId, input.orgId)
    if (!role) throw new AuthServiceError(404, 'Unknown role_id')
    if (role.isBuiltin) throw new AuthServiceError(409, 'Built-in roles cannot be deleted')
    if (this.db.countUsersForRole(role.id) > 0) {
      throw new AuthServiceError(409, 'Role still has assigned users')
    }
    this.db.deleteRole(role.id)
    return { ok: true }
  }

  setUserRoles(input: { orgId: string; userId: string; roleIds: string[] }, auth?: AuthContext): {
    user: UserWithRoles
  } {
    return this.updateUser({
      orgId: input.orgId,
      userId: input.userId,
      roleIds: input.roleIds,
    }, auth)
  }

  requireSystemAdmin(auth: AuthContext): void {
    if (!(auth.systemRoles?.includes('admin') || auth.role === 'admin')) {
      throw new AuthServiceError(403, 'System administrator permission is required')
    }
  }

  getUserOrNull(
    userId: string,
    orgId: string,
    auth?: AuthContext,
  ): UserWithRoles | null {
    const user = this.db.getUserByIdAndOrg(userId, orgId)
    if (!user) {
      return null
    }
    if (!this.canViewUser(user, auth)) {
      return null
    }
    return this.withRoles(user)
  }

  createUser(input: {
    orgId: string
    email?: string
    name: string
    departmentId?: string | null
    role?: string
    roleIds?: string[]
    password: string
  }, auth?: AuthContext): {
    user: UserWithRoles
  } {
    const email = input.email?.trim() || ''
    const name = input.name.trim()
    const departmentId = input.departmentId?.trim() || null
    if (!name || !input.password) {
      throw new AuthServiceError(400, 'Missing name or password')
    }
    const roleIds = this.resolveRoleIds(input.orgId, input.roleIds, input.role)
    this.assertCanAssignRoles(auth, roleIds)
    const role = this.primaryRoleForRoleIds(input.orgId, roleIds)
    if (this.roleIdsRequireDepartment(input.orgId, roleIds) && !departmentId) {
      throw new AuthServiceError(400, 'Department admin must be assigned to a department')
    }
    if (departmentId && !this.db.getDepartmentByIdAndOrg(departmentId, input.orgId)) {
      throw new AuthServiceError(400, 'Unknown department_id')
    }
    this.assertCanManageUserMutation(
      input.orgId,
      {
        role,
        departmentId,
      },
      auth,
    )

    if (email) {
      const existingUser = this.db.getUserByEmail(email)
      if (existingUser) {
        throw new AuthServiceError(409, 'User email already exists')
      }
    }
    if (this.db.listUsersByName(name).length > 0) {
      throw new AuthServiceError(409, 'Username already exists')
    }

    const createdAt = Date.now()
    const userId = randomUUID()
    const user: AuthCenterUser = {
      id: userId,
      orgId: input.orgId,
      email: email || createSyntheticUserEmail(userId),
      name,
      departmentId,
      role,
      status: 'active',
      tokenLimit: null,
      createdAt,
      passwordHash: hashPassword(input.password),
      passwordUpdatedAt: createdAt,
      lastLoginAt: null,
    }
    this.db.createUser(user)
    this.db.setUserRoleIds(user.id, roleIds)
    return { user: this.withRoles(user) }
  }

  updateUser(input: {
    orgId: string
    userId: string
    name?: string
    departmentId?: string | null
    role?: string
    roleIds?: string[]
    status?: string
  }, auth?: AuthContext): {
    user: UserWithRoles
  } {
    const user = this.db.getUserByIdAndOrg(input.userId, input.orgId)
    if (!user) {
      throw new AuthServiceError(404, 'Unknown user_id')
    }

    const patch: {
      name?: string
      departmentId?: string | null
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
    const nextRoleIds = input.roleIds !== undefined || typeof input.role === 'string'
      ? this.resolveRoleIds(input.orgId, input.roleIds, input.role)
      : this.db.listRolesForUser(user.id).map(role => role.id)
    if (input.roleIds !== undefined || typeof input.role === 'string') {
      this.assertCanAssignRoles(auth, nextRoleIds)
      patch.role = this.primaryRoleForRoleIds(input.orgId, nextRoleIds)
    }
    if (input.departmentId !== undefined) {
      const departmentId = input.departmentId?.trim() || null
      if (
        departmentId &&
        !this.db.getDepartmentByIdAndOrg(departmentId, input.orgId)
      ) {
        throw new AuthServiceError(400, 'Unknown department_id')
      }
      patch.departmentId = departmentId
    }
    if (typeof input.status === 'string') {
      const status = input.status.trim()
      if (!isUserStatus(status)) {
        throw new AuthServiceError(400, `Unsupported status: ${status}`)
      }
      patch.status = status
    }

    const nextDepartmentId =
      patch.departmentId === undefined ? user.departmentId : patch.departmentId
    if (this.roleIdsRequireDepartment(input.orgId, nextRoleIds) && !nextDepartmentId) {
      throw new AuthServiceError(400, 'Department admin must be assigned to a department')
    }
    this.assertCanManageExistingUser(user, auth)
    this.assertCanManageUserMutation(
      input.orgId,
      {
        role: patch.role ?? user.role,
        departmentId: nextDepartmentId,
      },
      auth,
    )

    if (
      patch.name === undefined &&
      patch.departmentId === undefined &&
      patch.role === undefined &&
      input.roleIds === undefined &&
      patch.status === undefined
    ) {
      throw new AuthServiceError(400, 'Missing user update fields')
    }

    if (
      (patch.status === 'disabled' || !this.hasSystemRoleIds(input.orgId, nextRoleIds, 'admin'))
      && this.userHasSystemRole(user.id, 'admin')
      && this.db.countActiveUsersWithSystemRole(input.orgId, 'admin') <= 1
    ) {
      throw new AuthServiceError(409, 'At least one active system administrator is required')
    }

    this.db.updateUser(user.id, patch)
    if (input.roleIds !== undefined || typeof input.role === 'string') {
      this.db.setUserRoleIds(user.id, nextRoleIds)
    }
    const updated = this.db.getUserByIdAndOrg(user.id, input.orgId) ?? user
    return {
      user: this.withRoles(updated),
    }
  }

  setUserTokenLimit(input: {
    orgId: string
    userId: string
    tokenLimit: number | null
  }, auth?: AuthContext): { ok: true } {
    const user = this.db.getUserByIdAndOrg(input.userId, input.orgId)
    if (!user) {
      throw new AuthServiceError(404, 'Unknown user_id')
    }
    this.assertCanManageExistingUser(user, auth)
    this.db.setUserTokenLimit(input.userId, input.tokenLimit)
    return { ok: true }
  }

  setDepartmentTokenLimit(input: {
    orgId: string
    departmentId: string
    tokenLimit: number | null
  }, auth?: AuthContext): { ok: true } {
    const department = this.db.getDepartmentByIdAndOrg(input.departmentId, input.orgId)
    if (!department) {
      throw new AuthServiceError(404, 'Unknown department_id')
    }
    this.db.setDepartmentTokenLimit(input.departmentId, input.tokenLimit)
    return { ok: true }
  }

  setUserPassword(input: {
    orgId: string
    userId: string
    password: string
  }, auth?: AuthContext): { ok: true } {
    const user = this.db.getUserByIdAndOrg(input.userId, input.orgId)
    if (!user) {
      throw new AuthServiceError(404, 'Unknown user_id')
    }
    if (!input.password) {
      throw new AuthServiceError(400, 'Missing password')
    }
    this.assertCanManageExistingUser(user, auth)

    this.db.updateUserPassword(
      input.userId,
      hashPassword(input.password),
      Date.now(),
    )
    return { ok: true }
  }

  listApiKeys(
    orgId: string,
    auth?: AuthContext,
  ): {
    api_keys: Array<Omit<AuthCenterApiKey, 'secretHash'>>
  } {
    const visibleUserIds = new Set(this.listVisibleUsers(orgId, auth).map(user => user.id))
    return {
      api_keys: this.db
        .listApiKeysByOrg(orgId)
        .filter(apiKey => visibleUserIds.has(apiKey.userId))
        .map(apiKey => sanitizeApiKey(apiKey)),
    }
  }

  createApiKey(input: {
    orgId: string
    userId: string
    name: string
    scopes: string[]
  }, auth?: AuthContext): {
    api_key: Omit<AuthCenterApiKey, 'secretHash'>
    plain_text_key: string
  } {
    const user = this.db.getUserByIdAndOrg(input.userId, input.orgId)
    if (!user) {
      throw new AuthServiceError(404, 'Unknown user_id')
    }
    this.assertCanManageExistingUser(user, auth)

    const name = input.name.trim()
    const scopes = input.scopes
      .map(scope => scope.trim())
      .filter(Boolean)

    if (!name || scopes.length === 0) {
      throw new AuthServiceError(400, 'Missing name or scopes')
    }
    this.assertCanManageApiKeyScopes(scopes, auth)

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
  }, auth?: AuthContext): { ok: true } {
    const apiKey = this.db.getApiKeyById(input.keyId)
    if (!apiKey || apiKey.orgId !== input.orgId) {
      throw new AuthServiceError(404, 'Unknown key_id')
    }
    const user = this.db.getUserByIdAndOrg(apiKey.userId, input.orgId)
    if (!user) {
      throw new AuthServiceError(404, 'Unknown user_id')
    }
    this.assertCanManageExistingUser(user, auth)

    this.db.revokeApiKey(apiKey.id)
    return { ok: true }
  }

  createDepartment(input: {
    orgId: string
    name: string
    parentId?: string | null
  }): {
    department: SanitizedAuthCenterDepartment
  } {
    const name = input.name.trim()
    const parentId = input.parentId?.trim() || null
    if (!name) {
      throw new AuthServiceError(400, 'Missing department name')
    }

    if (parentId && !this.db.getDepartmentByIdAndOrg(parentId, input.orgId)) {
      throw new AuthServiceError(400, 'Unknown parent department')
    }

    const existingSibling = this.findSiblingDepartment(input.orgId, parentId, name)
    if (existingSibling) {
      throw new AuthServiceError(409, 'Department name already exists under the same parent')
    }

    const timestamp = Date.now()
    const department: AuthCenterDepartment = {
      id: randomUUID(),
      orgId: input.orgId,
      parentId,
      name,
      tokenLimit: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    this.db.createDepartment(department)
    return {
      department: {
        ...department,
        userCount: 0,
      },
    }
  }

  updateDepartment(input: {
    orgId: string
    departmentId: string
    name?: string
    parentId?: string | null
  }): {
    department: SanitizedAuthCenterDepartment
  } {
    const department = this.db.getDepartmentByIdAndOrg(input.departmentId, input.orgId)
    if (!department) {
      throw new AuthServiceError(404, 'Unknown department_id')
    }

    const patch: {
      name?: string
      parentId?: string | null
    } = {}

    if (typeof input.name === 'string') {
      const name = input.name.trim()
      if (!name) {
        throw new AuthServiceError(400, 'Department name cannot be empty')
      }
      patch.name = name
    }

    if (input.parentId !== undefined) {
      const parentId = input.parentId?.trim() || null
      if (parentId === department.id) {
        throw new AuthServiceError(400, 'Department cannot be its own parent')
      }
      if (parentId && !this.db.getDepartmentByIdAndOrg(parentId, input.orgId)) {
        throw new AuthServiceError(400, 'Unknown parent department')
      }
      if (parentId && this.isDepartmentDescendant(input.orgId, department.id, parentId)) {
        throw new AuthServiceError(400, 'Department cannot be moved under its descendant')
      }
      patch.parentId = parentId
    }

    const nextName = patch.name ?? department.name
    const nextParentId =
      patch.parentId === undefined ? department.parentId : patch.parentId
    const sibling = this.findSiblingDepartment(input.orgId, nextParentId, nextName)
    if (sibling && sibling.id !== department.id) {
      throw new AuthServiceError(409, 'Department name already exists under the same parent')
    }

    if (patch.name === undefined && patch.parentId === undefined) {
      throw new AuthServiceError(400, 'Missing department update fields')
    }

    this.db.updateDepartment(department.id, patch)
    const updatedDepartment = this.db.getDepartmentByIdAndOrg(department.id, input.orgId) ?? department
    return {
      department: {
        ...updatedDepartment,
        userCount: this.countUsersForDepartment(input.orgId, updatedDepartment.id),
      },
    }
  }

  deleteDepartment(input: {
    orgId: string
    departmentId: string
  }): { ok: true } {
    const department = this.db.getDepartmentByIdAndOrg(input.departmentId, input.orgId)
    if (!department) {
      throw new AuthServiceError(404, 'Unknown department_id')
    }

    const hasChildren = this.db
      .listDepartmentsByOrg(input.orgId)
      .some(item => item.parentId === department.id)
    if (hasChildren) {
      throw new AuthServiceError(409, 'Department has child departments')
    }

    const hasUsers = this.db
      .listUsersByOrg(input.orgId)
      .some(user => user.departmentId === department.id)
    if (hasUsers) {
      throw new AuthServiceError(409, 'Department still has assigned users')
    }

    this.db.deleteDepartment(department.id)
    return { ok: true }
  }

  requireScope(
    auth: AuthContext,
    scope: string,
  ): void {
    if (!this.hasEffectiveScope(auth, scope)) {
      throw new AuthServiceError(403, `Missing scope: ${scope}`)
    }
  }

  requireAnyScope(
    auth: AuthContext,
    scopes: string[],
  ): void {
    if (!scopes.some(scope => this.hasEffectiveScope(auth, scope))) {
      throw new AuthServiceError(403, `Missing any scope: ${scopes.join(', ')}`)
    }
  }

  private hasEffectiveScope(auth: AuthContext, scope: string): boolean {
    return hasScope(auth.scopes, scope)
  }

  private issueToken(input: {
    user: AuthCenterUser
    scopes: string[]
    keyId: string
  }): {
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    user: UserWithRoles
    organization: { id: string; name: string; createdAt: number } | null
    scopes: string[]
  } {
    const roles = this.db.listRolesForUser(input.user.id)
    const issued = issueAccessToken(
      {
        iss: this.db.getIssuer(),
        sub: input.user.id,
        org_id: input.user.orgId,
        role: input.user.role,
        role_ids: roles.map(role => role.id),
        system_roles: roles.flatMap(role => role.systemKey ? [role.systemKey] : []),
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
      user: this.withRoles(input.user),
      organization: this.db.getOrganization(input.user.orgId),
      scopes: input.scopes,
    }
  }

  private authenticatePasswordUser(input: {
    username?: string
    email?: string
    password: string
  }): AuthCenterUser {
    const username = input.username?.trim() || ''
    const email = input.email?.trim().toLowerCase() || ''
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
    return user
  }

  private getUniqueUserByName(name: string): AuthCenterUser | null {
    const users = this.db.listUsersByName(name)
    if (users.length > 1) {
      throw new AuthServiceError(
        409,
        'Username is not unique; contact admin to resolve the conflict',
      )
    }
    return users[0] ?? null
  }

  private roleDefinition(role: AuthCenterRole): RoleDefinition {
    return {
      ...role,
      permissions: this.db.listRolePermissions(role.id),
      assignedCount: this.db.countUsersForRole(role.id),
    }
  }

  private withRoles(user: AuthCenterUser): UserWithRoles {
    const roles = this.db.listRolesForUser(user.id)
    return {
      ...sanitizeUser(user),
      roleIds: roles.map(role => role.id),
      roles: roles.map(role => ({
        id: role.id,
        systemKey: role.systemKey,
        name: role.name,
        isBuiltin: role.isBuiltin,
      })),
      effectiveScopes: this.getEffectiveScopes(user.id),
    }
  }

  private getEffectiveScopes(userId: string): string[] {
    const permissions = this.db.listRolesForUser(userId)
      .flatMap(role => this.db.listRolePermissions(role.id))
    if (permissions.includes('*')) return ['*']
    try {
      return normalizePermissions(permissions)
    } catch {
      return [...new Set(permissions)]
    }
  }

  private resolveRoleIds(orgId: string, inputRoleIds?: string[], legacyRole?: string): string[] {
    if (Array.isArray(inputRoleIds)) {
      const roleIds = [...new Set(inputRoleIds.map(value => value.trim()).filter(Boolean))]
      if (roleIds.length === 0) throw new AuthServiceError(400, 'At least one role is required')
      for (const roleId of roleIds) {
        if (!this.db.getRoleByIdAndOrg(roleId, orgId)) {
          throw new AuthServiceError(400, `Unknown role_id: ${roleId}`)
        }
      }
      return roleIds
    }
    const key = legacyRole?.trim() || 'user'
    if (!isAuthRole(key)) throw new AuthServiceError(400, `Unsupported role: ${key}`)
    const role = this.db.getRoleBySystemKey(orgId, key)
    if (!role) throw new AuthServiceError(500, `Built-in role is missing: ${key}`)
    return [role.id]
  }

  private primaryRoleForRoleIds(orgId: string, roleIds: string[]): AuthRole {
    const roles = roleIds
      .map(roleId => this.db.getRoleByIdAndOrg(roleId, orgId))
      .filter((role): role is AuthCenterRole => Boolean(role))
    if (roles.some(role => role.systemKey === 'admin')) return 'admin'
    if (roles.some(role => role.systemKey === 'dept_admin')) return 'dept_admin'
    return 'user'
  }

  private hasSystemRoleIds(
    orgId: string,
    roleIds: string[],
    systemKey: BuiltinRoleKey,
  ): boolean {
    return roleIds.some(roleId => this.db.getRoleByIdAndOrg(roleId, orgId)?.systemKey === systemKey)
  }

  private userHasSystemRole(userId: string, systemKey: BuiltinRoleKey): boolean {
    return this.db.listRolesForUser(userId).some(role => role.systemKey === systemKey)
  }

  private roleIdsRequireDepartment(orgId: string, roleIds: string[]): boolean {
    if (this.hasSystemRoleIds(orgId, roleIds, 'admin')) return false
    const permissions = roleIds.flatMap(roleId => this.db.listRolePermissions(roleId))
    return permissions.includes('admin:users')
  }

  private assertCanAssignRoles(auth: AuthContext | undefined, roleIds: string[]): void {
    if (!auth || auth.systemRoles?.includes('admin') || auth.role === 'admin') return
    const regularRole = this.db.getRoleBySystemKey(auth.orgId, 'user')
    if (!regularRole || roleIds.length !== 1 || roleIds[0] !== regularRole.id) {
      throw new AuthServiceError(403, 'Only system administrators can assign roles')
    }
  }

  private countUsersForDepartment(orgId: string, departmentId: string): number {
    return this.db
      .listUsersByOrg(orgId)
      .filter(user => user.departmentId === departmentId)
      .length
  }

  private findSiblingDepartment(
    orgId: string,
    parentId: string | null,
    name: string,
  ): AuthCenterDepartment | null {
    return (
      this.db
        .listDepartmentsByOrg(orgId)
        .find(department => department.parentId === parentId && department.name === name) ??
      null
    )
  }

  private isDepartmentDescendant(
    orgId: string,
    departmentId: string,
    candidateParentId: string,
  ): boolean {
    const departments = this.db.listDepartmentsByOrg(orgId)
    const byId = new Map(departments.map(department => [department.id, department]))
    let current = byId.get(candidateParentId) ?? null

    while (current) {
      if (current.id === departmentId) {
        return true
      }
      current = current.parentId ? byId.get(current.parentId) ?? null : null
    }

    return false
  }

  private listVisibleUsers(
    orgId: string,
    auth?: AuthContext,
  ): AuthCenterUser[] {
    const users = this.db.listUsersByOrg(orgId)
    if (!auth) {
      return users
    }

    const visibleDepartmentIds = this.getVisibleDepartmentIds(orgId, auth)
    if (visibleDepartmentIds === null) {
      return users
    }

    return users.filter(user =>
      user.departmentId !== null &&
      visibleDepartmentIds.has(user.departmentId),
    )
  }

  private getVisibleDepartmentIds(
    orgId: string,
    auth?: AuthContext,
  ): Set<string> | null {
    if (!auth) {
      return null
    }

    const actor = this.requireAuthUser(auth)
    if (auth.systemRoles?.includes('admin') || auth.role === 'admin') {
      return null
    }
    if (!hasScope(auth.scopes, 'admin:users') || !actor.departmentId) {
      return new Set<string>()
    }

    const childrenByParent = new Map<string | null, AuthCenterDepartment[]>()
    for (const department of this.db.listDepartmentsByOrg(orgId)) {
      const bucket = childrenByParent.get(department.parentId) ?? []
      bucket.push(department)
      childrenByParent.set(department.parentId, bucket)
    }

    const visibleIds = new Set<string>()
    const stack = [actor.departmentId]
    while (stack.length > 0) {
      const currentId = stack.pop()
      if (!currentId || visibleIds.has(currentId)) {
        continue
      }
      visibleIds.add(currentId)
      const children = childrenByParent.get(currentId) ?? []
      for (const child of children) {
        stack.push(child.id)
      }
    }

    return visibleIds
  }

  private requireAuthUser(auth: AuthContext): AuthCenterUser {
    const user = this.db.getUserByIdAndOrg(auth.userId, auth.orgId)
    if (!user || user.status !== 'active') {
      throw new AuthServiceError(403, 'Current user is not allowed to manage users')
    }
    return user
  }

  private canViewUser(
    user: AuthCenterUser,
    auth?: AuthContext,
  ): boolean {
    if (!auth) {
      return true
    }

    const visibleDepartmentIds = this.getVisibleDepartmentIds(user.orgId, auth)
    if (visibleDepartmentIds === null) {
      return true
    }

    return (
      user.departmentId !== null &&
      visibleDepartmentIds.has(user.departmentId)
    )
  }

  private assertCanManageExistingUser(
    user: AuthCenterUser,
    auth?: AuthContext,
  ): void {
    if (!this.canViewUser(user, auth)) {
      throw new AuthServiceError(403, 'You cannot manage this user')
    }
  }

  private assertCanManageUserMutation(
    orgId: string,
    input: {
      role: string
      departmentId: string | null
    },
    auth?: AuthContext,
  ): void {
    if (!auth) {
      return
    }

    const actor = this.requireAuthUser(auth)
    if (auth.systemRoles?.includes('admin') || auth.role === 'admin') {
      return
    }

    const visibleDepartmentIds = this.getVisibleDepartmentIds(orgId, auth)
    if (input.role !== 'user') {
      throw new AuthServiceError(403, 'Department admin can only manage user role accounts')
    }
    if (
      !input.departmentId ||
      visibleDepartmentIds === null ||
      !visibleDepartmentIds.has(input.departmentId)
    ) {
      throw new AuthServiceError(403, 'Target department is outside your managed scope')
    }
  }

  private assertCanManageApiKeyScopes(
    scopes: string[],
    auth?: AuthContext,
  ): void {
    if (!auth) {
      return
    }

    const actor = this.requireAuthUser(auth)
    if (auth.systemRoles?.includes('admin') || auth.role === 'admin') {
      return
    }

    const regularTemplate = BUILTIN_ROLE_TEMPLATES.find(role => role.key === 'user')
    const allowedScopes = new Set(regularTemplate?.permissions ?? [])
    if (!scopes.every(scope => allowedScopes.has(scope))) {
      throw new AuthServiceError(
        403,
        'Department admin can only issue user-scoped API keys',
      )
    }
  }
}
