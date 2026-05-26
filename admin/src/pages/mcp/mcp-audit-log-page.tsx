'use client'

import { useState } from 'react'
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

interface AuditLog {
  id: string
  mcp_server_name: string | null
  action: string
  tool_name: string | null
  user_name: string | null
  session_id: string | null
  status: 'success' | 'failure'
  request_params_json: string | null
  response_summary: string | null
  error_message: string | null
  created_at: number
}

const actionLabels: Record<string, string> = {
  tool_call: '工具调用',
  list_tools: '列出工具',
  connect: '连接',
  disconnect: '断开',
  error: '错误',
  test_connection: '测试连接',
}

const mockLogs: AuditLog[] = [
  {
    id: '1', mcp_server_name: 'CRM MCP', action: 'tool_call', tool_name: 'search_contacts',
    user_name: '张三', session_id: 'sess_abc123', status: 'success',
    request_params_json: '{"query":"客户A","limit":10}', response_summary: '返回 5 条记录', error_message: null,
    created_at: Date.now() - 3600000,
  },
  {
    id: '2', mcp_server_name: '知识库 MCP', action: 'tool_call', tool_name: 'search_knowledge',
    user_name: '李四', session_id: 'sess_def456', status: 'success',
    request_params_json: '{"query":"产品规格","top_k":5}', response_summary: '返回 5 条相关文档', error_message: null,
    created_at: Date.now() - 7200000,
  },
  {
    id: '3', mcp_server_name: '合同系统 MCP', action: 'tool_call', tool_name: 'create_contract',
    user_name: '王五', session_id: 'sess_ghi789', status: 'failure',
    request_params_json: '{"title":"合同-2025-001","amount":50000}', response_summary: null, error_message: '权限不足：需要审批后才能创建合同',
    created_at: Date.now() - 10800000,
  },
  {
    id: '4', mcp_server_name: 'CRM MCP', action: 'list_tools', tool_name: null,
    user_name: '张三', session_id: 'sess_abc123', status: 'success',
    request_params_json: null, response_summary: '返回 8 个可用工具', error_message: null,
    created_at: Date.now() - 14400000,
  },
  {
    id: '5', mcp_server_name: '本地工具 MCP', action: 'connect', tool_name: null,
    user_name: '系统', session_id: null, status: 'failure',
    request_params_json: null, response_summary: null, error_message: 'Connection refused: npx 进程启动失败',
    created_at: Date.now() - 18000000,
  },
  {
    id: '6', mcp_server_name: 'CRM MCP', action: 'tool_call', tool_name: 'get_customer_detail',
    user_name: '赵六', session_id: 'sess_jkl012', status: 'success',
    request_params_json: '{"customer_id":"C001"}', response_summary: '返回客户详情', error_message: null,
    created_at: Date.now() - 86400000,
  },
  {
    id: '7', mcp_server_name: '知识库 MCP', action: 'tool_call', tool_name: 'search_knowledge',
    user_name: '李四', session_id: 'sess_mno345', status: 'success',
    request_params_json: '{"query":"报销流程","top_k":3}', response_summary: '返回 3 条相关文档', error_message: null,
    created_at: Date.now() - 86400000 * 2,
  },
]

function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function McpAuditLogPage() {
  const [isLoading] = useState(false)
  const [logs] = useState<AuditLog[]>(mockLogs)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [serverFilter, setServerFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const filteredLogs = logs.filter((log) => {
    if (serverFilter !== 'all' && log.mcp_server_name !== serverFilter) return false
    if (actionFilter !== 'all' && log.action !== actionFilter) return false
    if (statusFilter !== 'all' && log.status !== statusFilter) return false
    return true
  })

  const serverNames = [...new Set(logs.map((l) => l.mcp_server_name).filter(Boolean))] as string[]

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleExport() {
    toast.success('审计日志导出成功')
  }

  if (isLoading) {
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
        <Select value={serverFilter} onValueChange={setServerFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="MCP 服务器" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部服务器</SelectItem>
            {serverNames.map((name) => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="操作类型" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部操作</SelectItem>
            <SelectItem value="tool_call">工具调用</SelectItem>
            <SelectItem value="list_tools">列出工具</SelectItem>
            <SelectItem value="connect">连接</SelectItem>
            <SelectItem value="disconnect">断开</SelectItem>
            <SelectItem value="error">错误</SelectItem>
            <SelectItem value="test_connection">测试连接</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[110px]"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="success">成功</SelectItem>
            <SelectItem value="failure">失败</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExport}>
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
              <TableHead>工具名</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>会话</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  没有找到匹配的审计日志
                </TableCell>
              </TableRow>
            ) : (
              filteredLogs.map((log) => (
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
                    <TableCell className="text-sm font-mono">{log.tool_name || '-'}</TableCell>
                    <TableCell className="text-sm">{log.user_name || '-'}</TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground">{log.session_id ? log.session_id.slice(0, 12) + '...' : '-'}</TableCell>
                    <TableCell>
                      {log.status === 'success'
                        ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25">成功</Badge>
                        : <Badge variant="destructive">失败</Badge>
                      }
                    </TableCell>
                  </TableRow>
                  {expandedRows.has(log.id) && (
                    <TableRow key={`${log.id}-detail`} className="bg-muted/30">
                      <TableCell colSpan={8} className="p-4">
                        <div className="space-y-3 text-sm">
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

      {/* Pagination placeholder */}
      <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
        <span>共 {filteredLogs.length} 条</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled>上一页</Button>
          <span className="px-2">第 1 页</span>
          <Button variant="outline" size="sm" disabled>下一页</Button>
        </div>
      </div>
    </DashboardLayout>
  )
}
