import * as React from 'react';
import { Box, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type Operation = Awaited<ReturnType<typeof window.agentDesktop.getAppAuthoringOperations>>[number];
const terminal = new Set(['succeeded', 'failed', 'canceled', 'interrupted', 'closed']);
const names: Record<string, string> = { build: '构建', preview: '预览', test: '验证', release: '安装' };
const statuses: Record<string, string> = { queued: '排队中', running: '运行中', starting: '启动中', ready: '已打开', prepared: '待提交', committing: '安装中', succeeded: '已完成', failed: '失败', canceled: '已取消', interrupted: '已中断', closed: '已关闭' };

export function AppAuthoringOperations({ sessionId }: { sessionId?: string }) {
  const [items, setItems] = React.useState<Operation[]>([]);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let current = true;
    setItems([]); setError('');
    if (!sessionId) return;
    const refresh = () => { void window.agentDesktop.getAppAuthoringOperations?.(sessionId).then(value => { if (current) setItems(value); }).catch(e => { if (current) setError(e.message); }); };
    refresh();
    const off = window.agentDesktop.onAppAuthoringOperation?.(event => { if (event.sessionId === sessionId) refresh(); });
    const timer = window.setInterval(refresh, 5000);
    return () => { current = false; off?.(); window.clearInterval(timer); };
  }, [sessionId]);
  if (!items.length && !error) return null;
  const visible = items.filter(item => !terminal.has(item.status)).concat(items.filter(item => terminal.has(item.status)).slice(-3));
  const hasFailure = Boolean(error || visible.some(item => item.status === 'failed'));
  return (
    <Popover key={sessionId}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="查看 App 操作详情"
          title={hasFailure ? 'App 构建与调试 · 有操作失败' : 'App 构建与调试'}
          className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-card/95 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-accent-foreground">
          <span aria-hidden="true" className="relative size-5">
            <Box className="size-5" strokeWidth={1.7} />
            <Wrench className="absolute -bottom-0.5 -right-0.5 size-3 rounded-sm bg-card text-muted-foreground" strokeWidth={2} />
          </span>
          {hasFailure && <span role="status" className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-destructive"><span className="sr-only">有 App 操作失败</span></span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={6} aria-label="App 操作详情"
        className="max-h-[min(20rem,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto p-2 text-xs">
        <p className="px-2 py-1.5 font-medium text-muted-foreground">App 构建与调试</p>
        {visible.map(item => <div key={item.operationRef} className="flex items-start gap-2 px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <div className={item.status === 'failed' ? 'text-destructive' : undefined}>{names[item.kind] || item.kind} · {statuses[item.status] || item.status}</div>
            <div className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">{item.error || String(item.result?.version || item.result?.appId || '')}</div>
          </div>
          {!terminal.has(item.status) && item.status !== 'committing' && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => {
            void window.agentDesktop.cancelAppAuthoringOperation(sessionId!, item.operationRef).catch(e => setError(e.message));
          }}>{item.kind === 'preview' ? '关闭' : '取消'}</Button>}
        </div>)}
        {error && <div role="alert" className="break-words px-2 py-1.5 text-destructive">{error}</div>}
      </PopoverContent>
    </Popover>
  );
}
