import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { runWithSessionApiOverrides } from '../sessionApiOverrides.js'
import { getModelCapability, loadModelCapabilities } from './modelCapabilities.js'

mock.module('color-diff-napi', () => ({
  ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}),
}))

const { getContextWindowForModel, getModelMaxOutputTokens, resolveContextWindowForModel } = await import('../context.js')
const { resolveDesktopModelContext } = await import('./desktopModelContext.js')
const { calculateTokenWarningState, getAutoCompactThreshold, getEffectiveContextWindowSize } = await import('../../services/compact/autoCompact.js')

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

describe('model context declarations', () => {
  test('uses saved limits for compaction and falls back to 200k for every model name', () => {
    for (const model of ['gpt-6.1-sol', 'gpt-4.1', 'claude-sonnet-4[1m]', 'unknown']) {
      expect(resolveContextWindowForModel(model)).toEqual({ contextWindow: 200_000, isDefault: true })
      expect(getAutoCompactThreshold(model)).toBe(167_000)
    }
    runWithSessionApiOverrides({
      declaredContextWindows: { 'gpt-6.1-sol': 1_000_000, 'fast-model': 500_000, 'claude-sonnet-4': 800_000 },
    }, () => {
      expect(resolveContextWindowForModel('gpt-6.1-sol')).toEqual({ contextWindow: 1_000_000, isDefault: false })
      expect(getEffectiveContextWindowSize('gpt-6.1-sol')).toBe(980_000)
      expect(getAutoCompactThreshold('gpt-6.1-sol')).toBe(967_000)
      expect(getAutoCompactThreshold('fast-model')).toBe(467_000)
      expect(getContextWindowForModel('claude-sonnet-4[1m]')).toBe(800_000)
      expect(calculateTokenWarningState(967_000, 'gpt-6.1-sol').isAboveAutoCompactThreshold).toBe(true)
    })
  })

  test('provider metadata does not change a saved context or the 200k fallback', async () => {
    await withCatalog(() => Response.json({ data: [
      { id: 'large-model', context_window: 1_050_000, max_input_tokens: 922_000, max_tokens: 128_000 },
      { id: 'small-model', context_window: 65_536 },
    ] }), async url => {
      await loadModelCapabilities('large-model')
      expect(getModelCapability('large-model')?.context_window).toBe(1_050_000)
      expect(getModelMaxOutputTokens('large-model')).toEqual({ default: 32_000, upperLimit: 128_000 })
      expect(getContextWindowForModel('large-model')).toBe(200_000)
      expect(getContextWindowForModel('small-model')).toBe(200_000)
      expect(await resolveDesktopModelContext({ model: 'large-model', url })).toEqual({
        model: 'large-model', contextWindow: 200_000, isDefault: true,
      })
      expect(await resolveDesktopModelContext({
        model: 'large-model', url, declaredContextWindows: { 'large-model': 1_000_000 },
      })).toEqual({ model: 'large-model', contextWindow: 1_000_000, isDefault: false })
      runWithSessionApiOverrides({ declaredContextWindows: { 'large-model': 500_000 } }, () => {
        expect(getContextWindowForModel('large-model')).toBe(500_000)
        expect(getAutoCompactThreshold('large-model')).toBe(467_000)
      })
    })
  })

  test('catalog discovery still caches output capabilities and backs off on failure', async () => {
    let requests = 0
    await withCatalog(() => {
      requests++
      return new Response('Not found', { status: 404 })
    }, async () => {
      await loadModelCapabilities('gpt-6.1-sol')
      await loadModelCapabilities('gpt-6.1-sol')
      expect(requests).toBe(1)
      expect(getContextWindowForModel('gpt-6.1-sol')).toBe(200_000)
    })
  })

  test('desktop context requires a model name', async () => {
    expect(await resolveDesktopModelContext({ model: ' ', url: 'https://example.test/v1' })).toBeNull()
  })
})
