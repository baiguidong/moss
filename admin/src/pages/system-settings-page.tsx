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
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { getSystemModelCatalog, getSystemSettings, updateSystemSettings } from '@/lib/api/settings'
import { hasScope } from '@/lib/api/client'
import { useAuth } from '@/lib/hooks/use-auth'
import type {
  SystemSettings,
  UpdateSystemSettingsRequest,
} from '@/lib/api/types'
import {
  Copy,
  MessageSquare,
  Server,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'

type EditableSystemSettings = Pick<
  SystemSettings,
  'openIM' | 'model' | 'availableModels' | 'fastModel' | 'image'
> & { webui: NonNullable<SystemSettings['webui']> }


type SettingsSectionProps = {
  icon: ComponentType<{ className?: string }>
  title: string
  children?: ReactNode
}

type SettingsFieldProps = {
  label: string
  children: ReactNode
}

function toEditableSettings(settings: SystemSettings): EditableSystemSettings {
  return {
    webui: { snapshots: normalizeSnapshotPolicy(settings.webui?.snapshots) },
    openIM: { ...settings.openIM },
    model: settings.model,
    availableModels: [...settings.availableModels],
    fastModel: settings.fastModel,
    image: { ...settings.image },
  }
}

function buildSystemSettingsPatch(
  settings: SystemSettings,
  draft: EditableSystemSettings,
): UpdateSystemSettingsRequest {
  const patch: UpdateSystemSettingsRequest = {}

  if (draft.model !== settings.model ||
      JSON.stringify(draft.availableModels) !== JSON.stringify(settings.availableModels) ||
      draft.fastModel !== settings.fastModel) {
    patch.models = {
      ...(draft.model !== settings.model ? { text: { model: draft.model } } : {}),
    }
    const textPatch = patch.models.text || {}
    if (JSON.stringify(draft.availableModels) !== JSON.stringify(settings.availableModels)) textPatch.availableModels = draft.availableModels
    if (draft.fastModel !== settings.fastModel) textPatch.fastModel = draft.fastModel
    patch.models.text = textPatch
  }
  if (draft.image.model !== settings.image.model) {
    patch.models = { ...(patch.models || {}), image: { model: draft.image.model } }
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
  children,
}: SettingsSectionProps) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <span>{title}</span>
        </CardTitle>
      </CardHeader>
      {children ? <CardContent className="space-y-5 pt-6">{children}</CardContent> : null}
    </Card>
  )
}

function SettingField({
  label,
  children,
}: SettingsFieldProps) {
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] md:items-start md:gap-6">
      <div className="space-y-1">
        <Label className="text-sm font-medium">{label}</Label>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      {[...Array(2)].map((_, index) => (
        <Card key={index}>
          <CardHeader className="border-b">
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {[...Array(3)].map((__, fieldIndex) => (
              <div key={fieldIndex} className="grid gap-3 md:grid-cols-[240px_1fr] md:gap-6">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
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
  const { scopes } = useAuth()
  const canManageSettings = hasScope(scopes, 'admin:settings')
  const [settings, setSettings] = useState<SystemSettings | null>(null)
  const [draft, setDraft] = useState<EditableSystemSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [modelCatalog, setModelCatalog] = useState<string[]>([])
  const [modelCatalogState, setModelCatalogState] = useState<'idle' | 'loading' | 'error'>('idle')
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
    if (!canManageSettings) return
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
  }, [canManageSettings])

  const fetchModelCatalog = useCallback(async () => {
    setModelCatalogState('loading')
    try {
      const response = await getSystemModelCatalog()
      setModelCatalog([...new Set(response.models)])
      setModelCatalogState('idle')
      toast.success('模型列表已更新')
    } catch (error) {
      setModelCatalogState('error')
      toast.error(error instanceof Error ? error.message : '获取模型列表失败')
    }
  }, [])

  useEffect(() => {
    if (canManageSettings) void loadSettings()
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

  if (!canManageSettings) {
    return (
      <DashboardLayout title="系统设置">
        <div className="rounded-xl border border-dashed px-6 py-16 text-center text-sm text-muted-foreground">
          当前账号没有“管理系统设置”权限，无法访问此页面。
        </div>
      </DashboardLayout>
    )
  }

  if (isLoading && !draft) {
    return (
      <DashboardLayout title="系统设置">
        <SettingsSkeleton />
      </DashboardLayout>
    )
  }

  if (!draft || !settings) {
    return (
      <DashboardLayout title="系统设置">
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
    <DashboardLayout title="系统设置">
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
          icon={Server}
          title="模型"
        >
          <SettingField label="模型列表">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={() => void fetchModelCatalog()} disabled={modelCatalogState === 'loading'}>
                {modelCatalogState === 'loading' ? '获取中…' : '获取模型列表'}
              </Button>
              {modelCatalogState === 'error' ? <span className="text-sm text-destructive">获取失败</span> : null}
            </div>
          </SettingField>

          <SettingField label="允许切换的模型">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {modelCatalog.map(model => {
                const checked = draft.availableModels.length === 0 || draft.availableModels.includes(model)
                return (
                  <label key={model} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={event => setDraft(current => current ? {
                        ...current,
                        availableModels: event.target.checked
                          ? [...new Set([...current.availableModels, model])]
                          : current.availableModels.length === 0
                            ? modelCatalog.filter(item => item !== model)
                            : current.availableModels.filter(item => item !== model),
                      } : current)}
                    />
                    <span className="truncate">{model}</span>
                  </label>
                )
              })}
            </div>
          </SettingField>

          <SettingField label="默认模型">
            <Input
              value={draft.model}
              onChange={event => setDraft(current => current ? { ...current, model: event.target.value } : current)}
              placeholder="从模型列表中选择或输入模型名称"
            />
          </SettingField>

          <SettingField label="快速模型">
            <Input
              value={draft.fastModel}
              onChange={event => setDraft(current => current ? { ...current, fastModel: event.target.value } : current)}
              placeholder="留空时使用默认模型"
            />
          </SettingField>

          <SettingField label="图片模型">
            <Input
              value={draft.image.model}
              onChange={event => setDraft(current => current ? { ...current, image: { model: event.target.value } } : current)}
              placeholder="gpt-image-2"
            />
          </SettingField>
        </SettingSection>

        <SettingSection
          icon={MessageSquare}
          title="OpenIM"
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

          <SettingField label="实例 ID">
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

          <SettingField label="Webhook 密钥">
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

          <SettingField label="请求超时（毫秒）">
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

        <SettingSection icon={Server} title="WebUI 环境快照">
          <SettingField label="快照数量上限">
            <Input type="number" min={1} step={1} value={draft.webui.snapshots.maxSnapshotsPerEnvironment} onChange={event => setDraft(current => current ? { ...current, webui: { snapshots: { ...current.webui.snapshots, maxSnapshotsPerEnvironment: Number(event.target.value) } } } : current)} />
          </SettingField>
          <SettingField label="空间上限（GiB）">
            <Input type="number" min={1} step={1} value={draft.webui.snapshots.maxBytesPerEnvironment / 1024 ** 3} onChange={event => setDraft(current => current ? { ...current, webui: { snapshots: { ...current.webui.snapshots, maxBytesPerEnvironment: Number(event.target.value) * 1024 ** 3 } } } : current)} />
          </SettingField>
        </SettingSection>



      </div>
    </DashboardLayout>
  )
}
