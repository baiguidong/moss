'use client'

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { login, isAuthenticated, isLoading: isCheckingAuth } = useAuth()

  useEffect(() => {
    if (!isCheckingAuth && isAuthenticated) {
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, isCheckingAuth, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      await login(username, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isCheckingAuth && isAuthenticated) {
    return null
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f8f3] px-5 py-6 text-[#263c30] md:px-10">
      <div className="flex min-h-[calc(100vh-48px)] w-full max-w-[1160px] flex-col">
        <header className="flex items-center gap-2.5 py-2 text-[21px] font-semibold tracking-[0.12em]">
          <img src={`${import.meta.env.BASE_URL}moss-m-icon.png`} alt="Moss" className="size-[30px] rounded-lg" />
          <span>moss</span>
          <span className="ml-2 border-l border-[#dde5dc] pl-4 text-xs font-normal tracking-[0.08em] text-[#687b6d]">控制平面</span>
        </header>
        <div className="grid flex-1 items-center gap-16 py-6 lg:grid-cols-[1fr_410px]">
          <div className="hidden pb-6 lg:block">
            <p className="flex items-center gap-2 text-xs font-medium tracking-[0.12em] text-[#347650]"><span className="size-1.5 rounded-full bg-[#347650]" />安全、清晰、可控</p>
            <h1 className="mt-6 text-5xl font-semibold leading-[1.35] tracking-[-0.04em]">管理你的<br /><span className="text-[#347650]">企业工作空间</span></h1>
            <p className="mt-5 max-w-[340px] text-[15px] leading-[1.95] text-[#687b6d]">统一管理组织成员、角色权限和工作电脑，让每一次协作都更稳定。</p>
            <div className="mt-8 flex flex-wrap gap-5 text-xs text-[#687b6d]"><span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4" />企业权限隔离</span><span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4" />设备状态可见</span></div>
          </div>
      <Card className="w-full overflow-hidden rounded-3xl border-[#dde5dc] bg-white shadow-[0_16px_56px_rgba(25,53,34,0.08),0_2px_8px_rgba(25,53,34,0.02)]">
        <CardHeader className="space-y-5 px-8 pb-5 pt-9 text-center">
          <div className="mx-auto mb-1 grid size-10 place-items-center rounded-[14px] bg-[#edf4eb] text-[#347650]">
            <img src={`${import.meta.env.BASE_URL}moss-m-icon.png`} alt="" className="size-7 rounded-lg" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-[23px] font-semibold tracking-tight text-[#263c30]">欢迎登录</CardTitle>
            <CardDescription className="text-[13px] leading-6 text-[#687b6d]">登录 Moss 控制平面，继续管理组织与设备</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-8 pb-9">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2.5">
              <Label className="text-xs font-medium text-[#263c30]" htmlFor="username">用户名或邮箱</Label>
              <Input
                id="username"
                type="text"
                className="h-[46px] rounded-[10px] border-[#dde5dc] bg-[#f6f8f3] px-3.5 text-[#263c30] focus-visible:border-[#347650] focus-visible:ring-[#347650]/15"
                placeholder="输入用户名或邮箱"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2.5">
              <Label className="text-xs font-medium text-[#263c30]" htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                className="h-[46px] rounded-[10px] border-[#dde5dc] bg-[#f6f8f3] px-3.5 text-[#263c30] focus-visible:border-[#347650] focus-visible:ring-[#347650]/15"
                placeholder="输入登录密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="mt-1 h-11 w-full rounded-[10px] bg-[#347650] text-sm font-medium text-white shadow-none hover:bg-[#2f6948]" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
              <span>进入控制台</span>
              {!isLoading && <ArrowRight className="size-4" />}
            </Button>
            <p className="text-center text-[11px] leading-5 text-[#687b6d]">
              登录即表示你已获组织管理员授权，并同意使用 Moss 企业工作空间服务。
            </p>
          </form>
        </CardContent>
      </Card>
        </div>
        <p className="py-2 text-center text-[11px] tracking-[0.05em] text-[#687b6d]">Moss 控制平面 · 企业工作空间</p>
      </div>
    </div>
  )
}
