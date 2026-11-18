import { useMemo, useState } from 'react'
import { Check, ChevronDown, Search, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ResourceDepartment, ResourceUser } from '@/lib/api/managed-resources'

export function ResourceUserPicker({ users, departments, currentUser, selected, onApply, disabled }: {
  users: ResourceUser[]; departments: ResourceDepartment[]; currentUser: ResourceUser
  selected: string[]; onApply: (ids: string[]) => void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const directory = useMemo(() => {
    const byId = new Map(departments.map(d => [d.id, d]))
    return new Map(departments.map(d => {
      const ancestors = new Set<string>()
      const names: string[] = []
      let parent: ResourceDepartment | undefined = d
      while (parent && !ancestors.has(parent.id)) {
        ancestors.add(parent.id)
        names.unshift(parent.name)
        parent = parent.parentId ? byId.get(parent.parentId) : undefined
      }
      return [d.id, { path: names.join(' / '), ancestors }]
    }))
  }, [departments])
  const options = [currentUser, ...users.filter(user => user.id !== currentUser.id)]
  const term = query.trim().toLocaleLowerCase()
  const filtered = options.filter(user => {
    const dept = directory.get(user.departmentId || '')
    const matchesDepartment = !department || (department === 'unassigned' ? !user.departmentId : dept?.ancestors.has(department))
    return matchesDepartment && (!selectedOnly || draft.has(user.id))
      && [user.name, user.email, dept?.path].some(text => text?.toLocaleLowerCase().includes(term))
  })
  const first = options.find(user => user.id === selected[0])
  const title = selected.length > 1 ? `已选 ${selected.length} 位用户` :
    first?.id === currentUser.id ? `${currentUser.name}（当前用户）` : first?.name || '选择授权用户'

  function changeOpen(next: boolean) {
    if (next) {
      setDraft(new Set(selected)); setQuery(''); setDepartment(''); setSelectedOnly(false)
    }
    setOpen(next)
  }
  function toggleUser(id: string) {
    setDraft(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <Button size="sm" variant="outline" disabled={disabled} aria-label={`授权用户，${title}`} className="max-w-56 font-normal">
        <UsersRound /><span className="truncate">{title}</span><ChevronDown className="size-3.5 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" aria-label="选择授权用户" className="w-[min(23rem,calc(100vw-1.5rem))] p-0">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input aria-label="搜索用户" placeholder="搜索姓名、邮箱或部门" value={query} onChange={e => setQuery(e.target.value)} className="h-8 pl-8 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="按部门筛选（含子部门）" title="包含下级部门" value={department} onChange={e => setDepartment(e.target.value)}
            className="h-8 min-w-0 flex-1 truncate rounded-md border bg-background px-2 text-sm">
            <option value="">全部部门</option>
            {[...directory].sort((a, b) => a[1].path.localeCompare(b[1].path, 'zh-CN')).map(([id, d]) =>
              <option key={id} value={id}>{d.path}</option>)}
            <option value="unassigned">未分配部门</option>
          </select>
          <Button size="sm" variant={selectedOnly ? 'secondary' : 'ghost'} aria-pressed={selectedOnly} onClick={() => setSelectedOnly(!selectedOnly)}>只看已选</Button>
        </div>
      </div>
      <div className="flex items-center justify-between px-3 pt-2 text-xs text-muted-foreground">
        <span>{filtered.length} 位用户</span>
        <button type="button" className="rounded px-1 py-1 text-primary disabled:opacity-50" disabled={!filtered.length}
          onClick={() => setDraft(new Set([...draft, ...filtered.map(user => user.id)]))}>全选结果</button>
      </div>
      <div className="max-h-[min(16rem,35vh)] overflow-y-auto px-1.5 pb-1.5">
        {!filtered.length && <p role="status" className="py-4 text-center text-sm text-muted-foreground">没有匹配的用户</p>}
        {filtered.map(user => <label key={user.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring">
          <input type="checkbox" aria-label={user.name} className="peer sr-only" checked={draft.has(user.id)} onChange={() => toggleUser(user.id)} />
          <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded border peer-checked:border-primary peer-checked:bg-primary">
            {draft.has(user.id) && <Check className="size-3 text-primary-foreground" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.name}{user.id === currentUser.id && <span className="ml-1 text-xs font-normal text-muted-foreground">（当前用户）</span>}</span>
            <span className="block truncate text-xs text-muted-foreground">{[directory.get(user.departmentId || '')?.path || '未分配部门', user.email].filter(Boolean).join(' · ')}</span>
          </span>
        </label>)}
      </div>
      <div className="flex items-center gap-2 border-t px-3 py-2">
        <span aria-live="polite" className="mr-auto text-xs text-muted-foreground">已选 {draft.size} 人</span>
        <Button size="sm" variant="ghost" disabled={!draft.size} onClick={() => setDraft(new Set())}>清空</Button>
        <Button size="sm" disabled={!draft.size} onClick={() => { onApply([...draft].sort()); setOpen(false) }}>应用选择</Button>
      </div>
    </PopoverContent>
  </Popover>
}
