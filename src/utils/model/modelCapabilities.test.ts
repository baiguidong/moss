import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { runWithSessionApiOverrides } from '../sessionApiOverrides.js'
import { getModelCapability, loadModelCapabilities } from './modelCapabilities.js'

mock.module('color-diff-napi', () => ({
  ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}),
}))

const { getContextWindowForModel, getModelMaxOutputTokens } = await import('../context.js')
const { resolveDesktopModelContext } = await import('./desktopModelContext.js')
const { calculateTokenWarningState, getAutoCompactThreshold } = await import('../../services/compact/autoCompact.js')

const servers: ReturnType<typeof Bun.serve>[] = []
const testGlobal = globalThis as typeof globalThis & { MACRO?: { VERSION: string } }
const originalMacro = testGlobal.MACRO
const originalApiKey = process.env.ANTHROPIC_API_KEY
beforeEach(() => {
  testGlobal.MACRO = { VERSION: 'test' }
  process.env.ANTHROPIC_API_KEY = 'test-key'
})
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
  if (originalMacro === undefined) delete testGlobal.MACRO
  else testGlobal.MACRO = originalMacro
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalApiKey
})

function withCatalog<T>(
  fetch: (request: Request) => Response | Promise<Response>,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch })
  servers.push(server)
  const baseUrl = `${server.url.origin}/v1`
  return runWithSessionApiOverrides({ mossBaseUrl: baseUrl, mossAuthToken: crypto.randomUUID() }, () => run(baseUrl))
}

