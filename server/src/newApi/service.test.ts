import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NewAPIService } from './service.js'

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
  fastModel: 'gpt-4o-mini',
  requestTimeoutMs: 1000,
}
const auth = { rawToken: 'moss', userId: 'user', orgId: 'org', role: 'user', scopes: [], keyId: 'user' } as any

function mockNewApi() {
  const requests: Array<{ path: string; method: string; authorization: string; body?: any }> = []
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    requests.push({
      path: url.pathname,
      method: init?.method || 'GET',
      authorization: new Headers(init?.headers).get('authorization') || '',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    if (url.pathname === '/api/user/') return new Response(JSON.stringify({ success: true }), { status: 200 })
    if (url.pathname === '/api/user/login') return new Response(JSON.stringify({ success: true, data: { access_token: 'user-session', user: { id: 42 } } }), { status: 200 })
    if (url.pathname === '/api/user/manage') return new Response(JSON.stringify({ success: true }), { status: 200 })
    if (url.pathname === '/api/token/' && init?.method === 'POST') return new Response(JSON.stringify({ success: true }), { status: 200 })
    if (url.pathname === '/api/token/' && init?.method !== 'POST') return new Response(JSON.stringify({ success: true, data: { items: [{ id: 7, name: 'moss-org-user' }] } }), { status: 200 })
    if (url.pathname === '/api/token/7/key') return new Response(JSON.stringify({ success: true, data: { key: 'sk-user-key' } }), { status: 200 })
    if (url.pathname === '/api/usage/token/') return new Response(JSON.stringify({ code: true, data: { total_used: 42, total_available: 58 } }), { status: 200 })
    throw new Error(`unexpected ${url.pathname}`)
  }) as typeof fetch
  return requests
}

test('creates a New API user and returns its direct gateway token', async () => {
  const requests = mockNewApi()
  const access = await new NewAPIService(config, root).ensureUserKey(auth)
  assert.deepEqual(access, { url: 'https://models.test/router', apiKey: 'sk-user-key', model: 'gpt-4o', fastModel: 'gpt-4o-mini', expiresAt: 0 })
  assert.deepEqual(requests.map(request => request.path), ['/api/user/', '/api/user/login', '/api/user/manage', '/api/token/', '/api/token/', '/api/token/7/key'])
  assert.deepEqual(requests.find(request => request.path === '/api/token/' && request.method === 'POST')?.body, {
    name: 'moss-org-user',
    unlimited_quota: true,
    allow_user_quota_query: true,
    expired_time: -1,
    group: 'default',
    model_limits_enabled: true,
    model_limits: 'gpt-4o',
  })
})

test('reads New API token usage with the user token', async () => {
  const requests = mockNewApi()
  const usage = await new NewAPIService(config, root).userInfo(auth)
  assert.deepEqual(usage, { code: true, data: { total_used: 42, total_available: 58 } })
  assert.equal(requests.at(-1)?.path, '/api/usage/token/')
  assert.equal(requests.at(-1)?.authorization, 'Bearer sk-user-key')
})

test('converts dollar recharge amounts to New API quota units', async () => {
  const requests = mockNewApi()
  await new NewAPIService(config, root).recharge(auth, 'other-user', 'org', 2.5)
  const manageRequests = requests.filter(request => request.path === '/api/user/manage')
  assert.equal(manageRequests.at(-1)?.body?.value, 1_250_000)
})

test('synchronizes the status of an existing New API user', async () => {
  const requests = mockNewApi()
  const service = new NewAPIService(config, root)
  await service.ensureUserKey({ ...auth, userId: 'status-user' })
  await service.syncUserStatus('status-user', 'org', 'disabled')
  const manageRequest = requests.filter(request => request.path === '/api/user/manage').at(-1)
  assert.deepEqual(manageRequest?.body, { id: 42, action: 'disable' })
})

test('normalizes the New API balance response to dollars', async () => {
  const requests = mockNewApi()
  const service = new NewAPIService(config, root)
  const balance = await service.balanceById('user', 'org')
  assert.deepEqual(balance, { availableUsd: 0.000116, usedUsd: 0.000084, totalUsd: 0.0002 })
  assert.equal(requests.at(-1)?.authorization, 'Bearer sk-user-key')
})
