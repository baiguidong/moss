'use client'

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Download, Star, Loader2, Pencil, Trash2, Plus, Upload, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'

import { DashboardLayout } from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  fetchMcpTemplates,
  createMcpTemplate,
  updateMcpTemplate,
  deleteMcpTemplate,
  uploadMcpIcon,
  type McpTemplate,
  type McpTemplateFormData,
  type UserConfigItem,
} from '@/lib/api/mcp'
import { ApiRequestError } from '@/lib/api/client'

function TypeBadge({ mcpType }: { mcpType: string }) {
  const labels: Record<string, string> = { http: 'HTTP', sse: 'SSE', stdio: 'STDIO' }
  return <Badge variant="outline">{labels[mcpType] || mcpType}</Badge>
}

export default function McpTemplatesPage() {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(true)
  const [templates, setTemplates] = useState<McpTemplate[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<McpTemplate | null>(null)
  const [formData, setFormData] = useState<McpTemplateFormData>({})
  const [userConfigItems, setUserConfigItems] = useState<UserConfigItem[]>([])
  const [isUploadingIcon, setIsUploadingIcon] = useState(false)
  const loadTemplates = useCallback(async () => {
    try {
      setIsLoading(true)
      const params: Record<string, string> = {}
      if (categoryFilter !== 'all') params.category = categoryFilter
      if (searchQuery.trim()) params.search = searchQuery.trim()
      const result = await fetchMcpTemplates(params)
      setTemplates(result.items)
    } catch (err) {
      if (err instanceof ApiRequestError) {
        toast.error(`加载模板列表失败: ${err.message}`)
      }
    } finally {
      setIsLoading(false)
    }
  }, [categoryFilter, searchQuery])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const categories = [...new Set(templates.map((t) => t.category).filter(Boolean) as string[])]

  // Per plan §4.6: 安装 应跳转到 MCP 服务页的 5 步向导并预填充模板配置。
  // 这里只负责跳转携带 template_id，由 servers 页拉取模板并预填表单。
  function handleInstall(template: McpTemplate) {
    navigate(`/mcp/servers?install_template=${encodeURIComponent(template.id)}`)
  }

  async function handleIconUpload(file: File) {
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']
    const maxSize = 2 * 1024 * 1024
    if (!validTypes.includes(file.type)) { toast.error('仅支持 PNG/JPEG/WebP/SVG 格式'); return }
    if (file.size > maxSize) { toast.error('图片大小不能超过 2MB'); return }
    setIsUploadingIcon(true)
    try {
      const response = await uploadMcpIcon(file)
      if (response.success) {
        setFormData(prev => ({ ...prev, icon: response.data.url }))
        toast.success('图标上传成功')
      } else { toast.error('图标上传失败') }
    } catch { toast.error('图标上传失败') }
    finally { setIsUploadingIcon(false) }
  }

  function handleCreate() {
    setEditingTemplate(null)
    setFormData({ mcp_type: 'http' })
    setUserConfigItems([])
    setIsCreateDialogOpen(true)
  }

  function handleEdit(template: McpTemplate) {
    setEditingTemplate(template)
    setFormData({
      name: template.name,
      description: template.description,
      icon: template.icon,
      category: template.category,
      mcp_type: template.mcp_type,
      url: template.url,
      command: template.command,
      args_json: template.args_json,
      env_json: template.env_json,
      timeout_ms: template.timeout_ms,
      auth_type: template.auth_type,
      scope: template.scope,
      risk_level: template.risk_level,
    })
    // Parse config_json to userConfigItems
    if (template.config_json) {
      try {
        const parsed = JSON.parse(template.config_json)
        setUserConfigItems(parsed.user_config_items ?? [])
      } catch { setUserConfigItems([]) }
    } else { setUserConfigItems([]) }
    setIsCreateDialogOpen(true)
  }

  async function handleSave() {
    if (!formData.name?.trim()) { toast.error('模板名称不能为空'); return }
    if (!formData.icon?.trim()) { toast.error('模板图标不能为空'); return }
    if ((formData.mcp_type === 'http' || formData.mcp_type === 'sse') && !formData.url?.trim()) { toast.error('HTTP/SSE 类型必须填写 URL'); return }
    if (formData.mcp_type === 'stdio' && !formData.command?.trim()) { toast.error('STDIO 类型必须填写命令'); return }
    const keyRegex = /^[A-Za-z0-9_-]+$/
    for (let i = 0; i < userConfigItems.length; i++) {
      const item = userConfigItems[i]
      if (!item.name?.trim()) { toast.error(`用户配置项第 ${i + 1} 行：名称不能为空`); return }
      if (!item.key?.trim()) { toast.error(`用户配置项第 ${i + 1} 行：Key 不能为空`); return }
      if (!keyRegex.test(item.key)) { toast.error(`用户配置项第 ${i + 1} 行：Key 只允许字母、数字、下划线和中划线`); return }
    }
    const payload = {
      ...formData,
      config_json: userConfigItems.length > 0 ? JSON.stringify({ user_config_items: userConfigItems }) : null,
    }
    try {
      if (editingTemplate) {
        await updateMcpTemplate(editingTemplate.id, payload)
        toast.success('模板已更新')
      } else {
        await createMcpTemplate(payload)
        toast.success('模板已创建')
      }
      setIsCreateDialogOpen(false)
      loadTemplates()
    } catch (err) {
      toast.error(editingTemplate ? '更新失败' : '创建失败')
    }
  }

  async function handleDelete(template: McpTemplate) {
    if (!confirm(`确定删除模板 "${template.name}"？`)) return
    try {
      await deleteMcpTemplate(template.id)
      toast.success('模板已删除')
      loadTemplates()
    } catch { toast.error('删除失败') }
  }

  const tagsArray = (tags: string[] | null): string[] => {
    if (!tags) return []
    if (Array.isArray(tags)) return tags
    return []
  }

  if (isLoading && templates.length === 0) {
    return (
      <DashboardLayout title="MCP 模板市场" description="浏览和安装预配置的 MCP 模板">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout title="MCP 模板市场" description="浏览和安装预配置的 MCP 模板">
      {/* Search & Filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索模板..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="分类" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat!}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={loadTemplates} disabled={isLoading}>
            {isLoading ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}刷新
          </Button>
          <Button size="sm" onClick={handleCreate}><Plus className="size-3.5 mr-1" />新建模板</Button>
        </div>
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.length === 0 ? (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            没有找到匹配的模板
          </div>
        ) : (
          templates.map((template) => (
            <Card key={template.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg border bg-muted/20 flex items-center justify-center overflow-hidden shrink-0">
                    <img src={template.icon} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{template.name}</CardTitle>
                    {template.category && (
                      <CardDescription className="mt-0.5 truncate">{template.category}</CardDescription>
                    )}
                  </div>
                  <TypeBadge mcpType={template.mcp_type} />
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                {template.description && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{template.description}</p>
                )}
                {tagsArray(template.tags_json).length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-4">
                    {tagsArray(template.tags_json).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-auto pt-3 border-t">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Download className="size-3" />{template.downloads}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 ml-auto">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => handleEdit(template)} title="编辑"><Pencil className="size-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => handleDelete(template)} title="删除"><Trash2 className="size-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? '编辑模板' : '新建模板'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>名称 <span className="text-destructive">*</span></Label>
                <Input value={formData.name ?? ''} onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="模板名称" />
              </div>
              <div className="space-y-1.5">
                <Label>图标 <span className="text-destructive">*</span></Label>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg border bg-muted/20 flex items-center justify-center overflow-hidden shrink-0">
                    {formData.icon ? (
                      <img src={formData.icon} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" className="relative" disabled={isUploadingIcon}>
                    {isUploadingIcon ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
                    {isUploadingIcon ? '上传中...' : '上传图标'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void handleIconUpload(file)
                        e.target.value = ''
                      }}
                    />
                  </Button>
                </div>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>描述</Label>
                <Input value={formData.description ?? ''} onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))} placeholder="描述" />
              </div>
              <div className="space-y-1.5">
                <Label>分类</Label>
                <Input value={formData.category ?? ''} onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))} placeholder="分类" />
              </div>
              <div className="space-y-1.5">
                <Label>类型</Label>
                <Select value={formData.mcp_type ?? 'http'} onValueChange={(v) => setFormData(prev => ({ ...prev, mcp_type: v as 'http' | 'sse' | 'stdio' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="sse">SSE</SelectItem>
                    <SelectItem value="stdio">STDIO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(formData.mcp_type === 'http' || formData.mcp_type === 'sse') && (
                <div className="col-span-2 space-y-1.5">
                  <Label>URL</Label>
                  <Input value={formData.url ?? ''} onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))} placeholder="https://..." />
                </div>
              )}
              {formData.mcp_type === 'stdio' && (
                <div className="col-span-2 space-y-1.5">
                  <Label>命令</Label>
                  <Input value={formData.command ?? ''} onChange={(e) => setFormData(prev => ({ ...prev, command: e.target.value }))} placeholder="npx ..." />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>范围</Label>
                <Select value={formData.scope ?? 'org'} onValueChange={(v) => setFormData(prev => ({ ...prev, scope: v as 'org' | 'department' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="org">企业</SelectItem>
                    <SelectItem value="department">部门</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>风险等级</Label>
                <Select value={formData.risk_level ?? 'low'} onValueChange={(v) => setFormData(prev => ({ ...prev, risk_level: v as 'low' | 'medium' | 'high' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">低</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* User Config Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">用户配置项</Label>
                <Button variant="outline" size="sm" onClick={() => setUserConfigItems(prev => [...prev, { name: '', target: 'env', key: '', description: '', required: true }])}>
                  <Plus className="size-3 mr-1" />添加
                </Button>
              </div>
              {userConfigItems.length > 0 && (
                <div className="space-y-2">
                  {userConfigItems.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 p-2 border rounded-md">
                      <div className="flex-1 space-y-1">
                        <div className="flex gap-2">
                          <Input className="flex-1" placeholder="名称 *" value={item.name} onChange={(e) => {
                            const next = [...userConfigItems]; next[idx] = { ...next[idx], name: e.target.value }; setUserConfigItems(next)
                          }} />
                          <Select value={item.target} onValueChange={(v) => {
                            const next = [...userConfigItems]; next[idx] = { ...next[idx], target: v as 'env' | 'headers' }; setUserConfigItems(next)
                          }}>
                            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="env">env</SelectItem><SelectItem value="headers">headers</SelectItem></SelectContent>
                          </Select>
                          <Input className="flex-1" placeholder="Key *" value={item.key} onChange={(e) => {
                            const next = [...userConfigItems]; next[idx] = { ...next[idx], key: e.target.value }; setUserConfigItems(next)
                          }} />
                        </div>
                        <div className="flex gap-2">
                          <Input className="flex-1" placeholder="说明(可选)" value={item.description ?? ''} onChange={(e) => {
                            const next = [...userConfigItems]; next[idx] = { ...next[idx], description: e.target.value }; setUserConfigItems(next)
                          }} />
                          <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                            <input type="checkbox" checked={item.required ?? true} onChange={(e) => {
                              const next = [...userConfigItems]; next[idx] = { ...next[idx], required: e.target.checked }; setUserConfigItems(next)
                            }} />必填
                          </label>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setUserConfigItems(prev => prev.filter((_, i) => i !== idx))}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave}>{editingTemplate ? '保存' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </DashboardLayout>
  )
}
