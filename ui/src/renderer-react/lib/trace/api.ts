import type { MessageEntry } from '@/types/trace-session'
import type { TraceCallRecord, TraceCaptureSettings, TraceSession, TraceSessionDeleteResult, TraceSessionList } from '@/types/trace'

export type TraceTarget = 'local' | 'remote'
export type TraceSessionSnapshot = TraceSession & { messages: MessageEntry[] }
export type TraceSessionRevision = { sessionId: string; revision: number; revisionToken?: string; changed: boolean; reset: boolean }

async function invoke<T>(channel: string, payload: Record<string, unknown>): Promise<T> {
  if (!window.agentDesktop?.ipcInvoke) throw new Error('Trace 需要 Moss 桌面连接。')
  return window.agentDesktop.ipcInvoke(channel, payload) as Promise<T>
}

export const tracesApi = {
  list(target: TraceTarget, options: { limit?: number; offset?: number; query?: string } = {}) {
    return invoke<TraceSessionList>('trace:list', { target, ...options })
  },
  get(target: TraceTarget, sessionId: string) {
    return invoke<TraceSessionSnapshot>('trace:get', { target, sessionId })
  },
  getCall(target: TraceTarget, sessionId: string, callId: string) {
    return invoke<TraceCallRecord>('trace:call', { target, sessionId, callId })
  },
  getRevision(target: TraceTarget, sessionId: string, sinceRevision?: number, sinceRevisionToken?: string) {
    return invoke<TraceSessionRevision>('trace:revision', { target, sessionId, sinceRevision, sinceRevisionToken })
  },
  getSettings(target: TraceTarget) {
    return invoke<TraceCaptureSettings>('trace:settings', { target })
  },
  updateSettings(target: TraceTarget, enabled: boolean) {
    return invoke<TraceCaptureSettings>('trace:update-settings', { target, enabled })
  },
  deleteSession(target: TraceTarget, sessionId: string) {
    return invoke<TraceSessionDeleteResult>('trace:delete', { target, sessionId })
  },
}
