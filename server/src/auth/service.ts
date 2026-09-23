import { randomUUID } from 'crypto'
import { flatMapAsync, mapAsync, someAsync } from '../model/async.js'
import type { Database } from '../model/database.js'
import {
  AuthRepository,
  createApiKeyRecord,
  createSyntheticUserEmail,
  hashPassword,
  sanitizeApiKey,
  sanitizeUser,
  verifyPassword,
  type AuthCenterApiKey,
  type AuthCenterBootstrap,
  type AuthCenterDepartment,
  type AuthCenterOAuthAuthorizationCode,
  type AuthCenterOAuthAuthorizationRequest,
  type AuthCenterRole,
  type AuthCenterUser,
  type BootstrapAdminConfig,
  type SanitizedAuthCenterDepartment,
  type SanitizedAuthCenterUser,
} from '../model/repositories/auth.js'
import {
  BUILTIN_ROLE_TEMPLATES,
  normalizePermissions,
  permissionCatalog,
  type BuiltinRoleKey,
} from './permissions.js'
import {
  hasScope,
  issueAccessToken,
  verifyAccessToken,
  type AuthContext,
} from './token.js'

export type AuthRole = 'admin' | 'dept_admin' | 'user'

export type AuthServiceOptions = {
  db: Database
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
  db: AuthRepository,
  bootstrapAdmin: BootstrapAdminConfig,
): Promise<AuthCenterBootstrap> {
  return db.transaction(async () => {
    if (!(await db.isInitialized())) {
      return await db.bootstrap(bootstrapAdmin)
    }

    return await db.ensureBootstrapAdmin(bootstrapAdmin)
  })
}

function isAuthRole(value: string): value is AuthRole {
  return value === 'admin' || value === 'dept_admin' || value === 'user'
}

function isUserStatus(value: string): value is 'active' | 'disabled' {
  return value === 'active' || value === 'disabled'
}

export async function createAuthService(options: AuthServiceOptions): Promise<{
  service: AuthService
  bootstrap: AuthCenterBootstrap
}> {
  const db = new AuthRepository(options.db)
  const bootstrap = await initializeStore(db, options.bootstrapAdmin)
  return {
    service: new AuthService(db, options.tokenTtlSec),
    bootstrap,
  }
}

export class AuthService {
  constructor(
    private readonly db: AuthRepository,
    private readonly tokenTtlSec: number,
  ) {}

  async verifyAccessToken(token: string): Promise<AuthContext | null> {
    return verifyAccessToken(
      token,
      await this.db.getJwtSecret(),
      await this.db.getIssuer(),
    )
  }

  // Cloud requests and active streams must not keep permissions from a stale JWT.
  async requireCurrentScope(auth: AuthContext, scope: string): Promise<void> {
    const user = await this.db.getUserByIdAndOrg(auth.userId, auth.orgId)
    if (
      !(await this.verifyAccessToken(auth.rawToken)) ||
      !user ||
      user.status !== 'active' ||
      !(await this.db.getOrganization(auth.orgId))
    ) {
      throw new AuthServiceError(401, 'Login is no longer valid')
    }
    if (auth.keyId !== 'password-login') {
      const key = await this.db.getApiKeyById(auth.keyId)
      if (
        !key ||
        key.status !== 'active' ||
        key.userId !== auth.userId ||
        key.orgId !== auth.orgId
      ) {
        throw new AuthServiceError(401, 'Login credential was revoked')
      }
      if (!hasScope(key.scopes, scope))
        throw new AuthServiceError(403, `Missing credential scope: ${scope}`)
    }
    this.requireScope(auth, scope)
    if (!hasScope(await this.getEffectiveScopes(auth.userId), scope)) {
      throw new AuthServiceError(403, `Missing current scope: ${scope}`)
    }
  }

