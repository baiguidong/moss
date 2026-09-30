import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearTraceCaptureStateForTests,
  drainTraceCaptureForTests,
  traceCaptureService,
  withTraceScope,
} from '../../../src/services/api/traceCapture.js'
import { hasScope, type AuthContext } from '../auth/token.js'
import { getUserProfileDir } from '../runtimePaths.js'
import { createTraceRoutes, TraceRouteError } from '../traceRoutes.js'
import type { ServerConfig, SessionRecord } from '../types.js'

const root = await mkdtemp(join(tmpdir(), 'moss-trace-routes-'))
const config = { dataDir: join(root, 'data') } as ServerConfig
const actor = (userId: string, scopes = ['sessions:list']): AuthContext => ({
  userId, scopes, orgId: 'org-a', rawToken: 'fixture', role: 'user', keyId: 'fixture',
})
const actors = {
  alice: actor('alice'), bob: actor('bob'),
  admin: actor('admin', ['sessions:list:any', 'sessions:attach:any', 'sessions:terminate:any']),
  restricted: actor('alice', []),
}
const makeSession = (sessionId: string, userId: string, orgId = 'org-a'): SessionRecord => ({
  sessionId, userId, orgId, transcriptSessionId: sessionId,
  transcriptPath: join(root, `${sessionId}.jsonl`),
  role: 'user', scopes: [], cwd: `/workspace/${userId}`, status: 'active', desiredState: 'active',
  runtime: { backend: 'docker', profileDir: getUserProfileDir(config, userId), transcriptDir: root },
  currentAttemptId: null, title: `${userId} analysis`, summary: null, assistantName: null,
  createdAt: 1, lastActiveAt: 1, endedAt: null, deletedAt: null,
})
const sessions = [makeSession('alice-session', 'alice'), makeSession('bob-session', 'bob'),
  makeSession('foreign-session', 'alice', 'org-b'), makeSession('deleted-session', 'alice')]
