'use client'

import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Settings,
  LogOut,
  Shield,
  Key,
} from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/hooks/use-auth'

const menuItems = [
  {
    title: '数据看板',
    url: '/',
    icon: LayoutDashboard,
  },
  {
    title: '用户管理',
    url: '/users',
    icon: Users,
  },
  {
    title: '会话管理',
    url: '/sessions',
    icon: MessageSquare,
  },
  {
    title: 'API Keys',
    url: '/api-keys',
    icon: Key,
  },
]

export function AppSidebar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="w-64 border-r bg-card flex flex-col h-full">
      {/* Header */}
      <div className="h-14 border-b px-4 flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Shield className="size-5" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">企业中控平台</span>
          <span className="text-xs text-muted-foreground">AI 管理系统</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <div className="mb-6">
          <p className="text-xs font-medium text-muted-foreground mb-2 px-3">主菜单</p>
          <ul className="space-y-1">
            {menuItems.map((item) => {
              const isActive =
                item.url === '/'
                  ? pathname === '/'
                  : pathname === item.url || pathname.startsWith(`${item.url}/`)
              return (
                <li key={item.title}>
                  <Link
                    to={item.url}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
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

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 px-3">系统</p>
          <ul className="space-y-1">
            <li>
              <button
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Settings className="size-4" />
                <span>系统设置</span>
              </button>
            </li>
          </ul>
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t p-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {user?.name?.slice(0, 1) || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name || 'User'}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email || ''}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void handleLogout()}
            className="shrink-0"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </aside>
  )
}
