import { createHash, randomUUID } from 'node:crypto'
const TRACE_PREVIEW_CHARS = 240_000
export const TRACE_STREAM_CAPTURE_BYTES = 1024 * 1024
// `token(?!s)` keeps secret-bearing keys (token, access_token, api_token) redacted while
// letting token-count fields (input_tokens, max_tokens, prompt_tokens) through.
const SENSITIVE_KEY_RE = /authorization|api[-_]?key|secret|token(?!s)|cookie|password|bearer/i

export type TraceProviderInfo = {
  id: string | null
  name: string
  format: string
}

export type TraceBodySnapshot = {
  contentType: 'json' | 'text' | 'empty'
  bytes: number
  sha256: string
  preview: string
  truncated: boolean
}

export type TraceCallStatus = 'pending' | 'ok' | 'error'

export type TraceEventSeverity = 'info' | 'warning' | 'error'

export type TraceCallUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

export type TraceRequestSemantic = {
  version: 1
  request: Record<string, unknown>
}

export type TraceCallRecord = {
  id: string
  sessionId: string
  source: 'anthropic' | 'proxy'
  querySource?: string
  provider?: TraceProviderInfo
  model?: string
  status?: TraceCallStatus
  startedAt: string
  completedAt?: string
  durationMs?: number
  usage?: TraceCallUsage
  metadata?: Record<string, unknown>
  request: {
    method: string
    url: string
    headers: Record<string, string>
    body: TraceBodySnapshot
    semantic?: TraceRequestSemantic
  }
  response?: {
    status: number
    headers: Record<string, string>
    body: TraceBodySnapshot
  }
  error?: {
    name: string
    message: string
    code?: string
    stack?: string
    cause?: string
  }
}

export type TraceEventRecord = {
  id: string
  sessionId: string
  timestamp: string
  phase: string
  severity: TraceEventSeverity
  callId?: string
  source?: TraceCallRecord['source']
  provider?: TraceProviderInfo
  model?: string
  title?: string
  message?: string
  metadata?: Record<string, unknown>
}

export type RecordTraceCallInput = {
  id?: string
  sessionId: string
  source: TraceCallRecord['source']
  querySource?: string
  provider?: TraceProviderInfo
  model?: string
  status?: TraceCallStatus
  startedAt?: string
  completedAt?: string
  durationMs?: number
  metadata?: Record<string, unknown>
  usage?: TraceCallUsage
  request: {
    method?: string
    url?: string
    headers?: Headers | Record<string, string> | null
    body?: unknown
    bodySnapshot?: TraceBodySnapshot
  }
  response?: {
    status: number
    headers?: Headers | Record<string, string> | null
    body?: unknown
    bodySnapshot?: TraceBodySnapshot
  }
  error?: unknown
}

export type RecordTraceEventInput = {
  id?: string
  sessionId: string
  timestamp?: string
  phase: string
  severity?: TraceEventSeverity
  callId?: string
  source?: TraceCallRecord['source']
  provider?: TraceProviderInfo
  model?: string
  title?: string
  message?: string
  metadata?: Record<string, unknown>
}

type TraceFileEntry =
  | TraceCallRecord
  | { type: 'call'; record: TraceCallRecord }
  | { type: 'event'; event: TraceEventRecord }

export function createTraceBodySnapshot(
  body: unknown,
  options?: { maxPreviewChars?: number; alreadyTruncated?: boolean },
): TraceBodySnapshot {
  const maxPreviewChars = options?.maxPreviewChars ?? TRACE_PREVIEW_CHARS
  const { serialized, contentType } = serializeTraceBody(body)
  const bytes = Buffer.byteLength(serialized)
  const preview = serialized.length > maxPreviewChars
    ? serialized.slice(0, maxPreviewChars)
    : serialized

  return {
    contentType,
    bytes,
    sha256: createHash('sha256').update(serialized).digest('hex'),
    preview,
    truncated: Boolean(options?.alreadyTruncated) || serialized.length > maxPreviewChars,
  }
}

type TraceJsonRecord = Record<string, unknown>

