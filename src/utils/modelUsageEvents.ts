import {
  getSessionIdContext,
  getTaskScopeContext,
} from './sessionIdContext.js'

export type ModelUsageEvent = {
  eventId: string
  occurredAt: number
  requestId?: string
  model: string
  querySource: string
  agentId?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type ModelUsageEventListener = (event: ModelUsageEvent) => void

const listenersBySession = new Map<string, Set<ModelUsageEventListener>>()

export function registerModelUsageEventListener(
  sessionId: string,
  listener: ModelUsageEventListener,
): () => void {
  let listeners = listenersBySession.get(sessionId)
  if (!listeners) {
    listeners = new Set()
    listenersBySession.set(sessionId, listeners)
  }
  listeners.add(listener)

  return () => {
    const current = listenersBySession.get(sessionId)
    current?.delete(listener)
    if (current?.size === 0) listenersBySession.delete(sessionId)
  }
}

export function emitModelUsageEvent(event: ModelUsageEvent): void {
  const sessionId = getSessionIdContext()
  const taskSessionId = getTaskScopeContext()?.sessionId
  const listeners = new Set<ModelUsageEventListener>()
  for (const key of [sessionId, taskSessionId]) {
    if (!key) continue
    for (const listener of listenersBySession.get(key) ?? []) {
      listeners.add(listener)
    }
  }

  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // Usage accounting must not turn a completed model response into a failed turn.
    }
  }
}
