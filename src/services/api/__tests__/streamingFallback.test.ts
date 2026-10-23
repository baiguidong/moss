import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { createAssistantMessage, createUserMessage } from '../../../utils/messages.js'
import { queryModelWithStreaming } from '../claude.js'
import { RetryBudget } from '../retryBudget.js'
import { normalizeMessages } from '../../../utils/messages.js'
import type { AdvancedSettings } from '../../../../packages/direct-connect-protocol/src/index.js'

const envKeys = [
  'MOSS_CONFIG_DIR', 'MOSS_FEATURE_FLAG_OVERRIDES', 'MOSS_RUNTIME_ADVANCED_SETTINGS',
  'CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK', 'MOSS_MODEL_AUTH_TOKEN',
  'MOSS_MODEL_BASE_URL', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_TEST_FIXTURES_ROOT', 'VCR_RECORD',
]
let originalEnv: Record<string, string | undefined>
const testGlobal = globalThis as typeof globalThis & { MACRO?: { VERSION: string } }
let originalMacro: typeof testGlobal.MACRO
let configDir: string
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | undefined

beforeEach(async () => {
  originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  originalMacro = testGlobal.MACRO
  configDir = await mkdtemp(join(tmpdir(), 'moss-streaming-fallback-'))
  process.env.MOSS_CONFIG_DIR = configDir
  // Always consume fixture HTTP responses instead of a prior VCR recording.
  process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = configDir
  process.env.VCR_RECORD = '1'
  process.env.MOSS_MODEL_AUTH_TOKEN = 'fixture-token'
  process.env.MOSS_MODEL_BASE_URL = 'https://model.invalid'
  process.env.ANTHROPIC_API_KEY = 'fixture-key'
  process.env.MOSS_FEATURE_FLAG_OVERRIDES = '{}'
  delete process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK
  testGlobal.MACRO = { VERSION: 'test' }
})

afterEach(async () => {
  fetchSpy?.mockRestore()
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (originalMacro === undefined) delete testGlobal.MACRO
  else testGlobal.MACRO = originalMacro
  await rm(configDir, { recursive: true, force: true })
})

const responseMessage = {
  id: 'fixture-message', type: 'message', role: 'assistant', model: 'fixture-model',
  content: [{ type: 'text', text: 'Both PDFs are ready.' }],
  stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
}
const messageStart = {
  type: 'message_start', message: { ...responseMessage, content: [], stop_reason: null },
}
const toolStart = {
  type: 'content_block_start', index: 0,
  content_block: { type: 'tool_use', id: 'fixture-tool', name: 'Bash', input: {} },
}
const toolInput = {
  type: 'content_block_delta', index: 0,
  delta: { type: 'input_json_delta', partial_json: '{"command":"generate-pdfs"}' },
}
const streamError = {
  type: 'error', error: { type: 'api_error', message: 'Fixture stream disconnected' },
}

function sse(events: { type: string; [key: string]: unknown }[]): Response {
  return new Response(events.map(event => (
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  )).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

async function runQuery(
  settings: Partial<AdvancedSettings>,
  firstResponse = sse([]),
  fallbackResponse = new Response(JSON.stringify(responseMessage), {
    headers: { 'content-type': 'application/json' },
  }),
  retryBudget?: RetryBudget,
) {
  process.env.MOSS_RUNTIME_ADVANCED_SETTINGS = JSON.stringify(settings)
  const requests: { stream?: boolean }[] = []
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)))
    if (requests.length === 1) return firstResponse
    if (requests.length === 2) return fallbackResponse
    throw new Error('Unexpected extra recovery request')
  })
  let fallbacks = 0
  const output = []
  for await (const message of queryModelWithStreaming({
    messages: [
      createUserMessage({ content: 'Generate the two PDFs.' }),
      createAssistantMessage({ content: [{
        type: 'tool_use', id: 'previous-tool', name: 'Bash', input: { command: 'generate-pdfs' },
      }] }),
      createUserMessage({ content: [{
        type: 'tool_result', tool_use_id: 'previous-tool', content: 'PDFs generated.',
      }] }),
    ],
    systemPrompt: [], thinkingConfig: { type: 'disabled' }, tools: [],
    signal: new AbortController().signal,
    options: {
      model: 'fixture-model', isNonInteractiveSession: true,
      querySource: 'sdk', agents: [], mcpTools: [], hasAppendSystemPrompt: false,
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      onStreamingFallback: () => { fallbacks++ },
      retryBudget,
    },
  })) output.push(message)
  if (requests.length === 0) {
    throw new Error(`Fixture request was never sent: ${JSON.stringify(output)}`)
  }
  return {
    requests, fallbacks,
    assistants: output.filter(message => message.type === 'assistant'),
  }
}

