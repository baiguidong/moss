import * as React from 'react';
import { Copy, X, LocateFixed, RefreshCw } from 'lucide-react';
import { contextEntryText, type CompactionRecord } from '@/lib/compaction';
import { Button } from '@/components/ui/button';
import { copyToClipboard } from './clipboard';

export function CompactionMarker({ record, content, onInspect }: {
  record?: CompactionRecord; content: string; onInspect?: (record: CompactionRecord) => void;
}) {
  return <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground" data-compaction-id={record?.id}>
    <span className="h-px flex-1 bg-border" />
    <span>{record && `第 ${record.number} 次压缩 · `}{content}</span>
    {record && onInspect && <button type="button" onClick={() => onInspect(record)} className="shrink-0 text-primary hover:underline">查看详情</button>}
    <span className="h-px flex-1 bg-border" />
  </div>;
}

export function CompactionDetails({ record, sessionId, onClose, onLocate }: {
  record: CompactionRecord; sessionId?: string; onClose: () => void; onLocate: () => void;
}) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const [tab, setTab] = React.useState<'result' | 'request'>('result');
  const [request, setRequest] = React.useState<Awaited<ReturnType<Window['agentDesktop']['getCompactionRequest']>>>();
  const [refresh, setRefresh] = React.useState(0);
  React.useEffect(() => { dialog.current?.showModal(); }, []);
  React.useEffect(() => {
    if (tab !== 'request') return;
    let cancelled = false;
    setRequest(undefined);
    if (!sessionId) setRequest({ request: null, reason: '未记录。' });
    else void window.agentDesktop.getCompactionRequest({ sessionId, boundaryId: record.id }).then(result => {
      if (!cancelled) setRequest(result);
    }).catch(error => { if (!cancelled) setRequest({ request: null, reason: String(error.message || error) }); });
    return () => { cancelled = true; };
  }, [record.id, sessionId, tab, refresh]);
  const labels = { summary: '压缩摘要', preserved: '保留的原消息', attachment: '补充上下文', hook: 'Hook 补充上下文' };
  const summaries = record.entries.filter(entry => entry.kind === 'summary');
  return <dialog ref={dialog} onCancel={onClose} onClose={onClose} aria-label={`第 ${record.number} 次压缩详情`}
    className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-[min(520px,100vw)] max-w-none border-l border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/15">
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <div className="flex-1"><div className="font-medium">第 {record.number} 次压缩</div><div className="mt-1 text-xs text-muted-foreground">{record.trigger === 'auto' ? '自动压缩' : record.trigger === 'manual' ? '手动压缩' : '上下文压缩'}{Number.isFinite(record.preTokens) ? ` · 压缩前约 ${record.preTokens!.toLocaleString()} tokens` : ''}</div></div>
        <Button variant="ghost" size="icon" aria-label="跳转到压缩位置" onClick={() => { onLocate(); onClose(); }}><LocateFixed className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" aria-label="关闭压缩详情" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="flex gap-2 border-b border-border p-3">
        <Button variant={tab === 'result' ? 'secondary' : 'ghost'} aria-pressed={tab === 'result'} onClick={() => setTab('result')}>压缩结果</Button>
        <Button variant={tab === 'request' ? 'secondary' : 'ghost'} aria-pressed={tab === 'request'} onClick={() => setTab('request')}>实际模型输入</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
        {tab === 'result' ? <>
          <p className="mb-4 text-xs text-muted-foreground">当时保存的摘要与保留内容；压缩后首次请求见「实际模型输入」。</p>
          {!summaries.length && <p className="mb-4 text-muted-foreground">此压缩记录未保存摘要。</p>}
          {!record.complete && <p className="mb-4 text-xs text-muted-foreground">旧记录未保存完整的压缩结果。</p>}
          {record.entries.map((entry, index) => <details key={`${entry.id}:${index}`} open={entry.kind === 'summary'} className="mb-3 rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-xs font-medium">{labels[entry.kind]} · {entry.role}</summary>
            <div className="my-2 flex justify-end"><Button variant="ghost" size="sm" onClick={() => void copyToClipboard(contextEntryText(entry.content))}><Copy className="mr-1 h-3 w-3" />复制</Button></div>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{contextEntryText(entry.content)}</pre>
          </details>)}
        </> : <>
          <div className="mb-3 flex items-center justify-between"><span className="text-xs text-muted-foreground">压缩后首次继续对话的请求</span><Button variant="ghost" size="sm" onClick={() => setRefresh(value => value + 1)}><RefreshCw className="mr-1 h-3 w-3" />刷新</Button></div>
          {!request ? <p role="status">正在读取…</p> : !request.request ? <p>{request.reason || '未记录。'}</p> : <>
            <p className="mb-2 text-xs text-muted-foreground">{request.request.model} · {request.request.startedAt}</p>
            <p className="mb-3 text-xs text-muted-foreground">已省略敏感字段与图片二进制。{request.request.truncated ? '此记录已截断。' : ''}</p>
            <Button variant="outline" size="sm" className="mb-3" onClick={() => void copyToClipboard(contextEntryText(request.request!.content))}><Copy className="mr-1 h-3 w-3" />复制请求</Button>
            <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">{contextEntryText(request.request.content)}</pre>
          </>}
        </>}
      </div>
    </div>
  </dialog>;
}
