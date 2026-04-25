'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { getUsers, createUser, resetPassword, getApiKeys } from '@/lib/api/auth'
import { getUserSessions } from '@/lib/api/sessions'
import type { AuthUser, ApiKey, Session } from '@/lib/api/types'
import {
  Plus,
  Search,
  MoreHorizontal,
  UserCheck,
  UserX,
  Loader2,
  Key,
  MessageSquare,
  ExternalLink,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'

const userSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  name: z.string().min(2, '用户名至少2个字符'),
  password: z.string().min(6, '密码至少6个字符'),
  role: z.enum(['admin', 'viewer', 'member']),
})

type UserFormData = z.infer<typeof userSchema>

const roleLabels: Record<string, string> = {
  admin: '管理员',
  viewer: '访客',
  member: '用户',
}

const scopeLabels: Record<string, string> = {
  '*': '全部权限',
  'sessions:create': '创建会话',
  'sessions:attach': '接入会话',
  'sessions:list': '列出会话',
  'sessions:list:any': '查看所有会话',
  'sessions:attach:any': '接入任何会话',
  'admin:users': '管理用户',
  'admin:api_keys': '管理 API Keys',
}

function UserSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-24" />
        </div>
      ))}
    </div>
  )
}

export default function UsersPage() {
  const [users, setUsers] = useState<AuthUser[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedUser, setSelectedUser] = useState<AuthUser | null>(null)
  const [userSessions, setUserSessions] = useState<Session[]>([])
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [activeTab, setActiveTab] = useState('users')

  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      email: '',
      name: '',
      password: '',
      role: 'member',
    },
  })

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [usersRes, apiKeysRes] = await Promise.all([getUsers(), getApiKeys()])
      setUsers(usersRes.users)
      setApiKeys(apiKeysRes.api_keys)
    } catch (error) {
      console.error('Failed to fetch data:', error)
      toast.error('获取数据失败')
    } finally {
      setIsLoading(false)
    }
  }

  const fetchUserSessions = async (userId: string) => {
    setIsLoadingSessions(true)
    try {
      const response = await getUserSessions(userId)
      setUserSessions(response.sessions)
    } catch (error) {
      console.error('Failed to fetch user sessions:', error)
      toast.error('获取用户会话失败')
    } finally {
      setIsLoadingSessions(false)
    }
  }

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesRole = roleFilter === 'all' || user.role === roleFilter
    return matchesSearch && matchesRole
  })

  const filteredApiKeys = apiKeys.filter((key) => {
    const user = users.find((u) => u.id === key.userId)
    return (
      key.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      key.prefix.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user?.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })

  const handleSubmit = async (data: UserFormData) => {
    setIsSubmitting(true)
    try {
      await createUser(data)
      toast.success('用户创建成功')
      setIsDialogOpen(false)
      form.reset()
      fetchData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建用户失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResetPassword = async (userId: string) => {
    const newPassword = prompt('请输入新密码（至少6位）:')
    if (!newPassword || newPassword.length < 6) {
      toast.error('密码长度不足')
      return
    }
    try {
      await resetPassword(userId, newPassword)
      toast.success('密码重置成功')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重置密码失败')
    }
  }

  const handleViewUser = async (user: AuthUser) => {
    setSelectedUser(user)
    await fetchUserSessions(user.id)
  }

  const getUserApiKeys = (userId: string) => {
    return apiKeys.filter((k) => k.userId === userId)
  }

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'admin':
        return 'default'
      case 'viewer':
        return 'outline'
      default:
        return 'secondary'
    }
  }

  if (isLoading) {
    return (
      <DashboardLayout title="用户管理">
        <div className="space-y-6">
          <UserSkeleton />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout title="用户管理">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between mb-6">
          <TabsList>
            <TabsTrigger value="users">用户</TabsTrigger>
            <TabsTrigger value="api-keys">
              API Keys
              <Badge variant="secondary" className="ml-2">
                {apiKeys.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
          {activeTab === 'users' && (
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="size-4 mr-2" />
              新建用户
            </Button>
          )}
        </div>

        <TabsContent value="users" className="space-y-6">
          {/* Filters */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="搜索用户名或邮箱..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="筛选角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部角色</SelectItem>
                <SelectItem value="admin">管理员</SelectItem>
                <SelectItem value="viewer">访客</SelectItem>
                <SelectItem value="member">用户</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Users Table */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户名</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>API Keys</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最后登录</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => {
                  const userKeys = getUserApiKeys(user.id)
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        <Button variant="link" className="p-0 h-auto" onClick={() => handleViewUser(user)}>
                          {user.name}
                        </Button>
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(user.role)}>
                          {roleLabels[user.role] || user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {userKeys.length > 0 ? (
                          <div className="flex gap-1">
                            {userKeys.slice(0, 2).map((key) => (
                              <Badge key={key.id} variant="secondary" className="text-xs">
                                {key.name}
                              </Badge>
                            ))}
                            {userKeys.length > 2 && (
                              <Badge variant="outline" className="text-xs">
                                +{userKeys.length - 2}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">无</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.status === 'active' ? 'default' : 'secondary'}>
                          {user.status === 'active' ? '启用' : '禁用'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleString('zh-CN')
                          : '从未登录'}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleViewUser(user)}>
                              <MessageSquare className="size-4 mr-2" />
                              查看会话
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleResetPassword(user.id)}>
                              <UserX className="size-4 mr-2" />
                              重置密码
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {filteredUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      没有找到匹配的用户
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="api-keys" className="space-y-4">
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>Key 前缀</TableHead>
                  <TableHead>所属用户</TableHead>
                  <TableHead>权限范围</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredApiKeys.map((key) => {
                  const keyUser = users.find((u) => u.id === key.userId)
                  return (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell>
                        <code className="text-sm bg-muted px-2 py-1 rounded">{key.prefix}...</code>
                      </TableCell>
                      <TableCell>{keyUser?.name || '-'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {key.scopes.slice(0, 2).map((scope) => (
                            <Badge key={scope} variant="secondary" className="text-xs">
                              {scopeLabels[scope] || scope}
                            </Badge>
                          ))}
                          {key.scopes.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{key.scopes.length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={key.status === 'active' ? 'default' : 'secondary'}>
                          {key.status === 'active' ? '启用' : '已撤销'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(key.createdAt).toLocaleDateString('zh-CN')}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {filteredApiKeys.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      没有找到匹配的 API Key
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Create User Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建用户</DialogTitle>
            <DialogDescription>创建新的用户账号</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>邮箱</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="user@example.com" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>用户名</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="请输入用户名" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>密码</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" placeholder="请输入密码" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>角色</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择角色" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="admin">管理员</SelectItem>
                        <SelectItem value="member">用户</SelectItem>
                        <SelectItem value="viewer">访客</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                  创建
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* User Detail Sheet */}
      <Sheet open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
        <SheetContent className="sm:max-w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>用户详情</SheetTitle>
            <SheetDescription>
              {selectedUser?.name} - {selectedUser?.email}
            </SheetDescription>
          </SheetHeader>
          {selectedUser && (
            <div className="mt-6 space-y-6">
              {/* User Info */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">基本信息</h3>
                <div className="grid gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">用户 ID</span>
                    <code className="text-xs">{selectedUser.id}</code>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">角色</span>
                    <Badge variant={getRoleBadgeVariant(selectedUser.role)}>
                      {roleLabels[selectedUser.role] || selectedUser.role}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">状态</span>
                    <Badge variant={selectedUser.status === 'active' ? 'default' : 'secondary'}>
                      {selectedUser.status === 'active' ? '启用' : '禁用'}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">创建时间</span>
                    <span>{new Date(selectedUser.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">最后登录</span>
                    <span>
                      {selectedUser.lastLoginAt
                        ? new Date(selectedUser.lastLoginAt).toLocaleString('zh-CN')
                        : '从未登录'}
                    </span>
                  </div>
                </div>
              </div>

              {/* User API Keys */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Key className="size-4" />
                  API Keys ({getUserApiKeys(selectedUser.id).length})
                </h3>
                {getUserApiKeys(selectedUser.id).length > 0 ? (
                  <div className="space-y-2">
                    {getUserApiKeys(selectedUser.id).map((key) => (
                      <div key={key.id} className="p-3 rounded-lg border">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{key.name}</span>
                          <Badge variant={key.status === 'active' ? 'default' : 'secondary'}>
                            {key.status === 'active' ? '启用' : '已撤销'}
                          </Badge>
                        </div>
                        <code className="text-xs text-muted-foreground">{key.prefix}...</code>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {key.scopes.map((scope) => (
                            <Badge key={scope} variant="secondary" className="text-xs">
                              {scopeLabels[scope] || scope}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">暂无 API Key</p>
                )}
              </div>

              {/* User Sessions */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="size-4" />
                  会话 ({userSessions.length})
                </h3>
                {isLoadingSessions ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                ) : userSessions.length > 0 ? (
                  <div className="space-y-2">
                    {userSessions.slice(0, 10).map((session) => (
                      <div
                        key={session.sessionId}
                        className="p-3 rounded-lg border flex items-center justify-between"
                      >
                        <div className="flex flex-col gap-1">
                          <code className="text-xs">{session.sessionId.slice(0, 16)}...</code>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary" className="text-xs">
                              {session.runtime.type}
                            </Badge>
                            <span>{new Date(session.createdAt).toLocaleDateString('zh-CN')}</span>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/sessions/${session.sessionId}`}>
                            <ExternalLink className="size-3" />
                          </Link>
                        </Button>
                      </div>
                    ))}
                    {userSessions.length > 10 && (
                      <p className="text-xs text-muted-foreground text-center">
                        还有 {userSessions.length - 10} 个会话...
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">暂无会话记录</p>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  )
}
