import { dcClient } from './client'
import type {
  ReportEventKind,
  ReportEventResponse,
  ReportsEventsResponse,
  ReportsSummaryResponse,
} from './types'

export function getReportsSummary(params?: {
  from?: number
  to?: number
}): Promise<ReportsSummaryResponse> {
  const search = new URLSearchParams()
  if (params?.from !== undefined) {
    search.set('from', String(params.from))
  }
  if (params?.to !== undefined) {
    search.set('to', String(params.to))
  }
  const query = search.toString()
  return dcClient.get<ReportsSummaryResponse>(
    `/api/v1/reports/summary${query ? `?${query}` : ''}`,
  )
}

export function getReportEvents(params?: {
  kind?: ReportEventKind | 'all'
  userId?: string
  from?: number
  to?: number
  before?: number
  limit?: number
}): Promise<ReportsEventsResponse> {
  const search = new URLSearchParams()
  if (params?.kind && params.kind !== 'all') {
    search.set('kind', params.kind)
  }
  if (params?.userId) {
    search.set('user_id', params.userId)
  }
  if (params?.from !== undefined) {
    search.set('from', String(params.from))
  }
  if (params?.to !== undefined) {
    search.set('to', String(params.to))
  }
  if (params?.before !== undefined) {
    search.set('before', String(params.before))
  }
  if (params?.limit !== undefined) {
    search.set('limit', String(params.limit))
  }
  const query = search.toString()
  return dcClient.get<ReportsEventsResponse>(
    `/api/v1/reports/events${query ? `?${query}` : ''}`,
  )
}

export function getReportEvent(reportId: string): Promise<ReportEventResponse> {
  return dcClient.get<ReportEventResponse>(
    `/api/v1/reports/events/${encodeURIComponent(reportId)}`,
  )
}
