'use client'

import { useState } from 'react'
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
import type { McpServer } from '@/lib/api/mcp'

// ===== Mock data =====

const mockServers: McpServer[] = [
  {
    id: '1', org_id: 'org1', name: 'crm-mcp', display_name: 'CRM MCP',
    description: '客户关系管理系统 MCP 接口', icon: null, category: '业务系统',
    risk_level: 'low', responsible_person: '张三',
    scope: 'org', owner_type: 'system', owner_id: 'org1',
    mcp_type: 'http', url: 'https://crm.example.com/mcp', command: null, args_json: null, env_json: null,
    timeout_ms: 30000, health_check_url: 'https://crm.example.com/health', use_proxy: false,
    auth_type: 'secret_ref', secret_ref: 'system:crm_api_key', auth_config_json: null,
    visible_to: null, bound_assistants: ['销售助手'], bound_skills: null,
    allow_read: true, allow_write: true, require_confirmation_for_write: false,
    allow_read_sensitive_fields: false, allow_outbound_network: true, allow_scheduled_task: false,
    audit_request: true, audit_response_summary: false, redact_sensitive_fields: true, allow_user_disable: true,
    enabled: true, status: 'enabled', created_by: 'admin', created_at: Date.now() - 86400000 * 30, updated_at: Date.now() - 86400000,
  },
  {
    id: '2', org_id: 'org1', name: 'knowledge-mcp', display_name: '知识库 MCP',
    description: '企业知识库检索 MCP', icon: null, category: '知识管理',
    risk_level: 'low', responsible_person: '李四',
    scope: 'org', owner_type: 'system', owner_id: 'org1',
    mcp_type: 'sse', url: 'https://kb.example.com/sse', command: null, args_json: null, env_json: null,
    timeout_ms: 30000, health_check_url: null, use_proxy: false,
    auth_type: 'bearer', secret_ref: null, auth_config_json: '{"token":"***"}',
    visible_to: null, bound_assistants: ['通用助手', '客服助手'], bound_skills: ['知识检索'],
    allow_read: true, allow_write: false, require_confirmation_for_write: false,
    allow_read_sensitive_fields: false, allow_outbound_network: true, allow_scheduled_task: false,
    audit_request: true, audit_response_summary: true, redact_sensitive_fields: false, allow_user_disable: true,
    enabled: true, status: 'enabled', created_by: 'admin', created_at: Date.now() - 86400000 * 20, updated_at: Date.now() - 86400000 * 2,
  },
  {
    id: '3', org_id: 'org1', name: 'contract-mcp', display_name: '合同系统 MCP',
    description: '销售部合同管理系统', icon: null, category: '业务系统',
    risk_level: 'medium', responsible_person: '王五',
    scope: 'department', owner_type: 'department', owner_id: 'dept-sales',
    mcp_type: 'http', url: 'https://contract.example.com/mcp', command: null, args_json: null, env_json: null,
    timeout_ms: 30000, health_check_url: null, use_proxy: true,
    auth_type: 'api_key', secret_ref: 'system:contract_key', auth_config_json: '{"header":"X-API-Key"}',
    visible_to: { department_ids: ['dept-sales'] }, bound_assistants: ['销售助手'], bound_skills: null,
    allow_read: true, allow_write: true, require_confirmation_for_write: true,
    allow_read_sensitive_fields: false, allow_outbound_network: true, allow_scheduled_task: false,
    audit_request: true, audit_response_summary: true, redact_sensitive_fields: true, allow_user_disable: false,
    enabled: true, status: 'pending', created_by: 'dept_admin', created_at: Date.now() - 86400000 * 5, updated_at: Date.now(),
  },
  {
    id: '4', org_id: 'org1', name: 'finance-mcp', display_name: '财务系统 MCP',
    description: '财务数据查询接口', icon: null, category: '财务',
    risk_level: 'high', responsible_person: '赵六',
    scope: 'department', owner_type: 'department', owner_id: 'dept-finance',
    mcp_type: 'http', url: 'https://finance.example.com/mcp', command: null, args_json: null, env_json: null,
    timeout_ms: 60000, health_check_url: 'https://finance.example.com/health', use_proxy: true,
    auth_type: 'secret_ref', secret_ref: 'system:finance_secret', auth_config_json: null,
    visible_to: { department_ids: ['dept-finance'] }, bound_assistants: null, bound_skills: null,
    allow_read: true, allow_write: false, require_confirmation_for_write: false,
    allow_read_sensitive_fields: false, allow_outbound_network: false, allow_scheduled_task: false,
    audit_request: true, audit_response_summary: true, redact_sensitive_fields: true, allow_user_disable: false,
    enabled: false, status: 'enabled', created_by: 'admin', created_at: Date.now() - 86400000 * 10, updated_at: Date.now() - 86400000 * 3,
  },
  {
    id: '5', org_id: 'org1', name: 'local-tool-mcp', display_name: '本地工具 MCP',
    description: 'STDIO 本地工具', icon: null, category: '开发工具',
    risk_level: 'low', responsible_person: '张三',
    scope: 'org', owner_type: 'system', owner_id: 'org1',
    mcp_type: 'stdio', url: null, command: 'npx', args_json: '["@anthropic/local-tool"]', env_json: '{"NODE_ENV":"production"}',
    timeout_ms: 30000, health_check_url: null, use_proxy: false,
    auth_type: 'none', secret_ref: null, auth_config_json: null,
    visible_to: null, bound_assistants: null, bound_skills: null,
    allow_read: true, allow_write: true, require_confirmation_for_write: false,
    allow_read_sensitive_fields: false, allow_outbound_network: false, allow_scheduled_task: false,
    audit_request: false, audit_response_summary: false, redact_sensitive_fields: false, allow_user_disable: true,
    enabled: true, status: 'error', created_by: 'admin', created_at: Date.now() - 86400000 * 15, updated_at: Date.now() - 3600000,
  },
]

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