describe('independent stream recovery policy', () => {
  test('finalizes all streamed blocks with captured native usage despite zero billing placeholders', async () => {
    const finalUsage = { input_tokens: 3, cache_read_input_tokens: 191_863,
      cache_creation_input_tokens: 2565, output_tokens: 1122,
      billing_usage: { source: 'oai_responses', semantic: 'openai',
        openai_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 195_553,
          prompt_tokens_details: { cached_tokens: 0 } } } }
    const result = await runQuery({}, sse([
      { ...messageStart, message: { ...messageStart.message,
        usage: { input_tokens: 221_624, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'first' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'second' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: finalUsage },
      { type: 'message_stop' },
    ]))
    expect(result.requests).toHaveLength(1)
    expect(result.assistants).toHaveLength(2)
    for (const message of normalizeMessages(result.assistants)) {
      expect(message.type).toBe('assistant')
      if (message.type === 'assistant') expect(message.message).toMatchObject({
        usage: { input_tokens: 3, cache_read_input_tokens: 191_863,
          cache_creation_input_tokens: 2565, output_tokens: 1122 }, stop_reason: 'end_turn',
      })
    }
  })

  test('404 recovery shares the streaming request attempt budget', async () => {
    const result = await runQuery({}, new Response(JSON.stringify({ error: { message: 'stream endpoint unavailable' } }), { status: 404 }), undefined, new RetryBudget({ maxAttempts: 1 }))
    expect(result.requests).toHaveLength(1)
    expect(JSON.stringify(result.assistants)).toContain('达到尝试次数上限')
  })
  test('an emitted tool call prevents automatic replay even when recovery is enabled', async () => {
    const result = await runQuery({ moss_streaming_tool_execution: true, moss_disable_nonstreaming_fallback: false }, sse([
      messageStart, toolStart, toolInput, { type: 'content_block_stop', index: 0 }, streamError,
    ]))
    expect(result.requests).toHaveLength(1)
    expect(result.fallbacks).toBe(0)
    expect(result.assistants.flatMap(message => message.message.content).filter(block => block.type === 'tool_use')).toHaveLength(1)
  })
  test.each([
    [false, false], [true, false], [false, true], [true, true],
  ])('streaming tools %s and recovery disabled %s are independent', async (streaming, disabled) => {
    const result = await runQuery({
      moss_streaming_tool_execution: streaming,
      moss_disable_nonstreaming_fallback: disabled,
    })
    expect(result.requests.map(request => Boolean(request.stream)))
      .toEqual(disabled ? [true] : [true, false])
    expect(result.fallbacks).toBe(disabled ? 0 : 1)
    expect(result.assistants).toHaveLength(1)
    if (disabled) expect(result.assistants[0]?.isApiErrorMessage).toBe(true)
    else expect(result.assistants[0]?.message.content).toEqual(responseMessage.content)
  })

  test.each([
    ['empty HTTP 200', () => sse([])],
    ['non-SSE HTTP 200', () => new Response('{}', { headers: { 'content-type': 'application/json' } })],
    ['message_start only', () => sse([messageStart])],
    ['unfinished tool arguments', () => sse([messageStart, toolStart, toolInput])],
  ] as const)('legacy settings recover %s after a previous tool succeeded', async (_name, response) => {
    const result = await runQuery({ moss_streaming_tool_execution: true }, response())
    expect(result.requests.map(request => Boolean(request.stream))).toEqual([true, false])
    expect(result.assistants[0]?.message.content).toEqual(responseMessage.content)
  })

  test('keeps the explicit environment opt-out authoritative', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    const result = await runQuery({ moss_disable_nonstreaming_fallback: false })
    expect(result.requests).toHaveLength(1)
    expect(result.fallbacks).toBe(0)
    expect(result.assistants[0]?.isApiErrorMessage).toBe(true)
  })

  test('an explicit opt-out prevents recovery from replaying an emitted tool call', async () => {
    const result = await runQuery({
      moss_streaming_tool_execution: true, moss_disable_nonstreaming_fallback: true,
    }, sse([
      messageStart, toolStart, toolInput,
      { type: 'content_block_stop', index: 0 }, streamError,
    ]))
    expect(result.requests).toHaveLength(1)
    expect(result.fallbacks).toBe(0)
    expect(result.assistants.flatMap(message => message.message.content)
      .filter(block => block.type === 'tool_use')).toHaveLength(1)
    expect(result.assistants.at(-1)?.isApiErrorMessage).toBe(true)
  })

  test('the opt-out still permits a fresh call with the same tool and arguments', async () => {
    const result = await runQuery({
      moss_streaming_tool_execution: true, moss_disable_nonstreaming_fallback: true,
    }, sse([
      messageStart, toolStart, toolInput,
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ]))
    expect(result.requests).toHaveLength(1)
    expect(result.fallbacks).toBe(0)
    expect(result.assistants[0]?.message.content).toMatchObject([{
      type: 'tool_use', name: 'Bash', input: { command: 'generate-pdfs' },
    }])
  })

  test('a valid empty end_turn does not trigger recovery', async () => {
    const result = await runQuery({}, sse([
      messageStart,
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } },
      { type: 'message_stop' },
    ]))
    expect(result.requests).toHaveLength(1)
    expect(result.assistants).toHaveLength(0)
  })

  test('a failed fallback reports an error once instead of looping', async () => {
    const result = await runQuery({}, sse([]), new Response('{}', {
      headers: { 'content-type': 'application/json' },
    }))
    expect(result.requests).toHaveLength(2)
    expect(result.fallbacks).toBe(1)
    expect(result.assistants).toHaveLength(1)
    expect(result.assistants[0]?.isApiErrorMessage).toBe(true)
  })
})
