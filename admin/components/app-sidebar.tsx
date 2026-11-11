'use client'

import type { ComponentType } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Laptop,
  Settings,
  LogOut,
  KeyRound,
} from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/hooks/use-auth'
import { hasAnyScope, hasScope } from '@/lib/api/client'

type NavItem = {
  title: string
  url: string
  icon: ComponentType<{ className?: string }>
  requiredScope?: string
  requiredAnyScopes?: string[]
}

const roleLabels: Record<string, string> = {
  admin: '管理员',
  dept_admin: '部门管理员',
  user: '普通用户',
}

const menuItems: NavItem[] = [
  {
    title: '工作台',
    url: '/',
    icon: LayoutDashboard,
  },
  {
    title: '用户与组织',
    url: '/users',
    icon: Users,
    requiredScope: 'admin:users',
  },
  {
    title: '工作电脑',
    url: '/computers',
    icon: Laptop,
    requiredAnyScopes: ['sessions:list', 'sessions:list:any'],
  },
]

const systemItems: NavItem[] = [
  {
    title: 'API Key 管理',
    url: '/api-keys',
    icon: KeyRound,
    requiredScope: 'admin:api_keys',
  },
  {
    title: '系统设置',
    url: '/settings',
    icon: Settings,
    requiredScope: 'admin:settings',
  },
]

export function AppSidebar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, scopes, logout } = useAuth()

  const visibleMenuItems = menuItems.filter((item) => {
    if ('requiredScope' in item && item.requiredScope) {
      return hasScope(scopes, item.requiredScope)
    }
    if ('requiredAnyScopes' in item && item.requiredAnyScopes) {
      return hasAnyScope(scopes, item.requiredAnyScopes)
    }
    return true
  })

  const visibleSystemItems = systemItems.filter((item) => {
    if ('requiredScope' in item && item.requiredScope) {
      return hasScope(scopes, item.requiredScope)
    }
    if ('requiredAnyScopes' in item && item.requiredAnyScopes) {
      return hasAnyScope(scopes, item.requiredAnyScopes)
    }
    return true
  })

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="flex h-full w-[248px] flex-col border-r border-border/70 bg-[var(--sidebar)]">
      {/* Header */}
      <div className="flex h-[68px] items-center gap-3 border-b border-border/70 px-4">
        <div className="flex size-9 items-center justify-center overflow-hidden rounded-xl bg-white shadow-[0_5px_14px_rgba(52,118,80,0.18)]">
          <img src={`${import.meta.env.BASE_URL}moss-m-icon.png`} alt="moss" className="size-9" />
        </div>
        <div className="min-w-0">
          <span className="block truncate text-[15px] font-semibold tracking-tight">moss</span>
          <span className="block text-[11px] text-muted-foreground">控制平面</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-5">
        <div className="mb-6">
          <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">工作区</p>
          <ul className="space-y-0.5">
            {visibleMenuItems.map((item) => {
              const isActive =
                item.url === '/'
                  ? pathname === '/'
                  : pathname === item.url || pathname.startsWith(`${item.url}/`)
              return (
                <li key={item.title}>
                  <Link
                    to={item.url}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>

        <div>
          <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">管理</p>
          <ul className="space-y-0.5">
            {visibleSystemItems.map((item) => {
              const isActive =
                item.url === '/settings'
                  ? pathname === item.url
                  : pathname === item.url || pathname.startsWith(`${item.url}/`)
              return (
                <li key={item.title}>
                  <Link
                    to={item.url}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-border/70 p-3">
        <div className="flex items-center gap-3">
          <Avatar className="size-9">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {user?.name?.slice(0, 1) || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium">{user?.name || 'User'}</p>
            <p className="truncate text-[11px] text-muted-foreground">{user?.role ? roleLabels[user.role] : '已登录'}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void handleLogout()}
            className="shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </aside>
  )
}
