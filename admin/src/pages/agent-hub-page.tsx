'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  batchSyncAgents,
  fetchAgentHubSkillDetailsByIds,
  getAgentHubCategories,
  getAgentHubDetail,
  getAgentHubAssistants,
  getInstalledAgents,
  installAgent,
  uninstallAgent,
  updateInstalledAgentMeta,
  createCustomAssistant,
  getAgentSyncStatus,
  type AgentHubAssistant,
  type AgentHubDetail,
  type BatchSyncAgentResult,
  type InstalledAgentInfo,
  type AgentSyncProgress,
} from '@/lib/api/agent-hub'
import { getSystemSettings } from '@/lib/api/settings'
import {
  getInstalledSkills,
  getSkillHubDetail,
  installSkill,
  type InstalledSkillInfo,
  type SkillHubSkill,
} from '@/lib/api/skill-store'
import type { AuthDepartment, AuthUser } from '@/lib/api/types'
import { getDepartments, getUsers } from '@/lib/api/auth'
import type { SystemSettings } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import {
  Bot,
  CheckCircle2,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'

type AgentHubTab = 'store' | 'installed'

type CoreFeature = {
  title: string
  desc?: string
}

type AgentSkillSummary = SkillHubSkill & {
  isInstalled: boolean
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean)
  }
  if (typeof value !== 'string' || !value.trim()) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed
          .map(item => String(item || '').trim())
          .filter(Boolean)
      : []
  } catch {
    return [value.trim()]
  }
}

function parseCoreFeatures(value: unknown): CoreFeature[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is CoreFeature =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as CoreFeature).title === 'string',
    )
  }
  if (typeof value !== 'string' || !value.trim()) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is CoreFeature =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as CoreFeature).title === 'string',
        )
      : []
  } catch {
    return []
  }
}

function normalizeVersion(value: unknown): string {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  const lower = normalized.toLowerCase()
  if (lower === 'unknown' || lower === 'unkown') return ''
  return normalized
}

