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
  const service = new LiteLLMService({ enabled: true, baseUrl: 'http://litellm:4000', publicBaseUrl: 'https://models.test', masterKey: 'master', keyTtlSec: 3600, defaultModel: 'moss-default', fastModel: 'moss-fast', requestTimeoutMs: 1000 }, root)
  const auth = { rawToken: 'moss', userId: 'user', orgId: 'org', role: 'user', scopes: [], keyId: 'user' }
  const first = await service.ensureUserKey(auth)
  const second = await service.ensureUserKey(auth)
  assert.deepEqual({ url: first.url, apiKey: first.apiKey, model: first.model }, { url: 'https://models.test', apiKey: 'sk-user-key', model: 'moss-default' })
  assert.equal(second.apiKey, 'sk-user-key')
  assert.equal(calls.filter(url => url.endsWith('/key/generate')).length, 1)
})
