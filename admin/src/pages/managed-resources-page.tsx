import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bot, Check, Minus, ChevronLeft, ChevronRight, Download, Hammer, Loader2, RefreshCw, Search, Trash2, Upload, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResourceUserPicker } from './resource-user-picker'
import { hasScope } from '@/lib/api/client'
import { useAuth } from '@/lib/hooks/use-auth'
import {
  getAssignments, getHubPage, getManagedResources, getResourceUsers, installFromHub, removeManagedResource,
  saveAssignments, setManagedResourceEnabled, uploadManagedResource,
  type HubCard, type ManagedKind, type ManagedResource, type ResourceDepartment, type ResourceUser,
} from '@/lib/api/managed-resources'

type Section = 'installed' | 'assignments' | 'market'
const sections = [['installed', '已安装'], ['assignments', '用户授权'], ['market', '市场']] as const
const grid = 'grid grid-cols-1 gap-2.5 @min-[30rem]:grid-cols-2 @min-[44rem]:grid-cols-3'
const kindLabel = (kind: ManagedKind) => kind === 'skills' ? '技能' : '专家'

function ResourceIcon({ source, kind, team, compact }: { source: string; kind: ManagedKind; team?: boolean; compact?: boolean }) {
  const [failed, setFailed] = useState('')
  const Icon = kind === 'skills' ? Hammer : team ? UsersRound : Bot
  return <span aria-hidden="true" className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary ${compact ? 'size-8' : 'size-10'}`}>
    {source && failed !== source
      ? <img src={source} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(source)} />
      : <Icon className={compact ? 'size-4' : 'size-5'} />}
  </span>
}

function CatalogCard({ kind, icon, name, slug, description, detail, actions, team }: {
  kind: ManagedKind; icon: string; name: string; slug: string; description: string; detail?: ReactNode; actions: ReactNode; team?: boolean
}) {
  return <article className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-3">
    <div className="flex min-w-0 items-start gap-2.5">
      <ResourceIcon source={icon} kind={kind} team={team} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold leading-5" title={name === slug ? name : `${name} · ${slug}`}>{name}</h3>
        <p title={description || slug} className="line-clamp-2 break-words text-xs leading-4 text-muted-foreground">{description || (slug !== name ? slug : '')}</p>
      </div>
    </div>
    <div className="mt-auto flex min-w-0 items-center justify-between gap-1.5">
      <span className="min-w-0 truncate text-xs text-muted-foreground">{detail}</span>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  </article>
}

function Message({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p role={error ? 'alert' : 'status'} className={`rounded-lg border border-dashed px-3 py-4 text-center text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{children}</p>
}

