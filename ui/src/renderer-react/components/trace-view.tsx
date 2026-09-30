import * as React from 'react'
import { useEffect, useState } from 'react'
import { ArrowLeft, Monitor, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TraceTargetContext } from '@/components/trace/TraceTarget'
import { TraceList } from '@/components/trace/TraceList'
import { TraceSession } from '@/components/trace/TraceSession'
import type { TraceTarget } from '@/lib/trace/api'

export function TraceView({ initialSessionId, initialTarget = 'local', onBack }: {
  initialSessionId?: string; initialTarget?: TraceTarget; onBack?: () => void
}) {
  const [target, setTarget] = useState<TraceTarget>(initialTarget)
  const [sessionId, setSessionId] = useState(initialSessionId)
  useEffect(() => { setTarget(initialTarget); setSessionId(initialSessionId) }, [initialSessionId, initialTarget])
  return <TraceTargetContext.Provider value={target}>
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground" data-testid="trace-view">
      <div className="flex shrink-0 items-center gap-2 border-b px-6 py-3">
        {onBack && <Button type="button" variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-4" />返回</Button>}
        <div role="group" aria-label="Trace 数据来源" className="flex gap-1 rounded-lg bg-muted p-1">
          {([{ value: 'local', label: '本地', icon: Monitor }, { value: 'remote', label: '服务器', icon: Server }] as const).map((item) =>
            <Button key={item.value} type="button" variant={target === item.value ? 'secondary' : 'ghost'} size="sm" aria-pressed={target === item.value}
              onClick={() => { setTarget(item.value); setSessionId(undefined) }}><item.icon className="size-3.5" />{item.label}</Button>)}
        </div>
      </div>
      {sessionId
        ? <TraceSession key={`${target}:${sessionId}`} sessionId={sessionId} onBack={() => setSessionId(undefined)} />
        : <TraceList key={target} onOpen={setSessionId} />}
    </div>
  </TraceTargetContext.Provider>
}
