import { authClient } from './client'
import type {
  SystemSettings,
  UpdateSystemSettingsRequest,
} from './types'

export function getSystemSettings(): Promise<SystemSettings> {
  return authClient.get<SystemSettings>('/api/v1/settings/system')
}

export function updateSystemSettings(
  data: UpdateSystemSettingsRequest,
): Promise<SystemSettings> {
  return authClient.patch<SystemSettings>('/api/v1/settings/system', data)
}

export function getSystemModels(input: { url: string; apiKey: string }): Promise<string[]> {
  return authClient.post<string[]>('/api/v1/settings/models', input)
}
