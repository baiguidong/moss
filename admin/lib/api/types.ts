// Moss auth/admin types
export type UserRole = 'admin' | 'dept_admin' | 'user'

export interface UserRoleSummary {
  id: string
  systemKey: UserRole | null
  name: string
  isBuiltin: boolean
}

export interface AuthUser {
  id: string
  orgId: string
  email: string | null
  name: string
  departmentId: string | null
  role: UserRole
  roleIds: string[]
  roles: UserRoleSummary[]
  effectiveScopes: string[]
  status: 'active' | 'disabled'
  tokenLimit: number | null
  createdAt: number
  passwordUpdatedAt: number | null
  lastLoginAt: number | null
}

export interface AuthOrg {
  id: string
  name: string
  createdAt: number
}

export interface AuthDepartment {
  id: string
  orgId: string
  parentId: string | null
  name: string
  tokenLimit: number | null
  createdAt: number
  updatedAt: number
  userCount: number
}

export interface RoleDefinition {
  id: string
  orgId: string
  systemKey: UserRole | null
  name: string
  description: string
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
  permissions: string[]
  assignedCount: number
}

export interface PermissionDefinition {
  code: string
  name: string
  description: string
  group: 'session' | 'communication' | 'agent-mail' | 'administration' | 'ragflow'
  protected?: boolean
}

export interface LoginRequest {
  grant_type: 'password' | 'api_key'
  username?: string
  email?: string
  password?: string
  api_key?: string
}

export interface LoginResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  user: AuthUser
  organization: AuthOrg | null
  scopes: string[]
}

export interface MeResponse {
  user: AuthUser | null
  organization: AuthOrg | null
  scopes: string[]
  role: string
  key_id: string
}

export interface UsersListResponse {
  users: AuthUser[]
}

export interface CreateUserRequest {
  email?: string
  name: string
  department_id?: string | null
  role_ids: string[]
  password: string
}

export interface CreateUserResponse {
  user: AuthUser
}

export interface UpdateUserRequest {
  name?: string
  department_id?: string | null
  role_ids?: string[]
  status?: 'active' | 'disabled'
}

export interface DepartmentsListResponse {
  departments: AuthDepartment[]
}

export interface CreateDepartmentRequest {
  name: string
  parent_id?: string | null
}

export interface UpdateDepartmentRequest {
  name?: string
  parent_id?: string | null
}

export interface DepartmentResponse {
  department: AuthDepartment
}

export interface RolesListResponse {
  roles: RoleDefinition[]
}

export interface PermissionsListResponse {
  permissions: PermissionDefinition[]
}

export interface RoleResponse {
  role: RoleDefinition
}

export interface UpsertRoleRequest {
  name?: string
  description?: string
  permissions?: string[]
}

export interface ApiKey {
  id: string
  orgId: string
  userId: string
  name: string
  prefix: string
  scopes: string[]
  status: 'active' | 'revoked'
  createdAt: number
  lastUsedAt: number | null
}

export interface ApiKeysListResponse {
  api_keys: ApiKey[]
}

export interface CreateApiKeyRequest {
  user_id: string
  name: string
  scopes: string[]
}

export interface CreateApiKeyResponse {
  api_key: ApiKey
  plain_text_key: string
}

export interface RagflowAccountStatus {
  enabled: boolean
  instance_id: string
  user_id: string
  provisioned: boolean
  ragflow_username: string | null
  ragflow_user_id: string | null
  password_ready: boolean
  api_key_ready: boolean
  updated_at: number | null
}

export interface RagflowIntegrationStatus {
  enabled: boolean
  instance_id: string
  base_url: string | null
  admin_url: string | null
  user_domain: string
  reachable: boolean
}

export interface RagflowCredentials {
  username: string
  password: string
  api_key: string
}

export type ThinkingMode = 'adaptive' | 'enabled' | 'disabled'

export interface SystemSettingsImage {
  provider: string
  url: string
  apiKey: string
  model: string
}

export interface SystemSettingsServerRuntime {
  dockerImage: string
}

export interface SystemSettings {
  bypassPermissions: boolean
  model: string
  fastModel: string
  maxTurns: number
  thinkingMode: ThinkingMode
  thinkingBudgetTokens: number
  url: string
  apiKey: string
  image: SystemSettingsImage
  serverRuntime: SystemSettingsServerRuntime
  settingsPath: string
  settingsExists: boolean
  settingsLoaded: boolean
  settingsParseError: string
}

export interface UpdateSystemSettingsRequest {
  bypassPermissions?: boolean
  models?: {
    text?: {
      baseUrl?: string
      apiKey?: string
      model?: string
      fastModel?: string
      maxTurns?: number
      thinking?: {
        mode?: ThinkingMode
        budgetTokens?: number
      }
    }
    image?: {
      provider?: string
      baseUrl?: string
      apiKey?: string
      model?: string
    }
  }
  serverRuntime?: Partial<SystemSettingsServerRuntime>
}

// Direct Connect Server Types
export type SessionStatus =
  | 'creating'
  | 'active'
  | 'detached'
  | 'ended'
  | 'terminated'
  | 'failed'
  | 'lost'

export type DesiredState = 'active' | 'ended' | 'terminated'

export interface SessionRuntime {
  backend: 'docker'
  dockerImage?: string
  containerName?: string
  profileDir: string
  transcriptDir: string
  workspaceDir?: string
}

export interface Session {
  sessionId: string
  transcriptSessionId: string
  workDir?: string
  cwd?: string
  userId: string
  orgId: string
  role: string
  scopes: string[]
  runtime: SessionRuntime
  status: SessionStatus
  desiredState: DesiredState
  assistantName?: string | null
  createdAt: number
  lastActiveAt: number
  endedAt: number | null
}

export interface SessionsListResponse {
  sessions: Session[]
}

export interface GetSessionResponse {
  session: Session
  ws_url?: string
}

export interface TextContentBlock {
  type: 'text'
  text: string
}

export interface ToolUseContentBlock {
  type: 'tool_use'
  id?: string
  name?: string
  input?: Record<string, unknown>
}

export interface ToolResultContentBlock {
  type: 'tool_result'
  tool_use_id?: string
  content?: string | unknown[]
  is_error?: boolean
}

export interface ThinkingContentBlock {
  type: 'thinking' | 'redacted_thinking'
  thinking?: string
}

export type ContentBlock =
  | TextContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock
  | ThinkingContentBlock
  | Record<string, unknown>

export interface SessionMessage {
  type?: string
  role?: string
  content?: string | ContentBlock[] | unknown
  message?: {
    role?: string
    content?: string | ContentBlock[] | unknown
    [key: string]: unknown
  }
  timestamp?: string
  uuid?: string
  tool_use_id?: string
  tool_name?: string
  input?: Record<string, unknown>
  is_error?: boolean
  [key: string]: unknown
}

export interface SessionContext {
  customTitle?: string
  tag?: string
  summary?: string
  mode?: string
  messages: SessionMessage[]
  transcript?: {
    lineCount: number
    parseErrorCount: number
    missing?: boolean
  }
}

export interface GetSessionContextResponse {
  session: Session
  context: SessionContext
}

export interface UserSessionsResponse {
  user: AuthUser
  sessions: Session[]
}

// Health Check
export interface HealthResponse {
  ok: boolean
  sessions: number
  auth_mode: string
}
