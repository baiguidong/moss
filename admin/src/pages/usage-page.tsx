import { DashboardLayout } from '@/components/dashboard-layout'
import { UserUsage } from '@/components/user-usage'
import { useAuth } from '@/lib/hooks/use-auth'

export default function UsagePage() {
  const { user } = useAuth()

  return (
    <DashboardLayout title="个人用量" description="查看当前用户的服务端累计 Token、请求次数与每日活动。">
      <div className="mx-auto max-w-[1440px] space-y-6">
        {user && <UserUsage key={user.id} userId={user.id} />}
      </div>
    </DashboardLayout>
  )
}
