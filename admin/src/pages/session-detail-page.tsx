'use client'

import { useCallback, useEffect, useState } from 'react'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getSession, resumeSession, terminateSession } from '@/lib/api/sessions'
import { getUsers } from '@/lib/api/auth'
import type { AuthUser, Session } from '@/lib/api/types'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Loader2, Play, Power, Clock, Container, Server } from 'lucide-react'
import { toast } from 'sonner'

const statusConfig: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  creating: { label: '创建中', variant: 'secondary' },
  active: { label: '运行中', variant: 'default' },
  detached: { label: '已断开', variant: 'outline' },
  ended: { label: '已结束', variant: 'secondary' },
  terminated: { label: '已终止', variant: 'destructive' },
  failed: { label: '失败', variant: 'destructive' },
  lost: { label: '丢失', variant: 'destructive' },
}

const lifecycleEvents = [
  { status: 'creating', label: '会话创建', description: '会话已创建，等待 runtime 启动' },
  { status: 'active', label: '运行时就绪', description: 'Runtime 已启动并可接受连接' },
  { status: 'detached', label: '已断开', description: '无活跃连接，runtime 仍在运行' },
  { status: 'ended', label: '正常结束', description: '会话正常结束' },
  { status: 'terminated', label: '已终止', description: '会话被强制终止' },
  { status: 'failed', label: '失败', description: '运行时启动失败' },
  { status: 'lost', label: '丢失', description: 'Runtime 无法访问' },
]

interface SessionDetailPageProps {
  sessionId: string
}

export function SessionDetailPage({ sessionId }: SessionDetailPageProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [users, setUsers] = useState<AuthUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isResuming, setIsResuming] = useState(false)
  const [isTerminating, setIsTerminating] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [sessionRes, usersRes] = await Promise.all([
        getSession(sessionId),
        getUsers().catch(() => ({ users: [] })),
      ])
      setSession(sessionRes.session)
      setUsers(usersRes.users)
    } catch (error) {
      console.error('Failed to fetch session:', error)
      toast.error('获取会话详情失败')
    } finally {
      setIsLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const handleResume = async () => {
    setIsResuming(true)
    try {
      const response = await resumeSession(sessionId)
      toast.success('会话已恢复')
      if (response.ws_url) {
        window.open(response.ws_url, '_blank', 'noopener,noreferrer')
      }
      await fetchData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '恢复会话失败')
    } finally {
      setIsResuming(false)
    }
  }

  const handleTerminate = async () => {
    if (!confirm('确定要终止这个会话吗？')) return
    setIsTerminating(true)
    try {
      await terminateSession(sessionId)
      toast.success('会话已终止')
      await fetchData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '终止会话失败')
    } finally {
      setIsTerminating(false)
    }
  }

  const getUserName = (userId: string) => {
    const user = users.find((u) => u.id === userId)
    return user?.name || userId.slice(0, 8)
  }

  if (isLoading) {
    return (
      <DashboardLayout title="会话详情">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    )
  }

  if (!session) {
    return (
      <DashboardLayout title="会话详情">
        <div className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground">会话不存在</p>
        </div>
      </DashboardLayout>
    )
  }

  const statusInfo = statusConfig[session.status] || {
    label: session.status,
    variant: 'outline' as const,
  }
  const canResume = ['ended', 'terminated', 'failed', 'lost'].includes(session.status)
  const canTerminate = ['active', 'creating', 'detached'].includes(session.status)
  const currentLifecycleIndex = lifecycleEvents.findIndex(event => event.status === session.status)

  return (
    <DashboardLayout title="会话详情" description={`Session ID: ${session.sessionId}`}>
      <div className="space-y-6">
        <div className="flex gap-2">
          {canResume && (
            <Button onClick={handleResume} disabled={isResuming}>
              {isResuming ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Play className="mr-2 size-4" />
              )}
              恢复会话
            </Button>
          )}
          {canTerminate && (
            <Button variant="destructive" onClick={handleTerminate} disabled={isTerminating}>
              {isTerminating ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Power className="mr-2 size-4" />
              )}
              终止会话
            </Button>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>会话信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {getUserName(session.userId).slice(0, 1)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">{getUserName(session.userId)}</p>
                  <p className="font-mono text-sm text-muted-foreground">
                    {session.userId.slice(0, 12)}...
                  </p>
                </div>
              </div>

              <div className="grid gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">状态</span>
                  <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">期望状态</span>
                  <Badge variant="outline">{session.desiredState}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">用户角色</span>
                  <span>{session.role}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">创建时间</span>
                  <span>{new Date(session.createdAt).toLocaleString('zh-CN')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">最后活跃</span>
                  <span>{new Date(session.lastActiveAt).toLocaleString('zh-CN')}</span>
                </div>
                {session.endedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">结束时间</span>
                    <span>{new Date(session.endedAt).toLocaleString('zh-CN')}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Container className="size-4" />
                Runtime
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">类型</span>
                  <Badge variant="secondary">{session.runtime.type}</Badge>
                </div>
                {session.runtime.dockerImage && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">镜像</span>
                    <span className="text-right font-mono text-xs">{session.runtime.dockerImage}</span>
                  </div>
                )}
                {session.runtime.dockerMode && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">模式</span>
                    <Badge variant="outline">{session.runtime.dockerMode}</Badge>
                  </div>
                )}
                {session.runtime.containerName && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">容器名</span>
                    <span className="text-right font-mono text-xs">
                      {session.runtime.containerName}
                    </span>
                  </div>
                )}
                {session.runtime.configDir && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">ConfigDir</span>
                    <span className="max-w-[180px] truncate text-right font-mono text-xs" title={session.runtime.configDir}>
                      {session.runtime.configDir}
                    </span>
                  </div>
                )}
                {(session.workDir || session.cwd) && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">工作目录</span>
                    <span className="max-w-[180px] truncate text-right font-mono text-xs" title={session.workDir || session.cwd}>
                      {session.workDir || session.cwd}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="size-4" />
                标识
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground">Transcript Session ID</p>
                <p className="break-all font-mono text-xs">{session.transcriptSessionId}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Org ID</p>
                <p className="break-all font-mono text-xs">{session.orgId}</p>
              </div>
              {session.assistantName && (
                <div>
                  <p className="text-muted-foreground">Assistant</p>
                  <p className="font-medium">{session.assistantName}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4" />
              会话生命周期
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lifecycleEvents.map((event, index) => {
                const isCurrent = event.status === session.status
                const isPast = currentLifecycleIndex >= 0 && index < currentLifecycleIndex
                return (
                  <div
                    key={event.status}
                    className={`rounded-lg border p-3 ${
                      isCurrent ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{event.label}</p>
                        <p className="text-sm text-muted-foreground">{event.description}</p>
                      </div>
                      {(isCurrent || isPast) && (
                        <Badge variant={isCurrent ? 'default' : 'secondary'}>
                          {isCurrent ? '当前' : '已过'}
                        </Badge>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
