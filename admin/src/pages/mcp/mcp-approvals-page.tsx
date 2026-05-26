'use client'

import { useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Eye } from 'lucide-react'
import { toast } from 'sonner'

import { DashboardLayout } from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ApprovalRequest {
  id: string
  user_name: string
  mcp_name: string
  mcp_display_name: string
  mcp_type: 'http' | 'sse' | 'stdio'
  mcp_url: string | null
  submitted_at: number
  status: 'pending' | 'approved' | 'rejected'
  review_note: string | null
}

const mockApprovals: ApprovalRequest[] = [
  {
    id: '1', user_name: '张三', mcp_name: 'github-mcp', mcp_display_name: 'GitHub MCP',
    mcp_type: 'http', mcp_url: 'https://github-mcp.example.com/sse',
    submitted_at: Date.now() - 3600000 * 2, status: 'pending', review_note: null,
  },
  {
    id: '2', user_name: '李四', mcp_name: 'notion-mcp', mcp_display_name: 'Notion MCP',
    mcp_type: 'sse', mcp_url: 'https://notion-mcp.example.com/sse',
    submitted_at: Date.now() - 86400000, status: 'pending', review_note: null,
  },
  {
    id: '3', user_name: '王五', mcp_name: 'local-files-mcp', mcp_display_name: '本地文件 MCP',
    mcp_type: 'stdio', mcp_url: null,
    submitted_at: Date.now() - 86400000 * 3, status: 'approved', review_note: '已确认安全性',
  },
  {
    id: '4', user_name: '赵六', mcp_name: 'slack-mcp', mcp_display_name: 'Slack MCP',
    mcp_type: 'http', mcp_url: 'https://slack-mcp.example.com/mcp',
    submitted_at: Date.now() - 86400000 * 5, status: 'rejected', review_note: '不符合企业安全策略，外网域名不在白名单中',
  },
]

function StatusBadge({ status }: { status: string }) {
  if (status === 'approved') return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25">已批准</Badge>
  if (status === 'rejected') return <Badge variant="destructive">已驳回</Badge>
  return <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/25">待审批</Badge>
}

function TypeBadge({ mcpType }: { mcpType: string }) {
  const labels: Record<string, string> = { http: 'HTTP', sse: 'SSE', stdio: 'STDIO' }
  return <Badge variant="outline">{labels[mcpType] || mcpType}</Badge>
}

function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function McpApprovalsPage() {
  const [approvals] = useState<ApprovalRequest[]>(mockApprovals)
  const [statusFilter, setStatusFilter] = useState('all')
  const [detailDialog, setDetailDialog] = useState<ApprovalRequest | null>(null)
  const [approveDialog, setApproveDialog] = useState<ApprovalRequest | null>(null)
  const [rejectDialog, setRejectDialog] = useState<ApprovalRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const filteredApprovals = approvals.filter((a) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false
    return true
  })

  const pendingCount = approvals.filter((a) => a.status === 'pending').length

  function handleApprove(request: ApprovalRequest) {
    setApproveDialog(null)
    toast.success(`已批准 ${request.mcp_display_name}`)
  }

  function handleReject() {
    if (!rejectDialog) return
    setRejectDialog(null)
    setRejectReason('')
    toast.success(`已驳回 ${rejectDialog.mcp_display_name}`)
  }

  return (
    <DashboardLayout title="MCP 审批管理" description="审核员工提交的个人 MCP 配置申请">
      {/* Stats */}
      <div className="flex items-center gap-4 mb-4">
        <div className="rounded-lg border bg-card px-4 py-2">
          <span className="text-sm text-muted-foreground">待审批</span>
          <span className="ml-2 text-lg font-bold text-yellow-600">{pendingCount}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="pending">待审批</SelectItem>
            <SelectItem value="approved">已批准</SelectItem>
            <SelectItem value="rejected">已驳回</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>申请人</TableHead>
              <TableHead>MCP 名称</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>提交时间</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredApprovals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  没有找到匹配的审批请求
                </TableCell>
              </TableRow>
            ) : (
              filteredApprovals.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="font-medium">{request.user_name}</TableCell>
                  <TableCell>
                    <div>
                      <div>{request.mcp_display_name}</div>
                      <div className="text-xs text-muted-foreground">{request.mcp_name}</div>
                    </div>
                  </TableCell>
                  <TableCell><TypeBadge mcpType={request.mcp_type} /></TableCell>
                  <TableCell className="text-sm">{formatDateTime(request.submitted_at)}</TableCell>
                  <TableCell><StatusBadge status={request.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDetailDialog(request)}>
                        <Eye className="size-3.5 mr-1" />详情
                      </Button>
                      {request.status === 'pending' && (
                        <>
                          <Button variant="ghost" size="sm" className="text-emerald-600 hover:text-emerald-700" onClick={() => setApproveDialog(request)}>
                            <CheckCircle2 className="size-3.5 mr-1" />批准
                          </Button>
                          <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => { setRejectDialog(request); setRejectReason('') }}>
                            <XCircle className="size-3.5 mr-1" />驳回
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!detailDialog} onOpenChange={(open) => { if (!open) setDetailDialog(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>MCP 配置详情</DialogTitle>
            <DialogDescription>{detailDialog?.mcp_display_name} — {detailDialog?.user_name} 提交的申请</DialogDescription>
          </DialogHeader>
          {detailDialog && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">名称：</span>{detailDialog.mcp_name}</div>
                <div><span className="text-muted-foreground">显示名称：</span>{detailDialog.mcp_display_name}</div>
                <div><span className="text-muted-foreground">类型：</span>{detailDialog.mcp_type.toUpperCase()}</div>
                <div><span className="text-muted-foreground">申请人：</span>{detailDialog.user_name}</div>
              </div>
              {detailDialog.mcp_url && (
                <div><span className="text-muted-foreground">URL：</span><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{detailDialog.mcp_url}</code></div>
              )}
              <div><span className="text-muted-foreground">提交时间：</span>{formatDateTime(detailDialog.submitted_at)}</div>
              {detailDialog.review_note && (
                <div>
                  <span className="text-muted-foreground">审核备注：</span>
                  <p className="mt-1 rounded bg-muted p-2">{detailDialog.review_note}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Approve Confirm Dialog */}
      <AlertDialog open={!!approveDialog} onOpenChange={(open) => { if (!open) setApproveDialog(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批准</AlertDialogTitle>
            <AlertDialogDescription>
              确定要批准 <strong>{approveDialog?.user_name}</strong> 提交的 <strong>{approveDialog?.mcp_display_name}</strong> 吗？批准后该 MCP 将可立即使用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => approveDialog && handleApprove(approveDialog)}>确认批准</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={(open) => { if (!open) setRejectDialog(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>驳回申请</DialogTitle>
            <DialogDescription>驳回 {rejectDialog?.user_name} 提交的 {rejectDialog?.mcp_display_name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>驳回原因</Label>
            <Textarea
              placeholder="请输入驳回原因..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>取消</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!rejectReason.trim()}>确认驳回</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}
