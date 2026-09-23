import assert from 'node:assert/strict'
import { OpenIMIntegrationService } from '../openim/service.js'

const bindings: Record<string, unknown>[] = []
const db = {
  exec: () => {},
  prepare: (sql: string) => ({
    get: (...args: unknown[]) => {
      if (sql.includes('openim_user_id = ?')) {
        return bindings.find(row => row.instance_id === args[0] && row.openim_user_id === args[1])
      }
      return bindings.find(row => row.org_id === args[0] && row.user_id === args[1] && row.instance_id === args[2])
    },
    run: (...args: unknown[]) => {
      if (sql.includes('INSERT OR IGNORE INTO openim_bindings')) {
        if (!bindings.some(row => row.instance_id === args[3] && row.user_id === args[2])) {
          bindings.push({
            id: args[0], org_id: args[1], user_id: args[2], instance_id: args[3],
            openim_user_id: args[4], profile_hash: args[5], provisioned_at: args[6],
            created_at: args[7], updated_at: args[8],
          })
        }
      } else if (sql.includes('UPDATE openim_bindings')) {
        const row = bindings.find(entry => entry.id === args[3])
        if (row) Object.assign(row, { profile_hash: args[0], provisioned_at: args[1], updated_at: args[2] })
      }
      return { changes: 1 }
    },
  }),
}
const users = [
  {
    id: 'user-1', orgId: 'org-1', name: 'Alice', email: 'alice@example.test',
    departmentId: 'dep-1', status: 'active', effectiveScopes: ['im:use', 'im:group:create', 'directory:read'],
  },
  {
    id: 'user-2', orgId: 'org-1', name: 'Bob', email: 'bob@example.test',
    departmentId: 'dep-1', status: 'active', effectiveScopes: ['im:use', 'directory:read'],
  },
]
const authService = {
  getUserOrNull: (userId: string, orgId: string) => users.find(user => user.id === userId && user.orgId === orgId) || null,
  listDirectory: () => ({
    users,
    departments: [{ id: 'dep-1', name: 'Engineering', parentId: null, userCount: 2 }],
  }),
}
const service = new OpenIMIntegrationService({
  db: db as any,
  authService: authService as any,
  config: {
    enabled: true,
    instanceId: 'default',
    apiUrl: 'https://openim.example.test',
    wsUrl: 'wss://openim.example.test/msg_gateway',
    chatUrl: '',
    adminUserId: 'imAdmin',
    secret: 'admin-secret',
    webhookSecret: 'webhook-secret-1234',
    requestTimeoutMs: 15_000,
  },
})
const requests: Array<{ pathname: string; body: Record<string, unknown>; token: string }> = []
const originalFetch = globalThis.fetch

try {
  globalThis.fetch = (async (input, init) => {
    const pathname = new URL(String(input)).pathname
    const body = JSON.parse(String(init?.body || '{}'))
    const token = String((init?.headers as Record<string, string>)?.token || '')
    requests.push({ pathname, body, token })
    if (pathname === '/auth/get_admin_token') {
      return new Response(JSON.stringify({ errCode: 0, data: { token: 'admin-token', expireTimeSeconds: 3600 } }))
    }
    if (pathname === '/user/account_check') {
      return new Response(JSON.stringify({ errCode: 0, data: { results: [] } }))
    }
    if (pathname === '/auth/get_user_token') {
      return new Response(JSON.stringify({ errCode: 0, data: { token: 'user-token', expireTimeSeconds: 3600 } }))
    }
    return new Response(JSON.stringify({ errCode: 0, data: {} }))
  }) as typeof fetch
  const auth = {
    orgId: 'org-1', userId: 'user-1', role: 'user', scopes: ['im:use', 'im:group:create', 'directory:read'],
  } as any
  const session = await service.createSession(auth, 4)
  assert.equal(session.imToken, 'user-token')
  assert.equal(session.apiAddr, 'https://openim.example.test')
  assert.equal(Object.hasOwn(session, 'secret'), false)
  assert.deepEqual(
    requests.find(request => request.pathname === '/auth/get_admin_token')?.body,
    { secret: 'admin-secret', userID: 'imAdmin' },
  )
  assert.deepEqual(
    requests.find(request => request.pathname === '/auth/get_user_token'),
    {
      pathname: '/auth/get_user_token',
      body: { platformID: 4, userID: session.userID },
      token: 'admin-token',
    },
  )
  const firstDirectoryPage = service.listDirectory(auth, { limit: 1 })
  assert.equal(firstDirectoryPage.users.length, 1)
  assert.ok(firstDirectoryPage.users.every(user => user.openimUserID.startsWith('moss_')))
  assert.ok(firstDirectoryPage.nextCursor)
  const secondDirectoryPage = service.listDirectory(auth, {
    cursor: firstDirectoryPage.nextCursor || undefined,
    limit: 1,
  })
  assert.equal(secondDirectoryPage.users.length, 1)
  assert.equal(secondDirectoryPage.nextCursor, null)
  assert.notEqual(secondDirectoryPage.users[0]?.id, firstDirectoryPage.users[0]?.id)
  users[0]!.status = 'disabled'
  await service.syncUser(users[0] as any)
  const forceLogouts = requests.filter(request => request.pathname === '/auth/force_logout')
  assert.equal(forceLogouts.length, 8)
  assert.deepEqual(forceLogouts.map(request => request.body.platformID), [1, 2, 3, 4, 5, 6, 7, 8])
} finally {
  globalThis.fetch = originalFetch
}