  async introspect(token: string): Promise<{
    active: boolean
    sub?: string
    org_id?: string
    role?: string
    scopes?: string[]
    key_id?: string
  }> {
    const auth = await this.verifyAccessToken(token)
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

  async issueTokenFromPassword(input: {
    username?: string
    email?: string
    password: string
  }): Promise<{
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    user: UserWithRoles
    organization: { id: string; name: string; createdAt: number } | null
    scopes: string[]
  }> {
    return await this.db.transaction(async () => {
      const user = await this.authenticatePasswordUser(input)
      const loggedInAt = Date.now()
      await this.db.updateUserLastLogin(user.id, loggedInAt)
      return await this.issueToken({
        user: { ...user, lastLoginAt: loggedInAt },
        scopes: await this.getEffectiveScopes(user.id),
        keyId: 'password-login',
      })
    })
  }

  async authenticatePasswordForOAuth(input: {
    username?: string
    email?: string
    password: string
  }): Promise<{
    user: UserWithRoles
    organization: { id: string; name: string; createdAt: number }
    scopes: string[]
  }> {
    return await this.db.transaction(async () => {
      const user = await this.authenticatePasswordUser(input)
      const organization = await this.db.getOrganization(user.orgId)
      if (!organization) {
        throw new AuthServiceError(401, 'User organization is invalid')
      }
      const loggedInAt = Date.now()
      await this.db.updateUserLastLogin(user.id, loggedInAt)
      return {
        user: await this.withRoles({ ...user, lastLoginAt: loggedInAt }),
        organization,
        scopes: await this.getEffectiveScopes(user.id),
      }
    })
  }

  async pruneOAuthAuthorizationRecords(currentTime: number): Promise<void> {
    await this.db.pruneOAuthAuthorizationRecords(currentTime)
  }

  async countOAuthAuthorizationRecords(): Promise<number> {
    return await this.db.countOAuthAuthorizationRecords()
  }

  async createOAuthAuthorizationRequest(
    request: AuthCenterOAuthAuthorizationRequest,
  ): Promise<void> {
    await this.db.createOAuthAuthorizationRequest(request)
  }

  async getOAuthAuthorizationRequest(
    id: string,
    currentTime: number,
  ): Promise<AuthCenterOAuthAuthorizationRequest | null> {
    return await this.db.getOAuthAuthorizationRequest(id, currentTime)
  }

  async incrementOAuthAuthorizationAttempts(
    id: string,
    currentTime: number,
  ): Promise<AuthCenterOAuthAuthorizationRequest | null> {
    return await this.db.incrementOAuthAuthorizationAttempts(id, currentTime)
  }

  async deleteOAuthAuthorizationRequest(id: string): Promise<void> {
    await this.db.deleteOAuthAuthorizationRequest(id)
  }

  async deleteOAuthAuthorizationRequestByState(
    state: string,
    redirectUri: string,
  ): Promise<boolean> {
    return await this.db.deleteOAuthAuthorizationRequestByState(
      state,
      redirectUri,
    )
  }

  async consumeOAuthAuthorizationRequest(
    id: string,
    currentTime: number,
  ): Promise<AuthCenterOAuthAuthorizationRequest | null> {
    return await this.db.consumeOAuthAuthorizationRequest(id, currentTime)
  }

  async completeOAuthAuthorization(
    requestId: string,
    authorization: AuthCenterOAuthAuthorizationCode,
    currentTime: number,
  ): Promise<boolean> {
    return await this.db.completeOAuthAuthorization(
      requestId,
      authorization,
      currentTime,
    )
  }

  async consumeOAuthAuthorizationCode(
    code: string,
    currentTime: number,
  ): Promise<AuthCenterOAuthAuthorizationCode | null> {
    return await this.db.consumeOAuthAuthorizationCode(code, currentTime)
  }

  async deleteOAuthAuthorizationCode(
    code: string,
    redirectUri: string,
  ): Promise<boolean> {
    return await this.db.deleteOAuthAuthorizationCode(code, redirectUri)
  }

  async deleteOAuthAuthorizationCodeByState(
    state: string,
    redirectUri: string,
  ): Promise<boolean> {
    return await this.db.deleteOAuthAuthorizationCodeByState(state, redirectUri)
  }

  async issueTokenFromApiKey(apiKeyValue: string): Promise<{
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    user: UserWithRoles
    organization: { id: string; name: string; createdAt: number } | null
    scopes: string[]
  }> {
    return await this.db.transaction(async () => {
      const value = apiKeyValue.trim()
      if (!value) {
        throw new AuthServiceError(400, 'Missing api_key')
      }

      const apiKey = await this.db.findActiveApiKey(value)
      if (!apiKey) {
        throw new AuthServiceError(401, 'Invalid API key')
      }

      const user = await this.db.getUserById(apiKey.userId)
      const organization = await this.db.getOrganization(apiKey.orgId)
      if (!user || user.status !== 'active' || !organization) {
        throw new AuthServiceError(401, 'API key owner is invalid')
      }

      // Browser OAuth keys are managed login credentials, so their scopes track
      // the user's current role. Explicitly created API keys remain fixed-scope.
      const oauthIdentity = await this.db.getOAuthIdentityByApiKeyId(apiKey.id)
      const scopes =
        oauthIdentity?.providerId === 'moss-server'
          ? await this.getEffectiveScopes(user.id)
          : apiKey.scopes
      if (
        oauthIdentity &&
        JSON.stringify(scopes) !== JSON.stringify(apiKey.scopes)
      ) {
        await this.db.updateApiKeyScopes(apiKey.id, scopes)
      }
      await this.db.updateApiKeyLastUsed(apiKey.id)
      return await this.issueToken({
        user,
        scopes,
        keyId: apiKey.id,
      })
    })
  }

  async issuePermanentApiKeyForOAuthUser(input: {
    userId: string
    orgId: string
  }): Promise<{
    api_key: string
    key: Omit<AuthCenterApiKey, 'secretHash'>
    user: UserWithRoles
    organization: { id: string; name: string; createdAt: number }
    scopes: string[]
  }> {
    return await this.db.transaction(async () => {
      const user = await this.db.getUserByIdAndOrg(input.userId, input.orgId)
      const organization = await this.db.getOrganization(input.orgId)
      if (!user || user.status !== 'active' || !organization) {
        throw new AuthServiceError(403, 'OAuth user is disabled')
      }

      const providerId = 'moss-server'
      const subject = user.id
      let identity = await this.db.getOAuthIdentity(providerId, subject)
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
        await this.db.createOAuthIdentity(identity)
      }
      if (identity?.apiKeyId) {
        await this.db.revokeApiKey(identity.apiKeyId)
      }
      const scopes = await this.getEffectiveScopes(user.id)
      const created = createApiKeyRecord({
        orgId: user.orgId,
        userId: user.id,
        name: 'oauth:browser-login',
        scopes,
      })
      const loggedInAt = Date.now()
      await this.db.createApiKey(created.apiKey)
      await this.db.updateOAuthIdentityLogin({
        providerId,
        subject,
        email: user.email,
        apiKeyId: created.apiKey.id,
        lastLoginAt: loggedInAt,
      })
      await this.db.updateUserLastLogin(user.id, loggedInAt)

      return {
        api_key: created.plainTextKey,
        key: sanitizeApiKey(created.apiKey),
        user: await this.withRoles({ ...user, lastLoginAt: loggedInAt }),
        organization,
        scopes,
      }
    })
  }

