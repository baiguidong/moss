import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DashboardLayout } from '@/components/dashboard-layout'
import { UserUsage } from '@/components/user-usage'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getUsers } from '@/lib/api/auth'
import { hasScope } from '@/lib/api/client'
import { useAuth } from '@/lib/hooks/use-auth'
import type { AuthUser } from '@/lib/api/types'

export default function UsagePage() {
  const { user, scopes } = useAuth()
  const [params, setParams] = useSearchParams()
  const [users, setUsers] = useState<AuthUser[]>([])
  const [error, setError] = useState('')
  const canManageUsers = hasScope(scopes, 'admin:users')
  const userId = params.get('user_id') || user?.id || ''

  useEffect(() => {
    if (!canManageUsers) return
    let active = true
    void getUsers().then(result => {
      if (active) { setUsers(result.users); setError('') }
    }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : '获取用户失败')
    })
    return () => { active = false }
  }, [canManageUsers])

  const options = users.length ? users : user ? [user] : []
  return (
    <DashboardLayout title="个人用量" description="按用户查看服务端累计 Token、请求次数与每日活动。">
      <div className="mx-auto max-w-[1440px] space-y-6">
        {canManageUsers && <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="usage-user" className="text-sm font-medium">统计用户</label>
          <Select value={userId} onValueChange={value => setParams({ user_id: value })}>
            <SelectTrigger id="usage-user" className="w-64"><SelectValue placeholder="选择用户" /></SelectTrigger>
            <SelectContent>
              {options.map(item => <SelectItem key={item.id} value={item.id}>
                {item.name}{item.id === user?.id ? '（我）' : ''}
              </SelectItem>)}
            </SelectContent>
          </Select>
          {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
        </div>}
        {userId && <UserUsage key={userId} userId={userId} />}
      </div>
    </DashboardLayout>
  )
}
