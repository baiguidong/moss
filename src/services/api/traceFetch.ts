import type { ClientOptions } from '@anthropic-ai/sdk'
import {
  createTraceBodySnapshot,
  type RecordTraceCallInput,
} from '../trace/traceRecord.js'
import { randomUUID as createTraceCallId } from 'node:crypto'
import { resolveTraceCapture } from '../trace/traceOutput.js'
import { getTraceScope, withTraceScope } from '../trace/traceScope.js'
import { TraceResponseCollector, traceUsageFromProtocol } from '../trace/responseCapture.js'
import { createProtocolOutputBudget, type ProtocolTraceSummary } from '../trace/protocolTrace.js'

type Fetch = NonNullable<ClientOptions['fetch']>
const pendingTasks = new Set<Promise<unknown>>()
let warnedCaptureFailure = false

function diagnose(error: unknown): void {
  if (warnedCaptureFailure) return
  warnedCaptureFailure = true
  // Do not log raw errors: provider messages can contain credentials/content.
  console.warn('[Trace] Capture unavailable; model request continues.',
    error instanceof Error ? error.name : 'UnknownError')
}

function background<T>(operation: () => Promise<T>): Promise<T | undefined> {
  const task = Promise.resolve().then(operation).catch(error => {
    diagnose(error)
    return undefined
  })
  pendingTasks.add(task)
  void task.then(() => pendingTasks.delete(task))
  return task
}

export async function drainTraceFetchForTests(): Promise<void> {
  while (pendingTasks.size) await Promise.allSettled([...pendingTasks])
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  const error = new Error(reason === undefined ? 'Request aborted before the response completed' : String(reason))
  error.name = 'AbortError'
  return error
}

function protocolForUrl(url: string): ProtocolTraceSummary['protocol'] {
  try {
    const path = new URL(url).pathname
    if (/\/responses\/?$/.test(path)) return 'openai_responses'
    if (/\/chat\/completions\/?$/.test(path)) return 'openai_chat'
  } catch { /* Anthropic is the default SDK wire protocol. */ }
  return 'anthropic'
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const body = init?.body
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body)
  if (body instanceof Blob) return body.text()
  // Never acquire the caller's request stream. SDK requests normally pass a
  // JSON string; cloning a Request preserves its body for the actual fetch.
  if (body == null && input instanceof Request) return input.clone().text()
  return body == null ? null : '[request body is a stream; not inspected]'
}

/**
 * Adapts cc-haha's call lifecycle to moss's shared fetch seam. Each request
 * snapshots the current setting; a later toggle cannot strand a pending call.
 */