function Grants({ kind, userIds, resources, saving, setSaving }: {
  kind: ManagedKind; userIds: string[]; resources: ManagedResource[]; saving: boolean; setSaving: (value: boolean) => void
}) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [changes, setChanges] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    let active = true
    getAssignments(userIds, kind).then(({ assigned_counts }) => { if (active) setCounts(assigned_counts) })
      .catch(cause => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [kind, userIds])

  if (!counts) return <Message error={!!error}>{error || '正在读取授权…'}</Message>
  const total = userIds.length
  const updatedCount = (id: string) => id in changes ? (changes[id] ? total : 0) : counts[id] || 0
  const term = query.trim().toLowerCase()
  const filtered = resources.filter(item => [item.displayName, item.slug].some(text => text.toLowerCase().includes(term)))
  const dirty = Object.keys(changes).length

  function edit(ids: string[], grant: boolean) {
    setChanges(previous => {
      const next = { ...previous }
      for (const id of ids) {
        if ((counts?.[id] || 0) === (grant ? total : 0)) delete next[id]
        else next[id] = grant
      }
      return next
    })
  }
  async function save() {
    setSaving(true)
    try {
      const entries = Object.entries(changes)
      const add = entries.filter(([, enabled]) => enabled).map(([id]) => id)
      const remove = entries.filter(([, enabled]) => !enabled).map(([id]) => id)
      const { assigned_counts } = await saveAssignments(userIds, kind, add, remove)
      setCounts(assigned_counts); setChanges({}); setError(''); toast.success(`已保存 ${total} 位用户的授权`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存授权失败') }
    finally { setSaving(false) }
  }

  return <>
    {error && <Message error>{error}</Message>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Input aria-label={`筛选授权${kindLabel(kind)}`} placeholder={`筛选${kindLabel(kind)}`} value={query}
        onChange={e => setQuery(e.target.value)} className="h-8 w-44 text-sm" />
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" disabled={saving || filtered.every(r => updatedCount(r.id) === total)}
          onClick={() => edit(filtered.map(r => r.id), true)}>全选结果</Button>
        <Button size="sm" variant="ghost" disabled={saving || filtered.every(r => updatedCount(r.id) === 0)}
          onClick={() => edit(filtered.map(r => r.id), false)}>取消全选</Button>
      </div>
    </div>
    {!filtered.length && <Message>没有匹配的{kindLabel(kind)}。</Message>}
    <fieldset aria-label={`允许使用的${kindLabel(kind)}`} disabled={saving} className={grid}>
      {filtered.map(item => {
        const count = updatedCount(item.id)
        const selected = count === total
        const mixed = count > 0 && !selected
        return <label key={item.id} className={`flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors focus-within:ring-2 focus-within:ring-ring ${selected || mixed ? 'border-primary/50 bg-primary/5' : 'bg-card hover:border-primary/35'}`}>
          <input type="checkbox" className="sr-only" checked={selected} aria-label={item.displayName}
            ref={node => { if (node) node.indeterminate = mixed }} onChange={e => edit([item.id], e.target.checked)} />
          <ResourceIcon source={item.icon} kind={kind} compact />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium" title={item.displayName}>{item.displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">{[!item.enabled && '已停用', mixed && `${count}/${total} 人已授权`,
              !mixed && item.enabled && item.slug !== item.displayName && item.slug].filter(Boolean).join(' · ')}</span>
          </span>
          <span aria-hidden="true" className={`flex size-4 shrink-0 items-center justify-center rounded border ${count ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'}`}>
            {selected ? <Check className="size-3" strokeWidth={3} /> : mixed ? <Minus className="size-3" strokeWidth={3} /> : null}
          </span>
        </label>
      })}
    </fieldset>
    <div className="flex flex-wrap items-center gap-2">
      <span aria-live="polite" className="mr-auto text-xs text-muted-foreground">{dirty ? `已修改 ${dirty} 项 · ${total} 位用户` :
        total === 1 ? `已授权 ${resources.filter(r => updatedCount(r.id) > 0).length} / ${resources.length} 项` : `已选 ${total} 位用户 · 半选表示部分用户已授权`}</span>
      {!!dirty && <Button size="sm" variant="ghost" disabled={saving} onClick={() => setChanges({})}>撤销更改</Button>}
      <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>{saving ? '保存中…' : total > 1 ? `保存授权（${total} 人）` : '保存授权'}</Button>
    </div>
  </>
}

function Market({ kind, installed, busy, onInstall, revision, query, page, setPage }: {
  kind: ManagedKind; installed: ManagedResource[]; busy: string; onInstall: (item: HubCard) => void; revision: number
  query: string; page: number; setPage: (page: number) => void
}) {
  const [items, setItems] = useState<HubCard[]>([])
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    const timer = window.setTimeout(() => {
      getHubPage(kind, query.trim(), page).then(result => {
        if (active) { setItems(result.items); setPages(Math.max(1, Math.ceil(result.total / result.pageSize))) }
      }).catch(cause => { if (active) setError(cause.message) })
        .finally(() => { if (active) setLoading(false) })
    }, query ? 220 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [kind, query, page, revision])

  return <>
    {loading ? <Message>正在加载市场…</Message> : error ? <Message error>{error}</Message> : !items.length ? <Message>没有匹配的{kindLabel(kind)}。</Message> : <>
      <div className={grid}>{items.map(item => {
        const exists = installed.some(resource => resource.slug === item.slug)
        return <CatalogCard key={item.slug + '/' + item.namespace} {...item} kind={kind} detail={item.category || item.version}
          actions={<Button size="sm" variant={exists ? 'ghost' : 'outline'} aria-label={`${exists ? '已安装' : '安装'} ${item.name}`}
            disabled={exists || !!busy} onClick={() => onInstall(item)}>
            {busy === item.slug ? <Loader2 className="animate-spin" /> : exists ? <Check /> : <Download />}{exists ? '已安装' : '安装'}
          </Button>} />
      })}</div>
      {pages > 1 && <div className="flex items-center justify-end gap-3">
        <Button variant="outline" size="icon-sm" aria-label="上一页" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft /></Button>
        <span className="text-xs tabular-nums text-muted-foreground">{page} / {pages}</span>
        <Button variant="outline" size="icon-sm" aria-label="下一页" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight /></Button>
      </div>}
    </>}
  </>
}

function Library({ kind, section, setSection, currentUser, userIds, onSelectUsers }: {
  kind: ManagedKind; section: Section; setSection: (value: Section) => void; currentUser: ResourceUser
  userIds: string[]; onSelectUsers: (ids: string[]) => void
}) {
  const [resources, setResources] = useState<ManagedResource[]>([])
  const [users, setUsers] = useState<ResourceUser[]>([])
  const [departments, setDepartments] = useState<ResourceDepartment[]>([])
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const [marketRevision, setMarketRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [userError, setUserError] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)
  const label = kindLabel(kind)

  useEffect(() => {
    let active = true
    setError(''); setLoading(true)
    getManagedResources(kind).then(result => { if (active) setResources(result.resources) })
      .catch(cause => { if (active) setError(cause.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [kind, revision])

  useEffect(() => {
    if (section !== 'assignments') return
    let active = true
    setUserError('')
    getResourceUsers().then(result => { if (active) { setUsers(result.users); setDepartments(result.departments) } })
      .catch(cause => { if (active) setUserError(cause.message) })
    return () => { active = false }
  }, [section, revision])

  async function change(key: string, operation: () => Promise<unknown>, message?: string) {
    setBusy(key)
    try { await operation(); setRevision(value => value + 1); if (message) toast.success(message) }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : '操作失败') }
    finally { setBusy('') }
  }

  return <Tabs value={section} onValueChange={value => setSection(value as Section)} className="mt-2 gap-0">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b">
      <TabsList aria-label={`${label}管理`} className="h-9 justify-start gap-3 rounded-none bg-transparent p-0">
        {sections.map(([id, title]) => <TabsTrigger key={id} value={id}
          className="relative h-full flex-none rounded-none border-0 bg-transparent px-1 text-muted-foreground shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 data-[state=active]:after:bg-primary">{title}</TabsTrigger>)}
      </TabsList>
      <div className="flex min-w-0 max-w-full items-center gap-1 py-1">
        {section === 'market' && <div className="relative min-w-0">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input aria-label={`搜索${label}`} placeholder={`搜索${label}`} value={query}
            onChange={e => { setQuery(e.target.value); setPage(1) }} className="h-8 w-44 max-w-full pl-8 text-sm" />
        </div>}
        {section === 'assignments' && <ResourceUserPicker users={users} departments={departments} currentUser={currentUser}
          selected={userIds} onApply={onSelectUsers} disabled={!!busy} />}
        {section === 'installed' && <>
          <input type="file" ref={uploadRef} accept=".zip,application/zip" hidden onChange={e => {
            const file = e.target.files?.[0]; e.target.value = ''
            if (file) void change('upload', () => uploadManagedResource(kind, file), `${label}已上传`)
          }} />
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => uploadRef.current?.click()}><Upload />上传 ZIP</Button>
        </>}
        <Button variant="ghost" size="icon-sm" aria-label="刷新" title="刷新" disabled={loading || !!busy}
          onClick={() => { if (section === 'market') setMarketRevision(n => n + 1); else setRevision(n => n + 1) }}><RefreshCw className={loading ? 'animate-spin' : ''} /></Button>
      </div>
    </div>
    {error && <div className="mt-3"><Message error>{error}</Message></div>}
    <TabsContent value="installed" className="pt-3">
      {loading ? <Message>正在读取资源库…</Message> : error ? null : !resources.length ? <Message>尚未安装{label}。可上传 ZIP 或从市场安装。</Message> :
        <div className={grid}>{resources.map(item => <CatalogCard key={item.id} kind={kind} icon={item.icon} name={item.displayName} slug={item.slug}
          description={item.description} detail={[item.version && `v${item.version}`,item.category].filter(Boolean).join(' · ')}
          actions={<>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Switch aria-label={`启用 ${item.displayName}`} checked={item.enabled} disabled={!!busy}
              onCheckedChange={on => void change(item.id, () => setManagedResourceEnabled(kind, item.id, on))} />{item.enabled ? '已启用' : '已停用'}</label>
            <Button size="icon-sm" variant="ghost" disabled={!!busy} aria-label={`移除 ${item.displayName}`} title="从服务端移除"
              className="text-muted-foreground hover:text-destructive" onClick={() => void change(item.id, () => removeManagedResource(kind, item.id), '已从服务端移除')}><Trash2 /></Button>
          </>} />)}</div>}
    </TabsContent>
    <TabsContent value="assignments" className="space-y-2.5 pt-3">
      {userError && <Message error>{userError}</Message>}
      {loading ? <Message>正在读取资源库…</Message> : error ? null : !resources.length ? <Message>暂无可分配的{label}。</Message> :
        <Grants key={JSON.stringify(userIds)} kind={kind} userIds={userIds} resources={resources} saving={busy === 'grants'}
          setSaving={value => setBusy(value ? 'grants' : '')} />}
    </TabsContent>
    <TabsContent value="market" className="space-y-2.5 pt-3">
      <Market kind={kind} installed={resources} busy={busy || (loading || error ? 'loading' : '')} revision={marketRevision} query={query} page={page} setPage={setPage} onInstall={item => void change(item.slug, () =>
        installFromHub(kind, { slug: item.slug, namespace: item.namespace || undefined, version: item.version || undefined }), `已安装「${item.name}」`)} />
    </TabsContent>
  </Tabs>
}

function ResourceTabs({ currentUser }: { currentUser: ResourceUser }) {
  const [kind, setKind] = useState<ManagedKind>('skills')
  const [section, setSection] = useState<Section>('installed')
  const [userIds, setUserIds] = useState([currentUser.id])
  return <Tabs value={kind} onValueChange={value => setKind(value as ManagedKind)} className="gap-0">
    <TabsList aria-label="资源类型" className="h-8 self-start">
      <TabsTrigger value="skills"><Hammer />技能</TabsTrigger><TabsTrigger value="experts"><Bot />专家</TabsTrigger>
    </TabsList>
    {(['skills','experts'] as const).map(tab => <TabsContent key={tab} value={tab}>
      <Library kind={tab} section={section} setSection={setSection} currentUser={currentUser} userIds={userIds}
        onSelectUsers={ids => setUserIds(previous => ids.length === previous.length && ids.every((id, i) => id === previous[i]) ? previous : ids)} />
    </TabsContent>)}
  </Tabs>
}

export default function ManagedResourcesPage() {
  const { scopes, user } = useAuth()
  return <DashboardLayout title="技能与专家"><div className="@container">
    {user && hasScope(scopes, 'admin:settings') ? <ResourceTabs key={user.id} currentUser={user} /> : <Message error>当前账号没有管理技能与专家的权限。</Message>}
  </div></DashboardLayout>
}
