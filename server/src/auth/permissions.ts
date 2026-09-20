export type PermissionDefinition = {
  code: string
  name: string
  description: string
  group: 'session' | 'communication' | 'agent-mail' | 'administration' | 'ragflow'
  protected?: boolean
}

export type BuiltinRoleKey = 'admin' | 'dept_admin' | 'user'

export type BuiltinRoleTemplate = {
  key: BuiltinRoleKey
  name: string
  description: string
  permissions: string[]
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  { code: 'sessions:create', name: '创建会话', description: '创建新的 Agent 会话。', group: 'session' },
  { code: 'sessions:attach', name: '接入会话', description: '连接并继续自己的 Agent 会话。', group: 'session' },
  { code: 'sessions:list', name: '查看自己的会话', description: '查看本人创建的会话。', group: 'session' },
  { code: 'sessions:list:any', name: '查看所有会话', description: '查看组织内所有用户的会话。', group: 'session' },
  { code: 'sessions:attach:any', name: '接入任意会话', description: '接入组织内任意用户的会话。', group: 'session' },
  { code: 'im:use', name: '使用即时消息', description: '登录即时消息并收发消息。', group: 'communication' },
  { code: 'directory:read', name: '查看组织通讯录', description: '查看当前组织的部门和启用用户。', group: 'communication' },
  { code: 'im:group:create', name: '创建群聊', description: '从组织通讯录选择成员创建群聊。', group: 'communication' },
  { code: 'agent-mail:send', name: '发送 Agent Mail', description: '通过 Agent Mail 发送消息。', group: 'agent-mail' },
  { code: 'agent-mail:receive', name: '接收 Agent Mail', description: '接收和管理 Agent Mail 消息。', group: 'agent-mail' },
  { code: 'apps:read', name: '查看 App', description: '查看当前归属范围的 App、实例和运行状态。', group: 'administration' },
  { code: 'apps:manage', name: '管理 App', description: '安装、启停、配置和卸载当前归属范围的 App。', group: 'administration' },
  { code: 'apps:deploy', name: '运行 App', description: '调用 App Action 并管理其运行实例。', group: 'administration' },
  { code: 'apps:logs', name: '查看 App 日志', description: '查看当前归属范围的 App 实例日志。', group: 'administration' },
  { code: 'admin:users', name: '管理用户与部门', description: '管理权限范围内的用户和部门。', group: 'administration' },
  { code: 'admin:api_keys', name: '管理 API Keys', description: '创建和撤销 Moss API Key。', group: 'administration' },
  { code: 'admin:roles', name: '管理角色与授权', description: '创建角色、配置权限并为用户分配角色。', group: 'administration', protected: true },
  { code: 'admin:settings', name: '管理系统设置', description: '修改组织的系统设置。', group: 'administration' },
  { code: 'ragflow:read', name: '读取个人知识库', description: '查询和检索本人的 RAGFlow 知识库。', group: 'ragflow' },
  { code: 'ragflow:manage', name: '管理个人知识库', description: '创建、上传、解析、编辑和删除本人的知识库内容。', group: 'ragflow' },
  { code: 'ragflow:credentials', name: '查看和轮换知识库凭据', description: '查看或轮换用户的 RAGFlow 登录账号、密码和 API Key。', group: 'ragflow' },
]

export const BUILTIN_ROLE_TEMPLATES: BuiltinRoleTemplate[] = [
  {
    key: 'admin',
    name: '系统管理员',
    description: '管理整个组织、角色、用户、会话、系统设置和个人知识库凭据。',
    permissions: ['*'],
  },
  {
    key: 'dept_admin',
    name: '部门管理员',
    description: '管理所属部门及子部门的用户，并管理自己的个人知识库。',
    permissions: [
      'sessions:create',
      'sessions:attach',
      'sessions:list',
      'im:use',
      'directory:read',
      'im:group:create',
      'agent-mail:send',
      'agent-mail:receive',
      'admin:users',
      'admin:api_keys',
      'ragflow:read',
      'ragflow:manage',
    ],
  },
  {
    key: 'user',
    name: '普通用户',
    description: '使用基础会话、Agent Mail，并读取自己的个人知识库。',
    permissions: [
      'sessions:create',
      'sessions:attach',
      'sessions:list',
      'im:use',
      'directory:read',
      'im:group:create',
      'agent-mail:send',
      'agent-mail:receive',
      'ragflow:read',
    ],
  },
]

const KNOWN_PERMISSION_CODES = new Set(PERMISSION_DEFINITIONS.map(item => item.code))

export function normalizePermissions(values: string[], options: { allowWildcard?: boolean } = {}): string[] {
  const result = new Set<string>()
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    if (value === '*' && options.allowWildcard) {
      result.add(value)
      continue
    }
    if (!KNOWN_PERMISSION_CODES.has(value)) {
      throw new Error(`Unknown permission: ${value}`)
    }
    result.add(value)
  }
  if (result.has('ragflow:manage')) result.add('ragflow:read')
  return [...result]
}

export function permissionCatalog(): PermissionDefinition[] {
  return PERMISSION_DEFINITIONS.map(item => ({ ...item }))
}
