'use client'

import { useState } from 'react'
import { Search, Download, Star } from 'lucide-react'
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

interface McpTemplate {
  id: string
  name: string
  display_name: string
  description: string
  category: string
  mcp_type: 'http' | 'sse' | 'stdio'
  author: string
  downloads: number
  rating: number
  tags: string[]
}

const mockTemplates: McpTemplate[] = [
  {
    id: '1', name: 'crm-template', display_name: 'CRM MCP 模板',
    description: '客户关系管理系统标准接口模板，支持客户查询、商机管理、订单跟踪等功能',
    category: '业务系统', mcp_type: 'http', author: 'Sudo官方',
    downloads: 256, rating: 4.8, tags: ['CRM', '销售', '客户管理'],
  },
  {
    id: '2', name: 'erp-template', display_name: 'ERP MCP 模板',
    description: '企业资源规划系统集成模板，支持采购、库存、财务等模块对接',
    category: '业务系统', mcp_type: 'http', author: 'Sudo官方',
    downloads: 189, rating: 4.5, tags: ['ERP', '采购', '库存'],
  },
  {
    id: '3', name: 'knowledge-template', display_name: '知识库 MCP 模板',
    description: '企业知识库检索模板，支持文档搜索、问答、摘要生成',
    category: '知识管理', mcp_type: 'sse', author: 'Sudo官方',
    downloads: 342, rating: 4.9, tags: ['知识库', '搜索', 'RAG'],
  },
  {
    id: '4', name: 'git-template', display_name: 'Git MCP 模板',
    description: 'Git 仓库操作模板，支持代码搜索、PR 管理、Issue 跟踪',
    category: '开发工具', mcp_type: 'http', author: '社区贡献',
    downloads: 512, rating: 4.7, tags: ['Git', '代码', 'PR'],
  },
  {
    id: '5', name: 'slack-template', display_name: 'Slack MCP 模板',
    description: 'Slack 消息集成模板，支持消息发送、频道管理、文件共享',
    category: '办公协作', mcp_type: 'http', author: '社区贡献',
    downloads: 128, rating: 4.3, tags: ['Slack', '消息', '协作'],
  },
  {
    id: '6', name: 'database-template', display_name: '数据库 MCP 模板',
    description: '数据库查询模板，支持 SQL 执行、表结构查看、数据导出',
    category: '开发工具', mcp_type: 'stdio', author: 'Sudo官方',
    downloads: 275, rating: 4.6, tags: ['数据库', 'SQL', '查询'],
  },
]

function TypeBadge({ mcpType }: { mcpType: string }) {
  const labels: Record<string, string> = { http: 'HTTP', sse: 'SSE', stdio: 'STDIO' }
  return <Badge variant="outline">{labels[mcpType] || mcpType}</Badge>
}

export default function McpTemplatesPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')

  const categories = [...new Set(mockTemplates.map((t) => t.category))]

  const filteredTemplates = mockTemplates.filter((t) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!(t.display_name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q)))) return false
    }
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
    return true
  })

  function handleInstall(template: McpTemplate) {
    toast.success(`正在安装 ${template.display_name}，将跳转到创建页面`)
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
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="分类" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTemplates.length === 0 ? (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            没有找到匹配的模板
          </div>
        ) : (
          filteredTemplates.map((template) => (
            <Card key={template.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{template.display_name}</CardTitle>
                    <CardDescription className="mt-1">{template.author}</CardDescription>
                  </div>
                  <TypeBadge mcpType={template.mcp_type} />
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{template.description}</p>
                <div className="flex flex-wrap gap-1 mb-4">
                  {template.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-auto pt-3 border-t">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Download className="size-3" />{template.downloads}
                    </span>
                    <span className="flex items-center gap-1">
                      <Star className="size-3 fill-yellow-400 text-yellow-400" />{template.rating}
                    </span>
                  </div>
                  <Button size="sm" onClick={() => handleInstall(template)}>安装</Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </DashboardLayout>
  )
}