function formatTime(timestamp: number | null): string {
  if (!timestamp) return '-'
  const diff = Date.now() - timestamp
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${Math.floor(diff / 86400000)} 天前`
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
  const [servers] = useState<McpServer[]>(mockServers)
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
    setCurrentStep(0)
    setIsCreateDialogOpen(true)
  }

  function openEditDialog(server: McpServer) {
    setEditingServer(server)
    setCurrentStep(0)
    setIsCreateDialogOpen(true)
  }

  function handleSubmit() {
    setIsSubmitting(true)
    setTimeout(() => {
      setIsSubmitting(false)
      setIsCreateDialogOpen(false)
      toast.success(editingServer ? 'MCP 服务已更新' : 'MCP 服务已创建')
    }, 1000)
  }

  function handleToggleEnabled(server: McpServer) {
    toast.success(server.enabled ? `已禁用 ${server.display_name || server.name}` : `已启用 ${server.display_name || server.name}`)
  }

  function handleTestConnection(server: McpServer) {
    toast.success(`${server.display_name || server.name} 连接测试成功`)
  }

  function resetFilters() {
    setSearchQuery('')
    setScopeFilter('all')
    setStatusFilter('all')
    setRiskFilter('all')
    setTypeFilter('all')
    setAuditFilter('all')
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
          <Button variant="outline" size="sm" onClick={() => toast.success('已刷新')}>
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
                      <Button variant="ghost" size="icon" className="size-8" title="测试连接" onClick={() => handleTestConnection(server)}>
                        <Plug className="size-3.5" />
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
                    <Input placeholder="mcp-server-name" defaultValue={editingServer?.name || ''} />
                  </div>
                  <div className="space-y-2">
                    <Label>显示名称 <span className="text-red-500">*</span></Label>
                    <Input placeholder="CRM MCP" defaultValue={editingServer?.display_name || ''} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>描述</Label>
                  <Textarea placeholder="MCP 服务描述..." defaultValue={editingServer?.description || ''} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>分类</Label>
                    <Select defaultValue={editingServer?.category || ''}>
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
                    <Select defaultValue={editingServer?.risk_level || 'low'}>
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
                  <Input placeholder="负责人姓名" defaultValue={editingServer?.responsible_person || ''} />
                </div>
              </div>
            )}

            {/* Step 2: 连接配置 */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>类型 <span className="text-red-500">*</span></Label>
                  <Select defaultValue={editingServer?.mcp_type || 'http'}>
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
                  <Input placeholder="https://example.com/mcp" defaultValue={editingServer?.url || ''} />
                </div>
                <div className="space-y-2">
                  <Label>启动命令 (STDIO)</Label>
                  <Input placeholder="npx" defaultValue={editingServer?.command || ''} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>超时时间 (ms)</Label>
                    <Input type="number" defaultValue={editingServer?.timeout_ms || 30000} />
                  </div>
                  <div className="space-y-2">
                    <Label>健康检查地址</Label>
                    <Input placeholder="https://example.com/health" defaultValue={editingServer?.health_check_url || ''} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch defaultChecked={editingServer?.use_proxy || false} />
                  <Label>使用代理</Label>
                </div>
              </div>
            )}

            {/* Step 3: 鉴权配置 */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>鉴权方式</Label>
                  <Select defaultValue={editingServer?.auth_type || 'none'}>
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
                  <Select defaultValue={editingServer?.secret_ref || ''}>
                    <SelectTrigger><SelectValue placeholder="选择已有凭据" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system:crm_api_key">system:crm_api_key</SelectItem>
                      <SelectItem value="system:contract_key">system:contract_key</SelectItem>
                      <SelectItem value="system:finance_secret">system:finance_secret</SelectItem>
                    </SelectContent>
                  </Select>
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
                  <Select defaultValue={editingServer?.scope || 'org'}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="org">企业级</SelectItem>
                      <SelectItem value="department">部门级</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>可见范围</Label>
                  <Select defaultValue="all">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">企业全员</SelectItem>
                      <SelectItem value="department">指定部门</SelectItem>
                      <SelectItem value="user">指定用户</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>绑定助手</Label>
                  <Select>
                    <SelectTrigger><SelectValue placeholder="选择助手..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sales">销售助手</SelectItem>
                      <SelectItem value="general">通用助手</SelectItem>
                      <SelectItem value="cs">客服助手</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>绑定技能</Label>
                  <Select>
                    <SelectTrigger><SelectValue placeholder="选择技能..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="search">知识检索</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                  "指定角色"和"指定场景"功能暂未实现，后续版本支持。
                </div>
              </div>
            )}

            {/* Step 5: 安全策略 */}
            {currentStep === 4 && (
              <div className="space-y-3">
                {[
                  { key: 'allow_read', label: '允许读操作', default: true },
                  { key: 'allow_write', label: '允许写操作', default: true },
                  { key: 'require_confirmation_for_write', label: '写操作需二次确认', default: false },
                  { key: 'allow_read_sensitive_fields', label: '允许读取敏感字段', default: false },
                  { key: 'allow_outbound_network', label: '允许出网', default: true },
                  { key: 'allow_scheduled_task', label: '允许自动任务调用', default: false },
                  { key: 'audit_request', label: '记录请求参数', default: false },
                  { key: 'audit_response_summary', label: '记录响应摘要', default: false },
                  { key: 'redact_sensitive_fields', label: '启用脱敏', default: false },
                  { key: 'allow_user_disable', label: '允许员工禁用', default: true },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between py-1">
                    <Label>{item.label}</Label>
                    <Switch defaultChecked={editingServer ? (editingServer[item.key as keyof McpServer] as boolean) : item.default} />
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
