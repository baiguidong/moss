import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

mock.module('color-diff-napi', () => ({ ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}) }))

const { QueryEngine } = await import('./QueryEngine.js')
const { getDefaultAppState } = await import('./state/AppStateStore.js')
const { createStore } = await import('./state/store.js')
const { runWithSessionIdContext } = await import('./utils/sessionIdContext.js')
const { asSessionId } = await import('./types/ids.js')
const { resetProjectForTesting, flushSessionStorage } = await import('./utils/sessionStorage.js')
const { registerModelUsageEventListener } = await import('./utils/modelUsageEvents.js')
const { appendSessionRuntimeEvent } = await import('../ui/src/shared/assistant-usage-reconcile.mjs')
const { deriveContextUsage } = await import('../ui/src/renderer-react/lib/context-usage.js')

const envKeys = ['MOSS_CONFIG_DIR', 'MOSS_FEATURE_FLAG_OVERRIDES', 'MOSS_RUNTIME_ADVANCED_SETTINGS',
  'MOSS_MODEL_AUTH_TOKEN', 'MOSS_MODEL_BASE_URL', 'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_TEST_FIXTURES_ROOT', 'VCR_RECORD', 'TEST_ENABLE_SESSION_PERSISTENCE',
  'CLAUDE_CODE_EAGER_FLUSH']
let previousEnv: Record<string, string | undefined>
let root: string
let previousMacro: unknown
let fetchSpy: ReturnType<typeof spyOn> | undefined

beforeEach(async () => {
  previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  previousMacro = (globalThis as any).MACRO
  root = await mkdtemp(join(tmpdir(), 'moss-query-usage-'))
  Object.assign(process.env, { MOSS_CONFIG_DIR: root, MOSS_FEATURE_FLAG_OVERRIDES: '{}',
    MOSS_RUNTIME_ADVANCED_SETTINGS: '{"moss_context_compaction_strategy":"proactive"}',
    MOSS_MODEL_AUTH_TOKEN: 'fixture-token', MOSS_MODEL_BASE_URL: 'https://model.invalid',
    ANTHROPIC_API_KEY: 'fixture-key', CLAUDE_CODE_TEST_FIXTURES_ROOT: root, VCR_RECORD: '1',
    TEST_ENABLE_SESSION_PERSISTENCE: '1', CLAUDE_CODE_EAGER_FLUSH: '1' })
  ;(globalThis as any).MACRO = { VERSION: 'test' }
  resetProjectForTesting()
})

afterEach(async () => {
  fetchSpy?.mockRestore()
  fetchSpy = undefined
  await flushSessionStorage()
  resetProjectForTesting()
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (previousMacro === undefined) delete (globalThis as any).MACRO
  else (globalThis as any).MACRO = previousMacro
  await rm(root, { recursive: true, force: true })
})

const finalUsage = { input_tokens: 3, cache_read_input_tokens: 191_863,
  cache_creation_input_tokens: 2565, output_tokens: 1122,
  billing_usage: { source: 'oai_responses', semantic: 'openai', openai_usage: {
    prompt_tokens: 0, completion_tokens: 0, total_tokens: 195_553,
    prompt_tokens_details: { cached_tokens: 0 },
  } } }