export function createTraceFetch(
  inner: Fetch,
  options: { sessionId: string | (() => string); querySource?: string },
): Fetch {
  return async (input, init) => {
    let capture: ReturnType<typeof resolveTraceCapture> = null
    try { capture = resolveTraceCapture() } catch { /* Tracing is best effort. */ }
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (!capture || method.toUpperCase() !== 'POST') return inner(input, init)

    let sessionId: string
    let scope: string
    let url: string
    let headers: Headers
    let body: Promise<unknown>
    try {
      sessionId = typeof options.sessionId === 'function' ? options.sessionId() : options.sessionId
      if (!sessionId.trim()) return inner(input, init)
      scope = getTraceScope()
      url = input instanceof Request ? input.url : String(input)
      headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      body = requestBody(input, init).catch(error => {
        diagnose(error)
        return '[request body unavailable]'
      })
    } catch (error) {
      diagnose(error)
      return inner(input, init)
    }

    const id = createTraceCallId()
    const startedAtMs = Date.now()
    const startedAt = new Date(startedAtMs).toISOString()
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const captureOptions = { captureEnabled: true }
    const inScope = <T>(callback: () => T) => withTraceScope(scope, callback)
    let requestOutputBudget: ProtocolTraceSummary['outputBudget'] | undefined
    // Defer JSON parsing and disk work until after fetch has been dispatched.
    // The pending entry already includes the full semantic request.
    const pending = background(async () => {
      await new Promise<void>(resolve => setImmediate(resolve))
      const raw = await body
      let model: string | undefined
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (parsed && typeof parsed === 'object' && typeof parsed.model === 'string') model = parsed.model
        requestOutputBudget = createProtocolOutputBudget(parsed)
      } catch { /* Keep malformed request bodies available for diagnosis. */ }
      const base: RecordTraceCallInput = {
        id, sessionId, source: 'anthropic', querySource: options.querySource, model, startedAt,
        request: { method, url, headers, body: raw },
      }
      await inScope(() => capture!.recordCall({
        ...base, status: 'pending', metadata: { phase: 'api_call_started' },
      }, captureOptions))
      await inScope(() => capture!.recordEvent({
        sessionId, callId: id, source: 'anthropic', model, timestamp: startedAt,
        phase: 'api_call_started', title: 'API call started', metadata: { url },
      }, captureOptions))
      return base
    })

    let response: Response
    try {
      response = await inner(input, init)
    } catch (error) {
      void background(async () => {
        const base = await pending
        if (!base) return
        await inScope(() => capture!.recordCall({
          ...base, status: 'error', error, completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs,
          metadata: { phase: 'api_call_failed', ...(signal?.aborted ? { aborted: true } : {}) },
        }, captureOptions))
        await inScope(() => capture!.recordEvent({
          sessionId, callId: id, source: 'anthropic', model: base.model,
          phase: 'api_call_failed', severity: 'error', title: 'API call failed',
          message: error instanceof Error ? error.message : String(error),
        }, captureOptions))
      })
      throw error
    }

    const collector = new TraceResponseCollector(response.headers.get('content-type') ?? '', protocolForUrl(url))
    let settled = false
    let onAbort: (() => void) | undefined
    const finalizeCapture = (error?: unknown, aborted = false) => {
      if (settled) return
      settled = true
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
      collector.finish(aborted ? 'cancelled' : error ? 'error' : 'eof')
      const captured = collector.result()
      const terminal = captured.protocolTrace.termination
      const providerFailed = ['error', 'response.error', 'response.failed', 'response.cancelled'].includes(terminal.event ?? '')
      const recordedError = error ?? (providerFailed ? new Error(
        `Provider stream ended with ${terminal.errorCode ?? terminal.errorType ?? terminal.event}`,
      ) : undefined)
      const phase = aborted ? 'api_call_aborted' : recordedError ? 'api_call_failed' : 'api_call_completed'
      const completedAt = new Date().toISOString()
      const durationMs = Date.now() - startedAtMs
      void background(async () => {
        const base = await pending
        if (!base) return
        // Response consumption may finish before deferred request parsing.
        // Enrich only the persisted summary after that parsing completes;
        // fetch and response delivery never wait for parsing or trace I/O.
        if (requestOutputBudget) captured.protocolTrace.outputBudget = requestOutputBudget
        const metadata = {
          phase, ...(aborted ? { aborted: true } : {}),
          responseBytesObserved: captured.bytesObserved,
          ...(captured.firstByteAt === undefined ? {} : { firstByteMs: captured.firstByteAt - startedAtMs }),
          protocolTrace: captured.protocolTrace,
        }
        await inScope(() => capture!.recordCall({
          ...base, completedAt, durationMs,
          ...(recordedError ? { status: 'error' as const, error: recordedError } : {}),
          usage: traceUsageFromProtocol(captured.protocolTrace),
          response: {
            status: response.status, headers: response.headers,
            bodySnapshot: createTraceBodySnapshot(captured.body, { alreadyTruncated: captured.truncated }),
          },
          metadata,
        }, captureOptions))
        await inScope(() => capture!.recordEvent({
          sessionId, callId: id, source: 'anthropic', model: base.model, timestamp: completedAt,
          phase, severity: recordedError ? 'error' : response.ok ? 'info' : 'warning',
          title: recordedError ? 'API call interrupted' : 'API call completed',
          ...(recordedError ? { message: recordedError instanceof Error ? recordedError.message : String(recordedError) } : {}),
          metadata: { status: response.status, durationMs, ...metadata },
        }, captureOptions))
      })
    }
    const complete = (error?: unknown, aborted = false) => {
      try { finalizeCapture(error, aborted) } catch (captureError) { diagnose(captureError) }
    }
    onAbort = () => complete(abortError(signal?.reason), true)
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    if (!response.body) {
      complete()
      return response
    }

    // Observe only bytes consumed by the SDK. Eagerly draining a cloned body
    // can make fetch's tee retain an unbounded queue on the slower branch.
    const upstream = response.body
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let cancelled = false
    const release = () => { try { reader?.releaseLock() } catch { /* Pending read during cancellation. */ } }
    try {
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            reader ??= upstream.getReader()
            const { done, value } = await reader.read()
            if (cancelled) return
            if (done) {
              complete()
              release()
              controller.close()
              return
            }
            try {
              collector.push(value)
              if (collector.streaming && collector.isTerminal()) complete()
            } catch (error) { diagnose(error) }
            controller.enqueue(value)
          } catch (error) {
            if (cancelled) return
            complete(error, Boolean(signal?.aborted))
            release()
            controller.error(error)
          }
        },
        async cancel(reason) {
          cancelled = true
          complete(abortError(reason), true)
          try { await (reader ? reader.cancel(reason) : upstream.cancel(reason)) }
          finally { release() }
        },
      }, { highWaterMark: 0 })
      const observed = new Response(stream, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      })
      for (const key of ['url', 'redirected', 'type'] as const) {
        Object.defineProperty(observed, key, { value: response[key] })
      }
      return observed
    } catch (error) {
      // Unusual/opaque responses that cannot be reconstructed still reach the SDK.
      diagnose(error)
      complete(error)
      return response
    }
  }
}
