import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { getUserUsage, type UsageOverview } from '@/lib/api/usage'
import { Button } from '@/components/ui/button'
import { UsageOverviewPanel } from '@/components/usage-overview'

export function UserUsage({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const [overview, setOverview] = useState<UsageOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let active = true
    let pending = false
    setOverview(null)
    setLoading(true)
    setError('')
    const load = async () => {
      if (pending) return
      pending = true
      try {
        const next = await getUserUsage(userId)
        if (active) { setOverview(next); setError('') }
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : '获取用量失败')
      } finally {
        pending = false
        if (active) setLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [userId, refresh])

  return (
    <section className="min-w-0 space-y-4" aria-label="个人 Token 用量">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Token 用量</h2>
          {overview && <p className="mt-1 text-xs text-muted-foreground">
            按 {overview.timezone} 统计 · 更新于 {new Date(overview.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </p>}
        </div>
        <Button variant="ghost" size="icon" aria-label="刷新用量" disabled={loading} onClick={() => setRefresh(value => value + 1)}>
          <RefreshCw className="size-4" />
        </Button>
      </div>
      {error ? (
        <div role="alert" className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          <p>用量数据暂时不可用：{error}</p>
          <Button variant="outline" className="mt-3" onClick={() => setRefresh(value => value + 1)}>重试</Button>
        </div>
      ) : loading || !overview || overview.user.id !== userId ? (
        <div className="flex min-h-36 items-center justify-center" role="status" aria-label="正在加载用量">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : <UsageOverviewPanel overview={overview} compact={compact} />}
    </section>
  )
}
