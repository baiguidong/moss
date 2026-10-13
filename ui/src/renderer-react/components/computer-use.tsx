import * as React from 'react';
import { Monitor, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ComputerUseStatus } from '../types';

function useComputerUse() {
  const [status, setStatus] = React.useState<ComputerUseStatus | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    const api = window.agentDesktop?.computerUse;
    if (!api) return;
    let alive = true;
    void api.status().then(s => { if (alive) setStatus(s); }).catch(e => { if (alive) setError(e.message); });
    const off = api.onChanged(setStatus);
    return () => { alive = false; off(); };
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try { await action(); setStatus(await window.agentDesktop.computerUse.status()); }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)); }
  };
  return { status, error, run };
}

export function ComputerUseControl() {
  const { status, error, run } = useComputerUse();
  if (!status?.active && !status?.requests?.length) return null;
  const api = window.agentDesktop.computerUse;
  const request = status.requests?.[0];
  return <aside aria-label="电脑操控" className="fixed bottom-5 right-5 z-[100] w-80 rounded-2xl border bg-background p-4 shadow-xl">
    <div className="flex items-center gap-2 text-sm font-medium"><Monitor className="size-4" />{request ? '应用控制授权' : '正在控制应用'}</div>
    {request ? <>
      <p className="mt-3 text-sm">{request.foreground ? `允许本次任务将 ${request.app.name} 置于前台并操作键盘鼠标？` : `允许 Moss 读取并操作 ${request.app.name}？`}</p>
      <p className="mt-1 break-all text-xs text-muted-foreground">{request.app.bundleId} · {request.sessionTitle || '当前会话'}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{request.foreground ? '操作期间请暂时不要使用键盘和鼠标。' : '应用界面和截图可能发送给当前模型服务。'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void run(() => api.decide(request.id, 'session'))}>{request.foreground ? '允许本次运行' : '本次会话允许'}</Button>
        {!request.foreground && <Button variant="outline" size="sm" onClick={() => void run(() => api.decide(request.id, 'always'))}>始终允许</Button>}
        <Button variant="ghost" size="sm" onClick={() => void run(() => api.decide(request.id, 'deny'))}>拒绝</Button>
      </div>
    </> : <><p className="mt-2 text-sm">{status.active?.app?.name || '正在选择应用'} · {status.active?.foreground ? '允许前台' : '后台'}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{status.active?.title}</p></>}
    <Button className="mt-3 w-full" variant="outline" size="sm" onClick={() => void run(() => api.stop())}><Square className="mr-2 size-3" />停止控制</Button>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  </aside>;
}
