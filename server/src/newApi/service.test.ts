import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NewAPIService } from './service.js'
import { ServerCredentialStore } from '../security/credentialStore.js'
import { createHash } from 'node:crypto'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

const root = await mkdtemp(join(tmpdir(), 'moss-new-api-test-'))
const config = {
  enabled: true,
  baseUrl: 'http://new-api:3000',
  publicBaseUrl: 'https://models.test/router',
  apiKey: 'sk-admin-key',
  initialQuota: 5000000,
  defaultModel: 'gpt-4o',
  availableModels: [],
  fastModel: 'gpt-4o-mini',
  requestTimeoutMs: 1000,
}
const auth = { rawToken: 'moss', userId: 'user', orgId: 'org', role: 'user', scopes: [], keyId: 'user' } as any

const users = {
  async getUserByIdAndOrg(userId: string, _orgId: string) {
    return { name: userId === 'user' ? 'bgd' : userId === 'other-user' ? 'admin' : userId }
  },
}

function mockNewApi(existingUsernames: string[] = []) {
  const requests: Array<{ path: string; method: string; authorization: string; body?: any }> = []
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    requests.push({
      path: url.pathname,
      method: init?.method || 'GET',
      authorization: new Headers(init?.headers).get('authorization') || '',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    if (url.pathname === '/api/user/search') {
      const page = Number(url.searchParams.get('p'))
      return new Response(JSON.stringify({ success: true, data: {
        items: existingUsernames.slice((page - 1) * 100, page * 100).map(username => ({ username })),
        total: existingUsernames.length, page_size: 100,
      } }), { status: 200 })
    }
    if (url.pathname === '/api/user/') return new Response(JSON.stringify({ success: true }), { status: 200 })
    if (url.pathname === '/api/user/login') return new Response(JSON.stringify({ success: true, data: { access_token: 'user-session', user: { id: 42 } } }), { status: 200 })
    if (url.pathname === '/api/user/manage') return new Response(JSON.stringify({ success: true }), { status: 200 })
    if (url.pathname === '/api/token/' && init?.method === 'POST') return new Response(JSON.stringify({ success: true }), { status: 200 })
    if (url.pathname === '/api/token/' && init?.method === 'PUT') return new Response(JSON.stringify({ success: true }), { status: 200 })
    if (url.pathname === '/api/token/' && init?.method !== 'POST') return new Response(JSON.stringify({ success: true, data: { items: [{ id: 7, name: 'moss-org-user' }] } }), { status: 200 })
    if (url.pathname === '/api/token/7' && init?.method !== 'PUT') return new Response(JSON.stringify({ success: true, data: { id: 7, name: 'moss-org-user', expired_time: -1, remain_quota: 0, unlimited_quota: true, model_limits_enabled: false, model_limits: '', allow_ips: '', group: 'default', cross_group_retry: false, allow_user_quota_query: true } }), { status: 200 })
    if (url.pathname === '/api/token/7/key') return new Response(JSON.stringify({ success: true, data: { key: 'sk-user-key' } }), { status: 200 })
    if (url.pathname === '/v1/models') return new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }), { status: 200 })
    if (url.pathname === '/api/usage/token/') return new Response(JSON.stringify({ code: true, data: { total_used: 42, total_available: 58 } }), { status: 200 })
    throw new Error(`unexpected ${url.pathname}`)
  }) as typeof fetch
  return requests
}

test('creates a New API user and returns its direct gateway token', async () => {
  const requests = mockNewApi()
  const access = await new NewAPIService(config, root, users).ensureUserKey(auth)
  assert.deepEqual(access, { url: 'https://models.test/router', apiKey: 'sk-user-key', model: 'gpt-4o', availableModels: ['gpt-4o', 'gpt-4o-mini'], fastModel: 'gpt-4o', expiresAt: 0 })
  assert.deepEqual(requests.map(request => request.path), ['/api/user/search', '/api/user/', '/api/user/login', '/api/user/', '/api/user/manage', '/api/token/', '/api/token/', '/api/token/7/key', '/v1/models', '/api/token/7'])
  assert.deepEqual(requests.find(request => request.path === '/api/user/' && request.method === 'POST')?.body, {
    username: 'moss_bgd',
    password: requests.find(request => request.path === '/api/user/login')?.body.password,
    display_name: 'moss_bgd',
    role: 1,
  })
  assert.deepEqual(requests.find(request => request.path === '/api/user/' && request.method === 'PUT')?.body, {
    id: 42, username: 'moss_bgd', display_name: 'moss_bgd', group: 'default', remark: 'moss:org:user',
  })
  assert.equal(requests.find(request => request.path === '/api/user/' && request.method === 'PUT')?.authorization, 'Bearer sk-admin-key')
  const saved = await new ServerCredentialStore(root).get('new-api-user', 'org:user')
  assert.equal(saved.username, 'moss_bgd')
  assert.equal(saved.userId, '42')
  assert.deepEqual(requests.find(request => request.path === '/api/token/' && request.method === 'POST')?.body, {
    name: 'moss-org-user',
    unlimited_quota: true,
    allow_user_quota_query: true,
    expired_time: -1,
    group: 'default',
    model_limits_enabled: false,
    model_limits: '',
  })
})

