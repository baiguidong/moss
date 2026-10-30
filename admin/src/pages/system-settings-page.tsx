'use client'

import { normalizeSnapshotPolicy } from '../../../shared/webui-snapshot-policy.mjs'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { getSystemModels, getSystemSettings, updateSystemSettings } from '@/lib/api/settings'
import type {
  SystemSettings,
  UpdateSystemSettingsRequest,
} from '@/lib/api/types'
import {
  Copy,
  MessageSquare,
  RefreshCw,
  Server,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'

type EditableSystemSettings = Pick<
  SystemSettings,
  'model' | 'fastModel' | 'url' | 'apiKey' | 'image' | 'serverRuntime' | 'openIM'
> & { webui: NonNullable<SystemSettings['webui']> }


type SettingsSectionProps = {
  icon: ComponentType<{ className?: string }>
  title: string
  description?: string
  children?: ReactNode
}

type SettingsFieldProps = {
  label: string
  description?: string
  children: ReactNode
}

function toEditableSettings(settings: SystemSettings): EditableSystemSettings {
  return {
    webui: { snapshots: normalizeSnapshotPolicy(settings.webui?.snapshots) },
    model: settings.model,
    fastModel: settings.fastModel,
    url: settings.url,
    apiKey: settings.apiKey,
    image: {
      model: settings.image.model,
    },
    serverRuntime: {
      dockerImage: settings.serverRuntime.dockerImage,
    },
    openIM: { ...settings.openIM },
  }
}

function buildSystemSettingsPatch(
  settings: SystemSettings,
  draft: EditableSystemSettings,
): UpdateSystemSettingsRequest {
  const patch: UpdateSystemSettingsRequest = {}

  const textPatch: NonNullable<
    NonNullable<UpdateSystemSettingsRequest['models']>['text']
  > = {}
  if (draft.model !== settings.model) {
    textPatch.model = draft.model
  }
  if (draft.fastModel !== settings.fastModel) {
    textPatch.fastModel = draft.fastModel
  }
  if (draft.url !== settings.url) {
    textPatch.baseUrl = draft.url
  }
  if (draft.apiKey !== settings.apiKey) {
    textPatch.apiKey = draft.apiKey
  }
  if (Object.keys(textPatch).length > 0) {
    patch.models = {
      ...patch.models,
      text: textPatch,
    }
  }

  const imagePatch: NonNullable<
    NonNullable<UpdateSystemSettingsRequest['models']>['image']
  > = {}
  if (draft.image.model !== settings.image.model) {
    imagePatch.model = draft.image.model
  }
  if (Object.keys(imagePatch).length > 0) {
    patch.models = {
      ...patch.models,
      image: imagePatch,
    }
  }

  const serverRuntimePatch: NonNullable<UpdateSystemSettingsRequest['serverRuntime']> = {}
  if (draft.serverRuntime.dockerImage !== settings.serverRuntime.dockerImage) {
    serverRuntimePatch.dockerImage = draft.serverRuntime.dockerImage
  }
  if (Object.keys(serverRuntimePatch).length > 0) {
    patch.serverRuntime = serverRuntimePatch
  }

  const openIMPatch: NonNullable<UpdateSystemSettingsRequest['openIM']> = {}
  const openIMFields = [
    'enabled',
    'instanceId',
    'apiUrl',
    'wsUrl',
    'chatUrl',
    'adminUserId',
    'secret',
    'webhookSecret',
    'requestTimeoutMs',
  ] as const
  for (const field of openIMFields) {
    if (draft.openIM[field] !== settings.openIM[field]) {
      Object.assign(openIMPatch, { [field]: draft.openIM[field] })
    }
  }
  if (Object.keys(openIMPatch).length > 0) {
    patch.openIM = openIMPatch
  }

  if (JSON.stringify(draft.webui.snapshots) !== JSON.stringify(normalizeSnapshotPolicy(settings.webui?.snapshots))) patch.webui = draft.webui
  return patch
}

function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

function SettingSection({
  icon: Icon,
  title,
  description,
  children,
}: SettingsSectionProps) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <span>{title}</span>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      {children ? <CardContent className="space-y-5 pt-6">{children}</CardContent> : null}
    </Card>
  )
}

