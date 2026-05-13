import { authClient, setToken, removeToken, setRefreshToken, setTokenExpiresAt, getToken, getRefreshToken } from './client'
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
} from './types'

function storeLoginResponse(response: LoginResponse): void {
  setToken(response.access_token)
  if (response.refresh_token) {
    setRefreshToken(response.refresh_token)
  }
  setTokenExpiresAt(Date.now() + (response.expires_in || 3600) * 1000)
}

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
  storeLoginResponse(response)
  return response
}

export async function loginWithApiKey(apiKey: string): Promise<LoginResponse> {
  const body: LoginRequest = {
    grant_type: 'api_key',
    api_key: apiKey,
  }
  const response = await authClient.post<LoginResponse>('/api/v1/auth/token', body)
  storeLoginResponse(response)
  return response
}

export async function logout(): Promise<void> {
  const accessToken = getToken()
  const refreshToken = getRefreshToken()

  if (accessToken) {
    try {
      await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          refresh_token: refreshToken || undefined,
        }),
      })
    } catch {
      // Server logout failed, still clear local tokens
    }
  }

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

export async function setUserTokenLimit(
  userId: string,
  tokenLimit: number | null,
): Promise<{ ok: boolean }> {
  return authClient.patch<{ ok: boolean }>(`/api/v1/users/${userId}/token-limit`, { tokenLimit })
}

export async function setUserLocalAuth(
  userId: string,
  localAuth: boolean,
): Promise<{ ok: boolean; local_auth: boolean }> {
  return authClient.put<{ ok: boolean; local_auth: boolean }>(`/api/v1/users/${userId}/local-auth`, { local_auth: localAuth })
}

export async function setDepartmentTokenLimit(
  departmentId: string,
  tokenLimit: number | null,
): Promise<{ ok: boolean }> {
  return authClient.patch<{ ok: boolean }>(`/api/v1/departments/${departmentId}/token-limit`, { tokenLimit })
}

export function isAuthenticated(): boolean {
  return !!getToken()
}