describe('provider model capabilities', () => {
  test('desktop lookup loads the same limits on reopen and follows model changes', async () => {
    let requests = 0
    await withCatalog(request => {
      requests++
      expect(request.headers.get('authorization')).toBe('Bearer desktop-account')
      return Response.json({ data: [
        { id: 'gpt-5.5', context_window: 1_000_000 },
        { id: 'smaller-model', context_window: 128_000 },
      ] })
    }, async url => {
      const options = { url, apiKey: 'desktop-account', model: 'gpt-5.5' }
      expect(await resolveDesktopModelContext(options)).toEqual({
        model: 'gpt-5.5', contextWindow: 1_000_000, isDefault: false,
      })
      expect(await resolveDesktopModelContext(options)).toMatchObject({ contextWindow: 1_000_000 })
      expect(await resolveDesktopModelContext({ ...options, model: 'smaller-model' })).toEqual({
        model: 'smaller-model', contextWindow: 128_000, isDefault: false,
      })
      expect(await resolveDesktopModelContext({ ...options, model: 'unknown-model' })).toEqual({
        model: 'unknown-model', contextWindow: 200_000, isDefault: true,
      })
      expect(requests).toBe(1)
    })
  })

  test('desktop lookup respects context policy and marks unavailable metadata as default', async () => {
    await withCatalog(() => new Response('Not found', { status: 404 }), async url => {
      expect(await resolveDesktopModelContext({ model: 'unknown', url })).toEqual({
        model: 'unknown', contextWindow: 200_000, isDefault: true,
      })
      expect(await resolveDesktopModelContext({ model: 'claude-sonnet-4[1m]', url })).toMatchObject({
        contextWindow: 1_000_000, isDefault: false,
      })
      expect(await resolveDesktopModelContext({ model: ' ', url })).toBeNull()
    })
  })

  test('uses the gateway 1M window before applying compaction and blocking thresholds', async () => {
    const requests: string[] = []
    await withCatalog(request => {
      requests.push(new URL(request.url).pathname)
      return Response.json({ data: [{ id: 'gpt-5.5', context_window: 1_000_000, max_output_tokens: 128_000 }] })
    }, async () => {
      expect(getContextWindowForModel('gpt-5.5')).toBe(200_000)
      await Promise.all([loadModelCapabilities('gpt-5.5'), loadModelCapabilities('gpt-5.5')])
      await loadModelCapabilities('gpt-5.5')
      expect(requests).toEqual(['/v1/models'])
      expect(getContextWindowForModel('gpt-5.5')).toBe(1_000_000)
      expect(getModelMaxOutputTokens('gpt-5.5')).toEqual({ default: 32_000, upperLimit: 128_000 })
      expect(getAutoCompactThreshold('gpt-5.5')).toBe(967_000)
      expect(calculateTokenWarningState(185_837, 'gpt-5.5')).toMatchObject({
        isAboveAutoCompactThreshold: false, isAtBlockingLimit: false,
      })
      expect(calculateTokenWarningState(967_000, 'gpt-5.5').isAboveAutoCompactThreshold).toBe(true)
      expect(calculateTokenWarningState(977_000, 'gpt-5.5').isAtBlockingLimit).toBe(true)
    })
  })

  test('reads subsequent catalog pages and native Anthropic token fields', async () => {
    const cursors: (string | null)[] = []
    await withCatalog(request => {
      const cursor = new URL(request.url).searchParams.get('after_id')
      cursors.push(cursor)
      return Response.json(cursor ? {
        data: [{ id: 'gpt-5.5', max_input_tokens: 1_000_000, max_tokens: 128_000 }], has_more: false,
      } : {
        data: [{ id: 'first-model' }], has_more: true, last_id: 'first-model',
      })
    }, async () => {
      await loadModelCapabilities('gpt-5.5')
      expect(cursors).toEqual([null, 'first-model'])
      expect(getContextWindowForModel('gpt-5.5')).toBe(1_000_000)
    })
  })

  test('isolates limits by endpoint and credentials, including simultaneous sessions', async () => {
    await withCatalog(request => Response.json({ data: [{
      id: 'gpt-5.5', context_window: request.headers.get('authorization') === 'Bearer account-a' ? 1_000_000 : 200_000,
    }] }), async baseUrl => {
      await Promise.all([
        runWithSessionApiOverrides({ mossBaseUrl: baseUrl, mossAuthToken: 'account-a' }, async () => {
          await loadModelCapabilities('gpt-5.5')
          expect(getContextWindowForModel('gpt-5.5')).toBe(1_000_000)
        }),
        runWithSessionApiOverrides({ mossBaseUrl: baseUrl, mossAuthToken: 'account-b' }, async () => {
          expect(getModelCapability('gpt-5.5')).toBeUndefined()
          await loadModelCapabilities('gpt-5.5')
          expect(getContextWindowForModel('gpt-5.5')).toBe(200_000)
        }),
      ])
      await withCatalog(() => Response.json({ data: [] }), async () => {
        expect(getModelCapability('gpt-5.5')).toBeUndefined()
        await loadModelCapabilities('gpt-5.5')
        expect(getContextWindowForModel('gpt-5.5')).toBe(200_000)
      })
    })
  })

  test('ignores malformed limits and falls back for models without metadata', async () => {
    await withCatalog(() => Response.json({ data: [
      null, {}, { id: 'gpt-5.5', context_window: -1, max_output_tokens: '128000' },
      { id: 'fractional', max_input_tokens: 100_000.5 },
    ] }), async () => {
      await loadModelCapabilities('gpt-5.5')
      expect(getModelCapability('gpt-5.5')).toBeUndefined()
      expect(getModelCapability('fractional')).toBeUndefined()
      expect(getContextWindowForModel('gpt-5.5')).toBe(200_000)
    })
  })

  test('keeps the fallback and backs off when the optional endpoint is unavailable', async () => {
    let requests = 0
    await withCatalog(() => {
      requests++
      return new Response('Not found', { status: 404 })
    }, async () => {
      await loadModelCapabilities('gpt-5.5')
      await loadModelCapabilities('gpt-5.5')
      expect(requests).toBe(1)
      expect(getContextWindowForModel('gpt-5.5')).toBe(200_000)
    })
  })

  test('skips discovery for an already cancelled query', async () => {
    let requests = 0
    await withCatalog(() => {
      requests++
      return Response.json({ data: [] })
    }, async () => {
      await loadModelCapabilities('gpt-5.5', AbortSignal.abort())
      expect(requests).toBe(0)
    })
  })
})
