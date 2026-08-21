import { dcClient } from './client'
import type {
  SessionsListResponse,
  GetSessionResponse,
  GetSessionContextResponse,
  HealthResponse,
  UserSessionsResponse,
} from './types'

export async function getHealth(): Promise<HealthResponse> {
  return dcClient.get<HealthResponse>('/healthz')
}

export async function getSessions(activeOnly = false): Promise<SessionsListResponse> {
  const query = activeOnly ? '?active_only=true' : ''
  return dcClient.get<SessionsListResponse>(`/api/v1/sessions${query}`)
}

export async function getSession(sessionId: string): Promise<GetSessionResponse> {
  return dcClient.get<GetSessionResponse>(`/api/v1/sessions/${sessionId}`)
}

export async function getSessionContext(
  sessionId: string
): Promise<GetSessionContextResponse> {
  return dcClient.get<GetSessionContextResponse>(`/api/v1/sessions/${sessionId}/context`)
}

export async function terminateSession(
  sessionId: string
): Promise<{ ok: boolean }> {
  return dcClient.post<{ ok: boolean }>(`/api/v1/sessions/${sessionId}/terminate`)
}

export async function getUserSessions(
  userId: string
): Promise<UserSessionsResponse> {
  return dcClient.get<UserSessionsResponse>(`/api/v1/users/${userId}/sessions`)
}

export async function resumeSession(
  sessionId: string
): Promise<GetSessionResponse> {
  return dcClient.post<GetSessionResponse>(`/api/v1/sessions/${sessionId}/resume`)
}