function createRequestSemanticField(
  body: unknown,
  source: TraceCallRecord['source'],
): { semantic: TraceRequestSemantic } | Record<string, never> {
  const semantic = createTraceRequestSemantic(body, source)
  return semantic ? { semantic } : {}
}

/**
 * Preserve the structured request before its raw preview is truncated. The
 * desktop owns semantic parsing and context classification; capture only
 * removes binary image payloads so that parser stays the single source of
 * truth for Anthropic, Chat Completions, and Responses request shapes.
 */
export function createTraceRequestSemantic(
  body: unknown,
  source: TraceCallRecord['source'],
): TraceRequestSemantic | null {
  const parsed = parseTraceRequestValue(body)
  if (!parsed) return null
  const request = source === 'proxy' && isTraceRecord(parsed.anthropic)
    ? parsed.anthropic
    : parsed
  if (
    !Array.isArray(request.messages) &&
    !Array.isArray(request.input) &&
    request.system === undefined &&
    request.instructions === undefined
  ) {
    return null
  }
  return {
    version: 1,
    request: compactTraceSemanticValue(request) as TraceJsonRecord,
  }
}

function parseTraceRequestValue(body: unknown): TraceJsonRecord | null {
  if (isTraceRecord(body)) return body
  if (typeof body !== 'string') return null
  const trimmed = body.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return isTraceRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function compactTraceSemanticValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY_RE.test(key)) return '[redacted]'
  if (Array.isArray(value)) return value.map(entry => compactTraceSemanticValue(entry))
  if (!isTraceRecord(value)) {
    return typeof value === 'string' ? redactSecretsInText(value) : value
  }

  if (value.type === 'image' && isTraceRecord(value.source)) {
    const source = value.source
    if (source.type === 'base64' && typeof source.data === 'string') {
      const decoded = Buffer.from(source.data, 'base64')
      return {
        ...Object.fromEntries(
          Object.entries(value)
            .filter(([entryKey]) => entryKey !== 'source')
            .map(([entryKey, entryValue]) => [entryKey, compactTraceSemanticValue(entryValue, entryKey)]),
        ),
        source: {
          type: 'base64',
          ...(typeof source.media_type === 'string' ? { media_type: source.media_type } : {}),
          bytes: decoded.byteLength,
          sha256: createHash('sha256').update(decoded).digest('hex'),
        },
      }
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      compactTraceSemanticValue(entryValue, entryKey),
    ]),
  )
}

function isTraceRecord(value: unknown): value is TraceJsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function serializeTraceBody(body: unknown): { serialized: string; contentType: TraceBodySnapshot['contentType'] } {
  if (body === null || body === undefined) {
    return { serialized: '', contentType: 'empty' }
  }

  if (typeof body === 'string') {
    const parsed = parseJsonOrText(body)
    if (typeof parsed !== 'string') {
      return {
        serialized: JSON.stringify(redactSensitiveValue(parsed), null, 2),
        contentType: 'json',
      }
    }
    return { serialized: redactSecretsInText(body), contentType: 'text' }
  }

  try {
    return {
      serialized: JSON.stringify(redactSensitiveValue(body), null, 2),
      contentType: 'json',
    }
  } catch {
    return { serialized: redactSecretsInText(String(body)), contentType: 'text' }
  }
}

function parseJsonOrText(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return text
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text
  try {
    return JSON.parse(trimmed)
  } catch {
    return text
  }
}

function redactSensitiveValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY_RE.test(key)) return '[redacted]'
  if (Array.isArray(value)) return value.map((entry) => redactSensitiveValue(entry))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactSensitiveValue(entryValue, entryKey),
      ]),
    )
  }
  if (typeof value === 'string') return redactSecretsInText(value)
  return value
}

