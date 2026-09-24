import { authClient, setToken, getToken, removeToken } from './client'
import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  UsersListResponse,
  CreateUserRequest,
  CreateUserResponse,
  UpdateUserRequest,
  ApiKeysListResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  DepartmentsListResponse,
  CreateDepartmentRequest,
  UpdateDepartmentRequest,
  DepartmentResponse,
  RolesListResponse,
  PermissionsListResponse,
  RoleResponse,
  UpsertRoleRequest,
  RagflowAccountStatus,
  RagflowCredentials,
  RagflowIntegrationStatus,
} from './types'

export async function login(
  username: string,
  password: string
): Promise<LoginResponse> {
  const body: LoginRequest = {
    grant_type: 'password',
    username,
    password,
  }
  const response = await authClient.post<LoginResponse>('/api/v1/auth/token', body)
  setToken(response.access_token)
  return response
}

export async function loginWithApiKey(apiKey: string): Promise<LoginResponse> {
  const body: LoginRequest = {
    grant_type: 'api_key',
    api_key: apiKey,
  }
  const response = await authClient.post<LoginResponse>('/api/v1/auth/token', body)
  setToken(response.access_token)
  return response
}

export async function logout(): Promise<void> {
  removeToken()
}

export async function getMe(): Promise<MeResponse> {
  return authClient.get<MeResponse>('/api/v1/auth/me')
}

export async function getUsers(): Promise<UsersListResponse> {
  return authClient.get<UsersListResponse>('/api/v1/users')
}

export async function createUser(data: CreateUserRequest): Promise<CreateUserResponse> {
  return authClient.post<CreateUserResponse>('/api/v1/users', data)
}

export async function updateUser(
  userId: string,
  data: UpdateUserRequest
): Promise<CreateUserResponse> {
  return authClient.patch<CreateUserResponse>(`/api/v1/users/${userId}`, data)
}

export async function deleteUser(userId: string): Promise<{ ok: true }> {
  return authClient.delete<{ ok: true }>(`/api/v1/users/${encodeURIComponent(userId)}`)
}

export async function resetPassword(
  userId: string,
  password: string
): Promise<{ ok: boolean }> {
  return authClient.post<{ ok: boolean }>(
    `/api/v1/users/${userId}/password`,
    { password }
  )
}

export async function getApiKeys(): Promise<ApiKeysListResponse> {
  return authClient.get<ApiKeysListResponse>('/api/v1/api-keys')
}

export async function revokeApiKey(keyId: string): Promise<{ ok: boolean }> {
  return authClient.delete<{ ok: boolean }>(`/api/v1/api-keys/${keyId}`)
}

export async function createApiKey(
  data: CreateApiKeyRequest
): Promise<CreateApiKeyResponse> {
  return authClient.post<CreateApiKeyResponse>('/api/v1/api-keys', data)
}

export async function getDepartments(): Promise<DepartmentsListResponse> {
  return authClient.get<DepartmentsListResponse>('/api/v1/departments')
}

export async function createDepartment(
  data: CreateDepartmentRequest
): Promise<DepartmentResponse> {
  return authClient.post<DepartmentResponse>('/api/v1/departments', data)
}

export async function updateDepartment(
  departmentId: string,
  data: UpdateDepartmentRequest
): Promise<DepartmentResponse> {
  return authClient.patch<DepartmentResponse>(
    `/api/v1/departments/${departmentId}`,
    data
  )
}

export async function deleteDepartment(
  departmentId: string
): Promise<{ ok: boolean }> {
  return authClient.delete<{ ok: boolean }>(`/api/v1/departments/${departmentId}`)
}

export async function getRoles(): Promise<RolesListResponse> {
  return authClient.get<RolesListResponse>('/api/v1/roles')
}

export async function getPermissions(): Promise<PermissionsListResponse> {
  return authClient.get<PermissionsListResponse>('/api/v1/permissions')
}

export async function createRole(data: Required<UpsertRoleRequest>): Promise<RoleResponse> {
  return authClient.post<RoleResponse>('/api/v1/roles', data)
}

export async function updateRole(roleId: string, data: UpsertRoleRequest): Promise<RoleResponse> {
  return authClient.patch<RoleResponse>(`/api/v1/roles/${encodeURIComponent(roleId)}`, data)
}

export async function deleteRole(roleId: string): Promise<{ ok: true }> {
  return authClient.delete<{ ok: true }>(`/api/v1/roles/${encodeURIComponent(roleId)}`)
}

export async function setUserTokenLimit(
  userId: string,
  tokenLimit: number | null,
): Promise<{ ok: boolean }> {
  return authClient.patch<{ ok: boolean }>(`/api/v1/users/${userId}/token-limit`, { tokenLimit })
}

export async function setDepartmentTokenLimit(
  departmentId: string,
  tokenLimit: number | null,
): Promise<{ ok: boolean }> {
  return authClient.patch<{ ok: boolean }>(`/api/v1/departments/${departmentId}/token-limit`, { tokenLimit })
}

export async function getRagflowStatus(): Promise<RagflowIntegrationStatus> {
  return authClient.get<RagflowIntegrationStatus>('/api/v1/integrations/ragflow/status')
}

export async function getUserRagflowStatus(userId: string): Promise<RagflowAccountStatus> {
  return authClient.get<RagflowAccountStatus>(`/api/v1/users/${encodeURIComponent(userId)}/ragflow`)
}

export async function provisionUserRagflow(userId: string): Promise<RagflowAccountStatus> {
  return authClient.post<RagflowAccountStatus>(
    `/api/v1/users/${encodeURIComponent(userId)}/ragflow/provision`,
    {},
  )
}

export async function revealUserRagflowCredentials(userId: string): Promise<RagflowCredentials> {
  return authClient.post<RagflowCredentials>(
    `/api/v1/users/${encodeURIComponent(userId)}/ragflow/credentials`,
    {},
  )
}

export async function rotateUserRagflowPassword(userId: string): Promise<Pick<RagflowCredentials, 'username' | 'password'>> {
  return authClient.post(
    `/api/v1/users/${encodeURIComponent(userId)}/ragflow/password`,
    {},
  )
}

export async function rotateUserRagflowApiKey(userId: string): Promise<Pick<RagflowCredentials, 'username' | 'api_key'>> {
  return authClient.post(
    `/api/v1/users/${encodeURIComponent(userId)}/ragflow/api-key`,
    {},
  )
}

export function isAuthenticated(): boolean {
  return !!getToken()
}
