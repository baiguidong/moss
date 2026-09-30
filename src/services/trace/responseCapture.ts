import { ProtocolTraceObserver, type ProtocolTraceSummary, type ProtocolTraceTransport } from './protocolTrace.js'

const CAPTURE_BYTES = 1024 * 1024

/** Shared by the fetch observer and explicit response snapshot reader. */
export class TraceResponseCollector {
  private readonly decoder = new TextDecoder()
  private readonly observer: ProtocolTraceObserver
  private text = ''
  private capturedBytes = 0
  private observedBytes = 0
  private firstByteAt: number | undefined
  private finished = false
  private interrupted = false

  constructor(
    private readonly contentType: string,
    protocol: ProtocolTraceSummary['protocol'] = 'anthropic',
    request?: unknown,
  ) {
    this.observer = new ProtocolTraceObserver(protocol, request)
  }

  get streaming(): boolean { return this.contentType.toLowerCase().includes('text/event-stream') }

  push(chunk: Uint8Array): void {
    if (this.finished) return
    this.firstByteAt ??= Date.now()
    this.observedBytes += chunk.byteLength
    const available = Math.max(0, CAPTURE_BYTES - this.capturedBytes)
    if (available) {
      const retained = chunk.subarray(0, available)
      this.text += this.decoder.decode(retained, { stream: true })
      this.capturedBytes += retained.byteLength
    }
    if (this.streaming) this.observer.push(chunk)
  }

  isTerminal(): boolean {
    const terminal = this.observer.snapshot().termination
    return Boolean(terminal.doneMarker || terminal.event)
  }

  finish(transport: Exclude<ProtocolTraceTransport, 'open'>): void {
    if (this.finished) return
    this.finished = true
    this.interrupted = transport === 'cancelled' || transport === 'error'
    this.text += this.decoder.decode()
    if (!this.streaming) {
      try { this.observer.observeJson(JSON.parse(this.text)) } catch { /* Non-JSON error bodies remain inspectable. */ }
    }
    this.observer.finish(this.streaming ? transport : transport === 'eof' ? 'non_stream' : transport)
  }

  result() {
    return {
      body: this.text,
      truncated: this.observedBytes > this.capturedBytes || this.interrupted,
      bytesObserved: this.observedBytes,
      firstByteAt: this.firstByteAt,
      protocolTrace: this.observer.snapshot(),
    }
  }
}

export function traceUsageFromProtocol(summary: ProtocolTraceSummary) {
  const usage = summary.usage
  const count = (field: string): number | undefined => typeof usage[field] === 'number' ? usage[field] as number : undefined
  const inputTokens = count('input_tokens') ?? count('prompt_tokens')
  const outputTokens = count('output_tokens') ?? count('completion_tokens')
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(count('cache_read_input_tokens') !== undefined ? { cacheReadInputTokens: count('cache_read_input_tokens') } : {}),
    ...(count('cache_creation_input_tokens') !== undefined ? { cacheCreationInputTokens: count('cache_creation_input_tokens') } : {}),
  }
}
