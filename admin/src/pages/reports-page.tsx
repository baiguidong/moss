'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Eye, RefreshCw } from 'lucide-react'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getReportEvents, getReportsSummary } from '@/lib/api/reports'
import type {
  ReportEvent,
  ReportEventKind,
  ReportEventSummary,
} from '@/lib/api/types'

const REPORT_KIND_OPTIONS: Array<{
  value: ReportEventKind | 'all'
  label: string
}> = [
  { value: 'all', label: '全部' },
  { value: 'telemetry_event', label: 'Telemetry Events' },
  { value: 'telemetry_metrics', label: 'Metrics' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'transcript', label: 'Transcript' },
  { value: 'bootstrap', label: 'Bootstrap' },
  { value: 'remote_settings', label: 'Remote Settings' },
  { value: 'policy_limits', label: 'Policy Limits' },
]

const REPORT_KIND_LABELS: Record<ReportEventKind, string> = {
  telemetry_event: 'Telemetry Events',
  telemetry_metrics: 'Metrics',
  feedback: 'Feedback',
  transcript: 'Transcript',
  bootstrap: 'Bootstrap',
  remote_settings: 'Remote Settings',
  policy_limits: 'Policy Limits',
}

const REPORT_KIND_BADGE: Record<
  ReportEventKind,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  telemetry_event: 'secondary',
  telemetry_metrics: 'outline',
  feedback: 'default',
  transcript: 'destructive',
  bootstrap: 'secondary',
  remote_settings: 'outline',
  policy_limits: 'secondary',
}

function formatTime(value: number | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

function stringifyPayload(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function previewPayload(value: unknown): string {
  const text = stringifyPayload(value).replace(/\s+/g, ' ').trim()
  return text.length > 160 ? `${text.slice(0, 160)}...` : text
}

function SummaryCard({
  title,
  summary,
}: {
  title: string
  summary?: ReportEventSummary
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">
          {(summary?.count ?? 0).toLocaleString()}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          最近上报：{formatTime(summary?.lastCreatedAt)}
        </p>
      </CardContent>
    </Card>
  )
}

export default function ReportsPage() {
  const [summary, setSummary] = useState<ReportEventSummary[]>([])
  const [events, setEvents] = useState<ReportEvent[]>([])
  const [kind, setKind] = useState<ReportEventKind | 'all'>('all')
  const [userId, setUserId] = useState('')
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<ReportEvent | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const summaryByKind = useMemo(() => {
    const map = new Map<ReportEventKind, ReportEventSummary>()
    for (const item of summary) {
      map.set(item.kind, item)
    }
    return map
  }, [summary])

  const loadReports = useCallback(
    async (options?: { append?: boolean; before?: number | null }) => {
      if (options?.append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
      }
      setError('')
      try {
        const [summaryResponse, eventsResponse] = await Promise.all([
          getReportsSummary(),
          getReportEvents({
            kind,
            userId: userId.trim() || undefined,
            before: options?.before ?? undefined,
            limit: 50,
          }),
        ])
        setSummary(summaryResponse.summaries)
        setEvents(current =>
          options?.append
            ? [...current, ...eventsResponse.events]
            : eventsResponse.events,
        )
        setNextCursor(eventsResponse.nextCursor)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    },
    [kind, userId],
  )

  useEffect(() => {
    void loadReports()
  }, [loadReports])

  return (
    <DashboardLayout
      title="上报数据"
      description="查看 Moss server 收到的 telemetry、metrics、feedback 和 transcript 原始上报。"
    >
      <div className="space-y-6">
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {REPORT_KIND_OPTIONS.filter(option => option.value !== 'all').map(
            option => (
              <SummaryCard
                key={option.value}
                title={option.label}
                summary={summaryByKind.get(option.value as ReportEventKind)}
              />
            ),
          )}
        </div>

        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>原始上报列表</CardTitle>
                <CardDescription>
                  当前仅做存储和查看；控制策略后续再接。
                </CardDescription>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  value={kind}
                  onValueChange={value => setKind(value as ReportEventKind | 'all')}
                >
                  <SelectTrigger className="w-full sm:w-[190px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_KIND_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={userId}
                  onChange={event => setUserId(event.target.value)}
                  placeholder="按 user_id 过滤"
                  className="sm:w-[220px]"
                />
                <Button
                  variant="outline"
                  onClick={() => void loadReports()}
                  disabled={isLoading}
                >
                  <RefreshCw className="mr-2 size-4" />
                  刷新
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-6">
                {[...Array(6)].map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                暂无上报数据
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">时间</TableHead>
                    <TableHead className="w-[150px]">类型</TableHead>
                    <TableHead className="w-[170px]">User</TableHead>
                    <TableHead className="w-[160px]">Source</TableHead>
                    <TableHead>Payload 预览</TableHead>
                    <TableHead className="w-[90px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map(event => (
                    <TableRow key={event.reportId}>
                      <TableCell>{formatTime(event.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant={REPORT_KIND_BADGE[event.kind]}>
                          {REPORT_KIND_LABELS[event.kind]}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {event.userId ?? '-'}
                      </TableCell>
                      <TableCell>{event.source ?? '-'}</TableCell>
                      <TableCell className="max-w-[520px] truncate font-mono text-xs text-muted-foreground">
                        {previewPayload(event.payload)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedEvent(event)}
                        >
                          <Eye className="mr-2 size-4" />
                          查看
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {nextCursor !== null ? (
              <div className="border-t p-4 text-center">
                <Button
                  variant="outline"
                  onClick={() =>
                    void loadReports({ append: true, before: nextCursor })
                  }
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? '加载中...' : '加载更多'}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(selectedEvent)} onOpenChange={open => {
        if (!open) setSelectedEvent(null)
      }}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>上报详情</DialogTitle>
            <DialogDescription>
              {selectedEvent
                ? `${REPORT_KIND_LABELS[selectedEvent.kind]} · ${formatTime(selectedEvent.createdAt)}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {selectedEvent ? (
            <div className="space-y-4 overflow-auto">
              <div className="grid gap-2 text-sm md:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">Report ID：</span>
                  <span className="font-mono text-xs">{selectedEvent.reportId}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Org ID：</span>
                  <span className="font-mono text-xs">{selectedEvent.orgId ?? '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">User ID：</span>
                  <span className="font-mono text-xs">{selectedEvent.userId ?? '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Source：</span>
                  <span>{selectedEvent.source ?? '-'}</span>
                </div>
              </div>
              <pre className="max-h-[58vh] overflow-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
                {stringifyPayload(selectedEvent.payload)}
              </pre>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}
