'use client'

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  RefreshCw,
  Loader2,
  Pencil,
  Power,
  PowerOff,
  Plug,
  FileText,
  Search,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { DashboardLayout } from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import type { McpServer, McpServerFormData } from '@/lib/api/mcp'
import { fetchMcpServers, createMcpServer, updateMcpServer, testMcpConnection as testConnection } from '@/lib/api/mcp'
import { ApiRequestError } from '@/lib/api/client'

// ===== Helper components =====

function StatusBadge({ enabled, status }: { enabled: boolean; status: string }) {
  if (!enabled) return <Badge variant="secondary">已禁用</Badge>
  if (status === 'error') return <Badge variant="destructive">异常</Badge>
  if (status === 'pending') return <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/25">待测试</Badge>
  return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25">已启用</Badge>
}

function RiskBadge({ level }: { level: string }) {
  if (level === 'high') return <Badge variant="destructive">高</Badge>
  if (level === 'medium') return <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/25">中</Badge>
  return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25">低</Badge>
}

function ScopeBadge({ scope }: { scope: string }) {
  if (scope === 'org') return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25">企业级</Badge>
  if (scope === 'department') return <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/25">部门级</Badge>
  return <Badge variant="secondary">个人级</Badge>
}

function TypeBadge({ mcpType }: { mcpType: string }) {
  const labels: Record<string, string> = { http: 'HTTP', sse: 'SSE', stdio: 'STDIO' }
  return <Badge variant="outline">{labels[mcpType] || mcpType}</Badge>
}

function formatVisibleTo(visibleTo: McpServer['visible_to']): string {
  if (!visibleTo) return '全员'
  if (visibleTo.department_ids?.length && visibleTo.user_ids?.length) return `${visibleTo.department_ids.length} 个部门 + ${visibleTo.user_ids.length} 人`
  if (visibleTo.department_ids?.length) return `${visibleTo.department_ids.length} 个部门`
  if (visibleTo.user_ids?.length) return `${visibleTo.user_ids.length} 人`
  return '仅管理员'
}

function getCredentialSource(secretRef: string | null): string {
  if (!secretRef) return '未配置'
  if (secretRef.startsWith('system:')) return 'system'
  if (secretRef.startsWith('user:')) return 'user'
  return '未知'
}

// ===== Main page component =====