  async getMe(auth: AuthContext): Promise<{
    user: UserWithRoles | null
    organization: { id: string; name: string; createdAt: number } | null
    scopes: string[]
    role: string
    key_id: string
  }> {
    return {
      user: await this.getUserOrNull(auth.userId, auth.orgId),
      organization: await this.db.getOrganization(auth.orgId),
      scopes: auth.scopes,
      role: auth.role,
      key_id: auth.keyId,
    }
  }

  async getAccountIdentity(
    orgId: string,
    userId: string | null,
  ): Promise<{
    user: UserWithRoles | null
    organization: { id: string; name: string; createdAt: number } | null
    scopes: string[]
  }> {
    const user = userId ? await this.getUserOrNull(userId, orgId) : null
    return {
      user,
      organization: await this.db.getOrganization(orgId),
      scopes: user?.effectiveScopes ?? [],
    }
  }

  async listUsers(
    orgId: string,
    auth?: AuthContext,
  ): Promise<{
    users: UserWithRoles[]
  }> {
    return {
      users: await mapAsync(
        await this.listVisibleUsers(orgId, auth),
        async user => await this.withRoles(user),
      ),
    }
  }

  async listDepartments(
    orgId: string,
    auth?: AuthContext,
  ): Promise<{
    departments: SanitizedAuthCenterDepartment[]
  }> {
    const userCountByDepartment = (
      await this.listVisibleUsers(orgId, auth)
    ).reduce((counts, user) => {
      if (user.departmentId) {
        counts.set(user.departmentId, (counts.get(user.departmentId) ?? 0) + 1)
      }
      return counts
    }, new Map<string, number>())

    const visibleDepartmentIds = await this.getVisibleDepartmentIds(orgId, auth)
    const visibleDepartments = (
      await this.db.listDepartmentsByOrg(orgId)
    ).filter(department =>
      visibleDepartmentIds === null
        ? true
        : visibleDepartmentIds.has(department.id),
    )

    return {
      departments: visibleDepartments.map(department => ({
        ...department,
        userCount: userCountByDepartment.get(department.id) ?? 0,
      })),
    }
  }

  async listDirectory(orgId: string): Promise<{
    departments: SanitizedAuthCenterDepartment[]
    users: Array<
      Pick<
        SanitizedAuthCenterUser,
        'id' | 'name' | 'email' | 'departmentId' | 'status'
      >
    >
  }> {
    const users = (await this.db.listUsersByOrg(orgId)).filter(
      user => user.status === 'active',
    )
    const userCountByDepartment = users.reduce((counts, user) => {
      if (user.departmentId) {
        counts.set(user.departmentId, (counts.get(user.departmentId) ?? 0) + 1)
      }
      return counts
    }, new Map<string, number>())
    return {
      departments: (await this.db.listDepartmentsByOrg(orgId)).map(
        department => ({
          ...department,
          userCount: userCountByDepartment.get(department.id) ?? 0,
        }),
      ),
      users: users.map(user => {
        const sanitized = sanitizeUser(user)
        return {
          id: sanitized.id,
          name: sanitized.name,
          email: sanitized.email,
          departmentId: sanitized.departmentId,
          status: sanitized.status,
        }
      }),
    }
  }

  async listRoles(orgId: string): Promise<{ roles: RoleDefinition[] }> {
    return {
      roles: await mapAsync(
        await this.db.listRolesByOrg(orgId),
        async role => await this.roleDefinition(role),
      ),
    }
  }

  listPermissions(): { permissions: ReturnType<typeof permissionCatalog> } {
    return { permissions: permissionCatalog() }
  }

