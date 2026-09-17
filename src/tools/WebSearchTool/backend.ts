import { getAPIProvider } from 'src/utils/model/providers.js'
import {
  getSessionMossBaseUrl,
  getSessionWebSearchSettings,
} from 'src/utils/sessionApiOverrides.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import type { Input, Output, SearchResult } from './WebSearchTool.js'

export type WebSearchMode =
  | 'auto'
  | 'native'
  | 'tavily'
  | 'brave'
  | 'disabled'

export type WebSearchProvider = 'native' | 'tavily' | 'brave'

export type WebSearchSettings = {
  mode: WebSearchMode
  tavilyApiKey?: string
  braveApiKey?: string
  nativeCapability: 'supported' | 'compatible' | 'unsupported' | 'unknown'
}

const unsupportedNativeEndpoints = new Set<string>()

function normalizeApiKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim() || undefined
}

function normalizeMode(value: unknown): WebSearchMode {
  return value === 'native' || value === 'tavily' || value === 'brave'
    || value === 'disabled'
    ? value
    : 'auto'
}

function legacyNativeCapability(model: string | undefined) {
  const provider = getAPIProvider()
  if (provider === 'firstParty' || provider === 'foundry') return 'supported' as const
  if (provider !== 'vertex' || !model) return 'unsupported' as const
  return model.includes('claude-opus-4')
    || model.includes('claude-sonnet-4')
    || model.includes('claude-haiku-4')
    ? 'supported' as const
    : 'unsupported' as const
}

export function getConfiguredWebSearchSettings(
  model?: string,
  settings: Pick<SettingsJson, 'webSearch'> = getSettings_DEPRECATED(),
): WebSearchSettings {
  const session = getSessionWebSearchSettings()
  if (session) {
    return {
      mode: normalizeMode(session.mode),
      tavilyApiKey: normalizeApiKey(session.tavilyApiKey),
      braveApiKey: normalizeApiKey(session.braveApiKey),
      nativeCapability: session.nativeCapability === 'supported'
        || session.nativeCapability === 'compatible'
        || session.nativeCapability === 'unsupported'
        ? session.nativeCapability
        : 'unknown',
    }
  }

  const raw = settings.webSearch
  return {
    mode: normalizeMode(raw?.mode),
    tavilyApiKey: normalizeApiKey(raw?.tavilyApiKey),
    braveApiKey: normalizeApiKey(raw?.braveApiKey),
    nativeCapability: legacyNativeCapability(model),
  }
}

function nativeEndpointKey(model: string | undefined): string {
  return `${getSessionMossBaseUrl() || 'default'}\0${String(model || '').trim()}`
}

function isNativeAvailable(model: string | undefined, settings: WebSearchSettings) {
  return (settings.nativeCapability === 'supported' || settings.nativeCapability === 'compatible')
    && !unsupportedNativeEndpoints.has(nativeEndpointKey(model))
}

export function getWebSearchCandidates(
  model: string | undefined,
  settings: WebSearchSettings = getConfiguredWebSearchSettings(model),
): WebSearchProvider[] {
  if (settings.mode === 'disabled') return []
  if (settings.mode === 'tavily') return settings.tavilyApiKey ? ['tavily'] : []
  if (settings.mode === 'brave') return settings.braveApiKey ? ['brave'] : []
  if (settings.mode === 'native') return isNativeAvailable(model, settings) ? ['native'] : []
  return [
    ...(settings.tavilyApiKey ? ['tavily' as const] : []),
    ...(settings.braveApiKey ? ['brave' as const] : []),
    ...(isNativeAvailable(model, settings) ? ['native' as const] : []),
  ]
}

export function isWebSearchEnabledForModel(model: string | undefined): boolean {
  return getWebSearchCandidates(model).length > 0
}

export function shouldFallbackFromNativeError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error)
  return /\b(400|422)\b/.test(message)
    || /web_search|server tool|tool schema|input_schema|extra input|unsupported/i.test(message)
}

