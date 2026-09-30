import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  captureResponseTraceSnapshot,
  clearTraceCaptureStateForTests,
  drainTraceCaptureForTests,
  setTraceAppendBeforeWriteHookForTests,
  traceCaptureService,
  updateTraceCaptureSettings,
  withTraceScope,
} from './traceCapture.js'
import { createTraceFetch, drainTraceFetchForTests } from './traceFetch.js'
import { TraceResponseCollector } from '../trace/responseCapture.js'

let scope: string
beforeEach(async () => { scope = await mkdtemp(join(tmpdir(), 'moss-trace-fetch-')) })
afterEach(async () => {
  await drainTraceFetchForTests()
  await drainTraceCaptureForTests()
  clearTraceCaptureStateForTests()
  await rm(scope, { recursive: true, force: true })
})
const request = { method: 'POST', body: JSON.stringify({ model: 'fixture-model', system: 'system prompt', messages: [{ role: 'user', content: 'hi' }] }) }
const encoder = new TextEncoder()
const frame = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`)

describe('model fetch trace lifecycle', () => {
  test.each([
    [{ max_tokens: 1024 }, 'max_tokens', 1024],
    [{ max_completion_tokens: 512 }, 'max_completion_tokens', 512],
    [{ max_output_tokens: 256 }, 'max_output_tokens', 256],
    [{ max_tokens: 128, max_output_tokens: 256 }, 'multiple', undefined],
    [{}, 'omit', undefined],
  ])('records the actual output budget from wire request %j', async (limits, field, effective) => withTraceScope(scope, async () => {
    let releaseWrite!: () => void
    const writeBlocked = new Promise<void>(resolve => { releaseWrite = resolve })
    let writeStarted = false
    setTraceAppendBeforeWriteHookForTests(async () => { writeStarted = true; await writeBlocked })
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      const traced = createTraceFetch(async () => new Response('immediate response'), { sessionId: 'output-budget' })
      const modelResult = (async () => {
        const response = await traced('https://model.invalid/messages', {
          ...request, body: JSON.stringify({ ...JSON.parse(request.body), ...limits }),
        })
        return response.text()
      })()
      // An intentionally blocked trace write must not delay either response
      // delivery or consumption, including when it finishes before parsing.
      expect(await Promise.race([
        modelResult,
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Model response waited for trace I/O')), 1000) }),
      ])).toBe('immediate response')
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(writeStarted).toBe(true)
    } finally {
      if (deadline) clearTimeout(deadline)
      releaseWrite()
      setTraceAppendBeforeWriteHookForTests(null)
      await drainTraceFetchForTests()
    }
    const trace = await traceCaptureService.getSessionTrace('output-budget')
    const protocol = trace.calls[0]?.metadata?.protocolTrace as { outputBudget?: unknown }
    expect(protocol.outputBudget).toEqual({
      source: 'unknown', field, wireFields: limits,
      ...(effective === undefined ? {} : { effective }),
    })
    expect(trace.events.find(event => event.phase === 'api_call_completed')?.metadata?.protocolTrace).toEqual(protocol)
  }))

  test('redacts stored URL credentials/query values without changing the actual fetch URL', async () => withTraceScope(scope, async () => {
    const url = 'https://wire-user:wire-password@model.invalid/messages?api_key=wire-key&access_token=wire-token'
    let receivedUrl: unknown
    const traced = createTraceFetch(async input => {
      receivedUrl = input
      return new Response('ok')
    }, { sessionId: 'url-redaction' })
    expect(await (await traced(url, request)).text()).toBe('ok')
    expect(receivedUrl).toBe(url)
    await drainTraceFetchForTests()
    const raw = await readFile(join(scope, 'traces', 'url-redaction.jsonl'), 'utf8')
    for (const secret of ['wire-user', 'wire-password', 'wire-key', 'wire-token']) {
      expect(raw).not.toContain(secret)
    }
  }))

  test('keeps full pending request, fetch override and a completed call when the setting changes midflight', async () => withTraceScope(scope, async () => {
    let resolveFetch!: (response: Response) => void
    let receivedBody: unknown
    const traced = createTraceFetch(async (_input, init) => {
      receivedBody = init?.body
      return new Promise(resolve => { resolveFetch = resolve })
    }, { sessionId: 'live', querySource: 'agent' })
    const result = traced('https://model.invalid/v1/messages', request)
    await drainTraceFetchForTests()
    const pending = await traceCaptureService.getSessionTrace('live')
    expect(pending.calls[0]?.status).toBe('pending')
    expect(pending.calls[0]?.request.semantic?.request.system).toBe('system prompt')
    expect(receivedBody).toBe(request.body)
    await updateTraceCaptureSettings({ enabled: false })
    resolveFetch(new Response(JSON.stringify({ usage: { input_tokens: 7, output_tokens: 2 }, content: [{ type: 'text', text: 'answer' }], stop_reason: 'end_turn' }), { headers: { 'content-type': 'application/json' } }))
    expect(await (await result).json()).toMatchObject({ content: [{ text: 'answer' }] })
    await drainTraceFetchForTests()
    const completed = await traceCaptureService.getSessionTrace('live')
    expect(completed.calls).toHaveLength(1)
    expect(completed.calls[0]).toMatchObject({ status: 'ok', querySource: 'agent', usage: { inputTokens: 7, outputTokens: 2 } })
    const disabled = createTraceFetch(async () => new Response('disabled'), { sessionId: 'disabled' })
    expect(await (await disabled('https://model.invalid/messages', request)).text()).toBe('disabled')
    await drainTraceFetchForTests()
    expect((await traceCaptureService.getSessionTrace('disabled')).calls).toEqual([])
    const raw = await readFile(join(scope, 'traces', 'live.jsonl'), 'utf8')
    expect(raw.split('\n').filter(Boolean)).toHaveLength(4)
  }))

  test('observes demand without eager clone draining and forwards cancellation', async () => withTraceScope(scope, async () => {
    let pulls = 0
    let cancelled: unknown
    const traced = createTraceFetch(async () => new Response(new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(frame({ type: 'content_block_delta', delta: { text: 'piece' } })) },
      cancel(reason) { cancelled = reason },
    }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream' } }), { sessionId: 'cancel' })
    const response = await traced('https://model.invalid/messages', request)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(pulls).toBe(0)
    const reader = response.body!.getReader()
    expect((await reader.read()).done).toBe(false)
    expect(pulls).toBe(1)
    await reader.cancel('fixture cancellation')
    expect(cancelled).toBe('fixture cancellation')
    await drainTraceFetchForTests()
    expect((await traceCaptureService.getSessionTrace('cancel')).calls[0]).toMatchObject({
      status: 'error', metadata: { aborted: true }, response: { body: { truncated: true } },
    })
  }))

  test('preserves final usage and stop reason beyond raw preview/capture limits', async () => withTraceScope(scope, async () => {
    const chunks = [
      frame({ type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } }),
      ...Array.from({ length: 140 }, () => frame({ type: 'content_block_delta', delta: { text: 'x'.repeat(8192) } })),
      frame({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 321 } }),
      frame({ type: 'message_stop' }),
    ]
    const traced = createTraceFetch(async () => new Response(new ReadableStream({
      pull(controller) { const next = chunks.shift(); if (next) controller.enqueue(next); else controller.close() },
    }), { headers: { 'content-type': 'text/event-stream' } }), { sessionId: 'large' })
    const response = await traced('https://model.invalid/messages', request)
    expect((await response.text()).length).toBeGreaterThan(1024 * 1024)
    await drainTraceFetchForTests()
    const trace = await traceCaptureService.getSessionTrace('large')
    expect(trace.calls[0]).toMatchObject({
      status: 'ok', usage: { inputTokens: 100, outputTokens: 321 },
      response: { body: { truncated: true } },
      metadata: { protocolTrace: { termination: { finishReason: 'max_tokens', event: 'message_stop' } } },
    })
    expect(trace.summary.totalOutputTokens).toBe(321)
  }))

  test('records transport errors without replacing the original rejection', async () => withTraceScope(scope, async () => {
    const error = new TypeError('fixture transport failure')
    const traced = createTraceFetch(async () => { throw error }, { sessionId: 'failure' })
    await expect(traced('https://model.invalid/messages', request)).rejects.toBe(error)
    await drainTraceFetchForTests()
    expect((await traceCaptureService.getSessionTrace('failure')).calls[0]).toMatchObject({ status: 'error', error: { name: 'TypeError', message: error.message } })
  }))

  test('records HTTP and protocol errors, while preserving response bytes and read-error identity', async () => withTraceScope(scope, async () => {
    const httpError = createTraceFetch(async () => new Response('quota exceeded', { status: 429 }), { sessionId: 'http-error' })
    const httpResponse = await httpError('https://model.invalid/messages', request)
    expect(httpResponse.status).toBe(429)
    expect(await httpResponse.text()).toBe('quota exceeded')
    const protocolBody = frame({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } })
    const protocolError = createTraceFetch(async () => new Response(protocolBody, { headers: { 'content-type': 'text/event-stream' } }), { sessionId: 'protocol-error' })
    expect(await (await protocolError('https://model.invalid/messages', request)).text()).toBe(new TextDecoder().decode(protocolBody))
    const originalError = new Error('upstream stream broke')
    const readError = createTraceFetch(async () => new Response(new ReadableStream({
      pull(controller) { controller.error(originalError) },
    })), { sessionId: 'read-error' })
    await expect((await readError('https://model.invalid/messages', request)).text()).rejects.toBe(originalError)
    await drainTraceFetchForTests()
    for (const id of ['http-error', 'protocol-error', 'read-error']) {
      expect((await traceCaptureService.getSessionTrace(id)).calls[0]?.status).toBe('error')
    }
  }))

  test('a response diagnostics failure never replaces the successful model body', async () => withTraceScope(scope, async () => {
    const fail = spyOn(TraceResponseCollector.prototype, 'finish').mockImplementation(() => { throw new Error('diagnostic fixture') })
    try {
      const traced = createTraceFetch(async () => new Response('exact model bytes'), { sessionId: 'diagnostic-failure' })
      expect(await (await traced('https://model.invalid/messages', request)).text()).toBe('exact model bytes')
      await drainTraceFetchForTests()
    } finally { fail.mockRestore() }
  }))

  test('ends a wedged body on abort and retains partial response', async () => withTraceScope(scope, async () => {
    const controller = new AbortController()
    const traced = createTraceFetch(async () => new Response(new ReadableStream({
      start(stream) { stream.enqueue(frame({ type: 'message_start', message: { usage: { input_tokens: 4 } } })) },
    }), { headers: { 'content-type': 'text/event-stream' } }), { sessionId: 'aborted' })
    const response = await traced('https://model.invalid/messages', { ...request, signal: controller.signal })
    const reader = response.body!.getReader()
    await reader.read()
    controller.abort(new DOMException('fixture timeout', 'TimeoutError'))
    await drainTraceFetchForTests()
    expect((await traceCaptureService.getSessionTrace('aborted')).calls[0]).toMatchObject({ status: 'error', error: { name: 'TimeoutError' }, usage: { inputTokens: 4 } })
    await reader.cancel()
  }))

  test('capture persistence failures cannot reject a successful model response', async () => {
    const invalid = join(scope, 'not-a-directory')
    await writeFile(invalid, 'fixture')
    await withTraceScope(invalid, async () => {
      const traced = createTraceFetch(async () => new Response('unchanged'), { sessionId: 'unwritable' })
      expect(await (await traced('https://model.invalid/messages', request)).text()).toBe('unchanged')
      await drainTraceFetchForTests()
    })
  })

  test('explicit response capture shares bounded protocol diagnostics and abort behavior', async () => {
    const controller = new AbortController()
    const response = new Response(new ReadableStream({
      start(stream) { stream.enqueue(frame({ type: 'message_start', message: { usage: { input_tokens: 5 } } })) },
    }), { headers: { 'content-type': 'text/event-stream' } })
    const capture = captureResponseTraceSnapshot(response, { signal: controller.signal, abortGraceMs: 10 })
    await Promise.resolve()
    controller.abort()
    expect(await capture).toMatchObject({ aborted: true, usage: { inputTokens: 5 }, snapshot: { truncated: true } })
  })

  test('explicit snapshot capture still recognizes a Responses terminal on a socket left open', async () => {
    let cancelled = false
    const response = new Response(new ReadableStream({
      start(stream) { stream.enqueue(frame({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 5, output_tokens: 2 } } })) },
      cancel() { cancelled = true },
    }), { headers: { 'content-type': 'text/event-stream' } })
    expect(await captureResponseTraceSnapshot(response)).toMatchObject({
      aborted: false, usage: { inputTokens: 5, outputTokens: 2 },
      protocolTrace: { termination: { event: 'response.completed' } },
    })
    expect(cancelled).toBe(true)
  })
})
