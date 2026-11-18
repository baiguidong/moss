import { dcClient } from './client'

export type ManagedKind = 'skills' | 'experts'

export interface ManagedResource {
  id: string
  kind: 'skill' | 'expert'
  slug: string
  name: string
  displayName: string
  description: string
  icon: string
  category: string
  version: string
  sha256: string
  enabled: boolean
  dependencies: string[]
  createdAt: number
  updatedAt: number
}

export interface HubCard {
  slug: string
  name: string
  description: string
  category: string
  icon: string
  team: boolean
  version: string
  namespace: string
}

export async function getManagedResources(kind: ManagedKind): Promise<{ resources: ManagedResource[] }> {
  return dcClient.get(`/api/v1/managed-resources/${kind}`)
}

export function getHubPage(kind: ManagedKind, keyword: string, page: number) {
  const query = new URLSearchParams({ view: 'cards', keyword, page: String(page) })
  return dcClient.get<{ items: HubCard[]; total: number; pageSize: number }>(`/api/v1/managed-resources/hub/${kind}?${query}`)
}

export async function installFromHub(kind: ManagedKind, payload: Record<string, unknown>) {
  return dcClient.post<{ resource: ManagedResource }>(`/api/v1/managed-resources/${kind}/install-from-hub`, payload)
}

export async function uploadManagedResource(kind: ManagedKind, file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)))
  }
  const slug = file.name.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return dcClient.post<{ resource: ManagedResource }>(`/api/v1/managed-resources/${kind}/install`, {
    slug: slug || `${kind.slice(0, -1)}-${Date.now()}`,
    name: file.name.replace(/\.zip$/i, ''),
    package_base64: btoa(binary),
    metadata: { source: 'admin-upload', fileName: file.name },
  })
}

export async function setManagedResourceEnabled(kind: ManagedKind, id: string, enabled: boolean) {
  return dcClient.patch<{ resource: ManagedResource }>(`/api/v1/managed-resources/${kind}/${encodeURIComponent(id)}`, { enabled })
}

export async function removeManagedResource(kind: ManagedKind, id: string) {
  return dcClient.delete<{ ok: boolean }>(`/api/v1/managed-resources/${kind}/${encodeURIComponent(id)}`)
}

export type ResourceUser = { id: string; name: string; email: string | null; departmentId: string | null }
export type ResourceDepartment = { id: string; name: string; parentId: string | null }

export function getResourceUsers() {
  return dcClient.get<{ users: ResourceUser[]; departments: ResourceDepartment[] }>('/api/v1/managed-resources/users')
}

type AssignmentSummary = { assigned_counts: Record<string, number> }

export function getAssignments(userIds: string[], kind: ManagedKind) {
  return dcClient.post<AssignmentSummary>(`/api/v1/managed-resources/users/${kind}/assignments`, { user_ids: userIds })
}

export function saveAssignments(userIds: string[], kind: ManagedKind, add: string[], remove: string[]) {
  return dcClient.patch<AssignmentSummary>(`/api/v1/managed-resources/users/${kind}/assignments`, { user_ids: userIds, add, remove })
}
