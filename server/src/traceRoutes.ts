import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import {
  readTraceCaptureSettings,
  traceCaptureService,
  trimTraceCallPreviews,
  updateTraceCaptureSettings,
  withTraceScope,
  type TraceSessionSummary,
} from '../../packages/trace/src/traceCapture.js'
import { toTraceMessages } from '../../packages/trace/src/traceMessages.js'
import { hasScope, type AuthContext } from './auth/token.js'
import { getUserProfileDir } from './runtimePaths.js'
import { loadSessionContextFromTranscript } from './transcript.js'
import type { ServerConfig, SessionRecord } from './types.js'

export class TraceRouteError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message)
    this.name = 'TraceRouteError'
  }
}

type Dependencies = {
  config: ServerConfig
  getSession: (id: string) => Promise<SessionRecord | null>
  listSessions: (filter: { orgId: string; userId?: string }) => Promise<SessionRecord[]>
  canAccessSession: (auth: AuthContext, session: SessionRecord, anyScope: string) => boolean
  requireAnyScope: (auth: AuthContext, scopes: string[]) => void | Promise<void>
  readJsonBody: (req: IncomingMessage) => Promise<Record<string, unknown>>
  loadTranscript?: typeof loadSessionContextFromTranscript
}

type Result = { status: number; body: unknown }

function decodeId(value: string): string {
  let id: string
  try { id = decodeURIComponent(value) } catch { throw new TraceRouteError(400, 'Invalid trace id') }
  if (!id.trim() || id === '.' || id === '..' || /[/\\\0]/.test(id)) {
    throw new TraceRouteError(400, 'Invalid trace id')
  }
  return id
}

function integerParameter(url: URL, name: string, fallback: number, minimum: number): number {
  const value = url.searchParams.get(name)
  if (value === null) return fallback
  const parsed = Number(value)
  if (!value.trim() || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new TraceRouteError(400, `Invalid ${name}`)
  }
  return parsed
}

function traceIds(session: SessionRecord): string[] {
  // New sessions share these IDs. A resumed/reset transcript can use a new ID,
  // while earlier model calls still belong to the stable cloud session.
  return [...new Set([session.sessionId, session.transcriptSessionId])]
}

function sessionMeta(session: SessionRecord) {
  return {
    id: session.sessionId,
    title: session.title || session.sessionId,
    projectPath: session.cwd,
    workDir: session.runtime.workspaceDir || session.cwd,
  }
}

function mergeSummaries(summaries: TraceSessionSummary[]): TraceSessionSummary {
  const models = new Map<string, number>()
  const summary: TraceSessionSummary = {
    apiCalls: 0, failedCalls: 0, totalDurationMs: 0,
    totalInputTokens: 0, totalOutputTokens: 0, models: [], updatedAt: null,
  }
  for (const item of summaries) {
    summary.apiCalls += item.apiCalls
    summary.failedCalls += item.failedCalls
    summary.totalDurationMs += item.totalDurationMs
    summary.totalInputTokens += item.totalInputTokens
    summary.totalOutputTokens += item.totalOutputTokens
    if (item.updatedAt && (!summary.updatedAt || item.updatedAt > summary.updatedAt)) summary.updatedAt = item.updatedAt
    for (const model of item.models) models.set(model.model, (models.get(model.model) || 0) + model.calls)
  }
  summary.models = [...models].map(([model, calls]) => ({ model, calls }))
  return summary
}

