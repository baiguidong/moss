// Moss auth/admin types
export interface AuthUser {
  id: string
  orgId: string
  email: string
  name: string
  role: 'admin' | 'viewer' | 'member'
  status: 'active' | 'disabled'
  createdAt: number
  passwordUpdatedAt?: number
  lastLoginAt: number | null
}

export interface AuthOrg {
  id: string
  name: string
  createdAt: number
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
  organization: AuthOrg
  scopes: string[]
}

export interface MeResponse {
  user: AuthUser
  organization: AuthOrg
  scopes: string[]
  role: string
  key_id: string
}

export interface UsersListResponse {
  users: AuthUser[]
}

export interface CreateUserRequest {
  email: string
  name: string
  role: 'admin' | 'viewer' | 'member'
  password: string
}

export interface CreateUserResponse {
  user: AuthUser
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
  type: 'host' | 'docker'
  dockerImage?: string
  dockerMode?: 'session' | 'user'
  containerName?: string
  configDir?: string
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

export interface SessionUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  totalTokens: number
  costUSD: number
  webSearchRequests: number
  assistantMessageCount: number
  filesRead: number
  truncatedFiles: string[]
  includesSubagents: boolean
  subagentTranscriptCount: number
  modelUsage: Record<string, number>
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
  tokens?: number
}

export interface SessionContext {
  customTitle?: string
  tag?: string
  summary?: string
  messages: SessionMessage[]
}

export interface GetSessionContextResponse {
  session: Session
  usage: SessionUsage
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
