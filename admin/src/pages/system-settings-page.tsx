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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getSystemModelCatalog, getSystemSettings, updateSystemSettings } from '@/lib/api/settings'
import { hasScope } from '@/lib/api/client'
import { useAuth } from '@/lib/hooks/use-auth'
import type {
  SystemSettings,
  UpdateSystemSettingsRequest,
} from '@/lib/api/types'
import { Copy, RefreshCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

type EditableSystemSettings = Pick<
  SystemSettings,
  'openIM' | 'model' | 'fastModel' | 'image'
> & {
  // null follows Router. An empty array is a manual selection still being edited.
  availableModels: string[] | null
  webui: NonNullable<SystemSettings['webui']>
}


const sections = [
  { id: 'models', title: '模型' },
  { id: 'openim', title: 'OpenIM' },
  { id: 'snapshots', title: 'WebUI 环境快照' },
] as const

const modelSourceOptionClassName = 'block rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors peer-hover:text-foreground peer-checked:bg-card peer-checked:text-foreground peer-checked:shadow-xs peer-focus-visible:ring-2 peer-focus-visible:ring-ring'
const bulkModelButtonClassName = 'h-7 rounded-none px-3 text-xs hover:bg-muted hover:text-foreground dark:hover:bg-muted focus-visible:z-10 focus-visible:ring-inset'

function toEditableSettings(settings: SystemSettings): EditableSystemSettings {
  return {
    webui: { snapshots: normalizeSnapshotPolicy(settings.webui?.snapshots) },
    openIM: { ...settings.openIM },
    model: settings.model,
    availableModels: settings.availableModels.length ? [...settings.availableModels] : null,
    fastModel: settings.fastModel,
    image: { ...settings.image },
  }
}

function buildSystemSettingsPatch(
  settings: SystemSettings,
  draft: EditableSystemSettings,
): UpdateSystemSettingsRequest {
  const patch: UpdateSystemSettingsRequest = {}

  const textPatch: NonNullable<UpdateSystemSettingsRequest['models']>['text'] = {}
  if (draft.model !== settings.model) textPatch.model = draft.model
  if (draft.fastModel !== settings.fastModel) textPatch.fastModel = draft.fastModel
  const availableModels = draft.availableModels ?? []
  if (draft.availableModels?.length !== 0 && JSON.stringify(availableModels) !== JSON.stringify(settings.availableModels)) {
    textPatch.availableModels = availableModels
  }
  if (Object.keys(textPatch).length) patch.models = { text: textPatch }
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
  return <div aria-label="正在读取系统设置" className="max-w-5xl space-y-4">
    <div className="flex gap-4 border-b pb-2">
      <Skeleton className="h-8 w-12" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-8 w-28" />
    </div>
    {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 max-w-xl" />)}
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
  const latestCatalogRequest = useRef(0)
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
    const request = ++latestCatalogRequest.current
    setModelCatalogState('loading')
    try {
      const response = await getSystemModelCatalog()
      if (request !== latestCatalogRequest.current) return
      setModelCatalog([...new Set(response.models)])
      setModelCatalogState('idle')
    } catch {
      if (request !== latestCatalogRequest.current) return
      setModelCatalogState('error')
    }
  }, [])

  useEffect(() => {
    if (canManageSettings) void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (canManageSettings && section === 'models') void fetchModelCatalog()
  }, [canManageSettings, fetchModelCatalog, section])

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
            if (!current || JSON.stringify(current) !== draftSnapshot) return current
            const saved = toEditableSettings(response)
            return current.availableModels?.length === 0 ? { ...saved, availableModels: [] } : saved
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
    ...(draft.availableModels ?? []),
    draft.model,
    draft.fastModel,
    draft.image.model,
  ].map(model => model.trim()).filter(Boolean))]
  const followsRouter = draft.availableModels === null
  const selectedModels = new Set(draft.availableModels ?? [])
  const manualModelOptions = [...new Set([...modelCatalog, ...settings.availableModels, ...selectedModels])]
  const invertedModels = manualModelOptions.filter(model => !selectedModels.has(model))
  const updateAllowedModels = (models: string[] | null) => {
    setDraft(current => current ? { ...current, availableModels: models } : current)
  }
  const toggleAllowedModel = (model: string, checked: boolean) => {
    setDraft(current => {
      if (!current || current.availableModels === null) return current
      const models = new Set(current.availableModels)
      if (checked) models.add(model)
      else models.delete(model)
      return { ...current, availableModels: [...models] }
    })
  }

  return (
    <DashboardLayout title="系统设置">
      <Tabs value={section} onValueChange={value => setSection(value as typeof section)} className="min-w-0 max-w-5xl gap-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-2">
          <TabsList aria-label="系统设置分类" className="h-auto min-w-0 max-w-full justify-start gap-1 overflow-x-auto bg-transparent p-0">
            {sections.map(({ id, title }) => (
              <TabsTrigger key={id} value={id}
                className="h-8 flex-none rounded-lg border-0 bg-transparent px-3 text-muted-foreground shadow-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-inset data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-primary/10 dark:data-[state=active]:text-foreground">
                {title}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex flex-wrap items-center gap-2">
            {isSaving && <span role="status" className="text-xs text-muted-foreground">保存中…</span>}
            {section === 'models' && <>
              {modelCatalogState === 'error' && <span role="status" className="text-xs text-destructive">模型列表读取失败</span>}
              <Button
                type="button" size="sm" variant="outline"
                className="h-8 rounded-lg border-border/70 bg-card text-xs shadow-none hover:bg-muted hover:text-foreground dark:border-border/70 dark:bg-card dark:hover:bg-muted"
                onClick={() => void fetchModelCatalog()}
                disabled={modelCatalogState === 'loading'}
                aria-busy={modelCatalogState === 'loading'}
              >
                <RefreshCw aria-hidden="true" className={modelCatalogState === 'loading' ? 'size-3.5 motion-safe:animate-spin' : 'size-3.5'} />
                {modelCatalogState === 'loading' ? '读取中…' : '刷新模型列表'}
              </Button>
            </>}
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

        <TabsContent value="models" className="@container min-w-0 space-y-3">
          <div className="border-b pb-3">
            <SettingField label="模型列表来源">
              <div className="space-y-1">
                <fieldset aria-label="模型列表来源" className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-border/70 bg-muted/35 p-0.5">
                  <label className="relative">
                    <input type="radio" name="model-list-source" className="peer absolute inset-0 size-full cursor-pointer opacity-0" checked={followsRouter}
                      onChange={() => updateAllowedModels(null)} />
                    <span className={modelSourceOptionClassName}>自动跟随 Router</span>
                  </label>
                  <label className="relative">
                    <input type="radio" name="model-list-source" className="peer absolute inset-0 size-full cursor-pointer opacity-0" checked={!followsRouter}
                      onChange={() => updateAllowedModels(modelCatalog)} />
                    <span className={modelSourceOptionClassName}>手动筛选</span>
                  </label>
                </fieldset>
                <p className="text-xs text-muted-foreground">
                  {followsRouter ? '会话可选模型随 Router 更新。' : '会话使用已保存的模型名单。'}
                </p>
              </div>
            </SettingField>
          </div>

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
          {!followsRouter && <div className="space-y-2 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">允许切换的模型</h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">已选 {selectedModels.size} / {manualModelOptions.length}</span>
                <div role="group" aria-label="批量选择模型" className="inline-flex divide-x divide-border/70 overflow-hidden rounded-lg border border-border/70 bg-card">
                  <Button type="button" variant="ghost" size="sm" className={bulkModelButtonClassName}
                    onClick={() => updateAllowedModels(manualModelOptions)} disabled={!manualModelOptions.length}>全选</Button>
                  <Button type="button" variant="ghost" size="sm" className={bulkModelButtonClassName}
                    onClick={() => updateAllowedModels(invertedModels)} disabled={!manualModelOptions.length}>反选</Button>
                </div>
              </div>
            </div>
            {selectedModels.size === 0 && <p role="status" className="text-sm text-muted-foreground">
              勾选至少一个模型后自动保存。当前使用{settings.availableModels.length ? '上次保存的名单' : ' Router 列表'}。
            </p>}
            <div className="grid gap-x-3 gap-y-0.5 @min-[23rem]:grid-cols-2 @min-[42rem]:grid-cols-3">
              {manualModelOptions.map(model => (
                <label key={model} className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/60">
                  <input
                    type="checkbox" className="accent-primary"
                    checked={selectedModels.has(model)}
                    onChange={event => toggleAllowedModel(model, event.target.checked)}
                  />
                  <span className="truncate" title={model}>{model}</span>
                </label>
              ))}
            </div>
          </div>}
        </TabsContent>

        <TabsContent value="openim" className="@container min-w-0 max-w-4xl space-y-3">
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

        </TabsContent>

        <TabsContent value="snapshots" className="@container min-w-0 max-w-xl space-y-3">
          <SettingField label="快照数量上限">
            <Input type="number" min={1} step={1} aria-label="快照数量上限" value={draft.webui.snapshots.maxSnapshotsPerEnvironment} onChange={event => setDraft(current => current ? { ...current, webui: { snapshots: { ...current.webui.snapshots, maxSnapshotsPerEnvironment: Number(event.target.value) } } } : current)} />
          </SettingField>
          <SettingField label="空间上限（GiB）">
            <Input type="number" min={1} step={1} aria-label="空间上限（GiB）" value={draft.webui.snapshots.maxBytesPerEnvironment / 1024 ** 3} onChange={event => setDraft(current => current ? { ...current, webui: { snapshots: { ...current.webui.snapshots, maxBytesPerEnvironment: Number(event.target.value) * 1024 ** 3 } } } : current)} />
          </SettingField>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  )
}
