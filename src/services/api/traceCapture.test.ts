import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  clearTraceCaptureStateForTests,
  createTraceBodySnapshot,
  createTraceRequestSemantic,
  drainTraceCaptureForTests,
  getTraceScope,
  readTraceCaptureSettings,
  traceCaptureService,
  trimTraceCallPreviews,
  updateTraceCaptureSettings,
  withTraceScope,
} from './traceCapture.js'

let scope: string
const originalMode = process.env.MOSS_TRACE_LOCAL_INDEX
beforeEach(async () => {
  scope = await mkdtemp(join(tmpdir(), 'moss-trace-store-'))
  process.env.MOSS_TRACE_LOCAL_INDEX = 'on'
})
afterEach(async () => {
  await drainTraceCaptureForTests()
  clearTraceCaptureStateForTests()
  if (originalMode === undefined) delete process.env.MOSS_TRACE_LOCAL_INDEX
  else process.env.MOSS_TRACE_LOCAL_INDEX = originalMode
  await rm(scope, { recursive: true, force: true })
})

describe('migrated trace persistence', () => {
  test('uses independent settings, preserves unknown fields and old disabled fixture', async () => {
    await writeFile(join(scope, 'settings.json'), '{"userOwned":true}')
    await writeFile(join(scope, 'trace-settings.json'), JSON.stringify({
      future: { keep: true }, traceCapture: { enabled: false, futureSetting: 2 },
    }))
    await withTraceScope(scope, async () => {
      expect((await readTraceCaptureSettings()).enabled).toBe(false)
      await updateTraceCaptureSettings({ enabled: true })
      expect(await readTraceCaptureSettings()).toEqual({ enabled: true, storageDir: join(scope, 'traces') })
    })
    expect(JSON.parse(await readFile(join(scope, 'trace-settings.json'), 'utf8'))).toEqual({
      future: { keep: true }, traceCapture: { enabled: true, futureSetting: 2 },
    })
    expect(await readFile(join(scope, 'settings.json'), 'utf8')).toBe('{"userOwned":true}')
  })

  test('isolates concurrent async scopes and explicit host override', async () => {
    const secondScope = join(scope, 'another-user')
    await Promise.all([scope, secondScope].map((directory, index) => withTraceScope(directory, async () => {
      await Promise.resolve()
      expect(getTraceScope()).toBe(directory)
      await traceCaptureService.recordCall({
        id: 'same-call', sessionId: 'same-session', source: 'anthropic',
        request: { body: { messages: [{ role: 'user', content: String(index) }] } },
      })
    })))
    for (const [index, directory] of [scope, secondScope].entries()) {
      const result = await withTraceScope(directory, () => traceCaptureService.getSessionTrace('same-session'))
      expect(result.calls[0]?.request.semantic?.request.messages).toEqual([{ role: 'user', content: String(index) }])
    }
    expect(withTraceScope(secondScope, () => getTraceScope())).toBe(secondScope)
  })

  test('upserts calls and preserves indexed/canonical parity, revisions, deletion and empty authorization filter', async () => withTraceScope(scope, async () => {
    const base = {
      id: 'call-1', sessionId: 'session-1', source: 'anthropic' as const,
      startedAt: '2026-09-29T00:00:00.000Z', model: 'fixture-model',
      request: { body: { messages: [{ role: 'user', content: 'hello' }] } },
    }
    await traceCaptureService.recordCall({ ...base, status: 'pending' })
    const initial = await traceCaptureService.getSessionTraceRevision('session-1')
    await traceCaptureService.recordCall({
      ...base, completedAt: '2026-09-29T00:00:01.000Z', durationMs: 1000,
      response: { status: 200, body: { usage: { input_tokens: 21, output_tokens: 3 }, content: [] } },
    })
    await traceCaptureService.recordEvent({ sessionId: 'session-1', callId: 'call-1', phase: 'completed' })
    const indexed = await traceCaptureService.getSessionTrace('session-1')
    expect(indexed.calls).toHaveLength(1)
    expect(indexed.calls[0]?.status).toBe('ok')
    expect(indexed.summary).toMatchObject({ apiCalls: 1, totalInputTokens: 21, totalOutputTokens: 3 })
    expect(await traceCaptureService.getSessionTraceCall('session-1', 'call-1')).toEqual(indexed.calls[0])
    const changed = await traceCaptureService.getSessionTraceRevision('session-1', initial.revision, initial.revisionToken)
    expect(changed.changed).toBe(true)
    const unchanged = await traceCaptureService.getSessionTraceRevision('session-1', changed.revision, changed.revisionToken)
    expect(unchanged.changed).toBe(false)
    expect((await traceCaptureService.listSessionTraces({ sessionIds: [] })).traces).toEqual([])
    expect((await traceCaptureService.listSessionTraces({ sessionIds: ['session-1'] })).total).toBe(1)
    await access(join(scope, 'db', 'trace-index-v1.sqlite'))
    process.env.MOSS_TRACE_LOCAL_INDEX = 'off'
    expect(await traceCaptureService.getSessionTrace('session-1')).toEqual(indexed)
    expect((await traceCaptureService.listSessionTraces()).traces[0]?.summary).toEqual(indexed.summary)
    expect((await traceCaptureService.deleteSessionTrace('session-1')).deleted).toBe(true)
    expect((await traceCaptureService.getSessionTrace('session-1')).calls).toEqual([])
  }))

  test('falls back to canonical JSONL when SQLite is unavailable or corrupt', async () => withTraceScope(scope, async () => {
    await mkdir(join(scope, 'db'))
    await writeFile(join(scope, 'db', 'trace-index-v1.sqlite'), 'corrupt fixture')
    await traceCaptureService.recordCall({
      id: 'fallback', sessionId: 'session', source: 'anthropic',
      request: { body: { system: 'Preserve this request' } },
    })
    expect((await traceCaptureService.getSessionTrace('session')).calls[0]?.id).toBe('fallback')
    expect((await traceCaptureService.listSessionTraces()).total).toBe(1)
  }))

  test('retains semantic request beyond list truncation and redacts credentials/images', async () => {
    const request = {
      api_key: 'fixture-key', max_tokens: 2048,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'x'.repeat(250_000) + 'request-tail' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } },
      ] }],
    }
    const semantic = createTraceRequestSemantic(request, 'anthropic')
    expect(JSON.stringify(semantic)).toContain('request-tail')
    expect(JSON.stringify(semantic)).not.toContain('fixture-key')
    expect(JSON.stringify(semantic)).not.toContain('AQID')
    expect(semantic?.request.max_tokens).toBe(2048)
    await withTraceScope(scope, async () => {
      const record = await traceCaptureService.recordCall({
        sessionId: 'semantic', source: 'anthropic',
        request: { url: 'https://example.invalid/messages?api_key=secret', headers: { Authorization: 'Bearer secret' }, body: request },
      })
      expect(record?.request.headers.Authorization).toBe('[redacted]')
      expect(record?.request.url).not.toContain('secret')
      expect(record?.request.body.truncated).toBe(true)
      expect(trimTraceCallPreviews(record!).request.semantic).toBeUndefined()
      expect(trimTraceCallPreviews(record!).request.body.preview.length).toBe(2048)
    })
    expect(createTraceBodySnapshot({ usage: { input_tokens: 3 }, secret: 'value' }).preview).toContain('"input_tokens": 3')
  })

  test('never persists URL credentials or sensitive query values repeated in call/event metadata', async () => withTraceScope(scope, async () => {
    const url = 'https://fixture-user:fixture-password@example.invalid/messages?api_key=fixture-key&access_token=fixture-token&max_tokens=42'
    const call = await traceCaptureService.recordCall({
      id: 'url-call', sessionId: 'url-secrets', source: 'anthropic',
      request: { url, body: { messages: [] } },
      metadata: { url, upstream: { requestUrl: url }, attempts: [url] },
      error: new Error(`Request failed: ${url}`),
    })
    const event = await traceCaptureService.recordEvent({
      sessionId: 'url-secrets', callId: 'url-call', phase: 'api_call_started',
      metadata: { url, upstream: { requestUrl: url }, attempts: [url] },
      message: `Retrying request to ${url}`,
    })
    const sanitized = call!.request.url
    expect(event?.metadata).toEqual({ url: sanitized, upstream: { requestUrl: sanitized }, attempts: [sanitized] })
    expect(call?.metadata).toEqual(event?.metadata)
    expect(new URL(sanitized).searchParams.get('max_tokens')).toBe('42')
    const raw = await readFile(join(scope, 'traces', 'url-secrets.jsonl'), 'utf8')
    for (const secret of ['fixture-user', 'fixture-password', 'fixture-key', 'fixture-token']) {
      expect(raw).not.toContain(secret)
    }
    expect(raw.split('\n').filter(Boolean)).toHaveLength(2)
  }))
})
