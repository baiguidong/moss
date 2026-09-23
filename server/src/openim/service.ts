import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  AuthService,
  AuthServiceError,
  type UserWithRoles,
} from '../auth/service.js'
import { hasScope, type AuthContext } from '../auth/token.js'
import { mapAsync, someAsync } from '../model/async.js'
import { OpenIMRepository } from '../model/repositories/openIM.js'
import type { SystemSettingsOpenIM } from '../systemSettings.js'

type SqlRow = Record<string, unknown>

type OpenIMBinding = {
  id: string
  orgId: string
  userId: string
  instanceId: string
  openimUserId: string
  profileHash: string
  provisionedAt: number | null
  updatedAt: number
}

type OpenIMResponse<T> = {
  errCode?: number
  errMsg?: string
  errDlt?: string
  data?: T
}

type DirectoryUser = {
  id: string
  name: string
  email: string | null
  departmentId: string | null
  status: 'active' | 'disabled'
  openimUserID: string
}

type DirectoryDepartment = {
  id: string
  name: string
  parentId: string | null
  userCount: number
}

type DirectoryInput = {
  cursor?: string
  limit?: number
}

type OpenIMWebhookResponse = {
  actionCode: number
  errCode: number
  errMsg: string
  errDlt: string
  nextCode: number
  groupID?: string
}

const DEFAULT_OPENIM_CONFIG: SystemSettingsOpenIM = {
  enabled: false,
  instanceId: 'default',
  apiUrl: '',
  wsUrl: '',
  chatUrl: '',
  adminUserId: 'imAdmin',
  secret: '',
  webhookSecret: '',
  requestTimeoutMs: 15_000,
}

function mapBinding(row: SqlRow): OpenIMBinding {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    userId: String(row.user_id),
    instanceId: String(row.instance_id),
    openimUserId: String(row.openim_user_id),
    profileHash: String(row.profile_hash || ''),
    provisionedAt:
      row.provisioned_at == null ? null : Number(row.provisioned_at),
    updatedAt: Number(row.updated_at),
  }
}

function openIMUserID(
  instanceId: string,
  orgId: string,
  userId: string,
): string {
  const digest = createHash('sha256')
    .update(`${instanceId}\0${orgId}\0${userId}`)
    .digest('hex')
    .slice(0, 32)
  return `moss_${digest}`
}

function profileHash(user: Pick<UserWithRoles, 'name' | 'email'>): string {
  return createHash('sha256')
    .update(`${user.name}\0${user.email || ''}`)
    .digest('hex')
}

function directoryOffset(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const match = /^offset:(\d+)$/.exec(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    )
    const offset = Number(match?.[1])
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error('invalid cursor')
    return offset
  } catch {
    throw new AuthServiceError(400, 'Invalid OpenIM directory cursor')
  }
}

export class OpenIMIntegrationService {
  private config: SystemSettingsOpenIM
  private adminToken: { value: string; expiresAt: number } | null = null
  private readonly pending = new Map<string, Promise<OpenIMBinding>>()

  constructor(
    private readonly input: {
      repository: OpenIMRepository
      config?: SystemSettingsOpenIM
      authService: AuthService
    },
  ) {
    this.config = input.config ?? DEFAULT_OPENIM_CONFIG
  }

  updateConfig(config: SystemSettingsOpenIM): void {
    this.config = config ?? DEFAULT_OPENIM_CONFIG
    this.adminToken = null
  }

  get enabled(): boolean {
    return Boolean(
      this.config.enabled &&
      this.config.apiUrl &&
      this.config.wsUrl &&
      this.config.secret,
    )
  }

  private assertEnabled(): void {
    if (this.enabled) return
    throw new AuthServiceError(
      503,
      '即时消息服务尚未配置，请联系管理员配置 Moss Server 的 OpenIM 连接。',
    )
  }

