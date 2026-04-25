import { authClient, setToken, getToken, removeToken } from './client'
import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  UsersListResponse,
  CreateUserRequest,
  CreateUserResponse,
  ApiKeysListResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
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

export async function createApiKey(
  data: CreateApiKeyRequest
): Promise<CreateApiKeyResponse> {
  return authClient.post<CreateApiKeyResponse>('/api/v1/api-keys', data)
}

export function isAuthenticated(): boolean {
  return !!getToken()
}
