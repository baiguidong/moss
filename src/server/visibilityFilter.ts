import type { AuthContext } from './auth/token.js'
import { hasScope } from './auth/token.js'

export type VisibilityFilter = {
  isAdmin: boolean
  departmentId: string | null
  visibleDepartmentIds: Set<string> | null
}

export function isVisibleTo(
  visibleTo: { department_ids: string[] | null } | null | undefined,
  filter: VisibilityFilter,
): boolean {
  if (filter.isAdmin) return true
  if (!visibleTo || visibleTo.department_ids === null) return true
  if (visibleTo.department_ids.length === 0) return false
  if (!filter.departmentId) return false
  const allowedSet = new Set(visibleTo.department_ids)
  for (const deptId of filter.visibleDepartmentIds ?? new Set()) {
    if (allowedSet.has(deptId)) return true
  }
  return false
}

export function buildVisibilityFilter(
  auth: AuthContext,
  getUserByIdAndOrg: (
    userId: string,
    orgId: string,
  ) => { role: string; departmentId: string | null } | null,
  listDepartmentsByOrg: (
    orgId: string,
  ) => Array<{ id: string; parentId: string | null }>,
): VisibilityFilter {
  const isAdmin = auth.role === 'admin' || hasScope(auth.scopes, '*')
  if (isAdmin) {
    return { isAdmin: true, departmentId: null, visibleDepartmentIds: null }
  }

  const user = getUserByIdAndOrg(auth.userId, auth.orgId)
  const departmentId = user?.departmentId ?? null
  const visibleDepartmentIds = getUserAncestorIds(
    auth.userId,
    auth.orgId,
    getUserByIdAndOrg,
    listDepartmentsByOrg,
  )

  return { isAdmin: false, departmentId, visibleDepartmentIds }
}

export function getUserAncestorIds(
  userId: string,
  orgId: string,
  getUserByIdAndOrg: (
    userId: string,
    orgId: string,
  ) => { role: string; departmentId: string | null } | null,
  listDepartmentsByOrg: (
    orgId: string,
  ) => Array<{ id: string; parentId: string | null }>,
): Set<string> {
  const user = getUserByIdAndOrg(userId, orgId)
  if (!user?.departmentId) return new Set()

  const departments = listDepartmentsByOrg(orgId)
  const byId = new Map(departments.map(d => [d.id, d]))
  const ancestorIds = new Set<string>()
  let current = byId.get(user.departmentId) ?? null
  while (current) {
    ancestorIds.add(current.id)
    current = current.parentId
      ? byId.get(current.parentId) ?? null
      : null
  }
  return ancestorIds
}
