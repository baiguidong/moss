'use client'

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Download, Star, Loader2 } from 'lucide-react'
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
import { fetchMcpTemplates } from '@/lib/api/mcp'
import type { McpTemplate } from '@/lib/api/mcp'
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
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{template.display_name ?? template.name}</CardTitle>
                    {template.category && (
                      <CardDescription className="mt-1">{template.category}</CardDescription>
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
                <div className="flex items-center justify-between mt-auto pt-3 border-t">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Download className="size-3" />{template.downloads}
                    </span>
                    <span className="flex items-center gap-1">
                      <Star className="size-3 fill-yellow-400 text-yellow-400" />{template.rating}
                    </span>
                  </div>
                  <Button size="sm" onClick={() => handleInstall(template)}>
                    安装
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

    </DashboardLayout>
  )
}
