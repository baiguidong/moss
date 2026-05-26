'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Download, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

import { DashboardLayout } from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { fetchMcpAuditLogs } from '@/lib/api/mcp'
import type { McpAuditLog } from '@/lib/api/mcp'
import { ApiRequestError } from '@/lib/api/client'

const actionLabels: Record<string, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  enable: '启用',
  disable: '禁用',
  test_connection: '测试连接',
  update_policy: '更新策略',
  create_personal: '创建个人',
  update_personal: '更新个人',
  delete_personal: '删除个人',
  approve_request: '审批通过',
  reject_request: '审批驳回',
  tool_call: '工具调用',
  list_tools: '列出工具',
  connect: '连接',
  disconnect: '断开',
  error: '错误',
}

function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function McpAuditLogPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [logs, setLogs] = useState<McpAuditLog[]>([])
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [serverFilter, setServerFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const loadLogs = useCallback(async () => {
    try {
      setIsLoading(true)
      const params: Record<string, string> = { page: String(page), page_size: '20' }
      if (serverFilter !== 'all') params.mcp_server_name = serverFilter
      if (actionFilter !== 'all') params.action = actionFilter
      if (statusFilter !== 'all') params.status = statusFilter
      const result = await fetchMcpAuditLogs(params)
      setLogs(result.items)
      setTotal(result.total)
    } catch (err) {
      if (err instanceof ApiRequestError) {
        toast.error(`加载审计日志失败: ${err.message}`)
      }
    } finally {
      setIsLoading(false)
    }
  }, [page, serverFilter, actionFilter, statusFilter])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  const serverNames = [...new Set(logs.map((l) => l.mcp_server_name).filter(Boolean))] as string[]
  const totalPages = Math.ceil(total / 20)

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleExport() {
    // CSV export from current data
    const headers = ['时间', 'MCP服务器', '操作', '工具名', '用户', '会话ID', '状态']
    const rows = logs.map((l) => [
      formatDateTime(l.created_at),
      l.mcp_server_name || '',
      actionLabels[l.action] || l.action,
      l.tool_name || '',
      l.user_name || '',
      l.session_id || '',
      l.status,
    ])
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mcp-audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('审计日志导出成功')
  }

  if (isLoading && logs.length === 0) {
    return (
      <DashboardLayout title="MCP 审计日志" description="查看 MCP 服务调用记录和安全审计日志">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout title="MCP 审计日志" description="查看 MCP 服务调用记录和安全审计日志">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select value={serverFilter} onValueChange={(v) => { setServerFilter(v); setPage(1) }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="MCP 服务器" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部服务器</SelectItem>
            {serverNames.map((name) => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1) }}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="操作类型" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部操作</SelectItem>
            <SelectItem value="create">创建</SelectItem>
            <SelectItem value="update">更新</SelectItem>
            <SelectItem value="delete">删除</SelectItem>
            <SelectItem value="enable">启用</SelectItem>
            <SelectItem value="disable">禁用</SelectItem>
            <SelectItem value="test_connection">测试连接</SelectItem>
            <SelectItem value="update_policy">更新策略</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
          <SelectTrigger className="w-[110px]"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="success">成功</SelectItem>
            <SelectItem value="failure">失败</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={logs.length === 0}>
          <Download className="size-4 mr-1" />导出
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>时间</TableHead>
              <TableHead>MCP 服务器</TableHead>
              <TableHead>操作</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  没有找到匹配的审计日志
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <>
                  <TableRow
                    key={log.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => toggleRow(log.id)}
                  >
                    <TableCell>
                      <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', expandedRows.has(log.id) && 'rotate-90')} />
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{formatDateTime(log.created_at)}</TableCell>
                    <TableCell className="text-sm">{log.mcp_server_name || '-'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{actionLabels[log.action] || log.action}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{log.user_name || '-'}</TableCell>
                    <TableCell>
                      {log.status === 'success'
                        ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25">成功</Badge>
                        : <Badge variant="destructive">失败</Badge>
                      }
                    </TableCell>
                  </TableRow>
                  {expandedRows.has(log.id) && (
                    <TableRow key={`${log.id}-detail`} className="bg-muted/30">
                      <TableCell colSpan={6} className="p-4">
                        <div className="space-y-3 text-sm">
                          {log.tool_name && (
                            <div>
                              <span className="font-medium text-muted-foreground">工具名：</span>
                              <span className="font-mono text-xs">{log.tool_name}</span>
                            </div>
                          )}
                          {log.request_params_json && (
                            <div>
                              <span className="font-medium text-muted-foreground">请求参数：</span>
                              <pre className="mt-1 rounded bg-background p-2 text-xs overflow-x-auto">{log.request_params_json}</pre>
                            </div>
                          )}
                          {log.response_summary && (
                            <div>
                              <span className="font-medium text-muted-foreground">响应摘要：</span>
                              <pre className="mt-1 rounded bg-background p-2 text-xs">{log.response_summary}</pre>
                            </div>
                          )}
                          {log.error_message && (
                            <div>
                              <span className="font-medium text-red-600">错误信息：</span>
                              <pre className="mt-1 rounded bg-red-500/10 p-2 text-xs text-red-700">{log.error_message}</pre>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
        <span>共 {total} 条</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
          <span className="px-2">第 {page} / {totalPages || 1} 页</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
        </div>
      </div>
    </DashboardLayout>
  )
}
