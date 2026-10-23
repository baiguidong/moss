import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotSideQuestionMessages, sideQuestionApiMessages, runSideQuestion } from './sideQuestion'
import { createAssistantMessage, createUserMessage } from './messages'
import { getEmptyToolPermissionContext } from '../Tool'

test('side snapshot fills only missing receipts as unknown and does not mutate main history', () => {
  const messages = [createUserMessage({ content: 'task' }), createAssistantMessage({ content: [
    { type: 'tool_use', id: 'finished', name: 'Read', input: {} },
    { type: 'tool_use', id: 'pending', name: 'Bash', input: {} },
  ] }), createUserMessage({ content: [{ type: 'tool_result', tool_use_id: 'finished', content: 'actual content' }] })]
  const before = JSON.stringify(messages)
  const snapshot = snapshotSideQuestionMessages(messages)
  expect(JSON.stringify(messages)).toBe(before)
  const text = JSON.stringify(snapshot)
  expect(text).toContain('actual content')
  expect(text).toContain('outcome are unknown')
  expect(text.match(/"tool_use_id":"finished"/g)).toHaveLength(1)
  expect(text.match(/"tool_use_id":"pending"/g)).toHaveLength(1)
  const apiCopy = JSON.stringify(sideQuestionApiMessages(messages))
  expect(apiCopy).not.toContain('"type":"tool_use"')
  expect(apiCopy).not.toContain('"type":"tool_result"')
  expect(apiCopy).toContain('actual content')
  expect(apiCopy).toContain('outcome are unknown')
})

const envKeys = ['MOSS_CONFIG_DIR', 'MOSS_FEATURE_FLAG_OVERRIDES', 'MOSS_MODEL_AUTH_TOKEN', 'MOSS_MODEL_BASE_URL', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_TEST_FIXTURES_ROOT', 'VCR_RECORD']
let previous: Record<string, string | undefined>, temp: string, macro: any, fetchMock: ReturnType<typeof spyOn> | undefined
beforeEach(async () => {
  previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  macro = (globalThis as any).MACRO; (globalThis as any).MACRO = { VERSION: 'test' }
  temp = await mkdtemp(join(tmpdir(), 'moss-side-question-'))
  Object.assign(process.env, { MOSS_CONFIG_DIR: temp, CLAUDE_CODE_TEST_FIXTURES_ROOT: temp, VCR_RECORD: '1', MOSS_FEATURE_FLAG_OVERRIDES: '{}',
    MOSS_MODEL_AUTH_TOKEN: 'fixture-token', MOSS_MODEL_BASE_URL: 'https://model.invalid', ANTHROPIC_API_KEY: 'fixture-key' })
})
afterEach(async () => {
  fetchMock?.mockRestore(); fetchMock = undefined
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  if (macro === undefined) delete (globalThis as any).MACRO; else (globalThis as any).MACRO = macro
  await rm(temp, { recursive: true, force: true })
})
function stream(blocks: any[], stop = 'end_turn') {
  const events = [ { type: 'message_start', message: { id: 'side-fixture', type: 'message', role: 'assistant', model: 'fixture-model', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    ...blocks.flatMap((block, index) => [
      { type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { ...block, text: '' } },
      { type: 'content_block_delta', index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } },
      { type: 'content_block_stop', index },
    ]),
    { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } }, { type: 'message_stop' } ]
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}
function params() {
  return { systemPrompt: [] as any, userContext: {}, systemContext: {}, forkContextMessages: [createUserMessage({ content: 'session A task' })],
    toolUseContext: { options: { mainLoopModel: 'fixture-model', thinkingConfig: { type: 'adaptive' }, tools: [{ name: 'Bash', call: () => { throw new Error('must never run') } }] },
      getAppState: () => ({ toolPermissionContext: getEmptyToolPermissionContext() }) } as any }
}
test('isolated side question uses one model request with no tools or executor even if the model returns tool_use', async () => {
  const requests: any[] = []
  fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    requests.push(JSON.parse(String(init?.body)))
    return stream([{ type: 'tool_use', id: 'unexpected', name: 'Bash', input: { command: 'never-execute' } }], 'tool_use')
  }, { preconnect: () => {} }))
  const result = await runSideQuestion({ question: 'why?', cacheSafeParams: params(), isolated: true })
  expect(requests).toHaveLength(1)
  expect(requests[0].tools || []).toHaveLength(0)
  expect(result.status).toBe('tool_unavailable')
})
test('isolated answers report output limits and use their own abort signal', async () => {
  fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => stream([{ type: 'text', text: 'Partial answer' }], 'max_tokens'), { preconnect: () => {} }))
  const context = params()
  const mainAbort = new AbortController(); mainAbort.abort()
  context.toolUseContext.abortController = mainAbort
  const result = await runSideQuestion({ question: 'why?', cacheSafeParams: context, isolated: true, abortController: new AbortController() })
  expect(result.status).toBe('truncated'); expect(result.response).toBe('Partial answer')
  const cancel = new AbortController(); cancel.abort(new Error('cancel only side'))
  await expect(runSideQuestion({ question: 'why?', cacheSafeParams: context, isolated: true, abortController: cancel })).rejects.toThrow('cancel only side')
})

test.each(['adaptive', 'disabled'])('gpt-6.1-sol side question inherits effort with %s thinking on the HTTP request', async thinkingType => {
  const requests: any[] = []
  fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body)); requests.push(body)
    return stream([{ type: 'text', text: 'The worker was stopped.' }])
  }, { preconnect: () => {} }))
  const context = params()
  context.toolUseContext.options.mainLoopModel = 'gpt-6.1-sol'
  context.toolUseContext.options.thinkingConfig = { type: thinkingType }
  context.toolUseContext.getAppState = () => ({ toolPermissionContext: getEmptyToolPermissionContext(), effortValue: 'low' })
  const result = await runSideQuestion({ question: 'Are you generating it?', cacheSafeParams: context, isolated: true })
  expect(requests).toHaveLength(1)
  expect(requests[0].thinking).toEqual({ type: thinkingType })
  expect(requests[0].output_config?.effort).toBe('low')
  expect(requests[0].tools || []).toHaveLength(0)
  expect(result.status).toBe('completed')
  expect(result.response).toBe('The worker was stopped.')
})