function redactSecretsInText(value: string): string {
  // Metadata can repeat a request URL under url/requestUrl or inside nested
  // arrays. Apply the same structured URL sanitizer to those string values;
  // do not rely on credential-shaped substrings (many keys are opaque).
  const sanitized = /^(?:https?|wss?):\/\//i.test(value)
    ? sanitizeUrl(value)
    : value.replace(/\b(?:https?|wss?):\/\/[^\s<>"'`]+/gi, url => sanitizeUrl(url))
  return sanitized
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/g, 'sk-[redacted]')
}

function sanitizeHeaders(headers: Headers | Record<string, string> | null | undefined): Record<string, string> {
  if (!headers) return {}
  const entries: Array<[string, string]> = []
  if (headers instanceof Headers) headers.forEach((value, key) => entries.push([key, value]))
  else entries.push(...Object.entries(headers))

  return Object.fromEntries(
    entries.map(([key, value]) => [
      key,
      SENSITIVE_KEY_RE.test(key) ? '[redacted]' : redactSecretsInText(String(value)),
    ]),
  )
}

function sanitizeUrl(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.username) parsed.username = '[redacted]'
    if (parsed.password) parsed.password = '[redacted]'
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_KEY_RE.test(key)) {
        parsed.searchParams.set(key, '[redacted]')
      }
    }
    return parsed.toString()
  } catch {
    return url
  }
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactSensitiveValue(metadata) as Record<string, unknown>
}

function inferCallStatus(input: RecordTraceCallInput): TraceCallStatus {
  if (input.status) return input.status
  if (input.error) return 'error'
  if (!input.response && !input.completedAt) return 'pending'
  if ((input.response?.status ?? 200) >= 400) return 'error'
  return 'ok'
}

function normalizeTraceError(error: unknown): TraceCallRecord['error'] {
  if (error instanceof Error) {
    const code = typeof (error as NodeJS.ErrnoException).code === 'string'
      ? (error as NodeJS.ErrnoException).code
      : undefined
    const cause = 'cause' in error && error.cause !== undefined
      ? redactSecretsInText(String(error.cause))
      : undefined
    return {
      name: error.name,
      message: redactSecretsInText(error.message),
      ...(code ? { code } : {}),
      ...(error.stack ? { stack: redactSecretsInText(error.stack) } : {}),
      ...(cause ? { cause } : {}),
    }
  }
  return { name: typeof error, message: redactSecretsInText(String(error)) }
}


export function createTraceCallRecord(input: RecordTraceCallInput): TraceCallRecord {
    const startedAt = input.startedAt ?? new Date().toISOString()
    const completedAt = input.completedAt
    const record: TraceCallRecord = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      source: input.source,
      ...(input.querySource ? { querySource: input.querySource } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      status: input.status ?? inferCallStatus(input),
      startedAt,
      ...(completedAt ? { completedAt } : {}),
      ...(typeof input.durationMs === 'number' ? { durationMs: input.durationMs } : {}),
      ...(input.metadata ? { metadata: sanitizeMetadata(input.metadata) } : {}),
      ...(input.usage ? { usage: input.usage } : {}),
      request: {
        method: input.request.method ?? 'POST',
        url: sanitizeUrl(input.request.url ?? ''),
        headers: sanitizeHeaders(input.request.headers),
        body: input.request.bodySnapshot ?? createTraceBodySnapshot(input.request.body ?? null),
        ...createRequestSemanticField(input.request.body, input.source),
      },
      ...(input.response
        ? {
            response: {
              status: input.response.status,
              headers: sanitizeHeaders(input.response.headers),
              body: input.response.bodySnapshot ?? createTraceBodySnapshot(input.response.body ?? null),
            },
          }
        : {}),
      ...(input.error ? { error: normalizeTraceError(input.error) } : {}),
    }

    return record
}

export function createTraceEventRecord(input: RecordTraceEventInput): TraceEventRecord {
    const event: TraceEventRecord = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      timestamp: input.timestamp ?? new Date().toISOString(),
      phase: input.phase,
      severity: input.severity ?? 'info',
      ...(input.callId ? { callId: input.callId } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.message ? { message: redactSecretsInText(input.message) } : {}),
      ...(input.metadata ? { metadata: sanitizeMetadata(input.metadata) } : {}),
    }

    return event
}

export function sanitizeTraceValue(value: unknown): unknown { return redactSensitiveValue(value) }
