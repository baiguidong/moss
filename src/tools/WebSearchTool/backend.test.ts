import { afterEach, describe, expect, it } from 'bun:test'
import {
  getConfiguredWebSearchSettings,
  getWebSearchCandidates,
  searchWithExternalProvider,
  type WebSearchSettings,
} from './backend.js'
import { runWithSessionApiOverrides } from '../../utils/sessionApiOverrides.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function settings(patch: Partial<WebSearchSettings> = {}): WebSearchSettings {
  return {
    mode: 'auto',
    nativeCapability: 'unknown',
    ...patch,
  }
}

describe('WebSearch backend selection', () => {
  it('orders explicit credentials before detected native search', () => {
    expect(getWebSearchCandidates('model-a', settings({
      tavilyApiKey: 'tavily-key',
      braveApiKey: 'brave-key',
      nativeCapability: 'supported',
    }))).toEqual(['tavily', 'brave', 'native'])
  })

  it('does not expose WebSearch when no configured or detected backend exists', () => {
    expect(getWebSearchCandidates('model-a', settings())).toEqual([])
    expect(getWebSearchCandidates('model-a', settings({
      mode: 'native',
      nativeCapability: 'unsupported',
    }))).toEqual([])
  })

  it('honors an explicitly selected external provider', () => {
    expect(getWebSearchCandidates('model-a', settings({
      mode: 'brave',
      tavilyApiKey: 'tavily-key',
      braveApiKey: 'brave-key',
      nativeCapability: 'supported',
    }))).toEqual(['brave'])
  })

  it('uses the desktop session capability instead of a model-name heuristic', () => {
    const resolved = runWithSessionApiOverrides({
      mossModel: 'gpt-compatible-name',
      webSearch: {
        mode: 'auto',
        nativeCapability: 'compatible',
      },
    }, () => getConfiguredWebSearchSettings('gpt-compatible-name'))

    expect(resolved.nativeCapability).toBe('compatible')
    expect(getWebSearchCandidates('gpt-compatible-name', resolved)).toEqual(['native'])
  })
})

describe('external WebSearch providers', () => {
  it('calls Tavily directly and preserves result snippets', async () => {
    let request: { url: string; init?: RequestInit } | null = null
    globalThis.fetch = (async (input, init) => {
      request = { url: String(input), init }
      return new Response(JSON.stringify({
        results: [{ title: 'Result title', url: 'https://example.com/result', content: 'Useful context' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const output = await searchWithExternalProvider(
      'tavily',
      { query: 'moss search', allowed_domains: ['example.com'] },
      'tavily-key',
      new AbortController().signal,
    )

    expect(request?.url).toBe('https://api.tavily.com/search')
    expect(request?.init?.headers).toMatchObject({ Authorization: 'Bearer tavily-key' })
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({
      query: 'moss search',
      include_domains: ['example.com'],
    })
    expect(output.results[1]).toMatchObject({
      content: [{
        title: 'Result title',
        url: 'https://example.com/result',
        snippet: 'Useful context',
      }],
    })
  })

  it('calls Brave directly with domain filters', async () => {
    let requestUrl = ''
    let requestHeaders: HeadersInit | undefined
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input)
      requestHeaders = init?.headers
      return new Response(JSON.stringify({
        web: { results: [{ title: 'Brave result', url: 'https://docs.example.com', description: 'Snippet' }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    const output = await searchWithExternalProvider(
      'brave',
      { query: 'moss', blocked_domains: ['spam.example'] },
      'brave-key',
      new AbortController().signal,
    )

    expect(requestUrl).toContain('api.search.brave.com/res/v1/web/search')
    expect(new URL(requestUrl).searchParams.get('q')).toBe('-site:spam.example moss')
    expect(requestHeaders).toMatchObject({ 'X-Subscription-Token': 'brave-key' })
    expect(output.results[1]).toMatchObject({
      content: [{ title: 'Brave result', url: 'https://docs.example.com', snippet: 'Snippet' }],
    })
  })
})