  private requireScope(auth: AuthContext, scope: string): void {
    if (!hasScope(auth.scopes, scope)) {
      throw new AuthServiceError(403, `Missing required scope: ${scope}`)
    }
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
    token?: string,
  ): Promise<T> {
    this.assertEnabled()
    let response: Response
    try {
      response = await fetch(`${this.config.apiUrl}${path}`, {
        method: 'POST',
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        headers: {
          'content-type': 'application/json; charset=utf-8',
          operationID: randomUUID(),
          ...(token ? { token } : {}),
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new AuthServiceError(
        502,
        `无法连接 OpenIM：${error instanceof Error ? error.message : String(error)}`,
      )
    }

    let payload: OpenIMResponse<T>
    try {
      payload = (await response.json()) as OpenIMResponse<T>
    } catch {
      throw new AuthServiceError(
        502,
        `OpenIM 返回了无效响应 (${response.status})`,
      )
    }
    if (!response.ok || payload.errCode !== 0) {
      const detail =
        payload.errDlt ||
        payload.errMsg ||
        `${response.status} ${response.statusText}`
      throw new AuthServiceError(502, `OpenIM 请求失败：${detail}`)
    }
    return payload.data as T
  }

  private async getAdminToken(force = false): Promise<string> {
    if (
      !force &&
      this.adminToken &&
      this.adminToken.expiresAt > Date.now() + 60_000
    ) {
      return this.adminToken.value
    }
    const data = await this.post<{
      token?: string
      expireTimeSeconds?: number
    }>('/auth/get_admin_token', {
      secret: this.config.secret,
      userID: this.config.adminUserId,
    })
    const token = data?.token?.trim() || ''
    if (!token) throw new AuthServiceError(502, 'OpenIM 未返回管理员 token')
    const expiresIn = Math.max(60, Number(data.expireTimeSeconds) || 3600)
    this.adminToken = { value: token, expiresAt: Date.now() + expiresIn * 1000 }
    return token
  }

  private async adminPost<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await this.post<T>(path, body, await this.getAdminToken())
    } catch (error) {
      if (!(error instanceof AuthServiceError) || !/token/i.test(error.message))
        throw error
      this.adminToken = null
      return await this.post<T>(path, body, await this.getAdminToken(true))
    }
  }

  private async getBinding(
    orgId: string,
    userId: string,
  ): Promise<OpenIMBinding | null> {
    const row = (await this.input.repository.getBinding(
      orgId,
      userId,
      this.config.instanceId,
    )) as SqlRow | undefined
    return row ? mapBinding(row) : null
  }

  private async getBindingByOpenIMUserId(
    openimUserId: string,
  ): Promise<OpenIMBinding | null> {
    const row = (await this.input.repository.getBindingByOpenIMUserId(
      this.config.instanceId,
      openimUserId,
    )) as SqlRow | undefined
    return row ? mapBinding(row) : null
  }

  private async ensureBinding(user: UserWithRoles): Promise<OpenIMBinding> {
    const existing = await this.getBinding(user.orgId, user.id)
    if (existing) return existing
    const timestamp = Date.now()
    const binding: OpenIMBinding = {
      id: randomUUID(),
      orgId: user.orgId,
      userId: user.id,
      instanceId: this.config.instanceId,
      openimUserId: openIMUserID(this.config.instanceId, user.orgId, user.id),
      profileHash: '',
      provisionedAt: null,
      updatedAt: timestamp,
    }
    await this.input.repository.ensureBinding(
      binding.id,
      binding.orgId,
      binding.userId,
      binding.instanceId,
      binding.openimUserId,
      binding.profileHash,
      binding.provisionedAt,
      timestamp,
      timestamp,
    )
    const persisted = await this.getBinding(user.orgId, user.id)
    if (!persisted) throw new AuthServiceError(500, '无法保存 OpenIM 用户绑定')
    return persisted
  }

  private async user(orgId: string, userId: string): Promise<UserWithRoles> {
    const user = await this.input.authService.getUserOrNull(userId, orgId)
    if (!user) throw new AuthServiceError(404, '用户不存在')
    if (user.status !== 'active') throw new AuthServiceError(403, '用户已停用')
    return user
  }

  private async provision(user: UserWithRoles): Promise<OpenIMBinding> {
    const binding = await this.ensureBinding(user)
    const nextProfileHash = profileHash(user)

    const checked = await this.adminPost<{
      results?: Array<{ userID?: string; accountStatus?: number }>
    }>('/user/account_check', { checkUserIDs: [binding.openimUserId] })
    const registered = checked?.results?.some(
      result =>
        result.userID === binding.openimUserId && result.accountStatus === 1,
    )
    const userInfo = {
      userID: binding.openimUserId,
      nickname: user.name,
      faceURL: '',
      ex: JSON.stringify({ mossOrgId: user.orgId, mossUserId: user.id }),
    }
    if (
      registered &&
      binding.provisionedAt &&
      binding.profileHash === nextProfileHash
    ) {
      return binding
    }
    if (registered) {
      await this.adminPost('/user/update_user_info', { userInfo })
    } else {
      try {
        await this.adminPost('/user/user_register', { users: [userInfo] })
      } catch (error) {
        const retried = await this.adminPost<{
          results?: Array<{ userID?: string; accountStatus?: number }>
        }>('/user/account_check', { checkUserIDs: [binding.openimUserId] })
        const registeredByPeer = retried?.results?.some(
          result =>
            result.userID === binding.openimUserId &&
            result.accountStatus === 1,
        )
        if (!registeredByPeer) throw error
        await this.adminPost('/user/update_user_info', { userInfo })
      }
    }

    const timestamp = Date.now()
    await this.input.repository.provision(
      nextProfileHash,
      timestamp,
      timestamp,
      binding.id,
    )
    return {
      ...binding,
      profileHash: nextProfileHash,
      provisionedAt: timestamp,
      updatedAt: timestamp,
    }
  }

  private async ensureUser(
    orgId: string,
    userId: string,
  ): Promise<OpenIMBinding> {
    const key = `${orgId}:${userId}`
    const current = this.pending.get(key)
    if (current) return current
    const operation = this.provision(await this.user(orgId, userId)).finally(
      () => this.pending.delete(key),
    )
    this.pending.set(key, operation)
    return operation
  }

  private async activeUserForBinding(
    binding: OpenIMBinding,
  ): Promise<UserWithRoles | null> {
    const user = await this.input.authService.getUserOrNull(
      binding.userId,
      binding.orgId,
    )
    return user?.status === 'active' ? user : null
  }

  private async getGroupOrg(openimGroupId: string): Promise<string | null> {
    const row = (await this.input.repository.getGroupOrg(
      this.config.instanceId,
      openimGroupId,
    )) as SqlRow | undefined
    return row ? String(row.org_id) : null
  }

  private async bindGroup(
    openimGroupId: string,
    binding: OpenIMBinding,
  ): Promise<void> {
    const timestamp = Date.now()
    await this.input.repository.bindGroup(
      randomUUID(),
      binding.orgId,
      this.config.instanceId,
      openimGroupId,
      binding.userId,
      timestamp,
      timestamp,
    )
  }

  private webhookAllowed(
    extra: Partial<OpenIMWebhookResponse> = {},
  ): OpenIMWebhookResponse {
    return {
      actionCode: 0,
      errCode: 0,
      errMsg: '',
      errDlt: '',
      nextCode: 0,
      ...extra,
    }
  }

  private webhookRejected(message: string): OpenIMWebhookResponse {
    return {
      actionCode: 0,
      errCode: 403,
      errMsg: 'Moss authorization rejected the operation',
      errDlt: message,
      nextCode: 1,
    }
  }

  webhookEnabled(): boolean {
    return Boolean(this.enabled && this.config.webhookSecret)
  }

  matchesWebhookSecret(candidate: string): boolean {
    const expected = this.config.webhookSecret || ''
    if (!expected || !candidate) return false
    const expectedHash = createHash('sha256').update(expected).digest()
    const candidateHash = createHash('sha256').update(candidate).digest()
    return timingSafeEqual(expectedHash, candidateHash)
  }

  async handleWebhook(
    command: string,
    payload: Record<string, unknown>,
  ): Promise<OpenIMWebhookResponse> {
    const text = (value: unknown) =>
      typeof value === 'string' ? value.trim() : ''
    const bindingFor = async (value: unknown) => {
      const userID = text(value)
      return userID ? await this.getBindingByOpenIMUserId(userID) : null
    }
    const validateUser = async (
      binding: OpenIMBinding | null,
      scope = 'im:use',
    ) => {
      if (!binding) return false
      const user = await this.activeUserForBinding(binding)
      return Boolean(user && hasScope(user.effectiveScopes, scope))
    }
    const sameOrganization = (bindings: OpenIMBinding[]) =>
      bindings.length > 0 &&
      bindings.every(binding => binding.orgId === bindings[0]?.orgId)

    if (command === 'callbackBeforeSendSingleMsgCommand') {
      const sendID = text(payload.sendID)
      if (sendID === this.config.adminUserId) return this.webhookAllowed()
      const sender = await bindingFor(sendID)
      const receiver = await bindingFor(payload.recvID)
      if (!sender && !receiver) return this.webhookAllowed()
      if (
        !(await validateUser(sender)) ||
        !(await validateUser(receiver)) ||
        sender?.orgId !== receiver?.orgId
      ) {
        return this.webhookRejected('只能向当前 Moss 组织中的启用用户发送消息')
      }
      return this.webhookAllowed()
    }

    if (command === 'callbackBeforeCreateGroupCommand') {
      const initMembers = Array.isArray(payload.initMemberList)
        ? payload.initMemberList
        : []
      const memberIDs = initMembers
        .map(item => text((item as Record<string, unknown>)?.userID))
        .filter(Boolean)
      const actorID =
        text(payload.ownerUserID) ||
        text(payload.creatorUserID) ||
        memberIDs[0] ||
        ''
      const bindings = await mapAsync(
        [...new Set([actorID, ...memberIDs])],
        async userID => await this.getBindingByOpenIMUserId(userID),
      )
      if (bindings.every(binding => !binding)) return this.webhookAllowed()
      if (
        bindings.some(binding => !binding) ||
        !sameOrganization(bindings as OpenIMBinding[])
      ) {
        return this.webhookRejected('群聊成员必须全部属于同一个 Moss 组织')
      }
      const actor = await this.getBindingByOpenIMUserId(actorID)
      if (!(await validateUser(actor, 'im:group:create'))) {
        return this.webhookRejected('当前用户没有创建群聊权限')
      }
      const typedBindings = bindings as OpenIMBinding[]
      if (
        await someAsync(
          typedBindings,
          async binding => !(await validateUser(binding)),
        )
      ) {
        return this.webhookRejected('群聊成员包含已停用或无即时消息权限的用户')
      }
      const groupID =
        text(payload.groupID) || `moss_${randomUUID().replaceAll('-', '')}`
      await this.bindGroup(groupID, actor!)
      return this.webhookAllowed({ groupID })
    }

    if (command === 'callbackBeforeSendGroupMsgCommand') {
      const sendID = text(payload.sendID)
      if (sendID === this.config.adminUserId) return this.webhookAllowed()
      const sender = await bindingFor(sendID)
      const groupOrg = await this.getGroupOrg(text(payload.groupID))
      if (!sender && !groupOrg) return this.webhookAllowed()
      if (
        !(await validateUser(sender)) ||
        !groupOrg ||
        sender?.orgId !== groupOrg
      ) {
        return this.webhookRejected('不能向其他 Moss 组织的群聊发送消息')
      }
      return this.webhookAllowed()
    }

    if (command === 'callbackBeforeInviteJoinGroupCommand') {
      const groupOrg = await this.getGroupOrg(text(payload.groupID))
      const invitedIDs = Array.isArray(payload.invitedUserIDs)
        ? payload.invitedUserIDs
        : []
      const bindings = await mapAsync(invitedIDs, bindingFor)
      if (!groupOrg && bindings.every(binding => !binding))
        return this.webhookAllowed()
      if (
        !groupOrg ||
        (await someAsync(
          bindings,
          async binding =>
            !(await validateUser(binding)) || binding?.orgId !== groupOrg,
        ))
      ) {
        return this.webhookRejected('只能邀请当前 Moss 组织中的启用用户')
      }
      return this.webhookAllowed()
    }

    if (command === 'callbackBeforeMembersJoinGroupCommand') {
      const groupOrg = await this.getGroupOrg(text(payload.groupID))
      const members = Array.isArray(payload.memberList)
        ? payload.memberList
        : []
      const bindings = await mapAsync(
        members,
        async item =>
          await bindingFor((item as Record<string, unknown>)?.userID),
      )
      if (!groupOrg && bindings.every(binding => !binding))
        return this.webhookAllowed()
      if (
        !groupOrg ||
        (await someAsync(
          bindings,
          async binding =>
            !(await validateUser(binding)) || binding?.orgId !== groupOrg,
        ))
      ) {
        return this.webhookRejected('群成员必须属于当前 Moss 组织')
      }
      return this.webhookAllowed()
    }

    if (command === 'callbackBeforeJoinGroupCommand') {
      const groupOrg = await this.getGroupOrg(text(payload.groupID))
      const applicant = await bindingFor(payload.applyID)
      if (!groupOrg && !applicant) return this.webhookAllowed()
      if (
        !groupOrg ||
        !(await validateUser(applicant)) ||
        applicant?.orgId !== groupOrg
      ) {
        return this.webhookRejected('不能加入其他 Moss 组织的群聊')
      }
      return this.webhookAllowed()
    }

    return this.webhookAllowed()
  }

  async createSession(
    auth: AuthContext,
    platformID: number,
  ): Promise<{
    available: true
    userID: string
    imToken: string
    expiresIn: number
    apiAddr: string
    wsAddr: string
    rtcEnabled: boolean
    capabilities: { createGroup: boolean }
    user: { id: string; name: string; email: string | null; orgId: string }
  }> {
    this.requireScope(auth, 'im:use')
    const user = await this.user(auth.orgId, auth.userId)
    const binding = await this.ensureUser(auth.orgId, auth.userId)
    const token = await this.adminPost<{
      token?: string
      expireTimeSeconds?: number
    }>('/auth/get_user_token', { platformID, userID: binding.openimUserId })
    const imToken = token?.token?.trim() || ''
    if (!imToken) throw new AuthServiceError(502, 'OpenIM 未返回用户 token')
    return {
      available: true,
      userID: binding.openimUserId,
      imToken,
      expiresIn: Math.max(60, Number(token.expireTimeSeconds) || 3600),
      apiAddr: this.config.apiUrl!,
      wsAddr: this.config.wsUrl!,
      rtcEnabled: false,
      capabilities: {
        createGroup: hasScope(user.effectiveScopes, 'im:group:create'),
      },
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        orgId: user.orgId,
      },
    }
  }

