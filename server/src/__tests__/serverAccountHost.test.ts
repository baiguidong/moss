import { describe, expect, it } from 'bun:test'
import { createServerAccountHostHandlers } from '../apps/serverAccountHost.js'

function fakeAuthService() {
  const directories = {
    'org-1': {
      departments: [{
        id: 'dep-1', name: 'Support', parentId: null, userCount: 2,
        orgId: 'org-1', tokenLimit: 100, createdAt: 1, updatedAt: 1,
      }],
      users: [
        { id: 'user-1', name: 'Alice', email: 'alice@example.test', departmentId: 'dep-1', status: 'active' },
        { id: 'user-2', name: 'Bob', email: 'bob@example.test', departmentId: 'dep-1', status: 'active' },
      ],
    },
    'org-2': {
      departments: [],
      users: [{ id: 'other', name: 'Other', email: 'other@example.test', departmentId: null, status: 'active' }],
    },
  }
  return {
    listDirectory: (orgId: keyof typeof directories) => directories[orgId],
    getAccountIdentity: (orgId: keyof typeof directories, userId: string | null) => ({
      user: userId ? directories[orgId].users.find((user) => user.id === userId) || null : null,
      organization: { id: orgId, name: orgId === 'org-1' ? 'One' : 'Two', createdAt: 1 },
      scopes: ['directory:read'],
    }),
  }
}

describe('Server Account Host', () => {
  it('returns only the App owner identity and organization directory', () => {
    const handlers = createServerAccountHostHandlers(fakeAuthService() as any)
    const context = { principal: { scope: 'user', orgId: 'org-1', userId: 'user-1' } }
    expect(handlers['identity.current']({}, context)).toMatchObject({
      source: 'server', user: { id: 'user-1', name: 'Alice' }, organization: { id: 'org-1' },
    })
    expect(handlers['identity.current']({}, context).organization).toEqual({ id: 'org-1', name: 'One' })
    expect(handlers['directory.search']({ query: 'bob' }, context)).toMatchObject({
      users: [{ id: 'user-2', name: 'Bob' }],
    })
    expect(handlers['directory.list']({}, context).departments).toEqual([
      { id: 'dep-1', name: 'Support', parentId: null, userCount: 2 },
    ])
  })

  it('paginates without crossing organizations and rejects host-scoped access', () => {
    const handlers = createServerAccountHostHandlers(fakeAuthService() as any)
    const context = { principal: { scope: 'org', orgId: 'org-1', userId: null } }
    const first = handlers['directory.list']({ limit: 1 }, context)
    expect(first.users.map((user) => user.id)).toEqual(['user-1'])
    const second = handlers['directory.list']({ limit: 1, cursor: first.nextCursor }, context)
    expect(second.users.map((user) => user.id)).toEqual(['user-2'])
    expect(second.users.some((user) => user.id === 'other')).toBe(false)
    expect(() => handlers['directory.list']({}, { principal: { scope: 'host' } }))
      .toThrow(/organization-scoped/)
  })

  it('applies the user owner directory scope in addition to the App grant', () => {
    const auth = fakeAuthService()
    auth.getAccountIdentity = ((orgId: string, userId: string | null) => ({
      user: userId ? { id: userId, status: 'active' } : null,
      organization: { id: String(orgId), name: 'One', createdAt: 1 },
      scopes: [],
    })) as any
    const handlers = createServerAccountHostHandlers(auth as any)
    expect(() => handlers['directory.list']({}, {
      principal: { scope: 'user', orgId: 'org-1', userId: 'user-1' },
    })).toThrow(/not allowed/)
  })

  it('rejects a user-owned App after its owner is disabled', () => {
    const auth = fakeAuthService()
    auth.getAccountIdentity = ((orgId: string, userId: string | null) => ({
      user: userId ? { id: userId, status: 'disabled' } : null,
      organization: { id: orgId, name: 'One', createdAt: 1 },
      scopes: ['directory:read'],
    })) as any
    const handlers = createServerAccountHostHandlers(auth as any)
    expect(() => handlers['identity.current']({}, {
      principal: { scope: 'user', orgId: 'org-1', userId: 'user-1' },
    })).toThrow(/no longer active/)
  })
})
