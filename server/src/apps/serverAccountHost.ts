import { createHash } from 'node:crypto'
import { APP_ERROR_CODES, AppServiceError } from '../../../packages/app-sdk/src/index.mjs'
import type { AuthService } from '../auth/service.js'
import { hasScope } from '../auth/token.js'

type AccountHostContext = {
  principal?: {
    scope?: string
    orgId?: string | null
    userId?: string | null
  } | null
}

type DirectoryInput = {
  departmentId?: unknown
  cursor?: unknown
  limit?: unknown
  query?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function requireOrganization(context: AccountHostContext): { orgId: string; userId: string | null } {
  const orgId = text(context.principal?.orgId)
  if (!orgId) {
    throw new AppServiceError(
      APP_ERROR_CODES.unauthorized,
      'Account Host requires an organization-scoped App owner.',
    )
  }
  return { orgId, userId: text(context.principal?.userId) || null }
}

function decodeCursor(value: unknown): number {
  const cursor = text(value)
  if (!cursor) return 0
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const match = /^offset:(\d+)$/.exec(decoded)
    if (!match) throw new Error('invalid cursor')
    const offset = Number(match[1])
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid cursor')
    return offset
  } catch {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Account directory cursor is invalid.')
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(`offset:${offset}`, 'utf8').toString('base64url')
}

function directoryRevision(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}

export function createServerAccountHostHandlers(authService: AuthService) {
  const ownerIdentity = (context: AccountHostContext) => {
    const owner = requireOrganization(context)
    const identity = authService.getAccountIdentity(owner.orgId, owner.userId)
    if (owner.userId && (!identity.user || identity.user.status !== 'active')) {
      throw new AppServiceError(
        APP_ERROR_CODES.unauthorized,
        'The user that owns this App is no longer active.',
      )
    }
    return { ...owner, identity }
  }

  const directory = (input: DirectoryInput, context: AccountHostContext, searching: boolean) => {
    const { orgId, userId, identity } = ownerIdentity(context)
    if (userId) {
      if (!hasScope(identity.scopes, 'directory:read')) {
        throw new AppServiceError(
          APP_ERROR_CODES.permissionDenied,
          'The App owner is not allowed to read the organization directory.',
        )
      }
    }
    const source = authService.listDirectory(orgId)
    const departmentId = text(input.departmentId)
    const query = searching ? text(input.query).toLowerCase() : ''
    const limit = Math.min(200, Math.max(1, Number(input.limit) || 100))
    const offset = searching ? 0 : decodeCursor(input.cursor)
    const allUsers = source.users
      .filter((user) => !departmentId || user.departmentId === departmentId)
      .filter((user) => !query || [user.name, user.email, user.id]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email || null,
        departmentId: user.departmentId || null,
        status: user.status,
      }))
    const users = allUsers.slice(offset, offset + limit)
    return {
      users,
      departments: source.departments,
      nextCursor: offset + users.length < allUsers.length
        ? encodeCursor(offset + users.length)
        : null,
      revision: directoryRevision({ users: allUsers, departments: source.departments }),
    }
  }

  return {
    'identity.current': (_input: Record<string, unknown>, context: AccountHostContext) => {
      const { identity } = ownerIdentity(context)
      return {
        source: 'server' as const,
        user: identity.user ? {
          id: identity.user.id,
          name: identity.user.name,
          email: identity.user.email || null,
          departmentId: identity.user.departmentId || null,
          status: identity.user.status,
        } : null,
        organization: identity.organization,
        scopes: identity.scopes,
      }
    },
    'directory.list': (input: DirectoryInput, context: AccountHostContext) => directory(input, context, false),
    'directory.search': (input: DirectoryInput, context: AccountHostContext) => directory(input, context, true),
  }
}
