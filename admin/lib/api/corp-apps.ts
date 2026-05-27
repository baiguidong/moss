import { authClient } from './client'

// ============================================================
// Corp App API — 企业应用管理 (Corp App Management)
// Multiple named instances per type (first type: 'wecomapp').
// ============================================================

export type CorpApp = {
  id: string
  orgId: string
  type: string                    // 'wecomapp' | ...
  name: string
  appKey: string                  // keyOf(config), e.g. corpId:agentId
  config: Record<string, unknown> // non-secret fields (corpId, agentId, ...)
  hasCredentials: boolean
  enabled: boolean
  capabilities?: string[]
  createdBy: string
  createdAt: number
  updatedAt: number
}

export type CorpAppType = {
  type: string
  capabilities: string[]
}

export type TestConnectionResult = {
  ok: boolean
  message?: string
}

export async function listCorpApps(): Promise<CorpApp[]> {
  const data = await authClient.get<{ apps: CorpApp[] }>('/api/v1/corp-apps')
  return data.apps
}

export async function listCorpAppTypes(): Promise<CorpAppType[]> {
  const data = await authClient.get<{ types: CorpAppType[] }>('/api/v1/corp-apps/types')
  return data.types
}

export function getCorpApp(id: string): Promise<CorpApp> {
  return authClient.get<CorpApp>(`/api/v1/corp-apps/${id}`)
}

export function createCorpApp(input: {
  type: string
  name: string
  config: Record<string, unknown>
  credentials?: Record<string, string>
}): Promise<CorpApp> {
  return authClient.post<CorpApp>('/api/v1/corp-apps', input)
}

export function updateCorpApp(
  id: string,
  input: {
    name?: string
    config?: Record<string, unknown>
    credentials?: Record<string, string>
    enabled?: boolean
  },
): Promise<CorpApp> {
  return authClient.patch<CorpApp>(`/api/v1/corp-apps/${id}`, input)
}

export function deleteCorpApp(id: string): Promise<{ ok: boolean }> {
  return authClient.delete(`/api/v1/corp-apps/${id}`)
}

export function testCorpApp(id: string): Promise<TestConnectionResult> {
  return authClient.post<TestConnectionResult>(`/api/v1/corp-apps/${id}/test`, undefined)
}