  async listDirectory(
    auth: AuthContext,
    input: DirectoryInput = {},
  ): Promise<{
    departments: DirectoryDepartment[]
    users: DirectoryUser[]
    nextCursor: string | null
    revision: string
  }> {
    this.requireScope(auth, 'directory:read')
    const directory = await this.input.authService.listDirectory(auth.orgId)
    const limit = Math.min(200, Math.max(1, Number(input.limit) || 200))
    const offset = directoryOffset(input.cursor)
    const users = directory.users.slice(offset, offset + limit)
    return {
      departments: directory.departments.map(department => ({
        id: department.id,
        name: department.name,
        parentId: department.parentId || null,
        userCount: department.userCount,
      })),
      users: users.map(user => ({
        ...user,
        openimUserID: openIMUserID(this.config.instanceId, auth.orgId, user.id),
      })),
      nextCursor:
        offset + users.length < directory.users.length
          ? Buffer.from(`offset:${offset + users.length}`, 'utf8').toString(
              'base64url',
            )
          : null,
      revision: createHash('sha256')
        .update(JSON.stringify(directory))
        .digest('hex')
        .slice(0, 24),
    }
  }

  async prepareDirectConversation(
    auth: AuthContext,
    targetUserId: string,
  ): Promise<{
    userID: string
    name: string
    email: string | null
  }> {
    this.requireScope(auth, 'im:use')
    const target = await this.user(auth.orgId, targetUserId)
    if (target.id === auth.userId)
      throw new AuthServiceError(400, '不能与自己创建会话')
    const binding = await this.ensureUser(auth.orgId, target.id)
    return {
      userID: binding.openimUserId,
      name: target.name,
      email: target.email,
    }
  }

