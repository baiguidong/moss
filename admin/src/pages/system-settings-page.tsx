'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
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
import { getSystemSettings, updateSystemSettings } from '@/lib/api/settings'
import type {
  ProfileMode,
  RuntimeBackend,
  SystemSettings,
  ThinkingMode,
  UpdateSystemSettingsRequest,
} from '@/lib/api/types'
import {
  Building2,
  Copy,
  Image as ImageIcon,
  Loader2,
  Package,
  RefreshCw,
  Server,
  Shield,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'

type EditableSystemSettings = Omit<
  SystemSettings,
  'settingsPath' | 'settingsExists' | 'settingsLoaded' | 'settingsParseError'
>

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

const thinkingModeOptions: Array<{
  value: ThinkingMode
  label: string
  description: string
}> = [
  {
    value: 'disabled',
    label: 'disabled',
    description: '关闭思考模式',
  },
  {
    value: 'adaptive',
    label: 'adaptive',
    description: '由系统自动决定',
  },
  {
    value: 'enabled',
    label: 'enabled',
    description: '始终启用思考模式',
  },
]

const runtimeBackendOptions: Array<{
  value: RuntimeBackend
  label: string
}> = [
  { value: 'host', label: 'host' },
  { value: 'docker', label: 'docker' },
]

const profileModeOptions: Array<{
  value: ProfileMode
  label: string
}> = [
  { value: 'session', label: 'session' },
  { value: 'user', label: 'user' },
]

const IMAGE_PROVIDER_DEFAULT_URLS: Record<string, string> = {
  minimax: 'https://api.minimaxi.com/v1/image_generation',
  openai: 'https://api.openai.com/v1',
}

const IMAGE_PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  minimax: 'image-01',
  openai: 'gpt-image-1',
}

function toEditableSettings(settings: SystemSettings): EditableSystemSettings {
  return {
    bypassPermissions: settings.bypassPermissions,
    model: settings.model,
    maxTurns: settings.maxTurns,
    thinkingMode: settings.thinkingMode,
    thinkingBudgetTokens: settings.thinkingBudgetTokens,
    url: settings.url,
    apiKey: settings.apiKey,
    image: {
      provider: settings.image.provider,
      url: settings.image.url,
      apiKey: settings.image.apiKey,
      model: settings.image.model,
    },
    skillStore: {
      tenantId: settings.skillStore.tenantId,
    },
    serverRuntime: {
      backend: settings.serverRuntime.backend,
      dockerImage: settings.serverRuntime.dockerImage,
      defaultProfileMode: settings.serverRuntime.defaultProfileMode,
      allowedProfileModes: settings.serverRuntime.allowedProfileModes,
    },
  }
}

