import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { APIError, type default as Anthropic } from '@anthropic-ai/sdk'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { returnValue } from '../../../utils/generators.js'
import type { ThinkingConfig } from '../../../utils/thinking.js'
import {
  clearThinkingCompatibilityCache,
  getThinkingCacheEntry,
  readThinkingCache,
  THINKING_COMPATIBILITY_TTL_MS,
  writeThinkingCache,
} from '../thinkingCompatibilityCache.js'
import { confirmThinkingFallback, type ThinkingFallbackState } from '../thinkingFallback.js'
import { withRetry, type RetryContext } from '../withRetry.js'

const originalConfigDir = process.env.MOSS_CONFIG_DIR
let configDir: string
const client = {
  baseURL: 'https://model.example.test/v1',
  apiKey: 'test-secret-api-key',
  authToken: 'test-secret-auth-token',
}
const model = 'custom-model'

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'moss-thinking-cache-test-'))
  process.env.MOSS_CONFIG_DIR = configDir
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.MOSS_CONFIG_DIR
  else process.env.MOSS_CONFIG_DIR = originalConfigDir
  await rm(configDir, { recursive: true, force: true })
})

function rejected(message = 'thinking is not supported for this model'): APIError {
  return APIError.generate(400, {
    error: { type: 'invalid_request_error', message },
  }, undefined, new Headers())
}

function run(
  state: ThinkingFallbackState,
  operation: (context: RetryContext) => Promise<string>,
  config: ThinkingConfig = { type: 'adaptive' },
) {
  return returnValue(withRetry(
    async () => ({ ...client }) as Anthropic,
    async (_client, _attempt, context) => operation(context),
    {
      maxRetries: 0, model, thinkingConfig: config,
      thinkingFallback: state,
    },
  ))
}