export default function McpServersPage() {
  const navigate = useNavigate()
  const [servers, setServers] = useState<McpServer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [riskFilter, setRiskFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [auditFilter, setAuditFilter] = useState('all')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<McpServer | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  // Form state for create/edit dialog
  const [formData, setFormData] = useState<McpServerFormData>({})

  const loadServers = useCallback(async () => {
    try {
      setIsLoading(true)
      const result = await fetchMcpServers()
      setServers(result.items)
    } catch (err) {
      if (err instanceof ApiRequestError) {
        toast.error(`加载失败: ${err.message}`)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadServers()
  }, [loadServers])

  // Filter logic
  const filteredServers = servers.filter((s) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!(s.display_name?.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q))) return false
    }
    if (scopeFilter !== 'all' && s.scope !== scopeFilter) return false
    if (typeFilter !== 'all' && s.mcp_type !== typeFilter) return false
    if (riskFilter !== 'all' && s.risk_level !== riskFilter) return false
    if (statusFilter !== 'all') {
      if (statusFilter === 'enabled' && !(s.enabled && s.status === 'enabled')) return false
      if (statusFilter === 'disabled' && s.enabled) return false
      if (statusFilter === 'error' && !(s.enabled && s.status === 'error')) return false
      if (statusFilter === 'pending' && !(s.enabled && s.status === 'pending')) return false
    }
    if (auditFilter !== 'all') {
      if (auditFilter === 'yes' && !s.audit_request && !s.audit_response_summary) return false
      if (auditFilter === 'no' && (s.audit_request || s.audit_response_summary)) return false
    }
    return true
  })

  // Stats
  const stats = {
    total: servers.length,
    org: servers.filter((s) => s.scope === 'org').length,
    dept: servers.filter((s) => s.scope === 'department').length,
    error: servers.filter((s) => s.enabled && s.status === 'error').length,
  }

  const steps = ['基础信息', '连接配置', '鉴权配置', '权限范围', '安全策略']

  function openCreateDialog() {
    setEditingServer(null)
    setFormData({})
    setCurrentStep(0)
    setIsCreateDialogOpen(true)
  }

  function openEditDialog(server: McpServer) {
    setEditingServer(server)
    setFormData({
      name: server.name,
      display_name: server.display_name || '',
      description: server.description || '',
      category: server.category || '',
      risk_level: server.risk_level,
      responsible_person: server.responsible_person || '',
      mcp_type: server.mcp_type,
      url: server.url || '',
      command: server.command || '',
      timeout_ms: server.timeout_ms,
      health_check_url: server.health_check_url || '',
      use_proxy: server.use_proxy,
      auth_type: server.auth_type,
      secret_ref: server.secret_ref || '',
      scope: server.scope,
      visible_to: server.visible_to,
      allow_read: server.allow_read,
      allow_write: server.allow_write,
      require_confirmation_for_write: server.require_confirmation_for_write,
      allow_read_sensitive_fields: server.allow_read_sensitive_fields,
      allow_outbound_network: server.allow_outbound_network,
      allow_scheduled_task: server.allow_scheduled_task,
      audit_request: server.audit_request,
      audit_response_summary: server.audit_response_summary,
      redact_sensitive_fields: server.redact_sensitive_fields,
      allow_user_disable: server.allow_user_disable,
    })
    setCurrentStep(0)
    setIsCreateDialogOpen(true)
  }

  async function handleSubmit() {
    setIsSubmitting(true)
    try {
      if (editingServer) {
        await updateMcpServer(editingServer.id, formData)
        toast.success('MCP 服务已更新')
      } else {
        await createMcpServer(formData)
        toast.success('MCP 服务已创建')
      }
      setIsCreateDialogOpen(false)
      setEditingServer(null)
      await loadServers()
    } catch (err) {
      if (err instanceof ApiRequestError) {
        toast.error(err.message)
      } else {
        toast.error('操作失败')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleToggleEnabled(server: McpServer) {
    try {
      await updateMcpServer(server.id, { enabled: !server.enabled })
      toast.success(server.enabled ? `已禁用 ${server.display_name || server.name}` : `已启用 ${server.display_name || server.name}`)
      await loadServers()
    } catch (err) {
      if (err instanceof ApiRequestError) {
        toast.error(err.message)
      }
    }
  }

  async function handleTestConnection(server: McpServer) {
    setTestingId(server.id)
    try {
      const result = await testConnection(server.id)
      if (result.success) {
        toast.success(`${server.display_name || server.name} 连接测试成功 (${result.latency_ms}ms)`)
      } else {
        toast.error(`${server.display_name || server.name} 连接测试失败: ${result.message}`)
      }
      await loadServers()
    } catch (err) {
      if (err instanceof ApiRequestError) {
        toast.error(err.message)
      }
    } finally {
      setTestingId(null)
    }
  }

  function resetFilters() {
    setSearchQuery('')
    setScopeFilter('all')
    setStatusFilter('all')
    setRiskFilter('all')
    setTypeFilter('all')
    setAuditFilter('all')
  }

  if (isLoading) {
    return (
      <DashboardLayout title="MCP 服务" description="管理企业级和部门级 MCP 服务配置">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout title="MCP 服务" description="管理企业级和部门级 MCP 服务配置">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-sm text-muted-foreground">总数</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-2xl font-bold">{stats.org}</div>
          <div className="text-sm text-muted-foreground">企业级</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-2xl font-bold">{stats.dept}</div>
          <div className="text-sm text-muted-foreground">部门级</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-2xl font-bold text-red-600">{stats.error}</div>
          <div className="text-sm text-muted-foreground">异常</div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索 MCP 服务..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadServers}>
            <RefreshCw className="size-4 mr-1" />刷新
          </Button>
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="size-4 mr-1" />创建 MCP
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Select value={scopeFilter} onValueChange={setScopeFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="作用域" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部作用域</SelectItem>
            <SelectItem value="org">企业级</SelectItem>
            <SelectItem value="department">部门级</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="enabled">已启用</SelectItem>
            <SelectItem value="disabled">已禁用</SelectItem>
            <SelectItem value="error">异常</SelectItem>
            <SelectItem value="pending">待测试</SelectItem>
          </SelectContent>
        </Select>
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="w-[100px]"><SelectValue placeholder="风险" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部风险</SelectItem>
            <SelectItem value="low">低</SelectItem>
            <SelectItem value="medium">中</SelectItem>
            <SelectItem value="high">高</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[100px]"><SelectValue placeholder="类型" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="http">HTTP</SelectItem>
            <SelectItem value="sse">SSE</SelectItem>
            <SelectItem value="stdio">STDIO</SelectItem>
          </SelectContent>
        </Select>
        <Select value={auditFilter} onValueChange={setAuditFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="审计" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部审计</SelectItem>
            <SelectItem value="yes">已开启</SelectItem>
            <SelectItem value="no">未开启</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          <X className="size-3 mr-1" />重置
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>作用域</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>可见范围</TableHead>
              <TableHead>绑定助手</TableHead>
              <TableHead>凭据来源</TableHead>
              <TableHead>风险等级</TableHead>
              <TableHead>审计</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredServers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                  没有找到匹配的数据
                </TableCell>
              </TableRow>
            ) : (
              filteredServers.map((server) => (
                <TableRow key={server.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{server.display_name || server.name}</div>
                      <div className="text-xs text-muted-foreground">{server.name}</div>
                    </div>
                  </TableCell>
                  <TableCell><TypeBadge mcpType={server.mcp_type} /></TableCell>
                  <TableCell><ScopeBadge scope={server.scope} /></TableCell>
                  <TableCell><StatusBadge enabled={server.enabled} status={server.status} /></TableCell>
                  <TableCell className="text-sm">{formatVisibleTo(server.visible_to)}</TableCell>
                  <TableCell className="text-sm">
                    {server.bound_assistants?.join(', ') || '-'}
                  </TableCell>
                  <TableCell className="text-sm">{getCredentialSource(server.secret_ref)}</TableCell>
                  <TableCell><RiskBadge level={server.risk_level} /></TableCell>
                  <TableCell>
                    {(server.audit_request || server.audit_response_summary) ? '是' : '否'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-8" title="编辑" onClick={() => openEditDialog(server)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" title={server.enabled ? '禁用' : '启用'} onClick={() => handleToggleEnabled(server)}>
                        {server.enabled ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" title="测试连接" onClick={() => handleTestConnection(server)} disabled={testingId === server.id}>
                        {testingId === server.id ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" title="查看日志" onClick={() => navigate('/mcp/audit-log')}>
                        <FileText className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create/Edit Dialog with 5-step wizard */}
      <Dialog open={isCreateDialogOpen} onOpenChange={(open) => { setIsCreateDialogOpen(open); if (!open) setEditingServer(null) }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingServer ? '编辑 MCP 服务' : '创建 MCP 服务'}</DialogTitle>
            <DialogDescription>
              {editingServer ? '修改 MCP 服务配置' : '按步骤配置新的 MCP 服务'}
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 py-2">
            {steps.map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentStep(i)}
                  className={`flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors ${
                    i === currentStep
                      ? 'bg-primary text-primary-foreground font-medium'
                      : i < currentStep
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground'
                  }`}
                >
                  <span className="size-5 flex items-center justify-center rounded-full text-xs border current:border-0">
                    {i < currentStep ? '✓' : i + 1}
                  </span>
                  <span className="hidden sm:inline">{step}</span>
                </button>
                {i < steps.length - 1 && <div className="w-4 h-px bg-border" />}
              </div>
            ))}
          </div>

          <div className="border-t pt-4">
            {/* Step 1: 基础信息 */}
            {currentStep === 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>名称 <span className="text-red-500">*</span></Label>
                    <Input placeholder="mcp-server-name" value={formData.name || ''} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>显示名称 <span className="text-red-500">*</span></Label>
                    <Input placeholder="CRM MCP" value={formData.display_name || ''} onChange={(e) => setFormData({ ...formData, display_name: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>描述</Label>
                  <Textarea placeholder="MCP 服务描述..." value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>分类</Label>
                    <Select value={formData.category || ''} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                      <SelectTrigger><SelectValue placeholder="选择分类" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="business">业务系统</SelectItem>
                        <SelectItem value="knowledge">知识管理</SelectItem>
                        <SelectItem value="dev">开发工具</SelectItem>
                        <SelectItem value="finance">财务</SelectItem>
                        <SelectItem value="other">其他</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>风险等级</Label>
                    <Select value={formData.risk_level || 'low'} onValueChange={(v) => setFormData({ ...formData, risk_level: v as any })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">低</SelectItem>
                        <SelectItem value="medium">中</SelectItem>
                        <SelectItem value="high">高</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>负责人</Label>
                  <Input placeholder="负责人姓名" value={formData.responsible_person || ''} onChange={(e) => setFormData({ ...formData, responsible_person: e.target.value })} />
                </div>
              </div>
            )}

            {/* Step 2: 连接配置 */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>类型 <span className="text-red-500">*</span></Label>
                  <Select value={formData.mcp_type || 'http'} onValueChange={(v) => setFormData({ ...formData, mcp_type: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="sse">SSE</SelectItem>
                      <SelectItem value="stdio">STDIO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>URL (HTTP/SSE)</Label>
                  <Input placeholder="https://example.com/mcp" value={formData.url || ''} onChange={(e) => setFormData({ ...formData, url: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>启动命令 (STDIO)</Label>
                  <Input placeholder="npx" value={formData.command || ''} onChange={(e) => setFormData({ ...formData, command: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>超时时间 (ms)</Label>
                    <Input type="number" value={formData.timeout_ms || 30000} onChange={(e) => setFormData({ ...formData, timeout_ms: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>健康检查地址</Label>
                    <Input placeholder="https://example.com/health" value={formData.health_check_url || ''} onChange={(e) => setFormData({ ...formData, health_check_url: e.target.value })} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={formData.use_proxy || false} onCheckedChange={(v) => setFormData({ ...formData, use_proxy: v })} />
                  <Label>使用代理</Label>
                </div>
              </div>
            )}

            {/* Step 3: 鉴权配置 */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>鉴权方式</Label>
                  <Select value={formData.auth_type || 'none'} onValueChange={(v) => setFormData({ ...formData, auth_type: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">无鉴权</SelectItem>
                      <SelectItem value="api_key">API Key</SelectItem>
                      <SelectItem value="bearer">Bearer Token</SelectItem>
                      <SelectItem value="basic">Basic Auth</SelectItem>
                      <SelectItem value="oauth">OAuth</SelectItem>
                      <SelectItem value="custom_header">自定义 Header</SelectItem>
                      <SelectItem value="secret_ref">Secret Center 引用</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Secret Center 凭据引用</Label>
                  <Input placeholder="system:secret_name" value={formData.secret_ref || ''} onChange={(e) => setFormData({ ...formData, secret_ref: e.target.value })} />
                </div>
                <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                  MCP 配置不直接保存明文密钥，只保存 Secret 引用。
                </div>
              </div>
            )}

            {/* Step 4: 权限范围 */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>作用域 <span className="text-red-500">*</span></Label>
                  <Select value={formData.scope || 'org'} onValueChange={(v) => setFormData({ ...formData, scope: v as any, owner_type: v === 'org' ? 'system' : 'department' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="org">企业级</SelectItem>
                      <SelectItem value="department">部门级</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                  "可见范围"和"绑定助手"功能将在后续版本中支持配置。
                </div>
              </div>
            )}

            {/* Step 5: 安全策略 */}
            {currentStep === 4 && (
              <div className="space-y-3">
                {[
                  { key: 'allow_read' as const, label: '允许读操作', default: true },
                  { key: 'allow_write' as const, label: '允许写操作', default: true },
                  { key: 'require_confirmation_for_write' as const, label: '写操作需二次确认', default: false },
                  { key: 'allow_read_sensitive_fields' as const, label: '允许读取敏感字段', default: false },
                  { key: 'allow_outbound_network' as const, label: '允许出网', default: true },
                  { key: 'allow_scheduled_task' as const, label: '允许自动任务调用', default: false },
                  { key: 'audit_request' as const, label: '记录请求参数', default: false },
                  { key: 'audit_response_summary' as const, label: '记录响应摘要', default: false },
                  { key: 'redact_sensitive_fields' as const, label: '启用脱敏', default: false },
                  { key: 'allow_user_disable' as const, label: '允许员工禁用', default: true },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between py-1">
                    <Label>{item.label}</Label>
                    <Switch checked={(formData[item.key] as boolean) ?? item.default} onCheckedChange={(v) => setFormData({ ...formData, [item.key]: v })} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {currentStep > 0 && (
              <Button variant="outline" onClick={() => setCurrentStep(currentStep - 1)}>上一步</Button>
            )}
            {currentStep < 4 ? (
              <Button onClick={() => setCurrentStep(currentStep + 1)}>下一步</Button>
            ) : (
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                {editingServer ? '保存' : '创建'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}
