import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { tracesApi } from '../src/renderer-react/lib/trace/api'
import { fetchTraceCallDetail, clearTraceCallCache } from '../src/renderer-react/lib/trace/callCache'
import { createTraceListReader } from '../src/renderer-react/lib/trace/listReader'
import { createTraceSessionReader } from '../src/renderer-react/lib/trace/sessionReader'
import type { TraceCallRecord } from '../src/renderer-react/types/trace'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
let requests: Array<{ channel: string; payload: any }>
let handler: (channel: string, payload: any) => unknown

function call(id = 'call', status: TraceCallRecord['status'] = 'ok', text = 'body'): TraceCallRecord {
  return { id, sessionId: 'session', source: 'anthropic', status, startedAt: '2026-09-01T10:00:00Z', request: {
    method: 'POST', url: 'https://example.test/v1/messages', headers: {},
    body: { contentType: 'text', bytes: text.length, sha256: text, preview: text, truncated: false },
  } }
}
function snapshot(label = 'one') {
  return { sessionId: 'session', calls: [call()], messages: [{ id: label, type: 'user', content: label, timestamp: '2026-09-01T10:00:00Z' }],
    summary: { apiCalls: 1, failedCalls: 0, totalDurationMs: 10, totalInputTokens: 1, totalOutputTokens: 2, models: [], updatedAt: null } }
}

