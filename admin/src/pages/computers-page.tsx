import { useCallback, useEffect, useState } from 'react'
import { Cloud, Monitor, RefreshCw } from 'lucide-react'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { dcClient, hasScope } from '@/lib/api/client'
import { useAuth } from '@/lib/hooks/use-auth'

type Host = { id: string; userId: string; name: string; kind: string; version: string; platform: string; online: boolean;
  lastSeen: number; status: { activeSessions: number; paused: boolean; policyRevision: number } }
type Command = { id: string; action: string; state: string; createdAt: number; result?: { error?: string } }
const states: Record<string, string> = { pending: '等待电脑接收', running: '已接收，等待结果', succeeded: '已完成', failed: '失败', expired: '已过期' }

export default function ComputersPage() {
  const { scopes } = useAuth()
  const [hosts, setHosts] = useState<Host[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [commands, setCommands] = useState<Command[]>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [policy, setPolicy] = useState<Record<string, boolean>>({})
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(async () => {
    try {
      const list = await dcClient.get<{ hosts: Host[] }>(`/api/v1/hosts${hasScope(scopes, 'admin:users') ? '?all=true' : ''}`)
      setHosts(list.hosts)
      if (selected) setCommands((await dcClient.get<{ commands: Command[] }>(`/api/v1/hosts/${selected}/commands`)).commands)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [scopes, selected])
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15000); return () => clearInterval(timer) }, [refresh])
  useEffect(() => {
    void dcClient.get<{ revision: number; settings: Record<string, boolean> }>('/api/v1/host-policy')
      .then(value => { setPolicy(value.settings); setRevision(value.revision) }).catch(cause => setError(String(cause)))
  }, [])
  const submit = async (host: Host, action: string) => {
    setPending(true)
    try { await dcClient.post(`/api/v1/hosts/${host.id}/commands`, { id: crypto.randomUUID(), action }); setSelected(host.id); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }
  return <DashboardLayout title="工作电脑" description="管理 Desktop 和个人云电脑。任务在对应电脑执行，关闭界面不会停止云端任务。">
    <div className="mb-5 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{hosts.length} 台电脑 · {hosts.filter(host => host.online).length} 台在线</p>
      <div className="flex gap-2"><Button variant="outline" asChild><a href="/">进入我的云电脑</a></Button><Button variant="outline" onClick={() => void refresh()}><RefreshCw className="mr-2 size-4" />刷新</Button></div></div>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    <div className="grid gap-4 lg:grid-cols-2">{hosts.map(host => <article key={host.id} className="rounded-xl border p-5">
      <div className="flex items-center gap-3">{host.kind === 'cloud' ? <Cloud className="size-6" /> : <Monitor className="size-6" />}<div className="min-w-0 flex-1"><h2 className="font-medium">{host.name}</h2><p className="truncate text-xs text-muted-foreground">{host.platform} · {host.version}</p></div><span className="text-sm">{host.online ? '在线' : '离线'}</span></div>
      <p className="my-3 text-sm">{host.status.paused ? '已暂停接收新任务' : '允许接收任务'} · {host.status.activeSessions} 个活动会话</p>
      <p className="mb-3 text-xs text-muted-foreground">最后上报：{new Date(host.lastSeen).toLocaleString()} · 策略版本 {host.status.policyRevision}<br />用户：{host.userId}</p>
      <div className="flex gap-2"><Button size="sm" disabled={pending} onClick={() => void submit(host, host.status.paused ? 'resume' : 'pause')}>{host.status.paused ? '恢复接收任务' : '暂停接收任务'}</Button><Button size="sm" variant="outline" onClick={() => setSelected(host.id)}>控制记录</Button></div>
    </article>)}</div>
    {!hosts.length && <p className="rounded-xl border p-8 text-sm text-muted-foreground">尚未登记工作电脑。用户登录云电脑，或在 Desktop 启用企业账号连接后，电脑会自动登记。</p>}
    {selected && <section className="mt-6 rounded-xl border p-5"><h2 className="mb-3 font-medium">控制记录</h2>{!commands.length && <p className="text-sm text-muted-foreground">暂无控制记录</p>}{commands.map(command => <div key={command.id} className="border-t py-3 text-sm"><span>{command.action === 'pause' ? '暂停接收任务' : command.action === 'resume' ? '恢复接收任务' : '取消会话'} · {states[command.state] || command.state}</span><span className="ml-3 text-muted-foreground">{new Date(command.createdAt).toLocaleString()}</span>{command.result?.error && <p className="mt-1 text-destructive">{command.result.error}</p>}</div>)}</section>}
    {hasScope(scopes, 'admin:settings') && <section className="mt-6 rounded-xl border p-5"><h2 className="font-medium">企业执行策略</h2><p className="my-2 text-xs text-muted-foreground">当前版本 {revision}。电脑连接后应用并上报版本；离线电脑保留已应用策略。</p>
      {([['agentTeamsEnabled', 'Agent Teams'], ['bypassPermissions', '自动批准工具权限']] as const).map(([key, label]) => <label key={key} className="my-3 flex items-center justify-between gap-4 text-sm">{label}<select className="rounded-md border bg-background p-2" value={key in policy ? String(policy[key]) : 'inherit'} onChange={event => setPolicy(current => { const next = { ...current }; if (event.target.value === 'inherit') delete next[key]; else next[key] = event.target.value === 'true'; return next })}><option value="inherit">由电脑配置</option><option value="false">强制关闭</option><option value="true">强制开启</option></select></label>)}
      <Button disabled={pending} onClick={async () => { setPending(true); try { const value = await dcClient.put<{ revision: number; settings: Record<string, boolean> }>('/api/v1/host-policy', { settings: policy }); setRevision(value.revision); setPolicy(value.settings) } catch (cause) { setError(String(cause)) } finally { setPending(false) } }}>保存策略</Button>
    </section>}
  </DashboardLayout>
}
