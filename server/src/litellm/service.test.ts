import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { LiteLLMService } from './service.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('creates and caches a user-scoped LiteLLM key', async () => {
  const calls: string[] = []
  globalThis.fetch = (async (input, init) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/user/new')) return new Response(JSON.stringify({ user_id: 'org:user' }), { status: 200 })
    if (url.endsWith('/key/generate')) return new Response(JSON.stringify({ key: 'sk-user-key' }), { status: 200 })
    throw new Error(`unexpected request ${url} ${String(init?.body)}`)
  }) as typeof fetch
  const root = await mkdtemp(join(tmpdir(), 'moss-litellm-test-'))
  const service = new LiteLLMService({ enabled: true, baseUrl: 'http://litellm:4000', publicBaseUrl: 'https://models.test', masterKey: 'master', keyTtlSec: 3600, maxBudget: 10, budgetDuration: '30d', rpmLimit: 60, tpmLimit: 100000, defaultModel: 'moss-default', fastModel: 'moss-fast', requestTimeoutMs: 1000 }, root)
  const auth = { rawToken: 'moss', userId: 'user', orgId: 'org', role: 'user', scopes: [], keyId: 'user' }
  const first = await service.ensureUserKey(auth)
  const second = await service.ensureUserKey(auth)
  assert.deepEqual({ url: first.url, apiKey: first.apiKey, model: first.model }, { url: 'https://models.test', apiKey: 'sk-user-key', model: 'moss-default' })
  assert.equal(second.apiKey, 'sk-user-key')
  assert.equal(calls.filter(url => url.endsWith('/key/generate')).length, 1)
})

test('passes native LiteLLM quota limits when generating a key', async () => {
  let body: any
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/user/new')) return new Response('{}', { status: 200 })
    if (String(input).endsWith('/key/generate')) { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ key: 'sk-quota-key' }), { status: 200 }) }
    throw new Error(`unexpected request ${String(input)}`)
  }) as typeof fetch
  const root = await mkdtemp(join(tmpdir(), 'moss-litellm-quota-test-'))
  const service = new LiteLLMService({ enabled: true, baseUrl: 'http://litellm:4000', publicBaseUrl: 'https://models.test', masterKey: 'master', keyTtlSec: 3600, maxBudget: 10, budgetDuration: '30d', rpmLimit: 60, tpmLimit: 100000, defaultModel: 'moss-default', fastModel: 'moss-fast', requestTimeoutMs: 1000 }, root)
  await service.ensureUserKey({ rawToken: 'moss', userId: 'quota-user', orgId: 'org', role: 'user', scopes: [], keyId: 'user' })
  assert.deepEqual({ max_budget: body.max_budget, budget_duration: body.budget_duration, rpm_limit: body.rpm_limit, tpm_limit: body.tpm_limit }, { max_budget: 10, budget_duration: '30d', rpm_limit: 60, tpm_limit: 100000 })
})
