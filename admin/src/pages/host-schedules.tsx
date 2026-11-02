import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { dcClient } from '@/lib/api/client'

type Config = { name: string; cron: string; prompt: string; enabled: boolean }
type Schedule = { id: string; revision: number; appliedRevision: number; config: Config; deleted: boolean; error?: string }
const empty: Config = { name: '', cron: '0 9 * * *', prompt: '', enabled: true }

export function HostSchedules({ hostId }: { hostId: string }) {
  const [tasks, setTasks] = useState<Schedule[]>([])
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [form, setForm] = useState<Config>(empty)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const refresh = useCallback(async () => {
    const result = await dcClient.get<{ schedules: Schedule[] }>(`/api/v1/hosts/${hostId}/schedules`)
    setTasks(result.schedules)
  }, [hostId])
  useEffect(() => {
    setTasks([]); setEditing(null); setForm(empty); setError('')
    const load = () => void refresh().catch(cause => setError(String(cause)))
    load(); const timer = setInterval(load, 15000); return () => clearInterval(timer)
  }, [refresh])
  const save = async (task: Schedule | null, config: Config, deleted = false) => {
    setPending(true); setError('')
    try {
      await dcClient.put(`/api/v1/hosts/${hostId}/schedules/${task?.id || crypto.randomUUID()}`, { revision: task?.revision || 0, config, deleted })
      setEditing(null); setForm(empty); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }
  return <div className="mt-6 border-t pt-5"><h3 className="font-medium">企业定时任务</h3>
    <p className="my-2 text-xs text-muted-foreground">按这台电脑的时区执行。离线时配置等待应用；执行中的任务结束后才更新或删除。换电脑前先删除原任务并等待确认。</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {tasks.map(task => <div key={task.id} className="my-3 rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="flex-1">{task.config.name} · {task.config.cron}</span>
      {!task.deleted && <><Button size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(task); setForm(task.config) }}>编辑</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => void save(task, { ...task.config, enabled: !task.config.enabled })}>{task.config.enabled ? '停用' : '启用'}</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => void save(task, task.config, true)}>删除</Button></>}
      </div><p className="mt-2 text-xs text-muted-foreground">{task.error || (task.appliedRevision === task.revision ? task.deleted ? '电脑已确认删除' : task.config.enabled ? '电脑已应用' : '电脑已停用' : task.deleted ? '等待电脑删除' : '等待电脑应用')} · 版本 {task.revision}</p></div>)}
    <form className="mt-4 grid gap-3" onSubmit={event => { event.preventDefault(); void save(editing, form) }}>
      <label className="text-sm">任务名称<input required maxLength={200} className="mt-1 block w-full rounded-md border bg-background p-2" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <label className="text-sm">执行时间（cron：分 时 日 月 周）<input required className="mt-1 block w-full rounded-md border bg-background p-2" value={form.cron} onChange={event => setForm({ ...form, cron: event.target.value })} /></label>
      <label className="text-sm">任务指令<textarea required maxLength={16000} rows={3} className="mt-1 block w-full rounded-md border bg-background p-2" value={form.prompt} onChange={event => setForm({ ...form, prompt: event.target.value })} /></label>
      <div className="flex gap-2"><Button disabled={pending} type="submit">{editing ? '保存修改' : '创建定时任务'}</Button>{editing && <Button type="button" variant="outline" onClick={() => { setEditing(null); setForm(empty) }}>取消编辑</Button>}</div>
    </form>
  </div>
}
