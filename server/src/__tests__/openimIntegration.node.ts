import assert from 'node:assert/strict'
import { OpenIMIntegrationService } from '../openim/service.js'

import { OpenIMRepository } from '../model/repositories/openIM.js'
import { openTestDatabase } from './databaseTestUtils.js'
const db = await openTestDatabase()
await db
  .prepare(
    "INSERT INTO organizations (id,name,created_at) VALUES ('org-1','One',1)",
  )
  .run()
await db
  .prepare(
    "INSERT INTO departments (id,org_id,name,created_at,updated_at) VALUES ('dep-1','org-1','Engineering',1,1)",
  )
  .run()
await db
  .prepare(
    "INSERT INTO users (id,org_id,email,name,department_id,created_at) VALUES ('user-1','org-1','alice@example.test','Alice','dep-1',1),('user-2','org-1','bob@example.test','Bob','dep-1',1)",
  )
  .run()
const users = [
  {
    id: 'user-1',
    orgId: 'org-1',
    name: 'Alice',
    email: 'alice@example.test',
    departmentId: 'dep-1',
    status: 'active',
    effectiveScopes: ['im:use', 'im:group:create', 'directory:read'],
  },
  {
    id: 'user-2',
    orgId: 'org-1',
    name: 'Bob',
    email: 'bob@example.test',
    departmentId: 'dep-1',
    status: 'active',
    effectiveScopes: ['im:use', 'directory:read'],
  },
]
const authService = {
  getUserOrNull: (userId: string, orgId: string) =>
    users.find(user => user.id === userId && user.orgId === orgId) || null,
  listDirectory: () => ({
    users,
    departments: [
      { id: 'dep-1', name: 'Engineering', parentId: null, userCount: 2 },
    ],
  }),
}
const service = new OpenIMIntegrationService({
  repository: new OpenIMRepository(db),
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
const requests: Array<{
  pathname: string
  body: Record<string, unknown>
  token: string
}> = []
const originalFetch = globalThis.fetch

try {
  globalThis.fetch = (async (input, init) => {
    const pathname = new URL(String(input)).pathname
    const body = JSON.parse(String(init?.body || '{}'))
    const token = String((init?.headers as Record<string, string>)?.token || '')
    requests.push({ pathname, body, token })
    if (pathname === '/auth/get_admin_token') {
      return new Response(
        JSON.stringify({
          errCode: 0,
          data: { token: 'admin-token', expireTimeSeconds: 3600 },
        }),
      )
    }
    if (pathname === '/user/account_check') {
      return new Response(JSON.stringify({ errCode: 0, data: { results: [] } }))
    }
    if (pathname === '/auth/get_user_token') {
      return new Response(
        JSON.stringify({
          errCode: 0,
          data: { token: 'user-token', expireTimeSeconds: 3600 },
        }),
      )
    }
    return new Response(JSON.stringify({ errCode: 0, data: {} }))
  }) as typeof fetch
  const auth = {
    orgId: 'org-1',
    userId: 'user-1',
    role: 'user',
    scopes: ['im:use', 'im:group:create', 'directory:read'],
  } as any
  const session = await service.createSession(auth, 4)
  assert.equal(session.imToken, 'user-token')
  assert.equal(session.apiAddr, 'https://openim.example.test')
  assert.equal(Object.hasOwn(session, 'secret'), false)
  assert.deepEqual(
    requests.find(request => request.pathname === '/auth/get_admin_token')
      ?.body,
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
  const firstDirectoryPage = await service.listDirectory(auth, { limit: 1 })
  assert.equal(firstDirectoryPage.users.length, 1)
  assert.ok(
    firstDirectoryPage.users.every(user =>
      user.openimUserID.startsWith('moss_'),
    ),
  )
  assert.ok(firstDirectoryPage.nextCursor)
  const secondDirectoryPage = await service.listDirectory(auth, {
    cursor: firstDirectoryPage.nextCursor || undefined,
    limit: 1,
  })
  assert.equal(secondDirectoryPage.users.length, 1)
  assert.equal(secondDirectoryPage.nextCursor, null)
  assert.notEqual(
    secondDirectoryPage.users[0]?.id,
    firstDirectoryPage.users[0]?.id,
  )
  users[0]!.status = 'disabled'
  await service.syncUser(users[0] as any)
  const forceLogouts = requests.filter(
    request => request.pathname === '/auth/force_logout',
  )
  assert.equal(forceLogouts.length, 8)
  assert.deepEqual(
    forceLogouts.map(request => request.body.platformID),
    [1, 2, 3, 4, 5, 6, 7, 8],
  )
} finally {
  await db.close()
  globalThis.fetch = originalFetch
}
