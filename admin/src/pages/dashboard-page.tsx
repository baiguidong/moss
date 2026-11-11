import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  Building2,
  ChartNoAxesCombined,
  CircleCheck,
  Laptop,
  RefreshCw,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getDepartments, getUsers } from '@/lib/api/auth'
import { dcClient, hasScope } from '@/lib/api/client'
import { getUserUsage, type UsageOverview } from '@/lib/api/usage'
import { useAuth } from '@/lib/hooks/use-auth'

type Host = {
  id: string
  name: string
  kind: string
  platform: string
  online: boolean
  lastSeen: number
  status: { activeSessions: number; paused: boolean }
  access: { allowed: boolean; reason?: string }
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(Math.round(value))
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'default',
}: {
  label: string
  value: string
  detail: string
  icon: typeof Users
  tone?: 'default' | 'rose' | 'green'
}) {
  return (
    <Card className="rounded-xl border-border/70 bg-card/90 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <span className={`flex size-8 items-center justify-center rounded-lg ${tone === 'rose' ? 'bg-primary/10 text-primary' : tone === 'green' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
          <Icon className="size-4" />
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { user, scopes } = useAuth()
  const canViewComputers = hasScope(scopes, 'sessions:list') || hasScope(scopes, 'sessions:list:any')
  const canManageUsers = hasScope(scopes, 'admin:users')
  const canViewUsage = canViewComputers || canManageUsers
  const [hosts, setHosts] = useState<Host[]>([])
  const [usage, setUsage] = useState<UsageOverview | null>(null)
  const [userCount, setUserCount] = useState<number | null>(null)
  const [departmentCount, setDepartmentCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setError('')
    try {
      const [usageResult, hostsResult, usersResult, departmentsResult] = await Promise.all([
        canViewUsage ? getUserUsage() : Promise.resolve(null),
        canViewComputers
          ? dcClient.get<{ hosts: Host[] }>(`/api/v1/hosts${canManageUsers ? '?all=true' : ''}`)
          : Promise.resolve(null),
        canManageUsers ? getUsers() : Promise.resolve(null),
        canManageUsers ? getDepartments() : Promise.resolve(null),
      ])
      setUsage(usageResult)
      if (hostsResult) setHosts(hostsResult.hosts)
      if (usersResult) setUserCount(usersResult.users.length)
      if (departmentsResult) setDepartmentCount(departmentsResult.departments.length)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取工作台数据失败')
    } finally {
      setLoading(false)
    }
  }, [canManageUsers, canViewComputers, canViewUsage])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onlineHosts = hosts.filter(host => host.online).length
  const activeSessions = hosts.reduce((total, host) => total + (host.status?.activeSessions ?? 0), 0)
  const todayUsage = usage?.daily.find(day => day.day === usage.today)
  const quickLinks = [
    canViewComputers ? { to: '/computers', label: '管理工作电脑', description: '查看在线状态、任务与企业策略', icon: Laptop } : null,
    { to: '/usage', label: '查看个人用量', description: '查看 Token 活动与请求趋势', icon: ChartNoAxesCombined },
    canManageUsers ? { to: '/users', label: '管理用户与组织', description: '维护用户、部门和角色授权', icon: Users } : null,
  ].filter(Boolean) as Array<{ to: string; label: string; description: string; icon: typeof Users }>

  return (
    <DashboardLayout title="工作台" description="从这里快速了解组织运行状态，并进入常用管理功能。">
      <div className="space-y-6">
        <section className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-card/90 to-card/90 p-6 shadow-sm md:p-7">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm text-muted-foreground">欢迎回来，{user?.name || '管理员'}</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">今天也保持工作流顺畅。</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">工作台汇总关键状态；需要深入处理时，再进入对应的管理页面。</p>
            </div>
            <Button variant="outline" className="w-fit rounded-lg bg-background/70" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`} />刷新数据
            </Button>
          </div>
        </section>

        {error ? <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="在线工作电脑" value={canViewComputers ? `${onlineHosts}/${hosts.length}` : '—'} detail={canViewComputers ? '在线 / 已登记' : '当前账号无电脑查看权限'} icon={Laptop} tone="rose" />
          <StatCard label="活动中的会话" value={canViewComputers ? String(activeSessions) : '—'} detail="正在执行的任务" icon={Activity} tone="green" />
          <StatCard label="今日 Token" value={todayUsage ? formatTokens(todayUsage.totalTokens) : '—'} detail={usage ? `${todayUsage?.requestCount ?? 0} 次请求` : canViewUsage ? '暂无用量数据' : '当前账号无用量查看权限'} icon={Zap} tone="rose" />
          <StatCard label="组织成员" value={userCount == null ? '—' : String(userCount)} detail={departmentCount == null ? '需要组织管理权限' : `${departmentCount} 个部门`} icon={Users} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <Card className="rounded-xl border-border/70 bg-card/90 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/60 pb-4">
              <div><CardTitle className="text-base">工作电脑状态</CardTitle><p className="mt-1 text-xs text-muted-foreground">最近登记的设备与连接状态</p></div>
              {canViewComputers ? <Link className="text-xs font-medium text-primary hover:underline" to="/computers">查看全部</Link> : null}
            </CardHeader>
            <CardContent className="pt-4">
              {!canViewComputers ? <p className="py-8 text-center text-sm text-muted-foreground">当前账号没有工作电脑查看权限。</p> : hosts.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">尚未登记工作电脑。</p> : <div className="space-y-2">{hosts.slice(0, 5).map(host => <div key={host.id} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-3"><span className={`size-2 rounded-full ${host.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{host.name}</p><p className="truncate text-xs text-muted-foreground">{host.platform} · {host.online ? `${host.status.activeSessions} 个活动会话` : `最后在线 ${new Date(host.lastSeen).toLocaleString('zh-CN')}`}</p></div><Badge variant={host.online ? 'default' : 'secondary'}>{host.online ? '在线' : '离线'}</Badge></div>)}</div>}
            </CardContent>
          </Card>

          <Card className="rounded-xl border-border/70 bg-card/90 shadow-sm">
            <CardHeader className="border-b border-border/60 pb-4"><CardTitle className="text-base">常用入口</CardTitle><p className="mt-1 text-xs text-muted-foreground">按当前账号权限显示</p></CardHeader>
            <CardContent className="space-y-2 pt-4">{quickLinks.map(item => <Link key={item.to} to={item.to} className="group flex items-center gap-3 rounded-lg border border-transparent px-2 py-3 transition-colors hover:border-border/70 hover:bg-muted/50"><span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><item.icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.label}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.description}</span></span><ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></Link>)}{quickLinks.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">暂无可用入口</p> : null}</CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-4 py-3 text-xs text-muted-foreground"><CircleCheck className="size-4 text-emerald-600" /><span>控制台连接正常</span><span className="text-border">|</span><ShieldCheck className="size-4" /><span>菜单已按当前权限过滤</span>{canManageUsers ? <><span className="text-border">|</span><Building2 className="size-4" /><span>组织管理已启用</span></> : null}</div>
      </div>
    </DashboardLayout>
  )
}