export function markNativeWebSearchUnsupported(model: string | undefined): void {
  unsupportedNativeEndpoints.add(nativeEndpointKey(model))
}

export function getApiKeyForProvider(
  provider: Exclude<WebSearchProvider, 'native'>,
  settings: WebSearchSettings,
): string | null {
  return provider === 'tavily'
    ? settings.tavilyApiKey ?? null
    : settings.braveApiKey ?? null
}

export async function searchWithExternalProvider(
  provider: Exclude<WebSearchProvider, 'native'>,
  input: Input,
  apiKey: string,
  signal: AbortSignal,
): Promise<Output> {
  const startTime = performance.now()
  const hits = provider === 'tavily'
    ? await searchWithTavily(input, apiKey, signal)
    : await searchWithBrave(input, apiKey, signal)
  return makeExternalSearchOutput(
    provider,
    input.query,
    hits,
    (performance.now() - startTime) / 1000,
  )
}

export function makeWebSearchUnavailableOutput(
  query: string,
  durationSeconds: number,
  reason: string,
): Output {
  return { query, results: [reason], durationSeconds }
}

type ExternalSearchHit = {
  title: string
  url: string
  snippet?: string
}

async function searchWithTavily(
  input: Input,
  apiKey: string,
  signal: AbortSignal,
): Promise<ExternalSearchHit[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: input.query,
      max_results: 8,
      search_depth: 'basic',
      include_answer: false,
      include_domains: input.allowed_domains,
      exclude_domains: input.blocked_domains,
    }),
    signal,
  })
  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status} ${await readErrorBody(response)}`)
  }
  const body = await response.json() as {
    results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>
  }
  return (body.results ?? [])
    .map(hit => normalizeHit(hit.title, hit.url, hit.content))
    .filter((hit): hit is ExternalSearchHit => hit !== null)
}

async function searchWithBrave(
  input: Input,
  apiKey: string,
  signal: AbortSignal,
): Promise<ExternalSearchHit[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', applyDomainFiltersToQuery(input))
  url.searchParams.set('count', '8')
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal,
  })
  if (!response.ok) {
    throw new Error(`Brave search failed: ${response.status} ${await readErrorBody(response)}`)
  }
  const body = await response.json() as {
    web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown }> }
  }
  return (body.web?.results ?? [])
    .map(hit => normalizeHit(hit.title, hit.url, hit.description))
    .filter((hit): hit is ExternalSearchHit => hit !== null)
}

function applyDomainFiltersToQuery(input: Input): string {
  const allowed = input.allowed_domains?.filter(Boolean) ?? []
  const blocked = input.blocked_domains?.filter(Boolean) ?? []
  const allowedClause = allowed.length
    ? `(${allowed.map(domain => `site:${domain}`).join(' OR ')}) `
    : ''
  const blockedClause = blocked.length
    ? `${blocked.map(domain => `-site:${domain}`).join(' ')} `
    : ''
  return `${allowedClause}${blockedClause}${input.query}`.trim()
}

function normalizeHit(title: unknown, url: unknown, snippet: unknown): ExternalSearchHit | null {
  if (typeof title !== 'string' || typeof url !== 'string') return null
  const normalizedSnippet = typeof snippet === 'string' ? snippet.trim() : ''
  return {
    title: title.trim(),
    url: url.trim(),
    ...(normalizedSnippet ? { snippet: normalizedSnippet.slice(0, 2000) } : {}),
  }
}

function makeExternalSearchOutput(
  provider: Exclude<WebSearchProvider, 'native'>,
  query: string,
  hits: ExternalSearchHit[],
  durationSeconds: number,
): Output {
  const result: SearchResult = {
    tool_use_id: `${provider}-web-search`,
    content: hits,
  }
  return {
    query,
    results: [`Search provider: ${provider}`, result],
    durationSeconds,
  }
}

async function readErrorBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  return text.slice(0, 500)
}
