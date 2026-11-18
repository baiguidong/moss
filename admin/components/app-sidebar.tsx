'use client'

import type { ComponentType } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Laptop,
  Settings,
  Puzzle,
  LogOut,
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
    title: '技能与专家',
    url: '/managed-resources',
    icon: Puzzle,
    requiredScope: 'admin:settings',
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
    <aside className="flex h-full w-14 shrink-0 flex-col md:w-[248px] border-r border-border/70 bg-[var(--sidebar)]">
      {/* Header */}
      <div className="flex h-14 items-center justify-center gap-3 border-b border-border/70 md:h-[68px] md:justify-start md:px-4">
        <div className="flex size-9 items-center justify-center overflow-hidden rounded-xl bg-white shadow-[0_5px_14px_rgba(52,118,80,0.18)]">
          <img src={`${import.meta.env.BASE_URL}moss-m-icon.png`} alt="moss" className="size-9" />
        </div>
        <div className="hidden min-w-0 md:block">
          <span className="block truncate text-[15px] font-semibold tracking-tight">moss</span>
          <span className="block text-[11px] text-muted-foreground">控制平面</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-1.5 py-3 md:px-3 md:py-5">
        <div className="mb-3 md:mb-6">
          <p className="mb-2 hidden px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80 md:block">工作区</p>
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
                    aria-label={item.title}
                    title={item.title}
                    className={`flex items-center justify-center gap-3 rounded-lg py-2.5 text-sm md:justify-start md:px-3 transition-colors ${
                      isActive
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <item.icon className="size-4" />
                    <span className="hidden md:inline">{item.title}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>

        <div>
          <p className="mb-2 hidden px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80 md:block">管理</p>
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
                    aria-label={item.title}
                    title={item.title}
                    className={`flex items-center justify-center gap-3 rounded-lg py-2.5 text-sm md:justify-start md:px-3 transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <item.icon className="size-4" />
                    <span className="hidden md:inline">{item.title}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-border/70 p-1.5 md:p-3">
        <div className="flex items-center justify-center gap-3 md:justify-start">
          <Avatar className="hidden size-9 md:flex">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {user?.name?.slice(0, 1) || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="hidden min-w-0 flex-1 md:block">
            <p className="truncate text-sm font-medium">{user?.name || 'User'}</p>
            <p className="truncate text-[11px] text-muted-foreground">{user?.role ? roleLabels[user.role] : '已登录'}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="退出登录"
            title="退出登录"
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