test('reads New API token usage with the user token', async () => {
  const requests = mockNewApi()
  const usage = await new NewAPIService(config, root, users).userInfo(auth)
  assert.deepEqual(usage, { code: true, data: { total_used: 42, total_available: 58 } })
  assert.equal(requests.at(-1)?.path, '/api/usage/token/')
  assert.equal(requests.at(-1)?.authorization, 'Bearer sk-user-key')
})

test('reads the unrestricted catalog with the dedicated catalog key', async () => {
  const requests = mockNewApi()
  const service = new NewAPIService({ ...config, catalogApiKey: 'sk-catalog-key' }, root, users)
  const catalog = await service.adminModelCatalog(auth)
  assert.deepEqual(catalog, { models: ['gpt-4o', 'gpt-4o-mini'] })
  assert.equal(requests.at(-1)?.path, '/v1/models')
  assert.equal(requests.at(-1)?.authorization, 'Bearer sk-catalog-key')
})

test('converts dollar recharge amounts to New API quota units', async () => {
  const requests = mockNewApi()
  await new NewAPIService(config, root, users).recharge(auth, 'other-user', 'org', 2.5)
  const manageRequests = requests.filter(request => request.path === '/api/user/manage')
  assert.equal(manageRequests.at(-1)?.body?.value, 1_250_000)
  assert.equal(requests.find(request => request.path === '/api/user/' && request.method === 'POST')?.body.username, 'moss_admin')
  assert.equal(requests.find(request => request.path === '/api/user/' && request.method === 'PUT')?.body.remark, 'moss:org:other-user')
})

test('synchronizes the status of an existing New API user', async () => {
  const requests = mockNewApi()
  const service = new NewAPIService(config, root, users)
  await service.ensureUserKey({ ...auth, userId: 'status-user' })
  await service.syncUserStatus('status-user', 'org', 'disabled')
  const manageRequest = requests.filter(request => request.path === '/api/user/manage').at(-1)
  assert.deepEqual(manageRequest?.body, { id: 42, action: 'disable' })
})

test('normalizes the New API balance response to dollars', async () => {
  const requests = mockNewApi()
  const service = new NewAPIService(config, root, users)
  const balance = await service.balanceById('user', 'org')
  assert.deepEqual(balance, { availableUsd: 0.000116, usedUsd: 0.000084, totalUsd: 0.0002 })
  assert.equal(requests.at(-1)?.authorization, 'Bearer sk-user-key')
})

test('keeps readable usernames unique without changing the Moss identity', async () => {
  const requests = mockNewApi([...Array.from({ length: 100 }, (_, index) => `moss_admin_${index}`), 'MOSS_ADMIN'])
  const target = { ...auth, userId: 'collision-user' }
  const digest = createHash('sha256').update('org:collision-user').digest('hex').slice(0, 8)
  const service = new NewAPIService(config, root, { async getUserByIdAndOrg() { return { name: 'admin' } } })
  await service.ensureUserKey(target)
  const created = requests.find(request => request.path === '/api/user/' && request.method === 'POST')?.body
  assert.equal(created.username, `moss_admin_${digest}`)
  assert.equal(requests.filter(request => request.path === '/api/user/search').length, 2)
  assert.equal(requests.find(request => request.path === '/api/user/' && request.method === 'PUT')?.body.remark, 'moss:org:collision-user')
})

test('fits long and non-ASCII usernames within the router limit', async () => {
  for (const [index, name] of ['a-very-long-Moss-username', '张三', '!!!'].entries()) {
    const requests = mockNewApi()
    const userId = `name-user-${index}`
    const service = new NewAPIService(config, root, { async getUserByIdAndOrg() { return { name } } })
    await service.ensureUserKey({ ...auth, userId })
    const created = requests.find(request => request.path === '/api/user/' && request.method === 'POST')?.body
    assert.ok(Array.from(created.username).length <= 20)
    assert.equal(created.display_name, created.username)
    if (name === '张三') assert.equal(created.username, 'moss_张三')
    else assert.match(created.username, /^moss_(?:a-very_)?[a-f0-9]{8,14}$/)
    assert.equal(requests.find(request => request.path === '/api/user/' && request.method === 'PUT')?.body.remark, `moss:org:${userId}`)
  }
})

test('reuses existing hash accounts without renaming or resolving a username', async () => {
  const requests = mockNewApi()
  const userId = 'legacy-user'
  const username = `moss_${createHash('sha256').update(`org:${userId}`).digest('hex').slice(0, 14)}`
  await new ServerCredentialStore(root).set('new-api-user', `org:${userId}`, {
    userId: '42', username, password: 'saved-password', apiKey: 'sk-user-key', tokenId: '7',
  })
  const service = new NewAPIService(config, root, { async getUserByIdAndOrg() { throw new Error('Existing accounts must be reused') } })
  await service.ensureUserKey({ ...auth, userId })
  assert.ok(requests.every(request => !request.path.startsWith('/api/user/')))
  assert.equal((await new ServerCredentialStore(root).get('new-api-user', `org:${userId}`)).username, username)
})