sessions[0]!.transcriptSessionId = 'alice-resumed'
sessions[3]!.deletedAt = 1
const handle = createTraceRoutes({
  config,
  getSession: async id => sessions.find(session => session.sessionId === id) || null,
  // Deliberately return too many rows to prove the route enforces the tenant
  // and session boundaries even if its repository caller is overbroad.
  listSessions: async () => sessions,
  canAccessSession: (auth, session, anyScope) => session.orgId === auth.orgId &&
    (session.userId === auth.userId || hasScope(auth.scopes, anyScope)),
  requireAnyScope: (auth, scopes) => {
    if (!scopes.some(scope => hasScope(auth.scopes, scope))) throw new TraceRouteError(403, 'Forbidden')
  },
  readJsonBody: async req => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  },
})
const server = http.createServer(async (req, res) => {
  try {
    const auth = actors[req.headers.authorization as keyof typeof actors] || null
    const result = await handle(req, new URL(req.url!, 'http://localhost'), auth)
    res.writeHead(result?.status || 404, { 'content-type': 'application/json' })
    res.end(JSON.stringify(result?.body || {}))
  } catch (error) {
    res.writeHead(error instanceof TraceRouteError ? error.statusCode : 500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
})
try {
  const capture = async (userId: string, sessionId: string, id = `${sessionId}-call`) =>
    await withTraceScope(getUserProfileDir(config, userId), () => traceCaptureService.recordCall({
      id, sessionId, source: 'anthropic', model: 'fixture-model', status: 'ok',
      startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', durationMs: 1000,
      usage: { inputTokens: 5, outputTokens: 3 },
      request: { url: 'https://fixture.invalid/messages', headers: { authorization: 'Bearer private-fixture' }, body: { messages: [{ role: 'user', content: 'x'.repeat(5000) }] } },
      response: { status: 200, body: { content: [{ type: 'text', text: `${userId} answer` }] } },
    }, { captureEnabled: true }))
  for (const session of sessions) await capture(session.userId, session.sessionId)
  await capture('alice', 'alice-resumed')
  await capture('alice', 'orphan-session')
  await drainTraceCaptureForTests()
  await mkdir(root, { recursive: true })
  const transcript = [
    { type: 'user', uuid: 'user-1', timestamp: '2026-01-01T00:00:00.000Z', message: { content: 'question' } },
    { type: 'assistant', uuid: 'assistant-1', timestamp: '2026-01-01T00:00:01.000Z', parentUuid: 'user-1', message: {
      id: 'provider-message', model: 'fixture-model', content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'fixture' } }],
      usage: { input_tokens: 5, output_tokens: 3 },
    } },
  ]
  await writeFile(sessions[0]!.transcriptPath, transcript.map(entry => JSON.stringify(entry)).join('\n') + '\n')
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
  const request = (path: string, auth = 'alice', method = 'GET', body?: unknown) => fetch(base + path, {
    method, headers: { authorization: auth, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = async (path: string, auth = 'alice', method = 'GET', body?: unknown) => {
    const response = await request(path, auth, method, body)
    const value = await response.json()
    assert.equal(response.status, 200, JSON.stringify(value))
    return value
  }

  // All trace surfaces require authentication; session reads/deletes reuse the
  // existing attach/terminate boundaries, including cross-organization admins.
  for (const path of ['/traces', '/traces/settings', '/sessions/alice-session/trace']) {
    assert.equal((await request(path, '')).status, 401)
  }
  for (const suffix of ['', '/revision', '/calls/alice-session-call']) {
    assert.equal((await request(`/sessions/alice-session/trace${suffix}`, 'bob')).status, 403)
    assert.equal((await request(`/sessions/foreign-session/trace${suffix}`, 'admin')).status, 403)
  }
  assert.equal((await request('/sessions/alice-session/trace', 'bob', 'DELETE')).status, 403)
  assert.equal((await request('/sessions/missing/trace')).status, 404)
  assert.equal((await request('/sessions/deleted-session/trace')).status, 404)
  assert.equal((await request('/traces', 'restricted')).status, 403)
  assert.equal((await request('/traces?offset=-1')).status, 400)
  assert.equal((await request('/sessions/alice-session/trace/revision?sinceRevision=no')).status, 400)
  assert.equal((await request('/sessions/alice-session/trace/calls/%2F')).status, 400)

  const ownList = await json('/traces')
  assert.equal(ownList.total, 1)
  assert.deepEqual(ownList.traces.map((trace: { sessionId: string }) => trace.sessionId), ['alice-session'])
  assert.equal(ownList.traces[0].summary.apiCalls, 2)
  assert.equal((await json('/traces?q=missing')).total, 0)
  const adminList = await json('/traces', 'admin')
  assert.deepEqual(adminList.traces.map((trace: { sessionId: string }) => trace.sessionId).sort(), ['alice-session', 'bob-session'])
  const filtered = await json('/traces?q=bob&limit=1&offset=0', 'admin')
  assert.equal(filtered.total, 1)
  assert.equal(filtered.traces[0].sessionId, 'bob-session')

  // Scope is tied to the owner, not the actor or a process-global environment.
  assert.equal((await json('/traces/settings')).enabled, false)
  assert.equal((await json('/traces/settings', 'bob')).enabled, false)
  await Promise.all([json('/traces/settings', 'alice', 'PUT', { enabled: true }), json('/traces/settings', 'bob', 'PUT', { enabled: false })])
  assert.equal((await json('/traces/settings', 'alice')).enabled, true)
  assert.equal((await json('/traces/settings', 'bob')).enabled, false)
  assert.equal((await request('/traces/settings', 'alice', 'PUT', { enabled: 'false' })).status, 400)
  assert.equal((await json('/sessions/bob-session/trace', 'admin')).calls[0].response.body.preview.includes('bob answer'), true)

  const snapshot = await json('/sessions/alice-session/trace')
  assert.equal(snapshot.sessionId, 'alice-session')
  assert.equal(snapshot.calls.length, 2)
  assert.ok(snapshot.calls.every((call: { request: { body: { preview: string } } }) => call.request.body.preview.length <= 2048))
  assert.equal(snapshot.messages[0].id, 'user-1')
  assert.equal(snapshot.messages[1].parentUuid, 'user-1')
  assert.equal(snapshot.messages[1].usageKey, 'provider-message')
  const full = await json('/sessions/alice-session/trace/calls/alice-resumed-call')
  assert.equal(full.call.sessionId, 'alice-session')
  assert.ok(full.call.request.body.preview.length > 5000)
  assert.ok(!JSON.stringify(full).includes('private-fixture'))
  assert.equal((await request('/sessions/alice-session/trace/calls/bob-session-call')).status, 404)

  const cursor = await json('/sessions/alice-session/trace/revision')
  const query = `?sinceRevision=${cursor.revision}&sinceRevisionToken=${cursor.revisionToken}`
  assert.equal((await json('/sessions/alice-session/trace/revision' + query)).changed, false)
  await appendFile(sessions[0]!.transcriptPath, JSON.stringify({
    type: 'user', uuid: 'tool-result', timestamp: '2026-01-01T00:00:02.000Z',
    message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' }] },
  }) + '\n')
  assert.equal((await json('/sessions/alice-session/trace/revision' + query)).changed, true)
  const changed = await json('/sessions/alice-session/trace')
  assert.notEqual(changed.messageSignature, snapshot.messageSignature)
  assert.equal(changed.messages.at(-1).id, 'tool-result')

  const transcriptBeforeDelete = await readFile(sessions[0]!.transcriptPath, 'utf8')
  assert.equal((await json('/sessions/alice-session/trace', 'alice', 'DELETE')).deleted, true)
  assert.equal((await json('/sessions/alice-session/trace')).calls.length, 0)
  assert.equal((await json('/traces')).total, 0)
  assert.equal(await readFile(sessions[0]!.transcriptPath, 'utf8'), transcriptBeforeDelete)
  assert.equal((await json('/sessions/bob-session/trace', 'admin')).calls.length, 1)
  assert.equal((await json('/sessions/alice-session/trace', 'alice', 'DELETE')).deleted, false)
} finally {
  server.closeAllConnections()
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  await drainTraceCaptureForTests()
  clearTraceCaptureStateForTests()
  await rm(root, { recursive: true, force: true })
}