function buildSystemSettingsPatch(
  settings: SystemSettings,
  draft: EditableSystemSettings,
): UpdateSystemSettingsRequest {
  const patch: UpdateSystemSettingsRequest = {}

  if (draft.bypassPermissions !== settings.bypassPermissions) {
    patch.bypassPermissions = draft.bypassPermissions
  }

  const textPatch: NonNullable<
    NonNullable<UpdateSystemSettingsRequest['models']>['text']
  > = {}
  if (draft.model !== settings.model) {
    textPatch.model = draft.model
  }
  if (draft.maxTurns !== settings.maxTurns) {
    textPatch.maxTurns = draft.maxTurns
  }
  const thinkingPatch: NonNullable<typeof textPatch.thinking> = {}
  if (draft.thinkingMode !== settings.thinkingMode) {
    thinkingPatch.mode = draft.thinkingMode
  }
  if (draft.thinkingBudgetTokens !== settings.thinkingBudgetTokens) {
    thinkingPatch.budgetTokens = draft.thinkingBudgetTokens
  }
  if (Object.keys(thinkingPatch).length > 0) {
    textPatch.thinking = thinkingPatch
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
  if (draft.image.provider !== settings.image.provider) {
    imagePatch.provider = draft.image.provider
  }
  if (draft.image.url !== settings.image.url) {
    imagePatch.baseUrl = draft.image.url
  }
  if (draft.image.apiKey !== settings.image.apiKey) {
    imagePatch.apiKey = draft.image.apiKey
  }
  if (draft.image.model !== settings.image.model) {
    imagePatch.model = draft.image.model
  }
  if (Object.keys(imagePatch).length > 0) {
    patch.models = {
      ...patch.models,
      image: imagePatch,
    }
  }

  const skillStorePatch: NonNullable<UpdateSystemSettingsRequest['skillStore']> = {}
  if (draft.skillStore.tenantId !== settings.skillStore.tenantId) {
    skillStorePatch.tenantId = draft.skillStore.tenantId
  }
  if (Object.keys(skillStorePatch).length > 0) {
    patch.skillStore = skillStorePatch
  }

  const serverRuntimePatch: NonNullable<UpdateSystemSettingsRequest['serverRuntime']> = {}
  if (draft.serverRuntime.backend !== settings.serverRuntime.backend) {
    serverRuntimePatch.backend = draft.serverRuntime.backend
  }
  if (draft.serverRuntime.dockerImage !== settings.serverRuntime.dockerImage) {
    serverRuntimePatch.dockerImage = draft.serverRuntime.dockerImage
  }
  if (
    draft.serverRuntime.defaultProfileMode !==
    settings.serverRuntime.defaultProfileMode
  ) {
    serverRuntimePatch.defaultProfileMode = draft.serverRuntime.defaultProfileMode
  }
  if (
    JSON.stringify(draft.serverRuntime.allowedProfileModes) !==
    JSON.stringify(settings.serverRuntime.allowedProfileModes)
  ) {
    serverRuntimePatch.allowedProfileModes =
      draft.serverRuntime.allowedProfileModes
  }
  if (Object.keys(serverRuntimePatch).length > 0) {
    patch.serverRuntime = serverRuntimePatch
  }

  return patch
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
      {[...Array(4)].map((_, index) => (
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
  const [hasSavedOnce, setHasSavedOnce] = useState(false)
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
      setHasSavedOnce(false)
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

  const isDirty = useMemo(() => {
    if (!settings || !draft) return false
    return (
      JSON.stringify(toEditableSettings(settings)) !== JSON.stringify(draft)
    )
  }, [draft, settings])
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

  const handleRefresh = async () => {
    setIsLoading(true)
    await loadSettings()
  }

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
          setHasSavedOnce(true)
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

  const autoSaveStatus = useMemo(() => {
    if (saveError) {
      return {
        label: '自动保存失败',
        variant: 'destructive' as const,
      }
    }
    if (isSaving) {
      return {
        label: '自动保存中',
        variant: 'secondary' as const,
      }
    }
    if (isDirty) {
      return {
        label: '等待自动保存',
        variant: 'outline' as const,
      }
    }
    return {
      label: hasSavedOnce ? '已自动保存' : '自动保存已开启',
      variant: 'secondary' as const,
    }
  }, [hasSavedOnce, isDirty, isSaving, saveError])

  if (isLoading && !draft) {
    return (
      <DashboardLayout
        title="系统设置"
        description="管理服务端的默认文本模型、图片模型和执行权限。"
      >
        <SettingsSkeleton />
      </DashboardLayout>
    )
  }

  if (!draft || !settings) {
    return (
      <DashboardLayout
        title="系统设置"
        description="管理服务端的默认文本模型、图片模型和执行权限。"
      >
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => void handleRefresh()}>
              <RefreshCw className="mr-2 size-4" />
              刷新
            </Button>
          </div>
          <Alert variant="destructive" className="max-w-3xl">
            <TriangleAlert className="size-4" />
            <AlertTitle>读取系统设置失败</AlertTitle>
            <AlertDescription>
              <p>{loadError || '未获取到系统设置数据。'}</p>
            </AlertDescription>
          </Alert>
        </div>
      </DashboardLayout>
    )
  }

  const thinkingModeMeta = thinkingModeOptions.find(
    option => option.value === draft.thinkingMode,
  )

  return (
    <DashboardLayout
      title="系统设置"
      description="管理服务端的默认文本模型、图片模型和执行权限。所有改动都会写入 ~/.moss/settings.json。"
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={settings.settingsExists ? 'secondary' : 'outline'}>
              {settings.settingsExists ? '配置文件已存在' : '配置文件尚未创建'}
            </Badge>
            <Badge variant={settings.settingsLoaded ? 'secondary' : 'outline'}>
              {settings.settingsLoaded ? '已加载' : '使用默认值'}
            </Badge>
            <Badge variant={autoSaveStatus.variant}>
              {autoSaveStatus.label}
            </Badge>
            {settings.settingsParseError ? (
              <Badge variant="destructive">文件解析失败</Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void handleRefresh()}
              disabled={isLoading || isSaving}
            >
              <RefreshCw className="mr-2 size-4" />
              刷新
            </Button>
          </div>
        </div>

        {saveError ? (
          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertTitle>自动保存失败</AlertTitle>
            <AlertDescription>
              <p>{saveError}</p>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader className="border-b">
            <div>
              <CardTitle>配置文件</CardTitle>
              <CardDescription>
                这里展示当前服务端读取的配置文件位置和加载状态。
              </CardDescription>
            </div>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCopy(settings.settingsPath, '配置文件路径')}
              >
                <Copy className="mr-2 size-4" />
                复制路径
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs">
              {settings.settingsPath}
            </div>
            {settings.settingsParseError ? (
              <Alert variant="destructive">
                <TriangleAlert className="size-4" />
                <AlertTitle>配置文件存在 JSON 解析错误</AlertTitle>
                <AlertDescription>
                  <p>{settings.settingsParseError}</p>
                  <p>
                    当前表单展示的是默认值和可识别字段。保存后会用新的合法配置覆盖原文件。
                  </p>
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <SettingSection
          icon={Sparkles}
          title="文本模型"
          description="设置服务端默认使用的文本模型、API 地址和认证信息。"
        >
          <SettingField label="默认模型" description="新的本地会话会默认使用这个模型。">
            <Input
              value={draft.model}
              onChange={(event) =>
                setDraft(current =>
                  current
                    ? {
                        ...current,
                        model: event.target.value,
                      }
                    : current,
                )
              }
              placeholder="claude-sonnet-4-6"
            />
          </SettingField>

          <SettingField label="API URL" description="文本模型接口地址，保存到 models.text.baseUrl。">
            <Input
              value={draft.url}
              onChange={(event) =>
                setDraft(current =>
                  current
                    ? {
                        ...current,
                        url: event.target.value,
                      }
                    : current,
                )
              }
              placeholder="https://model.example.com"
            />
          </SettingField>

          <SettingField
            label="API Key"
            description="文本模型认证信息，保存到 models.text.apiKey。"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={draft.apiKey}
                className="font-mono text-xs"
                onChange={(event) =>
                  setDraft(current =>
                    current
                      ? {
                          ...current,
                          apiKey: event.target.value,
                        }
                      : current,
                  )
                }
                placeholder="sk-ant-..."
              />
              {draft.apiKey ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="sm:shrink-0"
                  onClick={() => void handleCopy(draft.apiKey, '文本模型 API Key')}
                >
                  <Copy className="mr-2 size-4" />
                  复制
                </Button>
              ) : null}
            </div>
          </SettingField>
        </SettingSection>

        <SettingSection
          icon={ImageIcon}
          title="图片模型"
          description="设置图片生成的供应商、接口地址和默认模型。"
        >
          <SettingField label="图片厂商" description="支持 MiniMax 和 OpenAI 兼容图片接口。">
            <Select
              value={draft.image.provider}
              onValueChange={(value) =>
                setDraft(current => {
                  if (!current) return current
                  const previousDefaultUrl =
                    IMAGE_PROVIDER_DEFAULT_URLS[current.image.provider]
                  const previousDefaultModel =
                    IMAGE_PROVIDER_DEFAULT_MODELS[current.image.provider]
                  return {
                    ...current,
                    image: {
                      ...current.image,
                      provider: value,
                      url:
                        !current.image.url ||
                        current.image.url === previousDefaultUrl
                          ? IMAGE_PROVIDER_DEFAULT_URLS[value] ?? current.image.url
                          : current.image.url,
                      model:
                        !current.image.model ||
                        current.image.model === previousDefaultModel
                          ? IMAGE_PROVIDER_DEFAULT_MODELS[value] ?? current.image.model
                          : current.image.model,
                    },
                  }
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择图片厂商" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minimax">MiniMax</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
              </SelectContent>
            </Select>
          </SettingField>

          <SettingField label="API URL" description="图片生成接口地址。">
            <Input
              value={draft.image.url}
              onChange={(event) =>
                setDraft(current =>
                  current
                    ? {
                        ...current,
                        image: {
                          ...current.image,
                          url: event.target.value,
                        },
                      }
                    : current,
                )
              }
              placeholder={IMAGE_PROVIDER_DEFAULT_URLS[draft.image.provider] ?? 'https://api.openai.com/v1'}
            />
          </SettingField>

          <SettingField
            label="API Key"
            description="图片模型的供应商认证信息。"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={draft.image.apiKey}
                className="font-mono text-xs"
                onChange={(event) =>
                  setDraft(current =>
                    current
                      ? {
                          ...current,
                          image: {
                            ...current.image,
                            apiKey: event.target.value,
                          },
                        }
                      : current,
                  )
                }
                placeholder="sk-..."
              />
              {draft.image.apiKey ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="sm:shrink-0"
                  onClick={() => void handleCopy(draft.image.apiKey, '图片模型 API Key')}
                >
                  <Copy className="mr-2 size-4" />
                  复制
                </Button>
              ) : null}
            </div>
          </SettingField>

          <SettingField label="图片模型" description="默认图片模型名称。">
            <Input
              value={draft.image.model}
              onChange={(event) =>
                setDraft(current =>
                  current
                    ? {
                        ...current,
                        image: {
                          ...current.image,
                          model: event.target.value,
                        },
                      }
                    : current,
                )
              }
              placeholder={IMAGE_PROVIDER_DEFAULT_MODELS[draft.image.provider] ?? 'gpt-image-1'}
            />
          </SettingField>
        </SettingSection>

        <SettingSection
          icon={Building2}
          title="专属资产"
        >
          <SettingField label="租户 ID">
            <Input
              value={draft.skillStore.tenantId}
              onChange={(event) =>
                setDraft(current =>
                  current
                    ? {
                        ...current,
                        skillStore: {
                          ...current.skillStore,
                          tenantId: event.target.value,
                        },
                      }
                    : current,
                )
              }
              placeholder="tenant-001"
            />
          </SettingField>
        </SettingSection>

        <SettingSection
          icon={Server}
          title="会话运行时"
          description="设置新会话使用的服务端执行后端和默认 Profile 模式。"
        >
          <SettingField label="执行后端" description="client 不能覆盖这个值。">
            <Select
              value={draft.serverRuntime.backend}
              onValueChange={value =>
                setDraft(current =>
                  current
                    ? {
                        ...current,
                        serverRuntime: {
                          ...current.serverRuntime,
                          backend: value as RuntimeBackend,
                        },
                      }
                    : current,
                )
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择执行后端" />
              </SelectTrigger>
              <SelectContent>
                {runtimeBackendOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingField>

          {draft.serverRuntime.backend === 'docker' ? (
            <SettingField label="Docker Image" description="docker 后端创建新会话时使用。">
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
          ) : null}

          <SettingField label="默认 Profile 模式" description="client 未指定时使用。">
            <Select
              value={draft.serverRuntime.defaultProfileMode}
              onValueChange={value =>
                setDraft(current => {
                  if (!current) return current
                  const profileMode = value as ProfileMode
                  return {
                    ...current,
                    serverRuntime: {
                      ...current.serverRuntime,
                      defaultProfileMode: profileMode,
                      allowedProfileModes: current.serverRuntime.allowedProfileModes.includes(profileMode)
                        ? current.serverRuntime.allowedProfileModes
                        : [...current.serverRuntime.allowedProfileModes, profileMode],
                    },
                  }
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择默认 Profile 模式" />
              </SelectTrigger>
              <SelectContent>
                {profileModeOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingField>

          <SettingField label="允许的 Profile 模式">
            <div className="grid gap-3 sm:grid-cols-2">
              {profileModeOptions.map(option => (
                <label
                  key={option.value}
                  className="flex min-h-10 items-center gap-3 rounded-md border px-3 py-2"
                >
                  <Switch
                    checked={draft.serverRuntime.allowedProfileModes.includes(option.value)}
                    onCheckedChange={checked =>
                      setDraft(current => {
                        if (!current) return current
                        const currentAllowed =
                          current.serverRuntime.allowedProfileModes
                        const nextAllowed = checked
                          ? [...new Set([...currentAllowed, option.value])]
                          : currentAllowed.filter(mode => mode !== option.value)
                        if (nextAllowed.length === 0) {
                          return current
                        }
                        return {
                          ...current,
                          serverRuntime: {
                            ...current.serverRuntime,
                            allowedProfileModes: nextAllowed,
                            defaultProfileMode: nextAllowed.includes(
                              current.serverRuntime.defaultProfileMode,
                            )
                              ? current.serverRuntime.defaultProfileMode
                              : nextAllowed[0],
                          },
                        }
                      })
                    }
                  />
                  <span className="text-sm font-medium">{option.label}</span>
                </label>
              ))}
            </div>
          </SettingField>
        </SettingSection>

        <SettingSection
          icon={Shield}
          title="权限"
          description="设置工具调用权限确认、最大轮次和 thinking 模式。"
        >
          <SettingField
            label="跳过所有权限确认"
            description="打开后，新会话的工具调用将不再弹出权限确认框。"
          >
            <div className="flex min-h-10 items-center">
              <Switch
                checked={draft.bypassPermissions}
                onCheckedChange={checked =>
                  setDraft(current =>
                    current
                      ? {
                          ...current,
                          bypassPermissions: checked,
                        }
                      : current,
                  )
                }
              />
            </div>
          </SettingField>

          <SettingField
            label="最大轮次"
            description="仅影响新的 local 会话。"
          >
            <Input
              type="number"
              min={1}
              max={10000}
              value={draft.maxTurns}
              onChange={(event) =>
                setDraft(current =>
                  current
                    ? {
                        ...current,
                        maxTurns: Number.parseInt(event.target.value || '1', 10) || 1,
                      }
                    : current,
                )
              }
            />
          </SettingField>

          <SettingField
            label="思考模式"
            description={thinkingModeMeta?.description || '控制 thinking 的默认行为。'}
          >
            <Select
              value={draft.thinkingMode}
              onValueChange={value =>
                setDraft(current =>
                  current
                    ? {
                        ...current,
                        thinkingMode: value as ThinkingMode,
                      }
                    : current,
                )
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择思考模式" />
              </SelectTrigger>
              <SelectContent>
                {thinkingModeOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingField>

          {draft.thinkingMode === 'enabled' ? (
            <SettingField
              label="Thinking Budget Tokens"
              description="只在强制开启思考模式时生效。"
            >
              <Input
                type="number"
                min={1024}
                max={128000}
                value={draft.thinkingBudgetTokens}
                onChange={(event) =>
                  setDraft(current =>
                    current
                      ? {
                          ...current,
                          thinkingBudgetTokens:
                            Number.parseInt(event.target.value || '1024', 10) ||
                            1024,
                        }
                      : current,
                  )
                }
              />
            </SettingField>
          ) : null}
        </SettingSection>
      </div>
    </DashboardLayout>
  )
}
