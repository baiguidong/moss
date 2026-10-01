import { createHash } from 'node:crypto'
import { logForDebugging } from '../debug.js'
import {
  getSessionMossAuthToken,
  getSessionMossBaseUrl,
} from '../sessionApiOverrides.js'
import { normalizeMossBaseUrl } from './modelBaseUrl.js'

export type ModelCapability = {
  id: string
  max_input_tokens?: number
  max_tokens?: number
}

type CapabilityCache = {
  models: Map<string, ModelCapability>
  expiresAt: number
  pending?: Promise<void>
}

const catalogs = new Map<string, CapabilityCache>()
const CACHE_TTL_MS = 60 * 60 * 1000
const RETRY_DELAY_MS = 60 * 1000

function catalogKey(): string | undefined {
  const baseUrl = normalizeMossBaseUrl(getSessionMossBaseUrl()) ||
    normalizeMossBaseUrl(process.env.MOSS_MODEL_BASE_URL)
  if (!baseUrl) return undefined
  const token = getSessionMossAuthToken() || process.env.MOSS_MODEL_AUTH_TOKEN || ''
  return createHash('sha256').update(JSON.stringify([baseUrl, token])).digest('hex')
}

function positiveCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined
}

/** Read provider metadata before any local compaction/blocking decision. */
export async function loadModelCapabilities(
  model: string,
  signal?: AbortSignal,
): Promise<void> {
  const key = catalogKey()
  if (!key || signal?.aborted) return
  let cache = catalogs.get(key)
  if (cache?.pending) return cache.pending
  if (cache && cache.expiresAt > Date.now()) return
  if (!cache) {
    cache = { models: new Map(), expiresAt: 0 }
    if (catalogs.size >= 32) catalogs.delete(catalogs.keys().next().value!)
    catalogs.set(key, cache)
  }
  const entry = cache
  entry.pending = (async () => {
    try {
      // Lazy import avoids the context -> capabilities -> client -> context cycle.
      const { getAnthropicClient } = await import('../../services/api/client.js')
      const client = await getAnthropicClient({ maxRetries: 0, model, source: 'model_capabilities' })
      // Bound discovery across all pages, including providers that paginate
      // despite the requested limit. OpenAI-style catalogs have one page.
      const timeout = AbortSignal.timeout(5000)
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
      let page = await client.models.list({ limit: 1000 }, {
        timeout: 5000,
        maxRetries: 0,
        signal: requestSignal,
      })
      const models = new Map<string, ModelCapability>()
      for (;;) {
        if (!Array.isArray(page.data)) throw new Error('Invalid model catalog')
        for (const item of page.data) {
          const raw = item as unknown as Record<string, unknown>
          if (!raw || typeof raw.id !== 'string') continue
          const maxInput = positiveCount(raw.context_window) ?? positiveCount(raw.max_input_tokens)
          const maxOutput = positiveCount(raw.max_output_tokens) ?? positiveCount(raw.max_tokens)
          if (maxInput || maxOutput) {
            models.set(raw.id, { id: raw.id, max_input_tokens: maxInput, max_tokens: maxOutput })
          }
        }
        if (!page.hasNextPage()) break
        page = await page.getNextPage()
      }
      entry.models = models
      entry.expiresAt = Date.now() + CACHE_TTL_MS
    } catch {
      // A models endpoint is optional. Keep known limits on transient failures.
      entry.expiresAt = Date.now() + RETRY_DELAY_MS
      logForDebugging('Model capability discovery unavailable; retaining cached or default limits.')
    } finally {
      entry.pending = undefined
    }
  })()
  return entry.pending
}

export function getModelCapability(model: string): ModelCapability | undefined {
  const key = catalogKey()
  return key ? catalogs.get(key)?.models.get(model) : undefined
}
