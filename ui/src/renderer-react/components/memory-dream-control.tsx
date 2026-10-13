import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import type { MemoryDreamStatus } from '../types';

export function MemoryDreamControl({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = React.useState<MemoryDreamStatus>({ phase: 'idle', message: '', result: null });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
  const busy = status.phase === 'running' || status.phase === 'stopping';

  React.useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await window.agentDesktop.memory.dreamStatus();
        if (!disposed) setStatus(next);
      } catch (cause) {
        if (!disposed) setError(cleanIpcErrorMessage(cause));
      }
      if (!disposed) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);

  const act = async (stop: boolean) => {
    setPending(true);
    setError('');
    try {
      const memory = window.agentDesktop.memory;
      setStatus(await (stop ? memory.stopDream() : memory.startDream()));
    } catch (cause) {
      setError(cleanIpcErrorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="outline" disabled={pending || busy || !enabled} onClick={() => void act(false)}>
        {busy ? '正在整理…' : '立即整理记忆'}
      </Button>
      {busy && <Button size="sm" variant="ghost" disabled={pending || status.phase === 'stopping'} onClick={() => void act(true)}>停止整理</Button>}
      <span className="text-xs text-muted-foreground" role="status">{status.message}</span>
    </div>
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    {status.result && <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">查看整理结果</summary>
      <p className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap leading-6">{status.result.summary}</p>
    </details>}
  </div>;
}