async function transcriptFingerprint(session: SessionRecord): Promise<string> {
  try {
    const info = await stat(session.transcriptPath)
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function createTraceRoutes(deps: Dependencies) {
  const profile = (userId: string) => getUserProfileDir(deps.config, userId)
  const loadTranscript = deps.loadTranscript ?? loadSessionContextFromTranscript

  async function list(auth: AuthContext, url: URL): Promise<unknown> {
    await deps.requireAnyScope(auth, ['sessions:list', 'sessions:list:any'])
    const limit = Math.min(integerParameter(url, 'limit', 50, 1), 200)
    const offset = integerParameter(url, 'offset', 0, 0)
    const terms = (url.searchParams.get('q') || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    const records = (await deps.listSessions({
      orgId: auth.orgId,
      userId: hasScope(auth.scopes, 'sessions:list:any') ? undefined : auth.userId,
    })).filter(session => !session.deletedAt &&
      deps.canAccessSession(auth, session, 'sessions:attach:any') &&
      terms.every(term => [session.sessionId, session.title, session.cwd, session.runtime.workspaceDir]
        .filter(Boolean).join('\n').toLowerCase().includes(term)))

    const byOwner = new Map<string, SessionRecord[]>()
    for (const session of records) byOwner.set(session.userId, [...(byOwner.get(session.userId) || []), session])
    // Start from authorized DB sessions. Never expose orphaned files, deleted
    // sessions, or another tenant's traces just because they share a profile.
    const candidates = (await Promise.all([...byOwner].map(async ([owner, sessions]) => {
      const { files } = await withTraceScope(profile(owner), () => traceCaptureService.listSessionTraceFiles())
      return sessions.flatMap(session => {
        const ids = new Set(traceIds(session))
        const matching = files.filter(file => ids.has(file.sessionId))
        if (!matching.length) return []
        return [{
          session,
          ids: matching.map(file => file.sessionId),
          fileSize: matching.reduce((sum, file) => sum + file.fileSize, 0),
          fileUpdatedAt: matching.map(file => file.fileUpdatedAt).sort().at(-1)!,
        }]
      })
    }))).flat().sort((a, b) => b.fileUpdatedAt.localeCompare(a.fileUpdatedAt) || a.session.sessionId.localeCompare(b.session.sessionId))
    const traces = await Promise.all(candidates.slice(offset, offset + limit).map(async candidate => {
      const result = await withTraceScope(profile(candidate.session.userId), () =>
        traceCaptureService.listSessionTraces({ sessionIds: candidate.ids, limit: candidate.ids.length, offset: 0 }))
      return {
        sessionId: candidate.session.sessionId,
        session: sessionMeta(candidate.session),
        summary: mergeSummaries(result.traces.map(item => item.summary)),
        fileSize: candidate.fileSize,
        fileUpdatedAt: candidate.fileUpdatedAt,
      }
    }))
    const settings = await withTraceScope(profile(auth.userId), () => readTraceCaptureSettings())
    return { traces, total: candidates.length, settings, storageDir: settings.storageDir }
  }

  return async function handleTraceRoute(req: IncomingMessage, url: URL, auth: AuthContext | null): Promise<Result | null> {
    const settingsRoute = url.pathname === '/api/v1/traces/settings'
    const listRoute = url.pathname === '/api/v1/traces'
    const match = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/trace(?:\/(revision)|\/calls\/([^/]+))?$/)
    if (!settingsRoute && !listRoute && !match) return null
    if (!auth) throw new TraceRouteError(401, 'Unauthorized')
    const ok = (body: unknown): Result => ({ status: 200, body })
    if (settingsRoute) {
      if (req.method === 'GET') return ok(await withTraceScope(profile(auth.userId), () => readTraceCaptureSettings()))
      if (req.method === 'PUT') {
        const body = await deps.readJsonBody(req)
        if (typeof body.enabled !== 'boolean') throw new TraceRouteError(400, 'enabled must be boolean')
        return ok(await withTraceScope(profile(auth.userId), () => updateTraceCaptureSettings({ enabled: body.enabled as boolean })))
      }
      throw new TraceRouteError(405, 'Method not allowed')
    }
    if (listRoute) {
      if (req.method !== 'GET') throw new TraceRouteError(405, 'Method not allowed')
      return ok(await list(auth, url))
    }
    const sessionId = decodeId(match![1]!)
    const revisionRoute = Boolean(match![2])
    const callId = match![3] ? decodeId(match![3]) : undefined
    if (req.method !== 'GET' && !(req.method === 'DELETE' && !revisionRoute && !callId)) {
      throw new TraceRouteError(405, 'Method not allowed')
    }
    const session = await deps.getSession(sessionId)
    if (!session || session.deletedAt) throw new TraceRouteError(404, 'Session not found')
    const scope = req.method === 'DELETE' ? 'sessions:terminate:any' : 'sessions:attach:any'
    if (!deps.canAccessSession(auth, session, scope)) throw new TraceRouteError(403, 'Forbidden')
    return await withTraceScope(profile(session.userId), async () => {
      const ids = traceIds(session)
      if (req.method === 'DELETE') {
        const results = await Promise.all(ids.map(id => traceCaptureService.deleteSessionTrace(id)))
        return ok({ sessionId, deleted: results.some(result => result.deleted) })
      }
      if (revisionRoute) {
        const sinceRevision = url.searchParams.has('sinceRevision') ? integerParameter(url, 'sinceRevision', 0, 0) : undefined
        const sinceToken = url.searchParams.get('sinceRevisionToken') ?? undefined
        if (sinceToken !== undefined && (!sinceToken || sinceToken.length > 512)) throw new TraceRouteError(400, 'Invalid revision token')
        const revisions = await Promise.all(ids.map(id => traceCaptureService.getSessionTraceRevision(id)))
        const revision = revisions.reduce((sum, item) => sum + item.revision, 0)
        const revisionToken = digest([revisions.map(item => item.revisionToken), await transcriptFingerprint(session)])
        return ok({ sessionId, revision, revisionToken,
          changed: sinceToken !== undefined ? sinceToken !== revisionToken : sinceRevision !== revision,
          reset: sinceRevision !== undefined && (sinceRevision > revision || (sinceRevision === revision && sinceToken !== undefined && sinceToken !== revisionToken)),
        })
      }
      if (callId) {
        for (const id of [...ids].reverse()) {
          const call = await traceCaptureService.getSessionTraceCall(id, callId)
          if (call) return ok({ call: { ...call, sessionId } })
        }
        throw new TraceRouteError(404, 'Trace call not found')
      }
      const [parts, context] = await Promise.all([
        Promise.all(ids.map(id => traceCaptureService.getSessionTrace(id))),
        loadTranscript(session),
      ])
      const messages = toTraceMessages(context?.messages || [])
      return ok({
        sessionId,
        session: sessionMeta(session),
        summary: mergeSummaries(parts.map(part => part.summary)),
        calls: parts.flatMap(part => part.calls.map(call => ({ ...trimTraceCallPreviews(call), sessionId })))
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
        events: parts.flatMap(part => part.events.map(event => ({ ...event, sessionId })))
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
        messages,
        messageSignature: digest(messages),
      })
    })
  }
}
