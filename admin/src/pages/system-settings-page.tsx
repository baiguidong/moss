'use client'

import { normalizeSnapshotPolicy } from '../../../shared/webui-snapshot-policy.mjs'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  Cpu,
  HardDrive,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'

type EditableSystemSettings = Pick<
  SystemSettings,
  'openIM' | 'model' | 'availableModels' | 'fastModel' | 'image'
> & { webui: NonNullable<SystemSettings['webui']> }


const sections = [
  { id: 'models', title: '模型', icon: Cpu },
  { id: 'openim', title: 'OpenIM', icon: MessageSquare },
  { id: 'snapshots', title: 'WebUI 环境快照', icon: HardDrive },
] as const

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

function SettingField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid min-w-0 gap-1.5 @min-[34rem]:grid-cols-[8rem_minmax(0,1fr)] @min-[34rem]:items-baseline @min-[34rem]:gap-4">
    <span className="text-sm font-medium">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
}

function SettingsSkeleton() {
  return <div aria-label="正在读取系统设置" className="flex gap-5">
    <Skeleton className="h-32 w-32 shrink-0" />
    <div className="flex-1 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8 max-w-xl" />)}</div>
  </div>
}

export default function SystemSettingsPage() {
  const { scopes } = useAuth()
  const [section, setSection] = useState<typeof sections[number]['id']>('models')
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

  const fetchModelCatalog = useCallback(async (notify = true) => {
    setModelCatalogState('loading')
    try {
      const response = await getSystemModelCatalog()
      setModelCatalog([...new Set(response.models)])
      setModelCatalogState('idle')
      if (notify) toast.success('模型列表已更新')
    } catch (error) {
      setModelCatalogState('error')
      if (notify) toast.error(error instanceof Error ? error.message : '获取模型列表失败')
    }
  }, [])

  useEffect(() => {
    if (canManageSettings) void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (canManageSettings) void fetchModelCatalog(false)
  }, [canManageSettings, fetchModelCatalog])

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
    if (!settings || !draft || isSaving) {
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

  const modelOptions = [...new Set([
    ...modelCatalog,
    ...draft.availableModels,
    draft.model,
    draft.fastModel,
    draft.image.model,
  ].map(model => model.trim()).filter(Boolean))]
  const selectedModels = draft.availableModels.length === 0
    ? new Set(modelOptions)
    : new Set(draft.availableModels)
  const updateAllowedModels = (models: string[]) => {
    setDraft(current => current ? { ...current, availableModels: models } : current)
  }
  const selectAllModels = () => updateAllowedModels(modelOptions)
  const invertModels = () => updateAllowedModels(modelOptions.filter(model => !selectedModels.has(model)))

  return (
    <DashboardLayout title="系统设置">
      <div className="@container/settings">
        <div className="grid min-w-0 gap-4 @min-[42rem]/settings:grid-cols-[9.5rem_minmax(0,1fr)] @min-[42rem]/settings:gap-6">
          <nav aria-label="设置分类" className="flex min-w-0 gap-1 overflow-x-auto @min-[42rem]/settings:flex-col @min-[42rem]/settings:self-start">
            {sections.map(({ id, title, icon: Icon }) => <button key={id} type="button" aria-current={section === id ? 'page' : undefined}
              onClick={() => setSection(id)} className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring ${section === id ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'}`}>
              <Icon className="size-4 shrink-0" />{title}
            </button>)}
          </nav>
          <section aria-labelledby="settings-heading" className="@container min-w-0 max-w-4xl space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h1 id="settings-heading" className="text-lg font-semibold">{sections.find(item => item.id === section)?.title}</h1>
              {isSaving && <span role="status" className="text-xs text-muted-foreground">保存中…</span>}
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

            {section === 'models' && <div className="space-y-3">
              <SettingField label="默认模型">
                <select
                  aria-label="默认模型" value={draft.model}
                  onChange={event => setDraft(current => current ? { ...current, model: event.target.value } : current)}
                  className="h-8 w-full max-w-xl rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">请选择默认模型</option>
                  {modelOptions.map(model => <option key={model} value={model}>{model}</option>)}
                </select>
              </SettingField>

              <SettingField label="快速模型">
                <select
                  aria-label="快速模型" value={draft.fastModel}
                  onChange={event => setDraft(current => current ? { ...current, fastModel: event.target.value } : current)}
                  className="h-8 w-full max-w-xl rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">留空时使用默认模型</option>
                  {modelOptions.map(model => <option key={model} value={model}>{model}</option>)}
                </select>
              </SettingField>

              <SettingField label="图片模型">
                <select
                  aria-label="图片模型" value={draft.image.model}
                  onChange={event => setDraft(current => current ? { ...current, image: { model: event.target.value } } : current)}
                  className="h-8 w-full max-w-xl rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">请选择图片模型</option>
                  {modelOptions.map(model => <option key={model} value={model}>{model}</option>)}
                </select>
              </SettingField>
              <div className="border-t pt-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">允许切换的模型</h2>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void fetchModelCatalog()} disabled={modelCatalogState === 'loading'}>
                      {modelCatalogState === 'loading' ? '获取中…' : '获取模型列表'}
                    </Button>
                    {modelCatalogState === 'error' ? <span className="text-sm text-destructive">获取失败</span> : null}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={selectAllModels} disabled={modelOptions.length === 0}>全选</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={invertModels} disabled={modelOptions.length === 0}>反选</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => updateAllowedModels([])} disabled={modelOptions.length === 0}>全部允许</Button>
                    <span className="text-xs text-muted-foreground">留空表示不限制模型</span>
                  </div>
                  <div className="grid gap-x-3 gap-y-0.5 @min-[23rem]:grid-cols-2 @min-[42rem]:grid-cols-3">
                    {modelOptions.map(model => {
                      const checked = selectedModels.has(model)
                      return (
                        <label key={model} className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/60">
                          <input
                            type="checkbox" className="accent-primary"
                            checked={checked}
                            onChange={event => setDraft(current => current ? {
                              ...current,
                              availableModels: event.target.checked
                                ? [...new Set([...(current.availableModels.length === 0 ? modelOptions : current.availableModels), model])]
                                : (current.availableModels.length === 0 ? modelOptions : current.availableModels).filter(item => item !== model),
                            } : current)}
                          />
                          <span className="truncate">{model}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>}

            {section === 'openim' && <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">连接</h2>
              <SettingField label="启用 OpenIM">
                <div className="flex h-8 items-center">
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
                  aria-label="实例 ID" value={draft.openIM.instanceId}
                  onChange={(event) => setDraft(current => current ? {
                    ...current,
                    openIM: { ...current.openIM, instanceId: event.target.value },
                  } : current)}
                  placeholder="default"
                />
              </SettingField>

              <SettingField label="API URL">
                <Input
                  aria-label="API URL" value={draft.openIM.apiUrl}
                  onChange={(event) => setDraft(current => current ? {
                    ...current,
                    openIM: { ...current.openIM, apiUrl: event.target.value },
                  } : current)}
                  placeholder="http://10.0.1.180:10002"
                />
              </SettingField>

              <SettingField label="WebSocket URL">
                <Input
                  aria-label="WebSocket URL" value={draft.openIM.wsUrl}
                  onChange={(event) => setDraft(current => current ? {
                    ...current,
                    openIM: { ...current.openIM, wsUrl: event.target.value },
                  } : current)}
                  placeholder="ws://10.0.1.180:10001"
                />
              </SettingField>

              <SettingField label="Chat URL">
                <Input
                  aria-label="Chat URL" value={draft.openIM.chatUrl}
                  onChange={(event) => setDraft(current => current ? {
                    ...current,
                    openIM: { ...current.openIM, chatUrl: event.target.value },
                  } : current)}
                  placeholder="http://10.0.1.180:10008"
                />
              </SettingField>

              <SettingField label="请求超时（毫秒）">
                <Input
                  type="number"
                  min={1000}
                  max={120000}
                  step={1000}
                  aria-label="请求超时（毫秒）" value={draft.openIM.requestTimeoutMs}
                  onChange={(event) => setDraft(current => current ? {
                    ...current,
                    openIM: {
                      ...current.openIM,
                      requestTimeoutMs: Number(event.target.value) || 15000,
                    },
                  } : current)}
                />
              </SettingField>

              <h2 className="border-t pt-3 text-sm font-semibold text-muted-foreground">身份与密钥</h2>
              <SettingField label="管理员用户 ID">
                <Input
                  aria-label="管理员用户 ID" value={draft.openIM.adminUserId}
                  onChange={(event) => setDraft(current => current ? {
                    ...current,
                    openIM: { ...current.openIM, adminUserId: event.target.value },
                  } : current)}
                  placeholder="imAdmin"
                />
              </SettingField>

              <SettingField label="OpenIM 管理密钥">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Input
                    type="password"
                    aria-label="OpenIM 管理密钥" value={draft.openIM.secret}
                    className="font-mono text-xs"
                    onChange={(event) => setDraft(current => current ? {
                      ...current,
                      openIM: { ...current.openIM, secret: event.target.value },
                    } : current)}
                  />
                  {draft.openIM.secret ? (
                    <Button variant="outline" size="sm" onClick={() => void handleCopy(draft.openIM.secret, 'OpenIM 管理密钥')}>
                      <Copy className="size-3.5" />复制
                    </Button>
                  ) : null}
                </div>
              </SettingField>

              <SettingField label="Webhook 密钥">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Input
                    type="password"
                    aria-label="Webhook 密钥" value={draft.openIM.webhookSecret}
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
                      <Copy className="size-3.5" />复制
                    </Button>
                  ) : null}
                </div>
              </SettingField>

            </div>}

            {section === 'snapshots' && <div className="max-w-xl space-y-3">
              <SettingField label="快照数量上限">
                <Input type="number" min={1} step={1} aria-label="快照数量上限" value={draft.webui.snapshots.maxSnapshotsPerEnvironment} onChange={event => setDraft(current => current ? { ...current, webui: { snapshots: { ...current.webui.snapshots, maxSnapshotsPerEnvironment: Number(event.target.value) } } } : current)} />
              </SettingField>
              <SettingField label="空间上限（GiB）">
                <Input type="number" min={1} step={1} aria-label="空间上限（GiB）" value={draft.webui.snapshots.maxBytesPerEnvironment / 1024 ** 3} onChange={event => setDraft(current => current ? { ...current, webui: { snapshots: { ...current.webui.snapshots, maxBytesPerEnvironment: Number(event.target.value) * 1024 ** 3 } } } : current)} />
              </SettingField>
            </div>}
          </section>
        </div>
      </div>
    </DashboardLayout>
  )
}
