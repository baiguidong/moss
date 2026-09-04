'use client'

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
import { getSystemSettings, updateSystemSettings } from '@/lib/api/settings'
import type {
  SystemSettings,
  UpdateSystemSettingsRequest,
} from '@/lib/api/types'
import {
  Copy,
  Image as ImageIcon,
  Loader2,
  Package,
  Server,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'

type EditableSystemSettings = Pick<
  SystemSettings,
  'model' | 'url' | 'apiKey' | 'image' | 'serverRuntime'
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
    model: settings.model,
    url: settings.url,
    apiKey: settings.apiKey,
    image: {
      provider: settings.image.provider,
      url: settings.image.url,
      apiKey: settings.image.apiKey,
      model: settings.image.model,
    },
    serverRuntime: {
      dockerImage: settings.serverRuntime.dockerImage,
    },
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

  const serverRuntimePatch: NonNullable<UpdateSystemSettingsRequest['serverRuntime']> = {}
  if (draft.serverRuntime.dockerImage !== settings.serverRuntime.dockerImage) {
    serverRuntimePatch.dockerImage = draft.serverRuntime.dockerImage
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
        description="管理服务端的默认文本模型、图片模型和会话运行时。"
      >
        <SettingsSkeleton />
      </DashboardLayout>
    )
  }

  if (!draft || !settings) {
    return (
      <DashboardLayout
        title="系统设置"
        description="管理服务端的默认文本模型、图片模型和会话运行时。"
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
      description="管理服务端的默认文本模型、图片模型和会话运行时。"
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
          icon={Server}
          title="会话运行时"
          description="所有服务端会话都在 Docker 容器中运行。"
        >
          <SettingField label="Docker Image" description="服务端创建会话时使用的运行时镜像。">
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