function SettingField({
  label,
  description,
  children,
}: SettingsFieldProps) {
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] md:items-start md:gap-6">
      <div className="space-y-1">
        <Label className="text-sm font-medium">{label}</Label>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      {[...Array(3)].map((_, index) => (
        <Card key={index}>
          <CardHeader className="border-b">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {[...Array(3)].map((__, fieldIndex) => (
              <div key={fieldIndex} className="grid gap-3 md:grid-cols-[240px_1fr] md:gap-6">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function SystemSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null)
  const [draft, setDraft] = useState<EditableSystemSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelListState, setModelListState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [modelListError, setModelListError] = useState('')
  const settingsRef = useRef<SystemSettings | null>(null)
  const draftRef = useRef<EditableSystemSettings | null>(null)
  const lastFailedSnapshotRef = useRef<string | null>(null)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const loadSettings = useCallback(async () => {
    setLoadError('')
    try {
      const response = await getSystemSettings()
      setSettings(response)
      setDraft(toEditableSettings(response))
      setSaveError('')
      lastFailedSnapshotRef.current = null
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '读取系统设置失败'
      setLoadError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const serializedDraft = useMemo(
    () => (draft ? JSON.stringify(draft) : ''),
    [draft],
  )
  const serializedSettings = useMemo(
    () => (settings ? JSON.stringify(toEditableSettings(settings)) : ''),
    [settings],
  )

  const handleCopy = async (value: string, label: string) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} 已复制`)
    } catch {
      toast.error(`复制 ${label} 失败`)
    }
  }

  const modelOptions = useMemo(() => {
    const values = [
      ...availableModels,
      draft?.model || '',
      draft?.fastModel || '',
      draft?.image.model || '',
    ]
    return [...new Set(values.map(value => value.trim()).filter(Boolean))]
  }, [availableModels, draft?.fastModel, draft?.image.model, draft?.model])

  const handleFetchModels = async () => {
    if (!draft?.url.trim()) {
      setModelListState('error')
      setModelListError('请先填写 API URL。')
      return
    }
    setModelListState('loading')
    setModelListError('')
    try {
      const models = await getSystemModels({ url: draft.url, apiKey: draft.apiKey })
      setAvailableModels(models)
      setModelListState('success')
    } catch (error) {
      setModelListState('error')
      setModelListError(error instanceof Error ? error.message : '获取模型列表失败')
    }
  }

  useEffect(() => {
    setAvailableModels([])
    setModelListState('idle')
    setModelListError('')
  }, [draft?.apiKey, draft?.url])

  useEffect(() => {
    if (!settings || !draft) {
      return
    }
    if (serializedDraft === serializedSettings) {
      if (!isSaving) {
        setSaveError('')
      }
      return
    }
    if (lastFailedSnapshotRef.current === serializedDraft) {
      return
    }

    const timer = window.setTimeout(() => {
      const latestSettings = settingsRef.current
      const latestDraft = draftRef.current
      if (!latestSettings || !latestDraft) {
        return
      }

      const draftSnapshot = JSON.stringify(latestDraft)
      const settingsSnapshot = JSON.stringify(toEditableSettings(latestSettings))
      if (draftSnapshot === settingsSnapshot) {
        return
      }

      const patch = buildSystemSettingsPatch(latestSettings, latestDraft)
      if (Object.keys(patch).length === 0) {
        return
      }

      setIsSaving(true)
      setSaveError('')
      void updateSystemSettings(patch)
        .then(response => {
          lastFailedSnapshotRef.current = null
          setSettings(response)
          setDraft(current => {
            if (!current) return current
            return JSON.stringify(current) === draftSnapshot
              ? toEditableSettings(response)
              : current
          })
        })
        .catch(error => {
          const message =
            error instanceof Error ? error.message : '自动保存系统设置失败'
          lastFailedSnapshotRef.current = draftSnapshot
          setSaveError(message)
          toast.error(message)
        })
        .finally(() => {
          setIsSaving(false)
        })
    }, 600)

    return () => window.clearTimeout(timer)
  }, [draft, serializedDraft, serializedSettings, settings, isSaving])

  if (isLoading && !draft) {
    return (
      <DashboardLayout
        title="系统设置"
        description="管理服务端模型、集成和会话运行时。"
      >
        <SettingsSkeleton />
      </DashboardLayout>
    )
  }

  if (!draft || !settings) {
    return (
      <DashboardLayout
        title="系统设置"
        description="管理服务端模型、集成和会话运行时。"
      >
        <Alert variant="destructive" className="max-w-3xl">
          <TriangleAlert className="size-4" />
          <AlertTitle>读取系统设置失败</AlertTitle>
          <AlertDescription>
            <p>{loadError || '未获取到系统设置数据。'}</p>
          </AlertDescription>
        </Alert>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout
      title="系统设置"
      description="管理服务端模型、集成和会话运行时。"
    >
      <div className="space-y-6">
        {saveError ? (
          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertTitle>自动保存失败</AlertTitle>
            <AlertDescription>
              <p>{saveError}</p>
            </AlertDescription>
          </Alert>
        ) : null}

        <SettingSection
          icon={Sparkles}
          title="模型"
          description="配置共用的 API 地址和 Key，并选择默认、快速和图片模型。"
        >
          <SettingField label="API URL">
            <Input
              value={draft.url}
              onChange={(event) => setDraft(current => current ? { ...current, url: event.target.value } : current)}
              placeholder="https://model.example.com"
            />
          </SettingField>

          <SettingField label="API Key">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={draft.apiKey}
                className="font-mono text-xs"
                onChange={(event) => setDraft(current => current ? { ...current, apiKey: event.target.value } : current)}
                placeholder="your-model-api-key"
              />
              {draft.apiKey ? (
                <Button variant="outline" size="sm" className="sm:shrink-0" onClick={() => void handleCopy(draft.apiKey, '模型 API Key')}>
                  <Copy className="mr-2 size-4" />
                  复制
                </Button>
              ) : null}
            </div>
          </SettingField>

          <SettingField label="模型列表" description="从当前 API 获取可用模型，下面的模型选项会同步更新。">
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <Button variant="outline" size="sm" disabled={modelListState === 'loading' || !draft.url.trim()} onClick={() => void handleFetchModels()}>
                <RefreshCw className={`mr-2 size-4 ${modelListState === 'loading' ? 'animate-spin' : ''}`} />
                {modelListState === 'loading' ? '获取中…' : '获取模型列表'}
              </Button>
              {modelListState === 'success' ? <span className="text-xs text-muted-foreground">已获取 {availableModels.length} 个模型</span> : null}
              {modelListState === 'error' ? <span role="alert" className="text-xs text-destructive">{modelListError}</span> : null}
            </div>
          </SettingField>

          <SettingField label="默认模型" description="新的本地会话会默认使用这个模型。">
            <Select
              value={draft.model}
              onValueChange={(value) => setDraft(current => current ? { ...current, model: value } : current)}
            >
              <SelectTrigger className="w-full" aria-label="默认模型"><SelectValue placeholder="请选择模型" /></SelectTrigger>
              <SelectContent>{modelOptions.map(model => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectContent>
            </Select>
          </SettingField>

          <SettingField
            label="快速模型"
            description="用于检索、网页提取、摘要等轻量任务；留空时使用主模型。"
          >
            <Select
              value={draft.fastModel || undefined}
              onValueChange={(value) => setDraft(current => current ? { ...current, fastModel: value === '__empty_fast_model__' ? '' : value } : current)}
            >
              <SelectTrigger className="w-full" aria-label="快速模型"><SelectValue placeholder="留空，使用默认模型" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty_fast_model__">留空，使用默认模型</SelectItem>
                {modelOptions.map(model => <SelectItem key={model} value={model}>{model}</SelectItem>)}
              </SelectContent>
            </Select>
          </SettingField>

          <SettingField label="图片模型">
            <Select
              value={draft.image.model}
              onValueChange={(value) => setDraft(current => current ? { ...current, image: { model: value } } : current)}
            >
              <SelectTrigger className="w-full" aria-label="图片模型"><SelectValue placeholder="请选择模型" /></SelectTrigger>
              <SelectContent>{modelOptions.map(model => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectContent>
            </Select>
          </SettingField>
        </SettingSection>

        <SettingSection
          icon={MessageSquare}
          title="OpenIM"
          description="配置即时消息服务连接和服务端权限管理。"
        >
          <SettingField label="启用 OpenIM">
            <div className="flex h-10 items-center">
              <Switch
                checked={draft.openIM.enabled}
                onCheckedChange={(checked) =>
                  setDraft(current => current ? {
                    ...current,
                    openIM: { ...current.openIM, enabled: checked },
                  } : current)
                }
                aria-label="启用 OpenIM"
              />
            </div>
          </SettingField>

          <SettingField label="实例 ID" description="同一套 OpenIM 服务使用固定实例标识。">
            <Input
              value={draft.openIM.instanceId}
              onChange={(event) => setDraft(current => current ? {
                ...current,
                openIM: { ...current.openIM, instanceId: event.target.value },
              } : current)}
              placeholder="default"
            />
          </SettingField>

          <SettingField label="API URL">
            <Input
              value={draft.openIM.apiUrl}
              onChange={(event) => setDraft(current => current ? {
                ...current,
                openIM: { ...current.openIM, apiUrl: event.target.value },
              } : current)}
              placeholder="http://10.0.1.180:10002"
            />
          </SettingField>

          <SettingField label="WebSocket URL">
            <Input
              value={draft.openIM.wsUrl}
              onChange={(event) => setDraft(current => current ? {
                ...current,
                openIM: { ...current.openIM, wsUrl: event.target.value },
              } : current)}
              placeholder="ws://10.0.1.180:10001"
            />
          </SettingField>

          <SettingField label="Chat URL">
            <Input
              value={draft.openIM.chatUrl}
              onChange={(event) => setDraft(current => current ? {
                ...current,
                openIM: { ...current.openIM, chatUrl: event.target.value },
              } : current)}
              placeholder="http://10.0.1.180:10008"
            />
          </SettingField>

          <SettingField label="管理员用户 ID">
            <Input
              value={draft.openIM.adminUserId}
              onChange={(event) => setDraft(current => current ? {
                ...current,
                openIM: { ...current.openIM, adminUserId: event.target.value },
              } : current)}
              placeholder="imAdmin"
            />
          </SettingField>

          <SettingField label="OpenIM 管理密钥">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={draft.openIM.secret}
                className="font-mono text-xs"
                onChange={(event) => setDraft(current => current ? {
                  ...current,
                  openIM: { ...current.openIM, secret: event.target.value },
                } : current)}
              />
              {draft.openIM.secret ? (
                <Button variant="outline" size="sm" onClick={() => void handleCopy(draft.openIM.secret, 'OpenIM 管理密钥')}>
                  <Copy className="mr-2 size-4" />复制
                </Button>
              ) : null}
            </div>
          </SettingField>

          <SettingField label="Webhook 密钥" description="必须与 OpenIM 回调 URL 中的密钥一致。">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={draft.openIM.webhookSecret}
                className="font-mono text-xs"
                onChange={(event) => setDraft(current => current ? {
                  ...current,
                  openIM: { ...current.openIM, webhookSecret: event.target.value },
                } : current)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDraft(current => current ? {
                  ...current,
                  openIM: { ...current.openIM, webhookSecret: generateSecret() },
                } : current)}
              >
                生成
              </Button>
              {draft.openIM.webhookSecret ? (
                <Button variant="outline" size="sm" onClick={() => void handleCopy(draft.openIM.webhookSecret, 'Webhook 密钥')}>
                  <Copy className="mr-2 size-4" />复制
                </Button>
              ) : null}
            </div>
          </SettingField>

          <SettingField label="请求超时" description="单位：毫秒。">
            <Input
              type="number"
              min={1000}
              max={120000}
              step={1000}
              value={draft.openIM.requestTimeoutMs}
              onChange={(event) => setDraft(current => current ? {
                ...current,
                openIM: {
                  ...current.openIM,
                  requestTimeoutMs: Number(event.target.value) || 15000,
                },
              } : current)}
            />
          </SettingField>
        </SettingSection>

        <SettingSection icon={Server} title="WebUI 环境快照" description="每台云电脑的总额度，包含手动和恢复前保护快照。配置不可用时使用内置默认额度；下调额度不会自动删除已有快照。">
          <SettingField label="快照数量上限">
            <Input type="number" min={1} step={1} value={draft.webui.snapshots.maxSnapshotsPerEnvironment} onChange={event => setDraft(current => current ? { ...current, webui: { snapshots: { ...current.webui.snapshots, maxSnapshotsPerEnvironment: Number(event.target.value) } } } : current)} />
          </SettingField>
          <SettingField label="空间上限（GiB）" description="默认 20 GiB。创建时是否包含数据卷由用户单独选择，默认不包含。">
            <Input type="number" min={1} step={1} value={draft.webui.snapshots.maxBytesPerEnvironment / 1024 ** 3} onChange={event => setDraft(current => current ? { ...current, webui: { snapshots: { ...current.webui.snapshots, maxBytesPerEnvironment: Number(event.target.value) * 1024 ** 3 } } } : current)} />
          </SettingField>
        </SettingSection>

        <SettingSection
          icon={Server}
          title="会话运行时"
          description="所有服务端会话都在 Docker 容器中运行。"
        >
          <SettingField label="Docker Image" description="服务端创建会话时使用的运行时镜像；Compose 部署会在启动时用 .env 中的 MOSS_RUNTIME_IMAGE 同步此值。">
            <Input
              value={draft.serverRuntime.dockerImage}
              onChange={(event) =>
                setDraft(current =>
                  current
                    ? {
                        ...current,
                        serverRuntime: {
                          ...current.serverRuntime,
                          dockerImage: event.target.value,
                        },
                      }
                    : current,
                )
              }
              placeholder="moss-runtime:latest"
            />
          </SettingField>

        </SettingSection>

      </div>
    </DashboardLayout>
  )
}