function installedToHubAssistant(agent: InstalledAgentInfo): AgentHubAssistant {
  return {
    id: agent.meta?.id || agent.id || agent.name,
    name: agent.name,
    display_name: agent.displayName,
    description: agent.description,
    avatar: agent.avatar,
    emoji: agent.emoji || null,
    category: agent.category,
    categories: agent.categories,
    skills: agent.skills,
    sourceUrl: '',
  }
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="rounded-xl border bg-card p-4">
          <div className="flex gap-4">
            <Skeleton className="size-12 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

type StoreAgentCardProps = {
  agent: AgentHubAssistant
  installed: boolean
  busy: boolean
  onOpen: (agent: AgentHubAssistant) => void
  onInstall: (agent: AgentHubAssistant, skillIds: string[]) => void
}

function StoreAgentCard({
  agent,
  installed,
  busy,
  onOpen,
  onInstall,
}: StoreAgentCardProps) {
  const skillIds = agent.skills || []

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(agent)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(agent)
        }
      }}
      className="group relative flex w-full items-start gap-4 overflow-hidden rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/30"
    >
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-xl">
        {agent.avatar ? (
          <img
            src={agent.avatar}
            alt={agent.display_name}
            className="size-full object-cover"
          />
        ) : agent.emoji ? (
          <span>{agent.emoji}</span>
        ) : (
          <Bot className="size-5 text-muted-foreground" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{agent.display_name}</h3>
          {installed ? <Badge variant="secondary">已安装</Badge> : null}
          {skillIds.length > 0 ? (
            <Badge variant="outline">{skillIds.length} 个关联技能</Badge>
          ) : null}
        </div>

        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
          {agent.description || '暂无描述'}
        </p>

        {agent.categories?.length ? (
          <div className="flex flex-wrap gap-2">
            {agent.categories.slice(0, 3).map(category => (
              <Badge key={`${agent.id}:${category}`} variant="outline">
                {category}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="shrink-0">
        {busy ? (
          <Button size="sm" disabled>
            <Loader2 className="mr-2 size-4 animate-spin" />
            安装中
          </Button>
        ) : installed ? (
          <Button size="sm" variant="outline" disabled>
            已安装
          </Button>
        ) : agent.sourceUrl ? (
          <Button
            size="sm"
            onClick={event => {
              event.stopPropagation()
              onInstall(agent, skillIds)
            }}
          >
            安装
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            不可安装
          </Button>
        )}
      </div>
    </div>
  )
}

type InstalledAgentCardProps = {
  agent: InstalledAgentInfo
  uninstalling: boolean
  onOpenEdit: (agent: InstalledAgentInfo) => void
  onOpenVisibility: (agent: InstalledAgentInfo) => void
  onRequestUninstall: (agent: InstalledAgentInfo) => void
}

function InstalledAgentCard({
  agent,
  uninstalling,
  onOpenEdit,
  onOpenVisibility,
  onRequestUninstall,
}: InstalledAgentCardProps) {
  const badges = [
    agent.isBuiltin ? '系统内置' : agent.isHubInstalled ? 'Hub' : '本地',
    agent.version ? `v${agent.version}` : '',
    agent.skills.length > 0 ? `${agent.skills.length} 个关联技能` : '',
    (agent.agentType || agent.meta?.agent_type) === 'workflow' ? '业务流程' : '对话助手',
  ].filter(Boolean)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenEdit(agent)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpenEdit(agent)
        }
      }}
      className="flex items-start gap-4 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/30"
    >
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-xl">
        {agent.avatar ? (
          <img
            src={agent.avatar}
            alt={agent.displayName}
            className="size-full object-cover"
          />
        ) : agent.emoji ? (
          <span>{agent.emoji}</span>
        ) : (
          <Bot className="size-5 text-muted-foreground" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{agent.displayName}</h3>
          {agent.enabled ? (
            <Badge variant="secondary">已启用</Badge>
          ) : (
            <Badge variant="outline">已禁用</Badge>
          )}
        </div>
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
          {agent.description || '暂无描述'}
        </p>
        <div className="flex flex-wrap gap-2">
          {badges.map(badge => (
            <Badge key={`${agent.source}:${badge}`} variant="outline">
              {badge}
            </Badge>
          ))}
          {agent.categories.map(category => (
            <Badge key={`${agent.source}:${category}`} variant="outline">
              {category}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={event => {
            event.stopPropagation()
            onOpenVisibility(agent)
          }}
          title="编辑可见性"
        >
          <Shield className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={event => {
            event.stopPropagation()
            onOpenEdit(agent)
          }}
        >
          编辑
        </Button>
        {!agent.isBuiltin ? (
          <Button
            size="icon"
            variant="ghost"
            disabled={uninstalling}
            onClick={event => {
              event.stopPropagation()
              onRequestUninstall(agent)
            }}
          >
            {uninstalling ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4 text-destructive" />
            )}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export default function AgentHubPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  const [activeTab, setActiveTab] = useState<AgentHubTab>('store')
  const [assistants, setAssistants] = useState<AgentHubAssistant[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [installedFilterAgentType, setInstalledFilterAgentType] = useState<'all' | 'chat' | 'workflow'>('all')
  const [installedFilterVisibility, setInstalledFilterVisibility] = useState<'all' | 'public' | 'restricted' | 'admin-only'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')

  const [installedAgents, setInstalledAgents] = useState<InstalledAgentInfo[]>([])
  const [installedSkills, setInstalledSkills] = useState<InstalledSkillInfo[]>([])

  const [storeLoading, setStoreLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [installedLoading, setInstalledLoading] = useState(false)
  const [storeError, setStoreError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const [installingAssistantId, setInstallingAssistantId] = useState<string | null>(null)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailAgent, setDetailAgent] = useState<AgentHubAssistant | null>(null)
  const [detailData, setDetailData] = useState<AgentHubDetail | null>(null)
  const [detailSkills, setDetailSkills] = useState<AgentSkillSummary[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<InstalledAgentInfo | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editAvatar, setEditAvatar] = useState('')
  const [editEmoji, setEditEmoji] = useState('')
  const [editSkills, setEditSkills] = useState<SkillHubSkill[]>([])
  const [editSkillsLoading, setEditSkillsLoading] = useState(false)
  const [editEnabledSkills, setEditEnabledSkills] = useState<string[]>([])
  const [editAddSkillOpen, setEditAddSkillOpen] = useState(false)
  const [editAddSkillSelection, setEditAddSkillSelection] = useState<string[]>([])
  const [savingEdit, setSavingEdit] = useState(false)
  const [editAgentType, setEditAgentType] = useState<'chat' | 'workflow'>('chat')
  const [editMemoryMode, setEditMemoryMode] = useState<'session' | 'user'>('session')
  const [editVisibilityMode, setEditVisibilityMode] = useState<'all' | 'departments' | 'users' | 'admin'>('all')
  const [editVisibleTo, setEditVisibleTo] = useState<string[]>([])
  const [editVisibleUserIds, setEditVisibleUserIds] = useState<string[]>([])
  const [editWorkflowTrigger, setEditWorkflowTrigger] = useState<'cron' | 'webhook' | 'manual'>('manual')
  const [editWorkflowCron, setEditWorkflowCron] = useState('')
  const [editWorkflowWebhookPath, setEditWorkflowWebhookPath] = useState('')
  const [editWorkflowOutputWebhook, setEditWorkflowOutputWebhook] = useState('')
  const [editWorkflowTimeout, setEditWorkflowTimeout] = useState('')
  const [editWorkflowOutputTargets, setEditWorkflowOutputTargets] = useState<string[]>([])
  const [departments, setDepartments] = useState<AuthDepartment[]>([])
  const [users, setUsers] = useState<AuthUser[]>([])

  const [agentVisibilityOpen, setAgentVisibilityOpen] = useState(false)
  const [editingVisibilityAgent, setEditingVisibilityAgent] = useState<InstalledAgentInfo | null>(null)
  const [agentVisibilityMode, setAgentVisibilityMode] = useState<'all' | 'departments' | 'users' | 'admin'>('all')
  const [editAgentVisibleTo, setEditAgentVisibleTo] = useState<string[]>([])
  const [editAgentVisibleUserIds, setEditAgentVisibleUserIds] = useState<string[]>([])
  const [savingAgentVisibility, setSavingAgentVisibility] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDisplayName, setCreateDisplayName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createAvatar, setCreateAvatar] = useState('')
  const [createEmoji, setCreateEmoji] = useState('')
  const [createRules, setCreateRules] = useState('')
  const [createAgentType, setCreateAgentType] = useState<'chat' | 'workflow'>('chat')
  const [createMemoryMode, setCreateMemoryMode] = useState<'session' | 'user'>('session')
  const [createVisibilityMode, setCreateVisibilityMode] = useState<'all' | 'departments' | 'users' | 'admin'>('all')
  const [createVisibleTo, setCreateVisibleTo] = useState<string[]>([])
  const [createVisibleUserIds, setCreateVisibleUserIds] = useState<string[]>([])
  const [createWorkflowTrigger, setCreateWorkflowTrigger] = useState<'cron' | 'webhook' | 'manual'>('manual')
  const [createWorkflowCron, setCreateWorkflowCron] = useState('')
  const [createWorkflowWebhookPath, setCreateWorkflowWebhookPath] = useState('')
  const [createWorkflowOutputWebhook, setCreateWorkflowOutputWebhook] = useState('')
  const [createWorkflowTimeout, setCreateWorkflowTimeout] = useState('')
  const [createWorkflowOutputTargets, setCreateWorkflowOutputTargets] = useState<string[]>([])
  const [createSelectedSkills, setCreateSelectedSkills] = useState<string[]>([])
  const [creatingAssistant, setCreatingAssistant] = useState(false)

  const [pendingUninstallAgent, setPendingUninstallAgent] =
    useState<InstalledAgentInfo | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncProgressOpen, setSyncProgressOpen] = useState(false)
  const [syncProgress, setSyncProgress] = useState<AgentSyncProgress | null>(null)

  const requestIdRef = useRef(0)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  type DepartmentOption = AuthDepartment & { depth: number }

  const departmentOptions = useMemo((): DepartmentOption[] => {
    const build = (depts: AuthDepartment[], parentId: string | null, depth: number): DepartmentOption[] =>
      depts.filter(d => d.parentId === parentId).flatMap(d => [{ ...d, depth }, ...build(depts, d.id, depth + 1)])
    return build(departments, null, 0)
  }, [departments])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim())
    }, 300)

    return () => window.clearTimeout(timer)
  }, [searchQuery])

  const installedAgentLookup = useMemo(() => {
    const lookup = new Map<string, InstalledAgentInfo>()
    for (const agent of installedAgents) {
      lookup.set(agent.name, agent)
      if (agent.id) {
        lookup.set(agent.id, agent)
      }
      if (agent.meta?.id) {
        lookup.set(agent.meta.id, agent)
      }
    }
    return lookup
  }, [installedAgents])

  const installedSkillLookup = useMemo(() => {
    const lookup = new Set<string>()
    for (const skill of installedSkills) {
      if (skill.id) {
        lookup.add(skill.id)
      }
      lookup.add(skill.name)
    }
    return lookup
  }, [installedSkills])

  const tenantId = settings?.skillStore.tenantId.trim() || ''

  const detailResolvedInstalledAgent = useMemo(() => {
    if (!detailAgent) return null
    return (
      installedAgentLookup.get(detailAgent.id) ||
      installedAgentLookup.get(detailAgent.name) ||
      null
    )
  }, [detailAgent, installedAgentLookup])

  const detailSkillIds = useMemo(
    () => parseStringArray(detailData?.skills ?? detailAgent?.skills),
    [detailAgent?.skills, detailData?.skills],
  )

  const detailDisplayName =
    detailData?.display_name ||
    detailAgent?.display_name ||
    detailResolvedInstalledAgent?.displayName ||
    ''
  const detailDescription =
    detailData?.description ||
    detailAgent?.description ||
    detailResolvedInstalledAgent?.description ||
    ''
  const detailCategories =
    detailData?.categories ||
    detailAgent?.categories ||
    detailResolvedInstalledAgent?.categories ||
    []
  const detailScenarios = parseStringArray(detailData?.applicable_scenarios)
  const detailCoreFeatures = parseCoreFeatures(detailData?.core_features)

  const fetchInstalledState = useCallback(async (showLoader = true) => {
    if (showLoader) {
      setInstalledLoading(true)
    }

    try {
      const [agents, skills] = await Promise.all([
        getInstalledAgents(),
        getInstalledSkills(),
      ])
      setInstalledAgents(agents)
      setInstalledSkills(skills)
      return { agents, skills }
    } finally {
      if (showLoader) {
        setInstalledLoading(false)
      }
    }
  }, [])

  const loadBootstrapData = useCallback(async () => {
    setPageLoading(true)
    setPageError('')

    const [settingsResult, categoriesResult, installedResult] =
      await Promise.allSettled([
        getSystemSettings(),
        getAgentHubCategories(),
        fetchInstalledState(false),
      ])

    if (settingsResult.status === 'fulfilled') {
      setSettings(settingsResult.value)
    } else {
      toast.error(
        settingsResult.reason instanceof Error
          ? settingsResult.reason.message
          : '读取系统设置失败',
      )
    }

    if (categoriesResult.status === 'fulfilled') {
      setCategories(categoriesResult.value)
    } else {
      const message =
        categoriesResult.reason instanceof Error
          ? categoriesResult.reason.message
          : '读取智能体分类失败'
      setPageError(message)
    }

    if (installedResult.status === 'rejected') {
      const message =
        installedResult.reason instanceof Error
          ? installedResult.reason.message
          : '读取已安装智能体失败'
      setPageError(current => current || message)
    }

    try {
      const deptResult = await getDepartments()
      setDepartments(deptResult.departments)
    } catch { /* non-critical */ }

    try {
      const userResult = await getUsers()
      setUsers(userResult.users)
    } catch { /* non-critical */ }

    setPageLoading(false)
  }, [fetchInstalledState])

  useEffect(() => {
    void loadBootstrapData()
  }, [loadBootstrapData])

  const loadAssistantsPage = useCallback(
    async (params: {
      cursor?: string
      append: boolean
      requestId: number
      query: string
      category: string
    }) => {
      try {
        if (params.append) {
          setLoadingMore(true)
        } else {
          setStoreLoading(true)
          setStoreError('')
        }

        const response = await getAgentHubAssistants({
          cursor: params.cursor,
          limit: 40,
          query: params.query,
          category: params.category,
        })

        if (params.requestId !== requestIdRef.current) {
          return
        }

        setAssistants(current => {
          if (!params.append) {
            return response.assistants
          }

          const existingIds = new Set(current.map(agent => agent.id))
          return [
            ...current,
            ...response.assistants.filter(agent => !existingIds.has(agent.id)),
          ]
        })
        setNextCursor(response.next_cursor)
        setHasMore(response.has_more)
      } catch (error) {
        if (params.requestId !== requestIdRef.current) {
          return
        }
        setStoreError(error instanceof Error ? error.message : '获取智能体列表失败')
      } finally {
        if (params.requestId === requestIdRef.current) {
          setStoreLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    if (activeTab !== 'store') {
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setAssistants([])
    setNextCursor(null)
    setHasMore(false)

    void loadAssistantsPage({
      append: false,
      requestId,
      query: debouncedSearchQuery,
      category: selectedCategory === 'all' ? '' : selectedCategory,
    })
  }, [activeTab, debouncedSearchQuery, loadAssistantsPage, selectedCategory])

  const handleLoadMore = useCallback(() => {
    if (
      activeTab !== 'store' ||
      storeLoading ||
      loadingMore ||
      !hasMore ||
      !nextCursor
    ) {
      return
    }

    void loadAssistantsPage({
      cursor: nextCursor,
      append: true,
      requestId: requestIdRef.current,
      query: debouncedSearchQuery,
      category: selectedCategory === 'all' ? '' : selectedCategory,
    })
  }, [
    activeTab,
    debouncedSearchQuery,
    hasMore,
    loadAssistantsPage,
    loadingMore,
    nextCursor,
    selectedCategory,
    storeLoading,
  ])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || activeTab !== 'store') {
      return
    }

    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) {
        handleLoadMore()
      }
    })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [activeTab, handleLoadMore, hasMore])

  const buildSkillSummaries = useCallback(
    (skills: SkillHubSkill[]): AgentSkillSummary[] =>
      skills.map(skill => ({
        ...skill,
        isInstalled:
          installedSkillLookup.has(skill.id) || installedSkillLookup.has(skill.name),
      })),
    [installedSkillLookup],
  )

  const openDetail = useCallback(
    async (agent: AgentHubAssistant) => {
      setDetailOpen(true)
      setDetailAgent(agent)
      setDetailData(null)
      setDetailSkills([])
      setDetailLoading(true)

      try {
        const detail = await getAgentHubDetail(agent.id)
        setDetailData(detail)

        const skillIds = parseStringArray(detail?.skills ?? agent.skills)
        if (skillIds.length > 0) {
          // Resolve skill details from local installed data first, then Hub
          const localResolved: SkillHubSkill[] = []
          const missingIds: string[] = []

          for (const sid of skillIds) {
            const trimmed = sid.trim()
            const local = installedSkills.find(
              s => s.id.trim() === trimmed || s.name.trim() === trimmed || (s.meta?.id || '').trim() === trimmed,
            )
            if (local) {
              localResolved.push({
                id: (local.meta?.id || local.id).trim(),
                name: local.name.trim(),
                display_name: local.displayName,
                description: local.description,
                icon: local.icon,
                emoji: local.emoji,
                category: local.category,
                categories: local.categories,
              })
            } else {
              missingIds.push(trimmed)
            }
          }

          let hubResolved: SkillHubSkill[] = []
          if (missingIds.length > 0) {
            try {
              hubResolved = await fetchAgentHubSkillDetailsByIds(missingIds)
            } catch {
              for (const mid of missingIds) {
                hubResolved.push({ id: mid, name: mid, display_name: mid })
              }
            }
          }

          setDetailSkills(buildSkillSummaries([...localResolved, ...hubResolved]))
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '读取智能体详情失败')
      } finally {
        setDetailLoading(false)
      }
    },
    [buildSkillSummaries, installedSkills],
  )

  const openEdit = useCallback(async (agent: InstalledAgentInfo) => {
    setEditingAgent(agent)
    setEditName(agent.displayName || agent.name)
    setEditDescription(agent.description || '')
    setEditAvatar(agent.avatar || '')
    setEditEmoji(agent.emoji || '')
    setEditAgentType(agent.agentType || agent.meta?.agent_type || 'chat')
    setEditMemoryMode(agent.memoryMode || agent.meta?.memory_mode || 'session')
    setEditVisibleTo(agent.visibleTo?.department_ids ?? agent.meta?.visible_to?.department_ids ?? [])
    setEditVisibleUserIds(agent.visibleTo?.user_ids ?? agent.meta?.visible_to?.user_ids ?? [])

    // Determine visibility mode
    const deptIds = agent.visibleTo?.department_ids ?? agent.meta?.visible_to?.department_ids
    const userIds = agent.visibleTo?.user_ids ?? agent.meta?.visible_to?.user_ids

    if (deptIds === null && userIds === null) {
      setEditVisibilityMode('all')
    } else if ((deptIds?.length === 0 && (userIds === null || userIds?.length === 0)) ||
               (userIds?.length === 0 && (deptIds === null || deptIds?.length === 0))) {
      setEditVisibilityMode('admin')
    } else if (userIds !== null && userIds !== undefined && userIds.length > 0) {
      setEditVisibilityMode('users')
    } else if (deptIds !== null && deptIds !== undefined && deptIds.length > 0) {
      setEditVisibilityMode('departments')
    } else {
      setEditVisibilityMode('all')
    }

    setEditWorkflowTrigger(agent.workflow?.trigger || agent.meta?.workflow?.trigger || 'manual')
    setEditWorkflowCron(agent.workflow?.cron || agent.meta?.workflow?.cron || '')
    setEditWorkflowWebhookPath(agent.workflow?.webhook_path || agent.meta?.workflow?.webhook_path || '')
    setEditWorkflowOutputWebhook(agent.workflow?.output_webhook || agent.meta?.workflow?.output_webhook || '')
    setEditWorkflowTimeout(String(agent.workflow?.timeout_minutes ?? agent.meta?.workflow?.timeout_minutes ?? ''))
    setEditWorkflowOutputTargets(agent.workflow?.output_targets || agent.meta?.workflow?.output_targets || [])
    setEditSkills([])
    // Normalize enabledSkills: trim whitespace and deduplicate
    const rawEnabled = agent.enabledSkills || agent.meta?.enabledSkills || agent.skills || []
    const normalizedEnabled = [...new Set(rawEnabled.map(s => s.trim()).filter(Boolean))]
    setEditEnabledSkills(normalizedEnabled)
    setEditOpen(true)

    if (agent.skills.length === 0) {
      setEditSkillsLoading(false)
      return
    }

    setEditSkillsLoading(true)
    try {
      // agent.skills can be UUIDs (Hub agents) or names (custom agents)
      // installedSkills may have leading/trailing whitespace in name/id fields
      const allInstalled = installedSkills
      const localSkills: SkillHubSkill[] = []
      const missingIds: string[] = []

      for (const skillRef of agent.skills) {
        const trimmed = skillRef.trim()
        const local = allInstalled.find(
          s => s.id.trim() === trimmed || s.name.trim() === trimmed || (s.meta?.id || '').trim() === trimmed,
        )
        if (local) {
          localSkills.push({
            id: (local.meta?.id || local.id).trim(),
            name: local.name.trim(),
            display_name: local.displayName,
            description: local.description,
            icon: local.icon,
            emoji: local.emoji,
            category: local.category,
            categories: local.categories,
          })
        } else {
          missingIds.push(trimmed)
        }
      }

      // Fetch missing skill details from Hub API
      if (missingIds.length > 0) {
        try {
          const hubSkills = await fetchAgentHubSkillDetailsByIds(missingIds)
          localSkills.push(...hubSkills)
        } catch {
          for (const mid of missingIds) {
            localSkills.push({ id: mid, name: mid, display_name: mid })
          }
        }
      }

      setEditSkills(localSkills)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取关联技能失败')
    } finally {
      setEditSkillsLoading(false)
    }
  }, [installedSkills])

  const handleInstall = useCallback(
    async (agent: AgentHubAssistant, skillIds: string[]) => {
      if (installingAssistantId) {
        return
      }

      const sourceUrl = agent.sourceUrl?.trim() || ''
      if (!sourceUrl) {
        toast.error('该智能体暂不支持安装')
        return
      }

      setInstallingAssistantId(agent.id)
      try {
        const result = await installAgent({
          assistantName: agent.name,
          sourceUrl,
          version: normalizeVersion((detailData?.id === agent.id && detailData?.versions?.[0]?.version) || ''),
          checksum:
            detailData?.id === agent.id &&
            typeof detailData.versions?.[0]?.checksum === 'string'
              ? detailData.versions?.[0]?.checksum
              : undefined,
          assistantMeta: agent,
          selectedSkillIds: skillIds,
        })

        let message = `已安装 ${agent.display_name}`
        if (result.installedSkills.length > 0) {
          message += `，并安装 ${result.installedSkills.length} 个关联技能`
        }
        if (result.failedSkills.length > 0) {
          message += `，${result.failedSkills.length} 个关联技能安装失败`
        }
        toast.success(message)
        await fetchInstalledState(false)
        setDetailOpen(false)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '安装智能体失败')
      } finally {
        setInstallingAssistantId(null)
      }
    },
    [detailData, fetchInstalledState, installingAssistantId],
  )

  const handleSaveEdit = useCallback(async () => {
    if (!editingAgent) {
      return
    }

    setSavingEdit(true)
    try {
      await updateInstalledAgentMeta({
        assistantName: editingAgent.name,
        updates: {
          display_name: editName.trim(),
          description: editDescription.trim(),
          avatar: editAvatar.trim(),
          emoji: editEmoji.trim(),
          agent_type: editAgentType,
          memory_mode: editAgentType === 'chat' ? editMemoryMode : undefined,
          skills: editSkills.map(s => s.id || s.name),
          enabledSkills: editEnabledSkills,
          visible_to: editVisibilityMode === 'admin'
            ? { department_ids: [], user_ids: [] }
            : editVisibilityMode === 'departments'
              ? { department_ids: editVisibleTo.length > 0 ? editVisibleTo : null, user_ids: null }
              : editVisibilityMode === 'users'
                ? { department_ids: null, user_ids: editVisibleUserIds.length > 0 ? editVisibleUserIds : null }
                : null,
          workflow: editAgentType === 'workflow'
            ? {
                trigger: editWorkflowTrigger,
                cron: editWorkflowTrigger === 'cron' ? editWorkflowCron.trim() || undefined : undefined,
                webhook_path: editWorkflowTrigger === 'webhook' ? editWorkflowWebhookPath.trim() || undefined : undefined,
                output_targets: editWorkflowOutputTargets.length > 0 ? editWorkflowOutputTargets : undefined,
                output_webhook: editWorkflowOutputWebhook.trim() || undefined,
                timeout_minutes: editWorkflowTimeout ? Number(editWorkflowTimeout) || undefined : undefined,
              }
            : null,
        },
      })
      toast.success(`已更新 ${editingAgent.displayName}`)
      await fetchInstalledState(false)
      setEditOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存智能体信息失败')
    } finally {
      setSavingEdit(false)
    }
  }, [editAvatar, editDescription, editEmoji, editName, editAgentType, editMemoryMode, editVisibilityMode, editVisibleTo, editVisibleUserIds, editWorkflowTrigger, editWorkflowCron, editWorkflowWebhookPath, editWorkflowOutputWebhook, editWorkflowTimeout, editWorkflowOutputTargets, editEnabledSkills, editSkills, editingAgent, fetchInstalledState])

  const handleCreate = useCallback(async () => {
    const name = createName.trim()
    const displayName = createDisplayName.trim()
    const rules = createRules.trim()

    if (!name || !displayName) {
      toast.error('名称和显示名称为必填项')
      return
    }

    if (!rules) {
      toast.error('系统指令为必填项')
      return
    }

    setCreatingAssistant(true)
    try {
      await createCustomAssistant({
        name,
        displayName,
        description: createDescription.trim() || undefined,
        avatar: createAvatar.trim() || undefined,
        emoji: createEmoji.trim() || undefined,
        rules,
        skills: createSelectedSkills.length > 0 ? createSelectedSkills : undefined,
        agent_type: createAgentType,
        memory_mode: createAgentType === 'chat' ? createMemoryMode : undefined,
        visible_to: createVisibilityMode === 'admin'
          ? { department_ids: [], user_ids: [] }
          : createVisibilityMode === 'departments'
            ? { department_ids: createVisibleTo.length > 0 ? createVisibleTo : null, user_ids: null }
            : createVisibilityMode === 'users'
              ? { department_ids: null, user_ids: createVisibleUserIds.length > 0 ? createVisibleUserIds : null }
              : null,
        workflow: createAgentType === 'workflow'
          ? {
              trigger: createWorkflowTrigger,
              cron: createWorkflowTrigger === 'cron' ? createWorkflowCron.trim() || undefined : undefined,
              webhook_path: createWorkflowTrigger === 'webhook' ? createWorkflowWebhookPath.trim() || undefined : undefined,
              output_targets: createWorkflowOutputTargets.length > 0 ? createWorkflowOutputTargets : undefined,
              output_webhook: createWorkflowOutputWebhook.trim() || undefined,
              timeout_minutes: createWorkflowTimeout ? Number(createWorkflowTimeout) || undefined : undefined,
            }
          : null,
      })
      toast.success(`已创建智能体 ${displayName}`)
      setCreateOpen(false)
      setCreateName('')
      setCreateDisplayName('')
      setCreateDescription('')
      setCreateAvatar('')
      setCreateEmoji('')
      setCreateRules('')
      setCreateAgentType('chat')
      setCreateMemoryMode('session')
      setCreateVisibilityMode('all')
      setCreateVisibleTo([])
      setCreateVisibleUserIds([])
      setCreateWorkflowTrigger('manual')
      setCreateWorkflowCron('')
      setCreateWorkflowOutputTargets([])
      setCreateSelectedSkills([])
      await fetchInstalledState(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建智能体失败')
    } finally {
      setCreatingAssistant(false)
    }
  }, [createAvatar, createDescription, createDisplayName, createEmoji, createName, createRules, createAgentType, createMemoryMode, createVisibilityMode, createVisibleTo, createWorkflowTrigger, createWorkflowCron, createWorkflowWebhookPath, createWorkflowOutputWebhook, createWorkflowTimeout, createWorkflowOutputTargets, createSelectedSkills, fetchInstalledState])

  const handleConfirmUninstall = useCallback(async () => {
    if (!pendingUninstallAgent) {
      return
    }

    try {
      await uninstallAgent({
        assistantName: pendingUninstallAgent.name,
        sourcePath: pendingUninstallAgent.source,
      })
      toast.success(`已卸载 ${pendingUninstallAgent.displayName}`)
      await fetchInstalledState(false)
      if (detailResolvedInstalledAgent?.name === pendingUninstallAgent.name) {
        setDetailOpen(false)
      }
      if (editingAgent?.name === pendingUninstallAgent.name) {
        setEditOpen(false)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '卸载智能体失败')
    } finally {
      setPendingUninstallAgent(null)
    }
  }, [
    detailResolvedInstalledAgent?.name,
    editingAgent?.name,
    fetchInstalledState,
    pendingUninstallAgent,
  ])

  const openAgentVisibility = useCallback((agent: InstalledAgentInfo) => {
    setEditingVisibilityAgent(agent)
    const deptIds = agent.visibleTo?.department_ids
    const userIds = agent.visibleTo?.user_ids

    // Determine visibility mode
    if (deptIds === null && userIds === null) {
      setAgentVisibilityMode('all')
    } else if ((deptIds?.length === 0 && (userIds === null || userIds?.length === 0)) ||
               (userIds?.length === 0 && (deptIds === null || deptIds?.length === 0))) {
      setAgentVisibilityMode('admin')
    } else if (userIds !== null && userIds !== undefined && userIds.length > 0) {
      setAgentVisibilityMode('users')
    } else if (deptIds !== null && deptIds !== undefined && deptIds.length > 0) {
      setAgentVisibilityMode('departments')
    } else {
      setAgentVisibilityMode('all')
    }

    setEditAgentVisibleTo(deptIds ?? [])
    setEditAgentVisibleUserIds(userIds ?? [])
    setAgentVisibilityOpen(true)
  }, [])

  const handleSaveAgentVisibility = useCallback(async () => {
    if (!editingVisibilityAgent) return
    setSavingAgentVisibility(true)
    try {
      await updateInstalledAgentMeta({
        assistantName: editingVisibilityAgent.name,
        updates: {
          visible_to: agentVisibilityMode === 'admin'
            ? { department_ids: [], user_ids: [] }
            : agentVisibilityMode === 'departments'
              ? { department_ids: editAgentVisibleTo.length > 0 ? editAgentVisibleTo : null, user_ids: null }
              : agentVisibilityMode === 'users'
                ? { department_ids: null, user_ids: editAgentVisibleUserIds.length > 0 ? editAgentVisibleUserIds : null }
                : null,
        },
      })
      toast.success('可见性已更新')
      setAgentVisibilityOpen(false)
      await fetchInstalledState(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新可见性失败')
    } finally {
      setSavingAgentVisibility(false)
    }
  }, [editingVisibilityAgent, agentVisibilityMode, editAgentVisibleTo, editAgentVisibleUserIds, fetchInstalledState])

  const departmentNameMap = useMemo(
    () => new Map(departments.map(dept => [dept.id, dept.name])),
    [departments],
  )

  const filteredInstalledAgents = useMemo(() => {
    return installedAgents.filter(agent => {
      if (installedFilterAgentType !== 'all') {
        const type = agent.agentType || agent.meta?.agent_type
        if (type !== installedFilterAgentType) return false
      }
      if (installedFilterVisibility !== 'all') {
        const deptIds = agent.visibleTo?.department_ids
        if (installedFilterVisibility === 'public' && deptIds !== null && deptIds !== undefined) return false
        if (installedFilterVisibility === 'restricted' && (deptIds === null || deptIds === undefined || deptIds.length === 0)) return false
        if (installedFilterVisibility === 'admin-only' && (deptIds === null || deptIds === undefined || deptIds.length > 0)) return false
      }
      return true
    })
  }, [installedAgents, installedFilterAgentType, installedFilterVisibility])

  const handleRefresh = useCallback(async () => {
    await loadBootstrapData()
    if (activeTab === 'store') {
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setAssistants([])
      setNextCursor(null)
      setHasMore(false)

      await loadAssistantsPage({
        append: false,
        requestId,
        query: debouncedSearchQuery,
        category: selectedCategory === 'all' ? '' : selectedCategory,
      })
    }
  }, [
    activeTab,
    debouncedSearchQuery,
    loadAssistantsPage,
    loadBootstrapData,
    selectedCategory,
  ])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      await batchSyncAgents()
      setSyncProgressOpen(true)
      setSyncProgress(null)
      const poll = setInterval(async () => {
        try {
          const status = await getAgentSyncStatus()
          setSyncProgress(status)
          if (status.status === 'done' || status.status === 'error') {
            clearInterval(poll)
            setSyncing(false)
            if (status.status === 'done') {
              const parts: string[] = []
              if (status.installed > 0) parts.push(`新安装 ${status.installed} 个`)
              if (status.updated > 0) parts.push(`更新 ${status.updated} 个`)
              if (status.failed > 0) parts.push(`${status.failed} 个失败`)
              if (parts.length === 0) {
                toast.info('所有智能体已是最新版本')
              } else {
                toast.success(`同步完成：${parts.join('，')}`)
              }
            } else {
              toast.error(status.error || '同步失败')
            }
            await fetchInstalledState(false)
          }
        } catch {
          clearInterval(poll)
          setSyncing(false)
        }
      }, 1000)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '同步智能体失败')
      setSyncing(false)
    }
  }, [fetchInstalledState])

  if (pageLoading) {
    return (
      <DashboardLayout
        title="智能体管理"
        description="浏览、安装和管理 Hub 智能体，安装动作在 server 侧执行。"
      >
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <LoadingSkeleton />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout
      title="智能体管理"
      description="浏览、安装和管理 Hub 智能体，安装动作在 server 侧执行。"
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={tenantId ? 'secondary' : 'outline'}>
              {tenantId ? `专属技能租户: ${tenantId}` : '未配置专属技能租户 ID'}
            </Badge>
            <Badge variant="secondary">已安装 {installedAgents.length} 个智能体</Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 size-4" />
              创建智能体
            </Button>
            <Button variant="outline" onClick={() => void handleSync()} disabled={syncing}>
              {syncing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
              批量同步
            </Button>
            <Button variant="outline" onClick={() => void handleRefresh()}>
              <RefreshCw className="mr-2 size-4" />
              刷新
            </Button>
          </div>
        </div>

        {pageError ? (
          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertTitle>初始化失败</AlertTitle>
            <AlertDescription>{pageError}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <Tabs
                value={activeTab}
                onValueChange={value => setActiveTab(value as AgentHubTab)}
                className="gap-0"
              >
                <TabsList>
                  <TabsTrigger value="store">智能体库</TabsTrigger>
                  <TabsTrigger value="installed">
                    已安装
                    {installedAgents.length > 0 ? (
                      <span className="rounded-full bg-primary px-1.5 py-0 text-[10px] leading-4 text-primary-foreground">
                        {installedAgents.length}
                      </span>
                    ) : null}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div
                className={cn(
                  'min-w-0 flex-1 transition-opacity',
                  activeTab === 'installed' && 'pointer-events-none opacity-0',
                )}
              >
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="搜索智能体..."
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            {activeTab === 'store' ? (
              <div className="flex flex-wrap gap-2">
                {[{ key: 'all', label: '精选' }, ...categories.map(item => ({ key: item, label: item }))].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelectedCategory(item.key)}
                    className={cn(
                      'rounded-full px-3 py-1 text-sm transition-colors',
                      selectedCategory === item.key
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground mr-1">类型</span>
                {([['all', '全部'], ['chat', '对话助手'], ['workflow', '业务流程']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setInstalledFilterAgentType(key)}
                    className={cn(
                      'rounded-full px-3 py-1 text-sm transition-colors',
                      installedFilterAgentType === key
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
                <span className="text-sm text-muted-foreground ml-3 mr-1">可见性</span>
                {([['all', '全部'], ['public', '全员可见'], ['restricted', '指定部门'], ['admin-only', '仅管理员']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setInstalledFilterVisibility(key)}
                    className={cn(
                      'rounded-full px-3 py-1 text-sm transition-colors',
                      installedFilterVisibility === key
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </CardHeader>

          <CardContent className="pt-6">
            <Tabs value={activeTab} className="gap-0">
              <TabsContent value="store" className="space-y-4">
                {storeError ? (
                  <Alert variant="destructive">
                    <TriangleAlert className="size-4" />
                    <AlertTitle>读取智能体失败</AlertTitle>
                    <AlertDescription>{storeError}</AlertDescription>
                  </Alert>
                ) : null}

                {storeLoading ? (
                  <LoadingSkeleton />
                ) : assistants.length === 0 ? (
                  <Empty className="rounded-xl border bg-muted/20">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Sparkles className="size-5" />
                      </EmptyMedia>
                      <EmptyTitle>暂无可用智能体</EmptyTitle>
                      <EmptyDescription>
                        当前筛选条件下没有结果，试试切换分类或调整搜索词。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {assistants.map(agent => {
                      const installed =
                        installedAgentLookup.has(agent.id) ||
                        installedAgentLookup.has(agent.name)

                      return (
                        <StoreAgentCard
                          key={agent.id}
                          agent={agent}
                          installed={installed}
                          busy={installingAssistantId === agent.id}
                          onOpen={item => void openDetail(item)}
                          onInstall={(item, skillIds) =>
                            void handleInstall(item, skillIds)
                          }
                        />
                      )
                    })}
                  </div>
                )}

                {loadingMore ? <LoadingSkeleton /> : null}
                {hasMore ? <div ref={sentinelRef} className="h-1" /> : null}
              </TabsContent>

              <TabsContent value="installed" className="space-y-4">
                {installedLoading ? (
                  <LoadingSkeleton />
                ) : installedAgents.length === 0 ? (
                  <Empty className="rounded-xl border bg-muted/20">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Package className="size-5" />
                      </EmptyMedia>
                      <EmptyTitle>暂无已安装智能体</EmptyTitle>
                      <EmptyDescription>
                        从智能体库安装后，这里会展示 server 上当前已部署的智能体。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {filteredInstalledAgents.map(agent => (
                      <InstalledAgentCard
                        key={`${agent.source}:${agent.name}`}
                        agent={agent}
                        uninstalling={pendingUninstallAgent?.source === agent.source}
                        onOpenEdit={item => void openEdit(item)}
                        onOpenVisibility={item => void openAgentVisibility(item)}
                        onRequestUninstall={setPendingUninstallAgent}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detailDisplayName || '智能体详情'}</DialogTitle>
            <DialogDescription>
              查看智能体说明、关联技能和当前安装状态。
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[65vh] pr-4">
            <div className="space-y-6">
              {detailLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-4">
                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted text-2xl">
                      {detailData?.avatar || detailAgent?.avatar ? (
                        <img
                          src={detailData?.avatar || detailAgent?.avatar}
                          alt={detailDisplayName}
                          className="size-full object-cover"
                        />
                      ) : detailData?.emoji || detailAgent?.emoji ? (
                        <span>{detailData?.emoji || detailAgent?.emoji}</span>
                      ) : (
                        <Bot className="size-6 text-muted-foreground" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {detailResolvedInstalledAgent ? (
                          <Badge variant="secondary">已安装</Badge>
                        ) : (
                          <Badge variant="outline">未安装</Badge>
                        )}
                        {detailCategories.map(category => (
                          <Badge key={`detail:${category}`} variant="outline">
                            {category}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {detailDescription || '暂无描述'}
                      </p>
                    </div>
                  </div>

                  {detailCoreFeatures.length > 0 ? (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">核心能力</CardTitle>
                        <CardDescription>智能体在 Hub 中声明的能力说明。</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {detailCoreFeatures.map(feature => (
                          <div key={feature.title} className="rounded-lg border bg-muted/20 p-3">
                            <div className="font-medium">{feature.title}</div>
                            {feature.desc ? (
                              <p className="mt-1 text-sm text-muted-foreground">
                                {feature.desc}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ) : null}

                  {detailScenarios.length > 0 ? (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">适用场景</CardTitle>
                        <CardDescription>适合部署该智能体的业务场景。</CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-wrap gap-2">
                        {detailScenarios.map(scenario => (
                          <Badge key={scenario} variant="outline">
                            {scenario}
                          </Badge>
                        ))}
                      </CardContent>
                    </Card>
                  ) : null}

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">关联技能</CardTitle>
                      <CardDescription>
                        安装智能体时会尝试自动安装这些技能到 server。
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {detailSkillIds.length === 0 ? (
                        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                          该智能体没有声明关联技能。
                        </div>
                      ) : detailSkills.length === 0 ? (
                        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                          关联技能信息暂未加载完成。
                        </div>
                      ) : (
                        detailSkills.map(skill => (
                          <div
                            key={skill.id}
                            className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3"
                          >
                            <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background text-lg">
                              {skill.icon ? (
                                <img
                                  src={skill.icon}
                                  alt={skill.display_name}
                                  className="size-full object-cover"
                                />
                              ) : skill.emoji ? (
                                <span>{skill.emoji}</span>
                              ) : (
                                <Package className="size-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">
                                {skill.display_name || skill.name}
                              </div>
                              {skill.description ? (
                                <div className="line-clamp-2 text-sm text-muted-foreground">
                                  {skill.description}
                                </div>
                              ) : null}
                            </div>
                            <Badge variant={skill.isInstalled ? 'secondary' : 'outline'}>
                              {skill.isInstalled ? '已安装' : '未安装'}
                            </Badge>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="size-4" />
              <span>安装与卸载动作都在 server 侧执行。</span>
            </div>

            <div className="flex items-center gap-2">
              {detailResolvedInstalledAgent ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDetailOpen(false)
                      void openEdit(detailResolvedInstalledAgent)
                    }}
                  >
                    编辑已安装项
                  </Button>
                  {!detailResolvedInstalledAgent.isBuiltin ? (
                    <Button
                      variant="destructive"
                      onClick={() => setPendingUninstallAgent(detailResolvedInstalledAgent)}
                    >
                      <Trash2 className="mr-2 size-4" />
                      卸载
                    </Button>
                  ) : null}
                </>
              ) : (
                <Button
                  disabled={
                    detailLoading ||
                    installingAssistantId === detailAgent?.id ||
                    !(detailData?.sourceUrl || detailAgent?.sourceUrl)
                  }
                  onClick={() => {
                    if (!detailAgent) return
                    void handleInstall(detailData || detailAgent, detailSkillIds)
                  }}
                >
                  {installingAssistantId === detailAgent?.id ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      安装中
                    </>
                  ) : (
                    '安装到 Server'
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={open => {
          setEditOpen(open)
          if (!open) {
            setEditingAgent(null)
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑智能体</DialogTitle>
            <DialogDescription>
              修改 server 上已安装智能体的展示信息，不影响 Hub 原始数据。
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[65vh] pr-4">
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">显示名称</label>
              <Input
                value={editName}
                onChange={event => setEditName(event.target.value)}
                placeholder="输入智能体显示名称"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">头像地址</label>
              <Input
                value={editAvatar}
                onChange={event => setEditAvatar(event.target.value)}
                placeholder="https://..."
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Emoji</label>
              <Input
                value={editEmoji}
                onChange={event => setEditEmoji(event.target.value)}
                placeholder="🚀"
                className="w-32"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">描述</label>
              <Textarea
                value={editDescription}
                onChange={event => setEditDescription(event.target.value)}
                rows={4}
                placeholder="输入智能体描述"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">工作模式</label>
              <Select value={editAgentType} onValueChange={value => setEditAgentType(value as 'chat' | 'workflow')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat">对话助手</SelectItem>
                  <SelectItem value="workflow">业务流程</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editAgentType === 'chat' ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">记忆模式</label>
                <Select value={editMemoryMode} onValueChange={value => setEditMemoryMode(value as 'session' | 'user')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="session">会话独立</SelectItem>
                    <SelectItem value="user">跨会话共享</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  会话独立模式下每次对话互不影响；跨会话共享模式会保留用户历史记忆。
                </p>
              </div>
            ) : null}

            {editAgentType === 'workflow' ? (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">触发方式</label>
                  <Select value={editWorkflowTrigger} onValueChange={value => setEditWorkflowTrigger(value as 'cron' | 'webhook' | 'manual')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">手动</SelectItem>
                      <SelectItem value="cron">定时</SelectItem>
                      <SelectItem value="webhook">Webhook</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {editWorkflowTrigger === 'cron' ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Cron 表达式</label>
                    <Input
                      value={editWorkflowCron}
                      onChange={event => setEditWorkflowCron(event.target.value)}
                      placeholder="0 8 * * *"
                    />
                    <p className="text-xs text-muted-foreground">
                      例如：0 8 * * * 表示每天早上 8 点执行
                    </p>
                  </div>
                ) : null}

                {editWorkflowTrigger === 'webhook' ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Webhook 路径</label>
                    <Input
                      value={editWorkflowWebhookPath}
                      onChange={event => setEditWorkflowWebhookPath(event.target.value)}
                      placeholder="/hooks/contract-review"
                    />
                  </div>
                ) : null}

                <div className="space-y-2">
                  <label className="text-sm font-medium">输出目标</label>
                  <div className="flex flex-wrap gap-2">
                    {['chat', 'webhook', 'file'].map(target => (
                      <label
                        key={target}
                        className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer hover:bg-accent/30"
                      >
                        <Checkbox
                          checked={editWorkflowOutputTargets.includes(target)}
                          onCheckedChange={checked => {
                            setEditWorkflowOutputTargets(
                              checked === true
                                ? [...editWorkflowOutputTargets, target]
                                : editWorkflowOutputTargets.filter(t => t !== target),
                            )
                          }}
                        />
                        {target === 'chat' ? '对话' : target === 'webhook' ? 'Webhook' : '文件'}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">输出 Webhook 地址</label>
                  <Input
                    value={editWorkflowOutputWebhook}
                    onChange={event => setEditWorkflowOutputWebhook(event.target.value)}
                    placeholder="https://hooks.example.com/workflow"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">超时时间（分钟）</label>
                  <Input
                    type="number"
                    min={1}
                    value={editWorkflowTimeout}
                    onChange={event => setEditWorkflowTimeout(event.target.value)}
                    placeholder="30"
                    className="w-32"
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">可见范围</label>
              </div>
              <RadioGroup
                value={editVisibilityMode}
                onValueChange={value => setEditVisibilityMode(value as 'all' | 'departments' | 'users' | 'admin')}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="all" />
                  <label className="text-sm cursor-pointer">全员可见</label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="departments" />
                  <label className="text-sm cursor-pointer">指定部门可见</label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="users" />
                  <label className="text-sm cursor-pointer">指定人员可见</label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="admin" />
                  <label className="text-sm cursor-pointer">仅管理员可见</label>
                </div>
              </RadioGroup>
              {editVisibilityMode === 'departments' ? (
                departmentOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无部门数据</p>
                ) : (
                  <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 max-h-48 overflow-y-auto">
                    {departmentOptions.map(dept => (
                      <label
                        key={dept.id}
                        className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/30 rounded px-2 py-1"
                      >
                        <Checkbox
                          checked={editVisibleTo.includes(dept.id)}
                          onCheckedChange={checked => {
                            setEditVisibleTo(
                              checked === true
                                ? [...editVisibleTo, dept.id]
                                : editVisibleTo.filter(id => id !== dept.id),
                            )
                          }}
                        />
                        <span>{'— '.repeat(dept.depth)}{dept.name}</span>
                      </label>
                    ))}
                  </div>
                )
              ) : editVisibilityMode === 'users' ? (
                users.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无用户数据</p>
                ) : (
                  <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 max-h-48 overflow-y-auto">
                    {users.map(user => (
                      <label
                        key={user.id}
                        className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/30 rounded px-2 py-1"
                      >
                        <Checkbox
                          checked={editVisibleUserIds.includes(user.id)}
                          onCheckedChange={checked => {
                            setEditVisibleUserIds(
                              checked === true
                                ? [...editVisibleUserIds, user.id]
                                : editVisibleUserIds.filter(id => id !== user.id),
                            )
                          }}
                        />
                        <span>{user.name || user.email}</span>
                      </label>
                    ))}
                  </div>
                )
              ) : null}
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-sm font-medium">关联技能</div>
                <p className="text-sm text-muted-foreground">
                  管理该智能体关联的技能，可勾选启用、添加或移除。
                </p>
              </div>

              {editSkillsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <>
                  {/* Current associated skills */}
                  {editSkills.length > 0 ? (
                    <div className="space-y-2">
                      {editSkills.map(skill => {
                        const skillId = skill.id || skill.name
                        const isInstalled = installedSkillLookup.has(skill.id?.trim()) || installedSkillLookup.has(skill.name?.trim())
                        const isEnabled = editEnabledSkills.includes(skillId) || editEnabledSkills.includes(skill.name?.trim())
                        return (
                          <div
                            key={`edit-skill:${skillId}`}
                            className="flex items-center gap-3 rounded-lg border px-3 py-2 hover:bg-accent/30"
                          >
                            <Checkbox
                              checked={isEnabled}
                              onCheckedChange={checked => {
                                setEditEnabledSkills(
                                  checked === true
                                    ? [...editEnabledSkills, skill.name?.trim() || skillId]
                                    : editEnabledSkills.filter(s => s !== skillId && s !== skill.name?.trim()),
                                )
                              }}
                            />
                            <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background text-lg">
                              {skill.icon ? (
                                <img src={skill.icon} alt={skill.display_name} className="size-full object-cover" />
                              ) : skill.emoji ? (
                                <span>{skill.emoji}</span>
                              ) : (
                                <Package className="size-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium">{skill.display_name || skill.name}</div>
                              {skill.description ? (
                                <div className="line-clamp-1 text-xs text-muted-foreground">{skill.description}</div>
                              ) : null}
                            </div>
                            {isInstalled ? (
                              <Badge variant="secondary">已安装</Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    const detail = await getSkillHubDetail(skillId)
                                    const latestVersion = detail?.versions?.[0]
                                    if (!latestVersion?.source_url) {
                                      toast.error('该技能暂不支持安装')
                                      return
                                    }
                                    await installSkill({
                                      skillName: skill.name?.trim() || skillId,
                                      sourceUrl: latestVersion.source_url,
                                      version: typeof latestVersion.version === 'string' ? latestVersion.version : undefined,
                                      checksum: typeof latestVersion.checksum === 'string' ? latestVersion.checksum : undefined,
                                      skillMeta: skill,
                                    })
                                    toast.success(`已安装技能 ${skill.display_name || skill.name}`)
                                    await fetchInstalledState(false)
                                  } catch (err) {
                                    toast.error(err instanceof Error ? err.message : '安装技能失败')
                                  }
                                }}
                              >
                                安装
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setEditSkills(prev => prev.filter(s => (s.id || s.name) !== skillId))
                                setEditEnabledSkills(prev => prev.filter(s => s !== skillId && s !== skill.name?.trim()))
                              }}
                              title="移除关联"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                      该智能体暂无关联技能，点击下方按钮添加。
                    </div>
                  )}

                  {/* Add skill from installed skills */}
                  {(() => {
                    const associatedNames = new Set(editSkills.map(s => (s.name?.trim() || s.id)))
                    const availableToAdd = installedSkills.filter(s => !associatedNames.has(s.name.trim()))
                    if (availableToAdd.length === 0) return null
                    return (
                      <div className="space-y-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditAddSkillOpen(!editAddSkillOpen)}
                        >
                          <Plus className="mr-1 size-4" />
                          添加已安装技能
                        </Button>
                        {editAddSkillOpen ? (
                          <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border p-2">
                            {availableToAdd.map(skill => (
                              <label
                                key={`add-skill:${skill.name}`}
                                className="flex items-center gap-3 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-accent/30"
                              >
                                <Checkbox
                                  checked={editAddSkillSelection.includes(skill.name.trim())}
                                  onCheckedChange={checked => {
                                    const name = skill.name.trim()
                                    setEditAddSkillSelection(
                                      checked === true
                                        ? [...editAddSkillSelection, name]
                                        : editAddSkillSelection.filter(n => n !== name),
                                    )
                                  }}
                                />
                                <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background">
                                  {skill.icon ? (
                                    <img src={skill.icon} alt={skill.displayName} className="size-full object-cover" />
                                  ) : skill.emoji ? (
                                    <span className="text-sm">{skill.emoji}</span>
                                  ) : (
                                    <Package className="size-3.5 text-muted-foreground" />
                                  )}
                                </div>
                                <span className="text-sm">{skill.displayName}</span>
                              </label>
                            ))}
                          </div>
                        ) : null}
                        {editAddSkillSelection.length > 0 ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              const newSkills = editAddSkillSelection
                                .map(name => installedSkills.find(s => s.name.trim() === name))
                                .filter(Boolean)
                                .map(s => ({
                                  id: (s!.meta?.id || s!.id).trim(),
                                  name: s!.name.trim(),
                                  display_name: s!.displayName,
                                  description: s!.description,
                                  icon: s!.icon,
                                  emoji: s!.emoji,
                                  category: s!.category,
                                  categories: s!.categories,
                                }))
                              setEditSkills(prev => [...prev, ...newSkills])
                              setEditEnabledSkills(prev => [...prev, ...newSkills.map(s => s.name)])
                              setEditAddSkillSelection([])
                              setEditAddSkillOpen(false)
                            }}
                          >
                            确认添加 ({editAddSkillSelection.length})
                          </Button>
                        ) : null}
                      </div>
                    )
                  })()}
                </>
              )}
            </div>

            {editingAgent?.isHubInstalled ? (
              <Alert>
                <CheckCircle2 className="size-4" />
                <AlertTitle>当前安装源</AlertTitle>
                <AlertDescription>
                  该智能体来自 Hub，当前修改只会写入 server 本地的
                  `_moss_meta.json`。
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button disabled={savingEdit || !editingAgent} onClick={() => void handleSaveEdit()}>
              {savingEdit ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  保存中
                </>
              ) : (
                '保存'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingUninstallAgent !== null}
        onOpenChange={open => {
          if (!open) {
            setPendingUninstallAgent(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认卸载智能体</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingUninstallAgent
                ? `将从 server 上移除 ${pendingUninstallAgent.displayName}，该操作不会删除 Hub 中的原始数据。`
                : '确认后将从 server 上卸载该智能体。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirmUninstall()}>
              卸载
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={createOpen}
        onOpenChange={open => {
          setCreateOpen(open)
          if (!open) {
            setCreateName('')
            setCreateDisplayName('')
            setCreateDescription('')
            setCreateAvatar('')
            setCreateEmoji('')
            setCreateRules('')
            setCreateAgentType('chat')
            setCreateMemoryMode('session')
            setCreateVisibilityMode('all')
            setCreateVisibleTo([])
            setCreateWorkflowTrigger('manual')
            setCreateWorkflowCron('')
            setCreateWorkflowOutputTargets([])
            setCreateSelectedSkills([])
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>创建自定义智能体</DialogTitle>
            <DialogDescription>
              创建一个新的自定义智能体，将在 server 上生成智能体目录和配置文件。
            </DialogDescription>
          </DialogHeader>

	          <ScrollArea className="max-h-[65vh] pr-4">
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  标识名称 <span className="text-destructive">*</span>
                </label>
                <Input
                  value={createName}
                  onChange={event => setCreateName(event.target.value)}
                  placeholder="my-agent（英文，用作目录名）"
                />
                <p className="text-xs text-muted-foreground">
                  仅支持英文、数字和连字符，将作为智能体的唯一标识和目录名称
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  显示名称 <span className="text-destructive">*</span>
                </label>
                <Input
                  value={createDisplayName}
                  onChange={event => setCreateDisplayName(event.target.value)}
                  placeholder="我的智能体"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Emoji</label>
                <Input
                  value={createEmoji}
                  onChange={event => setCreateEmoji(event.target.value)}
                  placeholder="🚀"
                  className="w-32"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">头像地址</label>
                <Input
                  value={createAvatar}
                  onChange={event => setCreateAvatar(event.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">描述</label>
              <Textarea
                value={createDescription}
                onChange={event => setCreateDescription(event.target.value)}
                rows={2}
                placeholder="输入智能体描述"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">工作模式</label>
              <Select value={createAgentType} onValueChange={value => setCreateAgentType(value as 'chat' | 'workflow')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat">对话助手</SelectItem>
                  <SelectItem value="workflow">业务流程</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {createAgentType === 'chat' ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">记忆模式</label>
                <Select value={createMemoryMode} onValueChange={value => setCreateMemoryMode(value as 'session' | 'user')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="session">会话独立</SelectItem>
                    <SelectItem value="user">跨会话共享</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  会话独立模式下每次对话互不影响；跨会话共享模式会保留用户历史记忆。
                </p>
              </div>
            ) : null}

            {createAgentType === 'workflow' ? (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">触发方式</label>
                  <Select value={createWorkflowTrigger} onValueChange={value => setCreateWorkflowTrigger(value as 'cron' | 'webhook' | 'manual')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">手动</SelectItem>
                      <SelectItem value="cron">定时</SelectItem>
                      <SelectItem value="webhook">Webhook</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {createWorkflowTrigger === 'cron' ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Cron 表达式</label>
                    <Input
                      value={createWorkflowCron}
                      onChange={event => setCreateWorkflowCron(event.target.value)}
                      placeholder="0 8 * * *"
                    />
                    <p className="text-xs text-muted-foreground">
                      例如：0 8 * * * 表示每天早上 8 点执行
                    </p>
                  </div>
                ) : null}

                {createWorkflowTrigger === 'webhook' ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Webhook 路径</label>
                    <Input
                      value={createWorkflowWebhookPath}
                      onChange={event => setCreateWorkflowWebhookPath(event.target.value)}
                      placeholder="/hooks/contract-review"
                    />
                  </div>
                ) : null}

                <div className="space-y-2">
                  <label className="text-sm font-medium">输出目标</label>
                  <div className="flex flex-wrap gap-2">
                    {['chat', 'webhook', 'file'].map(target => (
                      <label
                        key={target}
                        className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer hover:bg-accent/30"
                      >
                        <Checkbox
                          checked={createWorkflowOutputTargets.includes(target)}
                          onCheckedChange={checked => {
                            setCreateWorkflowOutputTargets(
                              checked === true
                                ? [...createWorkflowOutputTargets, target]
                                : createWorkflowOutputTargets.filter(t => t !== target),
                            )
                          }}
                        />
                        {target === 'chat' ? '对话' : target === 'webhook' ? 'Webhook' : '文件'}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">输出 Webhook 地址</label>
                  <Input
                    value={createWorkflowOutputWebhook}
                    onChange={event => setCreateWorkflowOutputWebhook(event.target.value)}
                    placeholder="https://hooks.example.com/workflow"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">超时时间（分钟）</label>
                  <Input
                    type="number"
                    min={1}
                    value={createWorkflowTimeout}
                    onChange={event => setCreateWorkflowTimeout(event.target.value)}
                    placeholder="30"
                    className="w-32"
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">可见范围</label>
              </div>
              <RadioGroup
                value={createVisibilityMode}
                onValueChange={value => setCreateVisibilityMode(value as 'all' | 'departments' | 'users' | 'admin')}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="all" />
                  <label className="text-sm cursor-pointer">全员可见</label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="departments" />
                  <label className="text-sm cursor-pointer">指定部门可见</label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="users" />
                  <label className="text-sm cursor-pointer">指定人员可见</label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="admin" />
                  <label className="text-sm cursor-pointer">仅管理员可见</label>
                </div>
              </RadioGroup>
              {createVisibilityMode === 'departments' ? (
                departmentOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无部门数据</p>
                ) : (
                  <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 max-h-48 overflow-y-auto">
                    {departmentOptions.map(dept => (
                      <label
                        key={dept.id}
                        className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/30 rounded px-2 py-1"
                      >
                        <Checkbox
                          checked={createVisibleTo.includes(dept.id)}
                          onCheckedChange={checked => {
                            setCreateVisibleTo(
                              checked === true
                                ? [...createVisibleTo, dept.id]
                                : createVisibleTo.filter(id => id !== dept.id),
                            )
                          }}
                        />
                        <span>{'— '.repeat(dept.depth)}{dept.name}</span>
                      </label>
                    ))}
                  </div>
                )
              ) : createVisibilityMode === 'users' ? (
                users.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无用户数据</p>
                ) : (
                  <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 max-h-48 overflow-y-auto">
                    {users.map(user => (
                      <label
                        key={user.id}
                        className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/30 rounded px-2 py-1"
                      >
                        <Checkbox
                          checked={createVisibleUserIds.includes(user.id)}
                          onCheckedChange={checked => {
                            setCreateVisibleUserIds(
                              checked === true
                                ? [...createVisibleUserIds, user.id]
                                : createVisibleUserIds.filter(id => id !== user.id),
                            )
                          }}
                        />
                        <span>{user.name || user.email}</span>
                      </label>
                    ))}
                  </div>
                )
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                系统指令 <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={createRules}
                onChange={event => setCreateRules(event.target.value)}
                rows={8}
                placeholder="输入智能体的系统指令（System Prompt），定义智能体的行为和角色..."
              />
              <p className="text-xs text-muted-foreground">
                系统指令将写入 instructions.md 文件，作为智能体的核心行为定义
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-sm font-medium">关联技能</div>
                <p className="text-sm text-muted-foreground">
                  选择要关联到该智能体的已安装技能。
                </p>
              </div>
              {installedSkills.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                  暂无已安装技能，请先在技能商店安装技能。
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {installedSkills.map(skill => {
                    const isSelected = createSelectedSkills.includes(skill.name)
                    return (
                      <label
                        key={`create-skill:${skill.name}`}
                        className="flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer hover:bg-accent/30"
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={checked => {
                            setCreateSelectedSkills(
                              checked === true
                                ? [...createSelectedSkills, skill.name]
                                : createSelectedSkills.filter(s => s !== skill.name),
                            )
                          }}
                        />
                        <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background text-lg">
                          {skill.icon ? (
                            <img src={skill.icon} alt={skill.displayName} className="size-full object-cover" />
                          ) : skill.emoji ? (
                            <span>{skill.emoji}</span>
                          ) : (
                            <Package className="size-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{skill.displayName}</div>
                          {skill.description ? (
                            <div className="line-clamp-1 text-xs text-muted-foreground">{skill.description}</div>
                          ) : null}
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
	          </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={creatingAssistant || !createName.trim() || !createDisplayName.trim() || !createRules.trim()}
              onClick={() => void handleCreate()}
            >
              {creatingAssistant ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  创建中
                </>
              ) : (
                '创建'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={syncProgressOpen} onOpenChange={open => { if (!open) setSyncProgressOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>智能体同步进度</DialogTitle>
            <DialogDescription>
              {syncProgress?.status === 'running'
                ? '正在从 Hub 同步智能体...'
                : syncProgress?.status === 'done'
                  ? '同步完成'
                  : syncProgress?.status === 'error'
                    ? '同步失败'
                    : '等待同步...'}
            </DialogDescription>
          </DialogHeader>
          {syncProgress ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>进度</span>
                <span className="text-muted-foreground">
                  {syncProgress.processed}/{syncProgress.total}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{
                    width: syncProgress.total > 0
                      ? `${(syncProgress.processed / syncProgress.total) * 100}%`
                      : '0%',
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>新安装: <span className="font-medium">{syncProgress.installed}</span></div>
                <div>更新: <span className="font-medium">{syncProgress.updated}</span></div>
                <div>跳过: <span className="font-medium">{syncProgress.skipped}</span></div>
                <div>失败: <span className="font-medium text-destructive">{syncProgress.failed}</span></div>
              </div>
              {syncProgress.status === 'error' && syncProgress.error ? (
                <p className="text-sm text-destructive">{syncProgress.error}</p>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSyncProgressOpen(false)}
              disabled={syncProgress?.status === 'running'}
            >
              {syncProgress?.status === 'running' ? '同步中...' : '关闭'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={agentVisibilityOpen} onOpenChange={setAgentVisibilityOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑智能体可见性</DialogTitle>
            <DialogDescription>
              {editingVisibilityAgent?.displayName ?? ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <RadioGroup
              value={agentVisibilityMode}
              onValueChange={value => setAgentVisibilityMode(value as 'all' | 'departments' | 'users' | 'admin')}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="all" />
                <label className="text-sm cursor-pointer">全员可见</label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="departments" />
                <label className="text-sm cursor-pointer">指定部门可见</label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="users" />
                <label className="text-sm cursor-pointer">指定人员可见</label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="admin" />
                <label className="text-sm cursor-pointer">仅管理员可见</label>
              </div>
            </RadioGroup>
            {agentVisibilityMode === 'departments' ? (
              departmentOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无部门数据</p>
              ) : (
                <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 max-h-48 overflow-y-auto">
                  {departmentOptions.map(dept => (
                    <label
                      key={dept.id}
                      className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/30 rounded px-2 py-1"
                    >
                      <Checkbox
                        checked={editAgentVisibleTo.includes(dept.id)}
                        onCheckedChange={checked => {
                          setEditAgentVisibleTo(
                            checked === true
                              ? [...editAgentVisibleTo, dept.id]
                              : editAgentVisibleTo.filter(id => id !== dept.id),
                          )
                        }}
                      />
                      <span>{'— '.repeat(dept.depth)}{dept.name}</span>
                    </label>
                  ))}
                </div>
              )
            ) : agentVisibilityMode === 'users' ? (
              users.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无用户数据</p>
              ) : (
                <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 max-h-48 overflow-y-auto">
                  {users.map(user => (
                    <label
                      key={user.id}
                      className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/30 rounded px-2 py-1"
                    >
                      <Checkbox
                        checked={editAgentVisibleUserIds.includes(user.id)}
                        onCheckedChange={checked => {
                          setEditAgentVisibleUserIds(
                            checked === true
                              ? [...editAgentVisibleUserIds, user.id]
                              : editAgentVisibleUserIds.filter(id => id !== user.id),
                          )
                        }}
                      />
                      <span>{user.name || user.email}</span>
                    </label>
                  ))}
                </div>
              )
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAgentVisibilityOpen(false)}>
              取消
            </Button>
            <Button disabled={savingAgentVisibility} onClick={() => void handleSaveAgentVisibility()}>
              {savingAgentVisibility ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  保存中
                </>
              ) : (
                '保存'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}