beforeEach(() => {
  requests = []
  handler = (_channel, payload) => call(payload.callId)
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { agentDesktop: { ipcInvoke: async (channel: string, payload: unknown) => {
    requests.push({ channel, payload })
    return handler(channel, payload)
  } } } })
  clearTraceCallCache()
})
afterEach(() => {
  clearTraceCallCache()
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

describe('Trace IPC and call cache', () => {
  test('passes the selected source, search page and capture toggle through IPC', async () => {
    await tracesApi.list('remote', { limit: 50, offset: 100, query: 'broken call' })
    await tracesApi.updateSettings('remote', false)
    await tracesApi.deleteSession('local', 'session')
    expect(requests).toEqual([
      { channel: 'trace:list', payload: { target: 'remote', limit: 50, offset: 100, query: 'broken call' } },
      { channel: 'trace:update-settings', payload: { target: 'remote', enabled: false } },
      { channel: 'trace:delete', payload: { target: 'local', sessionId: 'session' } },
    ])
  })

  test('propagates save errors instead of claiming the capture switch changed', async () => {
    handler = () => { throw new Error('只读配置目录') }
    await expect(tracesApi.updateSettings('local', false)).rejects.toThrow('只读配置目录')
  })

  test('caches terminal details and isolates local and remote calls with identical IDs', async () => {
    handler = (_channel, payload) => call(payload.callId, 'ok', payload.target)
    expect((await fetchTraceCallDetail('session', 'call', 'revision:1', 'local'))?.request.body.preview).toBe('local')
    expect((await fetchTraceCallDetail('session', 'call', 'revision:1', 'remote'))?.request.body.preview).toBe('remote')
    await fetchTraceCallDetail('session', 'call', 'revision:1', 'local')
    expect(requests).toHaveLength(2)
  })

  test('never caches a pending response and fetches its completion', async () => {
    let terminal = false
    handler = () => call('call', terminal ? 'ok' : 'pending')
    expect((await fetchTraceCallDetail('session', 'call'))?.status).toBe('pending')
    terminal = true
    expect((await fetchTraceCallDetail('session', 'call'))?.status).toBe('ok')
    await fetchTraceCallDetail('session', 'call')
    expect(requests).toHaveLength(2)
  })

  test('invalidates completed details after a trace revision changes', async () => {
    await fetchTraceCallDetail('session', 'call', 'token:old')
    handler = () => call('call', 'error', 'recovered partial response')
    expect((await fetchTraceCallDetail('session', 'call', 'token:new'))?.status).toBe('error')
    expect(requests).toHaveLength(2)
  })

  test('retries failures and bounds the LRU cache', async () => {
    handler = () => { throw new Error('temporarily unavailable') }
    expect(await fetchTraceCallDetail('session', 'call')).toBeNull()
    handler = (_channel, payload) => call(payload.callId)
    for (let index = 0; index < 33; index++) await fetchTraceCallDetail('session', `call-${index}`)
    const previous = requests.length
    await fetchTraceCallDetail('session', 'call-0')
    expect(requests).toHaveLength(previous + 1)
  })
})

describe('Trace snapshot revision polling', () => {
  test('does not miss a write between the first revision and the first snapshot', async () => {
    let revision = 1
    handler = (channel, payload) => {
      if (channel === 'trace:revision') return { sessionId: 'session', revision, revisionToken: String(revision), changed: payload.sinceRevision !== revision, reset: false }
      const result = snapshot(String(revision))
      revision = 2
      return result
    }
    const read = createTraceSessionReader('local', 'session')
    expect((await read(true)).snapshot?.messages[0]?.id).toBe('1')
    expect((await read()).snapshot?.messages[0]?.id).toBe('2')
    expect((await read()).snapshot).toBeNull()
    expect(requests.map(({ channel }) => channel)).toEqual(['trace:revision', 'trace:get', 'trace:revision', 'trace:get', 'trace:revision'])
  })

  test('commits revision only after a successful snapshot, so a failed fetch retries', async () => {
    let fail = true
    handler = (channel) => {
      if (channel === 'trace:revision') return { sessionId: 'session', revision: 2, revisionToken: 'new', changed: true, reset: false }
      if (fail) { fail = false; throw new Error('connection lost') }
      return snapshot()
    }
    const read = createTraceSessionReader('remote', 'session')
    await expect(read(true)).rejects.toThrow('connection lost')
    expect((await read()).snapshot?.sessionId).toBe('session')
    expect(requests[2].payload.sinceRevision).toBeUndefined()
  })

  test('uses a changed reset token even when the numeric revision is the same', async () => {
    let token = 'before-reset'
    handler = (channel, payload) => channel === 'trace:revision'
      ? { sessionId: 'session', revision: 1, revisionToken: token, changed: payload.sinceRevisionToken !== token, reset: true }
      : snapshot(token)
    const read = createTraceSessionReader('local', 'session')
    expect((await read(true)).revisionKey).toBe('token:before-reset')
    token = 'after-reset'
    expect((await read()).snapshot?.messages[0]?.id).toBe('after-reset')
  })

  test('falls back to snapshots and sees transcript-only changes on an older server', async () => {
    let label = 'original'
    handler = (channel) => {
      if (channel === 'trace:revision') throw new Error('unsupported route')
      return snapshot(label)
    }
    const read = createTraceSessionReader('local', 'session')
    const first = await read(true)
    expect((await read()).snapshot).toBeNull()
    label = 'new message'
    const next = await read()
    expect(next.snapshot?.messages[0]?.id).toBe('new message')
    expect(next.revisionKey).not.toBe(first.revisionKey)
  })
})


describe('Trace list refresh window', () => {
  function page(offset: number, limit: number, total = 350) {
    return { traces: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => ({ sessionId: `session-${offset + index}`, session: null, summary: snapshot().summary, fileSize: 0, fileUpdatedAt: '' })), total, storageDir: '/fixture', settings: { enabled: true, storageDir: '/fixture' } }
  }

  test('refreshes all 350 loaded records across the service 200-row cap', async () => {
    handler = (_channel, payload) => page(payload.offset, Math.min(payload.limit, 200))
    const reader = createTraceListReader('local', 'search')
    const result = await reader.read({ limit: 350 })
    expect(result?.traces).toHaveLength(350)
    expect(result?.traces[349].sessionId).toBe('session-349')
    expect(requests.map(({ payload }) => ({ limit: payload.limit, offset: payload.offset }))).toEqual([{ limit: 200, offset: 0 }, { limit: 150, offset: 200 }])
    expect(reader.busy).toBe(false)
  })

  test('skips polling and load-more while a slow page is in flight', async () => {
    let complete!: (value: unknown) => void
    handler = (_channel, payload) => new Promise(resolve => { complete = resolve })
    const reader = createTraceListReader('remote', '')
    const append = reader.read({ limit: 50, offset: 200 })
    expect(reader.busy).toBe(true)
    expect(await reader.read({ limit: 200 })).toBeNull()
    expect(await reader.read({ limit: 50, offset: 250 })).toBeNull()
    expect(requests).toHaveLength(1)
    complete(page(200, 50))
    expect((await append)?.traces).toHaveLength(50)
    expect(reader.busy).toBe(false)
    handler = (_channel, payload) => page(payload.offset, payload.limit)
    expect((await reader.read({ limit: 250 }))?.traces).toHaveLength(250)
    expect(requests).toHaveLength(3)
  })

  test('releases a failed request so a later refresh can recover', async () => {
    handler = () => { throw new Error('slow server disconnected') }
    const reader = createTraceListReader('remote', '')
    await expect(reader.read({ limit: 50 })).rejects.toThrow('slow server disconnected')
    await reader.waitForIdle()
    expect(reader.busy).toBe(false)
    handler = (_channel, payload) => page(payload.offset, payload.limit, 25)
    expect((await reader.read({ limit: 350 }))?.traces).toHaveLength(25)
    expect(requests).toHaveLength(2)
  })
})