describe('persisted thinking compatibility', () => {
  it('reuses a successful fallback in a new query and client without another rejected request', async () => {
    let attempts = 0
    const first: ThinkingFallbackState = {}
    const operation = async (context: RetryContext) => {
      attempts++
      if (context.thinkingConfig.type !== 'disabled') throw rejected()
      return 'reply'
    }
    await run(first, operation)
    expect(attempts).toBe(2)
    const entry = getThinkingCacheEntry(client, model, 'adaptive')!
    // Request headers alone do not prove a streamed response succeeded.
    expect(await readThinkingCache(entry)).toBeUndefined()
    await confirmThinkingFallback(first)
    expect(await readThinkingCache(entry)).toBe('disabled')
    await run({}, operation)
    expect(attempts).toBe(3)
  })

  it('reuses omission for an endpoint rejecting the entire thinking field', async () => {
    const first: ThinkingFallbackState = {}
    await run(first, async context => {
      if (!context.omitThinking) throw rejected("Unknown parameter: 'thinking'")
      return 'reply'
    })
    await confirmThinkingFallback(first)
    let attempts = 0
    await run({}, async context => {
      attempts++
      expect(context.omitThinking).toBe(true)
      return 'reply'
    })
    expect(attempts).toBe(1)
  })

  it('does not cache failed fallbacks, unrelated errors, or successful text-only requests', async () => {
    for (const message of [
      'thinking is not supported for this model',
      'thinking.budget_tokens must be less than max_tokens',
      'Insufficient balance',
    ]) {
      const state: ThinkingFallbackState = {}
      await expect(run(state, async () => { throw rejected(message) })).rejects.toThrow()
      expect(await readThinkingCache(getThinkingCacheEntry(client, model, 'adaptive')!))
        .toBeUndefined()
    }
    const state: ThinkingFallbackState = {}
    await run(state, async () => 'text without thinking')
    await confirmThinkingFallback(state)
    expect(await readThinkingCache(getThinkingCacheEntry(client, model, 'adaptive')!))
      .toBeUndefined()
  })

  it('isolates endpoints, models, credentials, and configured modes', async () => {
    const entry = getThinkingCacheEntry(client, model, 'adaptive')!
    await writeThinkingCache(entry, 'disabled')
    const otherEntries = [
      getThinkingCacheEntry({ ...client, baseURL: 'https://other.example.test/v1' }, model, 'adaptive')!,
      getThinkingCacheEntry({ ...client, apiKey: 'other-key' }, model, 'adaptive')!,
      getThinkingCacheEntry({ ...client, authToken: 'other-token' }, model, 'adaptive')!,
      getThinkingCacheEntry(client, 'other-model', 'adaptive')!,
      getThinkingCacheEntry(client, model, 'enabled')!,
      getThinkingCacheEntry(client, model, 'disabled')!,
    ]
    for (const other of otherEntries) {
      expect(other.path).not.toBe(entry.path)
      expect(await readThinkingCache(other)).toBeUndefined()
    }
    expect(getThinkingCacheEntry({ ...client, baseURL: `${client.baseURL}/` }, model, 'adaptive'))
      .toEqual(entry)
  })

  it('expires after 24 hours and cache hits do not extend the expiry', async () => {
    const entry = getThinkingCacheEntry(client, model, 'adaptive')!
    const now = Date.now()
    await writeThinkingCache(entry, 'disabled', now)
    expect(await readThinkingCache(entry, now + THINKING_COMPATIBILITY_TTL_MS - 1))
      .toBe('disabled')
    expect(await readThinkingCache(entry, now + THINKING_COMPATIBILITY_TTL_MS))
      .toBeUndefined()
    const before = await readFile(entry.path, 'utf8')
    const state: ThinkingFallbackState = {}
    await run(state, async () => 'reply')
    await confirmThinkingFallback(state)
    expect(await readFile(entry.path, 'utf8')).toBe(before)

    await writeThinkingCache(entry, 'disabled', now - THINKING_COMPATIBILITY_TTL_MS - 1)
    await run({}, async context => {
      expect(context.thinkingConfig.type).toBe('adaptive')
      return 'reply'
    })
  })

  it('clearing the cache makes the next query use the original configuration', async () => {
    await writeThinkingCache(getThinkingCacheEntry(client, model, 'adaptive')!, 'disabled')
    await clearThinkingCompatibilityCache()
    await run({}, async context => {
      expect(context.thinkingConfig.type).toBe('adaptive')
      return 'reply'
    })
  })

  it('discards a cached fallback that the endpoint now explicitly rejects', async () => {
    const entry = getThinkingCacheEntry(client, model, 'adaptive')!
    await writeThinkingCache(entry, 'disabled')
    let attempts = 0
    await expect(run({}, async () => {
      attempts++
      throw rejected()
    })).rejects.toThrow()
    expect(attempts).toBe(1)
    expect(await readThinkingCache(entry)).toBeUndefined()
  })

  it('does not persist credentials, URLs, model names, or conversation content', async () => {
    const entry = getThinkingCacheEntry(client, model, 'adaptive')!
    await writeThinkingCache(entry, 'disabled')
    const content = await readFile(entry.path, 'utf8')
    for (const value of [client.apiKey, client.authToken, client.baseURL, model]) {
      expect(entry.path + content).not.toContain(value)
    }
    expect(Object.keys(JSON.parse(content)).sort()).toEqual(['expiresAt', 'mode', 'version'])
  })

  it('ignores corrupt or unknown cache data and tolerates an unwritable cache directory', async () => {
    const entry = getThinkingCacheEntry(client, model, 'adaptive')!
    await writeThinkingCache(entry, 'disabled')
    for (const content of ['not json', 'null', JSON.stringify({
      version: 2, mode: 'disabled', expiresAt: Date.now() + 10000,
    })]) {
      await writeFile(entry.path, content)
      expect(await readThinkingCache(entry)).toBeUndefined()
    }
    await clearThinkingCompatibilityCache()
    await writeFile(join(configDir, 'cache', 'thinking-compatibility'), 'not a directory')
    await writeThinkingCache(entry, 'disabled')
    expect(await readThinkingCache(entry)).toBeUndefined()
    await run({}, async context => {
      expect(context.thinkingConfig.type).toBe('adaptive')
      return 'reply'
    })
  })

  it('keeps concurrent entries independently readable', async () => {
    const entries = Array.from({ length: 8 }, (_, index) =>
      getThinkingCacheEntry(client, `model-${index}`, 'adaptive')!,
    )
    await Promise.all(entries.map(entry => writeThinkingCache(entry, 'disabled')))
    expect(await Promise.all(entries.map(entry => readThinkingCache(entry))))
      .toEqual(Array(8).fill('disabled'))
  })
})