  async prepareGroupConversation(
    auth: AuthContext,
    targetUserIds: string[],
  ): Promise<{
    groupID: string
    memberUserIDs: string[]
  }> {
    this.requireScope(auth, 'im:use')
    this.requireScope(auth, 'im:group:create')
    const uniqueUserIds = [
      ...new Set(targetUserIds.map(value => value.trim()).filter(Boolean)),
    ]
    if (uniqueUserIds.length < 2)
      throw new AuthServiceError(400, '创建群聊至少选择两名成员')
    if (uniqueUserIds.includes(auth.userId))
      throw new AuthServiceError(400, '无需重复选择自己')
    const bindings = await Promise.all(
      uniqueUserIds.map(async userId => {
        const target = await this.user(auth.orgId, userId)
        return await this.ensureUser(auth.orgId, target.id)
      }),
    )
    const ownerBinding = await this.ensureUser(auth.orgId, auth.userId)
    const groupID = `moss_${randomUUID().replaceAll('-', '')}`
    await this.bindGroup(groupID, ownerBinding)
    return {
      groupID,
      memberUserIDs: bindings.map(binding => binding.openimUserId),
    }
  }

  async syncUser(user: UserWithRoles): Promise<void> {
    if (!this.enabled) return
    if (user.status === 'active') {
      await this.ensureUser(user.orgId, user.id)
      return
    }
    const binding = await this.getBinding(user.orgId, user.id)
    if (!binding?.provisionedAt) return
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5, 6, 7, 8].map(
        async platformID =>
          await this.adminPost('/auth/force_logout', {
            platformID,
            userID: binding.openimUserId,
          }),
      ),
    )
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length) {
      throw new AuthServiceError(
        502,
        `OpenIM 会话撤销失败 (${failures.length}/8)，请重试停用操作`,
      )
    }
  }

  async health(auth: AuthContext): Promise<{
    enabled: boolean
    connected: boolean
    instanceId: string
    rtcEnabled: boolean
  }> {
    this.requireScope(auth, 'im:use')
    if (!this.enabled) {
      return {
        enabled: false,
        connected: false,
        instanceId: this.config.instanceId,
        rtcEnabled: false,
      }
    }
    await this.getAdminToken()
    return {
      enabled: true,
      connected: true,
      instanceId: this.config.instanceId,
      rtcEnabled: false,
    }
  }
}