async function responseStream(interrupted = false) {
  const events = [
    { type: 'message_start', message: { id: 'captured-response', type: 'message', role: 'assistant',
      model: 'gpt-6-sol', content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 221_624, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'first' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'second' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: finalUsage },
    { type: 'message_stop' },
  ]
  const encoded = new TextEncoder()
  return new Response(new ReadableStream({
    async start(controller) {
      for (const event of events) {
        if (interrupted && event.type === 'message_delta') {
          controller.enqueue(encoded.encode('event: error\ndata: {"type":"error","error":{"type":"api_error","message":"Fixture stream interrupted"}}\n\n'))
          break
        }
        if (event.type === 'message_delta') await new Promise(resolve => setTimeout(resolve, 160))
        controller.enqueue(encoded.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  }), { headers: { 'content-type': 'text/event-stream', 'request-id': 'fixture-http-request' } })
}

describe('SDK final usage end-to-end', () => {
  for (const includePartialMessages of [true, false]) {
    test(`SDK, UI, transcript and ledger agree with partial messages ${includePartialMessages}`, async () => {
      fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input instanceof Request ? input.url : input)
        const pathname = new URL(url).pathname
        if (pathname.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-6-sol' }] })
        if (pathname.endsWith('/messages')) return responseStream()
        throw new Error(`Unexpected fixture network request: ${url}`)
      })
      const sessionId = asSessionId(randomUUID())
      const receipts: any[] = []
      const stopListening = registerModelUsageEventListener(sessionId, event => receipts.push(event))
      try {
        await runWithSessionIdContext(sessionId, root, async () => {
          const store = createStore(getDefaultAppState())
          const engine = new QueryEngine({ cwd: root, tools: [], commands: [], mcpClients: [], agents: [],
            canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
            getAppState: store.getState, setAppState: store.setState, readFileCache: new Map() as any,
            userSpecifiedModel: 'gpt-6-sol', customSystemPrompt: 'Fixture system prompt',
            thinkingConfig: { type: 'disabled' }, includePartialMessages })
          let history: any[] = []
          const emitted: any[] = []
          for await (const message of engine.submitMessage('fixture request')) {
            const wireMessage = JSON.parse(JSON.stringify(message))
            emitted.push(wireMessage)
            history = appendSessionRuntimeEvent(history, wireMessage)
          }
          expect(emitted.filter(message => message.type === 'assistant')).toHaveLength(2)
          for (const assistant of history.filter(message => message.type === 'assistant')) {
            expect(assistant.message).toMatchObject({ stop_reason: 'end_turn', usage: {
              input_tokens: 3, cache_read_input_tokens: 191_863,
              cache_creation_input_tokens: 2565, output_tokens: 1122,
            } })
          }
          expect(deriveContextUsage(history, null)).toMatchObject({ used: 195_553, outputTokens: 1122 })
          const result = emitted.findLast(message => message.type === 'result')
          expect(result?.subtype).toBe('success')
          expect(result?.usage).toMatchObject({ input_tokens: 3, cache_read_input_tokens: 191_863,
            cache_creation_input_tokens: 2565, output_tokens: 1122 })
          expect(result?.modelUsage['gpt-6-sol'].contextWindow).toBe(0)
          await flushSessionStorage()
          const transcript = (await readFile(join(root, `${sessionId}.jsonl`), 'utf8'))
            .split('\n').filter(Boolean).map(line => JSON.parse(line))
          const assistants = transcript.filter(message => message.type === 'assistant')
          expect(assistants).toHaveLength(2)
          for (const assistant of assistants) expect(assistant.message.usage).toMatchObject({
            input_tokens: 3, cache_read_input_tokens: 191_863, cache_creation_input_tokens: 2565, output_tokens: 1122,
          })
          expect(receipts).toHaveLength(1)
          expect(receipts[0]).toMatchObject({ inputTokens: 3, cacheReadTokens: 191_863,
            cacheWriteTokens: 2565, outputTokens: 1122 })
        })
      } finally {
        stopListening()
      }
    }, 30_000)
  }

  test('keeps partial content and the API error when a stream ends without final usage', async () => {
    process.env.MOSS_RUNTIME_ADVANCED_SETTINGS = '{"moss_disable_nonstreaming_fallback":true}'
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input instanceof Request ? input.url : input)
      const pathname = new URL(url).pathname
      if (pathname.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-6-sol' }] })
      if (pathname.endsWith('/messages')) return responseStream(true)
      throw new Error(`Unexpected fixture network request: ${url}`)
    })
    const sessionId = asSessionId(randomUUID())
    await runWithSessionIdContext(sessionId, root, async () => {
      const store = createStore(getDefaultAppState())
      const engine = new QueryEngine({ cwd: root, tools: [], commands: [], mcpClients: [], agents: [],
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        getAppState: store.getState, setAppState: store.setState, readFileCache: new Map() as any,
        userSpecifiedModel: 'gpt-6-sol', customSystemPrompt: 'Fixture system prompt',
        thinkingConfig: { type: 'disabled' }, includePartialMessages: false })
      const emitted = []
      for await (const message of engine.submitMessage('fixture interrupted request')) emitted.push(message)
      const assistants = emitted.filter(message => message.type === 'assistant')
      expect(assistants.some(message => message.message.model === '<synthetic>')).toBe(true)
      const partials = assistants.filter(message => message.message.id === 'captured-response')
      expect(partials).toHaveLength(2)
      for (const partial of partials) expect(partial.message.usage.input_tokens).toBe(221_624)
      await flushSessionStorage()
      const transcript = (await readFile(join(root, `${sessionId}.jsonl`), 'utf8'))
        .split('\n').filter(Boolean).map(line => JSON.parse(line))
      expect(transcript.filter(message => message.type === 'assistant'
        && message.message.id === 'captured-response')).toHaveLength(2)
    })
  }, 30_000)
})