  async createRole(input: {
    orgId: string
    name: string
    description?: string
    permissions: string[]
  }): Promise<{ role: RoleDefinition }> {
    return await this.db.transaction(async () => {
      const name = input.name.trim()
      if (!name) throw new AuthServiceError(400, 'Missing role name')
      if (
        (await this.db.listRolesByOrg(input.orgId)).some(
          role => role.name === name,
        )
      ) {
        throw new AuthServiceError(409, 'Role name already exists')
      }
      let permissions: string[]
      try {
        permissions = normalizePermissions(input.permissions)
      } catch (error) {
        throw new AuthServiceError(
          400,
          error instanceof Error ? error.message : String(error),
        )
      }
      if (permissions.includes('admin:roles')) {
        throw new AuthServiceError(
          400,
          'The protected role-management permission cannot be assigned to a custom role',
        )
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
      await this.db.createRole(role, permissions)
      return { role: await this.roleDefinition(role) }
    })
  }

  async updateRole(input: {
    orgId: string
    roleId: string
    name?: string
    description?: string
    permissions?: string[]
  }): Promise<{ role: RoleDefinition }> {
    return await this.db.transaction(async () => {
      const role = await this.db.getRoleByIdAndOrg(input.roleId, input.orgId)
      if (!role) throw new AuthServiceError(404, 'Unknown role_id')
      if (role.systemKey === 'admin') {
        throw new AuthServiceError(
          409,
          'The system administrator role is protected',
        )
      }
      const name = input.name?.trim()
      if (role.isBuiltin && name && name !== role.name) {
        throw new AuthServiceError(409, 'Built-in roles cannot be renamed')
      }
      if (
        name &&
        (await this.db.listRolesByOrg(input.orgId)).some(
          item => item.id !== role.id && item.name === name,
        )
      ) {
        throw new AuthServiceError(409, 'Role name already exists')
      }
      let permissions: string[] | undefined
      if (input.permissions) {
        try {
          permissions = normalizePermissions(input.permissions)
        } catch (error) {
          throw new AuthServiceError(
            400,
            error instanceof Error ? error.message : String(error),
          )
        }
        if (permissions.includes('admin:roles')) {
          throw new AuthServiceError(
            400,
            'The protected role-management permission is reserved for system administrators',
          )
        }
      }
      await this.db.updateRole(role.id, {
        name: role.isBuiltin ? undefined : name,
        description: input.description?.trim(),
      })
      if (permissions) await this.db.setRolePermissions(role.id, permissions)
      const updated =
        (await this.db.getRoleByIdAndOrg(role.id, input.orgId)) ?? role
      return { role: await this.roleDefinition(updated) }
    })
  }

  async deleteRole(input: {
    orgId: string
    roleId: string
  }): Promise<{ ok: true }> {
    return await this.db.transaction(async () => {
      const role = await this.db.getRoleByIdAndOrg(input.roleId, input.orgId)
      if (!role) throw new AuthServiceError(404, 'Unknown role_id')
      if (role.isBuiltin)
        throw new AuthServiceError(409, 'Built-in roles cannot be deleted')
      if ((await this.db.countUsersForRole(role.id)) > 0) {
        throw new AuthServiceError(409, 'Role still has assigned users')
      }
      await this.db.deleteRole(role.id)
      return { ok: true }
    })
  }

  async setUserRoles(
    input: { orgId: string; userId: string; roleIds: string[] },
    auth?: AuthContext,
  ): Promise<{
    user: UserWithRoles
  }> {
    return await this.db.transaction(async () => {
      return await this.updateUser(
        {
          orgId: input.orgId,
          userId: input.userId,
          roleIds: input.roleIds,
        },
        auth,
      )
    })
  }

  requireSystemAdmin(auth: AuthContext): void {
    if (!(auth.systemRoles?.includes('admin') || auth.role === 'admin')) {
      throw new AuthServiceError(
        403,
        'System administrator permission is required',
      )
    }
  }

  async getUserOrNull(
    userId: string,
    orgId: string,
    auth?: AuthContext,
  ): Promise<UserWithRoles | null> {
    const user = await this.db.getUserByIdAndOrg(userId, orgId)
    if (!user) {
      return null
    }
    if (!(await this.canViewUser(user, auth))) {
      return null
    }
    return await this.withRoles(user)
  }

  async createUser(
    input: {
      orgId: string
      email?: string
      name: string
      departmentId?: string | null
      role?: string
      roleIds?: string[]
      password: string
    },
    auth?: AuthContext,
  ): Promise<{
    user: UserWithRoles
  }> {
    return await this.db.transaction(async () => {
      const email = input.email?.trim() || ''
      const name = input.name.trim()
      const departmentId = input.departmentId?.trim() || null
      if (!name || !input.password) {
        throw new AuthServiceError(400, 'Missing name or password')
      }
      const roleIds = await this.resolveRoleIds(
        input.orgId,
        input.roleIds,
        input.role,
      )
      await this.assertCanAssignRoles(auth, roleIds)
      const role = await this.primaryRoleForRoleIds(input.orgId, roleIds)
      if (
        (await this.roleIdsRequireDepartment(input.orgId, roleIds)) &&
        !departmentId
      ) {
        throw new AuthServiceError(
          400,
          'Department admin must be assigned to a department',
        )
      }
      if (
        departmentId &&
        !(await this.db.getDepartmentByIdAndOrg(departmentId, input.orgId))
      ) {
        throw new AuthServiceError(400, 'Unknown department_id')
      }
      await this.assertCanManageUserMutation(
        input.orgId,
        {
          role,
          departmentId,
        },
        auth,
      )

      if (email) {
        const existingUser = await this.db.getUserByEmail(email)
        if (existingUser) {
          throw new AuthServiceError(409, 'User email already exists')
        }
      }
      if ((await this.db.listUsersByName(name)).length > 0) {
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
      await this.db.createUser(user)
      await this.db.setUserRoleIds(user.id, roleIds)
      return { user: await this.withRoles(user) }
    })
  }

  async updateUser(
    input: {
      orgId: string
      userId: string
      name?: string
      departmentId?: string | null
      role?: string
      roleIds?: string[]
      status?: string
    },
    auth?: AuthContext,
  ): Promise<{
    user: UserWithRoles
  }> {
    return await this.db.transaction(async () => {
      const user = await this.db.getUserByIdAndOrg(input.userId, input.orgId)
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
        const conflictingUsers = (await this.db.listUsersByName(name)).filter(
          existingUser => existingUser.id !== user.id,
        )
        if (conflictingUsers.length > 0) {
          throw new AuthServiceError(409, 'Username already exists')
        }
        patch.name = name
      }
      const nextRoleIds =
        input.roleIds !== undefined || typeof input.role === 'string'
          ? await this.resolveRoleIds(input.orgId, input.roleIds, input.role)
          : (await this.db.listRolesForUser(user.id)).map(role => role.id)
      if (input.roleIds !== undefined || typeof input.role === 'string') {
        await this.assertCanAssignRoles(auth, nextRoleIds)
        patch.role = await this.primaryRoleForRoleIds(input.orgId, nextRoleIds)
      }
      if (input.departmentId !== undefined) {
        const departmentId = input.departmentId?.trim() || null
        if (
          departmentId &&
          !(await this.db.getDepartmentByIdAndOrg(departmentId, input.orgId))
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
        patch.departmentId === undefined
          ? user.departmentId
          : patch.departmentId
      if (
        (await this.roleIdsRequireDepartment(input.orgId, nextRoleIds)) &&
        !nextDepartmentId
      ) {
        throw new AuthServiceError(
          400,
          'Department admin must be assigned to a department',
        )
      }
      await this.assertCanManageExistingUser(user, auth)
      await this.assertCanManageUserMutation(
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
        (patch.status === 'disabled' ||
          !(await this.hasSystemRoleIds(input.orgId, nextRoleIds, 'admin'))) &&
        (await this.userHasSystemRole(user.id, 'admin')) &&
        (await this.db.countActiveUsersWithSystemRole(input.orgId, 'admin')) <=
          1
      ) {
        throw new AuthServiceError(
          409,
          'At least one active system administrator is required',
        )
      }

      await this.db.updateUser(user.id, patch)
      if (input.roleIds !== undefined || typeof input.role === 'string') {
        await this.db.setUserRoleIds(user.id, nextRoleIds)
      }
      const updated =
        (await this.db.getUserByIdAndOrg(user.id, input.orgId)) ?? user
      return {
        user: await this.withRoles(updated),
      }
    })
  }

  async setUserTokenLimit(
    input: {
      orgId: string
      userId: string
      tokenLimit: number | null
    },
    auth?: AuthContext,
  ): Promise<{ ok: true }> {
    const user = await this.db.getUserByIdAndOrg(input.userId, input.orgId)
    if (!user) {
      throw new AuthServiceError(404, 'Unknown user_id')
    }
    await this.assertCanManageExistingUser(user, auth)
    await this.db.setUserTokenLimit(input.userId, input.tokenLimit)
    return { ok: true }
  }

  async setDepartmentTokenLimit(
    input: {
      orgId: string
      departmentId: string
      tokenLimit: number | null
    },
    auth?: AuthContext,
  ): Promise<{ ok: true }> {
    const department = await this.db.getDepartmentByIdAndOrg(
      input.departmentId,
      input.orgId,
    )
    if (!department) {
      throw new AuthServiceError(404, 'Unknown department_id')
    }
    await this.db.setDepartmentTokenLimit(input.departmentId, input.tokenLimit)
    return { ok: true }
  }

  async setUserPassword(
    input: {
      orgId: string
      userId: string
      password: string
    },
    auth?: AuthContext,
  ): Promise<{ ok: true }> {
    return await this.db.transaction(async () => {
      const user = await this.db.getUserByIdAndOrg(input.userId, input.orgId)
      if (!user) {
        throw new AuthServiceError(404, 'Unknown user_id')
      }
      if (!input.password) {
        throw new AuthServiceError(400, 'Missing password')
      }
      await this.assertCanManageExistingUser(user, auth)

      await this.db.updateUserPassword(
        input.userId,
        hashPassword(input.password),
        Date.now(),
      )
      return { ok: true }
    })
  }

  async listApiKeys(
    orgId: string,
    auth?: AuthContext,
  ): Promise<{
    api_keys: Array<Omit<AuthCenterApiKey, 'secretHash'>>
  }> {
    const visibleUserIds = new Set(
      (await this.listVisibleUsers(orgId, auth)).map(user => user.id),
    )
    return {
      api_keys: (await this.db.listApiKeysByOrg(orgId))
        .filter(apiKey => visibleUserIds.has(apiKey.userId))
        .map(apiKey => sanitizeApiKey(apiKey)),
    }
  }

  async createApiKey(
    input: {
      orgId: string
      userId: string
      name: string
      scopes: string[]
    },
    auth?: AuthContext,
  ): Promise<{
    api_key: Omit<AuthCenterApiKey, 'secretHash'>
    plain_text_key: string
  }> {
    const user = await this.db.getUserByIdAndOrg(input.userId, input.orgId)
    if (!user) {
      throw new AuthServiceError(404, 'Unknown user_id')
    }
    await this.assertCanManageExistingUser(user, auth)

    const name = input.name.trim()
    const scopes = input.scopes.map(scope => scope.trim()).filter(Boolean)

    if (!name || scopes.length === 0) {
      throw new AuthServiceError(400, 'Missing name or scopes')
    }
    await this.assertCanManageApiKeyScopes(scopes, auth)

    const created = createApiKeyRecord({
      orgId: input.orgId,
      userId: user.id,
      name,
      scopes,
    })
    await this.db.createApiKey(created.apiKey)
    return {
      api_key: sanitizeApiKey(created.apiKey),
      plain_text_key: created.plainTextKey,
    }
  }

  async revokeApiKey(
    input: {
      orgId: string
      keyId: string
    },
    auth?: AuthContext,
  ): Promise<{ ok: true }> {
    const apiKey = await this.db.getApiKeyById(input.keyId)
    if (!apiKey || apiKey.orgId !== input.orgId) {
      throw new AuthServiceError(404, 'Unknown key_id')
    }
    const user = await this.db.getUserByIdAndOrg(apiKey.userId, input.orgId)
    if (!user) {
      throw new AuthServiceError(404, 'Unknown user_id')
    }
    await this.assertCanManageExistingUser(user, auth)

    await this.db.revokeApiKey(apiKey.id)
    return { ok: true }
  }

  async createDepartment(input: {
    orgId: string
    name: string
    parentId?: string | null
  }): Promise<{
    department: SanitizedAuthCenterDepartment
  }> {
    return await this.db.transaction(async () => {
      const name = input.name.trim()
      const parentId = input.parentId?.trim() || null
      if (!name) {
        throw new AuthServiceError(400, 'Missing department name')
      }

      if (
        parentId &&
        !(await this.db.getDepartmentByIdAndOrg(parentId, input.orgId))
      ) {
        throw new AuthServiceError(400, 'Unknown parent department')
      }

      const existingSibling = await this.findSiblingDepartment(
        input.orgId,
        parentId,
        name,
      )
      if (existingSibling) {
        throw new AuthServiceError(
          409,
          'Department name already exists under the same parent',
        )
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

      await this.db.createDepartment(department)
      return {
        department: {
          ...department,
          userCount: 0,
        },
      }
    })
  }

  async updateDepartment(input: {
    orgId: string
    departmentId: string
    name?: string
    parentId?: string | null
  }): Promise<{
    department: SanitizedAuthCenterDepartment
  }> {
    return await this.db.transaction(async () => {
      const department = await this.db.getDepartmentByIdAndOrg(
        input.departmentId,
        input.orgId,
      )
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
        if (
          parentId &&
          !(await this.db.getDepartmentByIdAndOrg(parentId, input.orgId))
        ) {
          throw new AuthServiceError(400, 'Unknown parent department')
        }
        if (
          parentId &&
          (await this.isDepartmentDescendant(
            input.orgId,
            department.id,
            parentId,
          ))
        ) {
          throw new AuthServiceError(
            400,
            'Department cannot be moved under its descendant',
          )
        }
        patch.parentId = parentId
      }

      const nextName = patch.name ?? department.name
      const nextParentId =
        patch.parentId === undefined ? department.parentId : patch.parentId
      const sibling = await this.findSiblingDepartment(
        input.orgId,
        nextParentId,
        nextName,
      )
      if (sibling && sibling.id !== department.id) {
        throw new AuthServiceError(
          409,
          'Department name already exists under the same parent',
        )
      }

      if (patch.name === undefined && patch.parentId === undefined) {
        throw new AuthServiceError(400, 'Missing department update fields')
      }

      await this.db.updateDepartment(department.id, patch)
      const updatedDepartment =
        (await this.db.getDepartmentByIdAndOrg(department.id, input.orgId)) ??
        department
      return {
        department: {
          ...updatedDepartment,
          userCount: await this.countUsersForDepartment(
            input.orgId,
            updatedDepartment.id,
          ),
        },
      }
    })
  }

  async deleteDepartment(input: {
    orgId: string
    departmentId: string
  }): Promise<{ ok: true }> {
    return await this.db.transaction(async () => {
      const department = await this.db.getDepartmentByIdAndOrg(
        input.departmentId,
        input.orgId,
      )
      if (!department) {
        throw new AuthServiceError(404, 'Unknown department_id')
      }

      const hasChildren = (
        await this.db.listDepartmentsByOrg(input.orgId)
      ).some(item => item.parentId === department.id)
      if (hasChildren) {
        throw new AuthServiceError(409, 'Department has child departments')
      }

      const hasUsers = (await this.db.listUsersByOrg(input.orgId)).some(
        user => user.departmentId === department.id,
      )
      if (hasUsers) {
        throw new AuthServiceError(409, 'Department still has assigned users')
      }

      await this.db.deleteDepartment(department.id)
      return { ok: true }
    })
  }

  requireScope(auth: AuthContext, scope: string): void {
    if (!this.hasEffectiveScope(auth, scope)) {
      throw new AuthServiceError(403, `Missing scope: ${scope}`)
    }
  }

  requireAnyScope(auth: AuthContext, scopes: string[]): void {
    if (!scopes.some(scope => this.hasEffectiveScope(auth, scope))) {
      throw new AuthServiceError(403, `Missing any scope: ${scopes.join(', ')}`)
    }
  }

  private hasEffectiveScope(auth: AuthContext, scope: string): boolean {
    return hasScope(auth.scopes, scope)
  }

  private async issueToken(input: {
    user: AuthCenterUser
    scopes: string[]
    keyId: string
  }): Promise<{
    access_token: string
    token_type: 'Bearer'
    expires_in: number
    user: UserWithRoles
    organization: { id: string; name: string; createdAt: number } | null
    scopes: string[]
  }> {
    const roles = await this.db.listRolesForUser(input.user.id)
    const issued = issueAccessToken(
      {
        iss: await this.db.getIssuer(),
        sub: input.user.id,
        org_id: input.user.orgId,
        role: input.user.role,
        role_ids: roles.map(role => role.id),
        system_roles: roles.flatMap(role =>
          role.systemKey ? [role.systemKey] : [],
        ),
        scopes: input.scopes,
        key_id: input.keyId,
      },
      await this.db.getJwtSecret(),
      this.tokenTtlSec,
    )

    return {
      access_token: issued.token,
      token_type: 'Bearer',
      expires_in: issued.expiresAt - Math.floor(Date.now() / 1000),
      user: await this.withRoles(input.user),
      organization: await this.db.getOrganization(input.user.orgId),
      scopes: input.scopes,
    }
  }

  private async authenticatePasswordUser(input: {
    username?: string
    email?: string
    password: string
  }): Promise<AuthCenterUser> {
    const username = input.username?.trim() || ''
    const email = input.email?.trim().toLowerCase() || ''
    if ((!username && !email) || !input.password) {
      throw new AuthServiceError(400, 'Missing username/email or password')
    }

    const user = username
      ? await this.getUniqueUserByName(username)
      : await this.db.getUserByEmail(email)
    if (
      !user ||
      user.status !== 'active' ||
      !verifyPassword(input.password, user.passwordHash)
    ) {
      throw new AuthServiceError(401, 'Invalid username/email or password')
    }
    return user
  }

  private async getUniqueUserByName(
    name: string,
  ): Promise<AuthCenterUser | null> {
    const users = await this.db.listUsersByName(name)
    if (users.length > 1) {
      throw new AuthServiceError(
        409,
        'Username is not unique; contact admin to resolve the conflict',
      )
    }
    return users[0] ?? null
  }

  private async roleDefinition(role: AuthCenterRole): Promise<RoleDefinition> {
    return {
      ...role,
      permissions: await this.db.listRolePermissions(role.id),
      assignedCount: await this.db.countUsersForRole(role.id),
    }
  }

  private async withRoles(user: AuthCenterUser): Promise<UserWithRoles> {
    const roles = await this.db.listRolesForUser(user.id)
    return {
      ...sanitizeUser(user),
      roleIds: roles.map(role => role.id),
      roles: roles.map(role => ({
        id: role.id,
        systemKey: role.systemKey,
        name: role.name,
        isBuiltin: role.isBuiltin,
      })),
      effectiveScopes: await this.getEffectiveScopes(user.id),
    }
  }

  private async getEffectiveScopes(userId: string): Promise<string[]> {
    const permissions = await flatMapAsync(
      await this.db.listRolesForUser(userId),
      async role => await this.db.listRolePermissions(role.id),
    )
    if (permissions.includes('*')) return ['*']
    try {
      return normalizePermissions(permissions)
    } catch {
      return [...new Set(permissions)]
    }
  }

  private async resolveRoleIds(
    orgId: string,
    inputRoleIds?: string[],
    legacyRole?: string,
  ): Promise<string[]> {
    if (Array.isArray(inputRoleIds)) {
      const roleIds = [
        ...new Set(inputRoleIds.map(value => value.trim()).filter(Boolean)),
      ]
      if (roleIds.length === 0)
        throw new AuthServiceError(400, 'At least one role is required')
      for (const roleId of roleIds) {
        if (!(await this.db.getRoleByIdAndOrg(roleId, orgId))) {
          throw new AuthServiceError(400, `Unknown role_id: ${roleId}`)
        }
      }
      return roleIds
    }
    const key = legacyRole?.trim() || 'user'
    if (!isAuthRole(key))
      throw new AuthServiceError(400, `Unsupported role: ${key}`)
    const role = await this.db.getRoleBySystemKey(orgId, key)
    if (!role)
      throw new AuthServiceError(500, `Built-in role is missing: ${key}`)
    return [role.id]
  }

  private async primaryRoleForRoleIds(
    orgId: string,
    roleIds: string[],
  ): Promise<AuthRole> {
    const roles = (
      await mapAsync(
        roleIds,
        async roleId => await this.db.getRoleByIdAndOrg(roleId, orgId),
      )
    ).filter((role): role is AuthCenterRole => Boolean(role))
    if (roles.some(role => role.systemKey === 'admin')) return 'admin'
    if (roles.some(role => role.systemKey === 'dept_admin')) return 'dept_admin'
    return 'user'
  }

  private async hasSystemRoleIds(
    orgId: string,
    roleIds: string[],
    systemKey: BuiltinRoleKey,
  ): Promise<boolean> {
    return await someAsync(
      roleIds,
      async roleId =>
        (await this.db.getRoleByIdAndOrg(roleId, orgId))?.systemKey ===
        systemKey,
    )
  }

  private async userHasSystemRole(
    userId: string,
    systemKey: BuiltinRoleKey,
  ): Promise<boolean> {
    return (await this.db.listRolesForUser(userId)).some(
      role => role.systemKey === systemKey,
    )
  }

  private async roleIdsRequireDepartment(
    orgId: string,
    roleIds: string[],
  ): Promise<boolean> {
    if (await this.hasSystemRoleIds(orgId, roleIds, 'admin')) return false
    const permissions = await flatMapAsync(
      roleIds,
      async roleId => await this.db.listRolePermissions(roleId),
    )
    return permissions.includes('admin:users')
  }

  private async assertCanAssignRoles(
    auth: AuthContext | undefined,
    roleIds: string[],
  ): Promise<void> {
    if (!auth || auth.systemRoles?.includes('admin') || auth.role === 'admin')
      return
    const regularRole = await this.db.getRoleBySystemKey(auth.orgId, 'user')
    if (!regularRole || roleIds.length !== 1 || roleIds[0] !== regularRole.id) {
      throw new AuthServiceError(
        403,
        'Only system administrators can assign roles',
      )
    }
  }

  private async countUsersForDepartment(
    orgId: string,
    departmentId: string,
  ): Promise<number> {
    return (await this.db.listUsersByOrg(orgId)).filter(
      user => user.departmentId === departmentId,
    ).length
  }

  private async findSiblingDepartment(
    orgId: string,
    parentId: string | null,
    name: string,
  ): Promise<AuthCenterDepartment | null> {
    return (
      (await this.db.listDepartmentsByOrg(orgId)).find(
        department =>
          department.parentId === parentId && department.name === name,
      ) ?? null
    )
  }

  private async isDepartmentDescendant(
    orgId: string,
    departmentId: string,
    candidateParentId: string,
  ): Promise<boolean> {
    const departments = await this.db.listDepartmentsByOrg(orgId)
    const byId = new Map(
      departments.map(department => [department.id, department]),
    )
    let current = byId.get(candidateParentId) ?? null

    while (current) {
      if (current.id === departmentId) {
        return true
      }
      current = current.parentId ? (byId.get(current.parentId) ?? null) : null
    }

    return false
  }

  private async listVisibleUsers(
    orgId: string,
    auth?: AuthContext,
  ): Promise<AuthCenterUser[]> {
    const users = await this.db.listUsersByOrg(orgId)
    if (!auth) {
      return users
    }

    const visibleDepartmentIds = await this.getVisibleDepartmentIds(orgId, auth)
    if (visibleDepartmentIds === null) {
      return users
    }

    return users.filter(
      user =>
        user.departmentId !== null &&
        visibleDepartmentIds.has(user.departmentId),
    )
  }

  private async getVisibleDepartmentIds(
    orgId: string,
    auth?: AuthContext,
  ): Promise<Set<string> | null> {
    if (!auth) {
      return null
    }

    const actor = await this.requireAuthUser(auth)
    if (auth.systemRoles?.includes('admin') || auth.role === 'admin') {
      return null
    }
    if (!hasScope(auth.scopes, 'admin:users') || !actor.departmentId) {
      return new Set<string>()
    }

    const childrenByParent = new Map<string | null, AuthCenterDepartment[]>()
    for (const department of await this.db.listDepartmentsByOrg(orgId)) {
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

  private async requireAuthUser(auth: AuthContext): Promise<AuthCenterUser> {
    const user = await this.db.getUserByIdAndOrg(auth.userId, auth.orgId)
    if (!user || user.status !== 'active') {
      throw new AuthServiceError(
        403,
        'Current user is not allowed to manage users',
      )
    }
    return user
  }

  private async canViewUser(
    user: AuthCenterUser,
    auth?: AuthContext,
  ): Promise<boolean> {
    if (!auth) {
      return true
    }

    const visibleDepartmentIds = await this.getVisibleDepartmentIds(
      user.orgId,
      auth,
    )
    if (visibleDepartmentIds === null) {
      return true
    }

    return (
      user.departmentId !== null && visibleDepartmentIds.has(user.departmentId)
    )
  }

  private async assertCanManageExistingUser(
    user: AuthCenterUser,
    auth?: AuthContext,
  ): Promise<void> {
    if (!(await this.canViewUser(user, auth))) {
      throw new AuthServiceError(403, 'You cannot manage this user')
    }
  }

  private async assertCanManageUserMutation(
    orgId: string,
    input: {
      role: string
      departmentId: string | null
    },
    auth?: AuthContext,
  ): Promise<void> {
    if (!auth) {
      return
    }

    const actor = await this.requireAuthUser(auth)
    if (auth.systemRoles?.includes('admin') || auth.role === 'admin') {
      return
    }

    const visibleDepartmentIds = await this.getVisibleDepartmentIds(orgId, auth)
    if (input.role !== 'user') {
      throw new AuthServiceError(
        403,
        'Department admin can only manage user role accounts',
      )
    }
    if (
      !input.departmentId ||
      visibleDepartmentIds === null ||
      !visibleDepartmentIds.has(input.departmentId)
    ) {
      throw new AuthServiceError(
        403,
        'Target department is outside your managed scope',
      )
    }
  }

  private async assertCanManageApiKeyScopes(
    scopes: string[],
    auth?: AuthContext,
  ): Promise<void> {
    if (!auth) {
      return
    }

    const actor = await this.requireAuthUser(auth)
    if (auth.systemRoles?.includes('admin') || auth.role === 'admin') {
      return
    }

    const regularTemplate = BUILTIN_ROLE_TEMPLATES.find(
      role => role.key === 'user',
    )
    const allowedScopes = new Set(regularTemplate?.permissions ?? [])
    if (!scopes.every(scope => allowedScopes.has(scope))) {
      throw new AuthServiceError(
        403,
        'Department admin can only issue user-scoped API keys',
      )
    }
  }
}
