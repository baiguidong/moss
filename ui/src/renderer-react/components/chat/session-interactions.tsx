import * as React from 'react';
import { Send } from 'lucide-react';
import { SessionDialog } from '../session-dialog';
import { MarkdownRenderer } from '../markdown/markdown-renderer';
import type { SessionInteraction } from '@/lib/session-interactions';

const labels: Record<string, string> = { accepted: '等待接收', consumed: '已加入上下文', running: '正在回答', completed: '已回答', truncated: '回答已截断', empty: '未收到回答', tool_unavailable: '请在主会话中处理', failed: '侧问失败', cancelled: '已取消', timeout: '侧问超时', unknown: '上次请求状态未确认，请核对记录' };

export function SessionInteractions({ sessionId, items, busy, onRestore }: { sessionId: string; items: SessionInteraction[]; busy: boolean; onRestore: (item: SessionInteraction) => void }) {
  const [restored, setRestored] = React.useState<Set<string>>(() => new Set());
  const pending = items.filter(item => ['running', 'accepted'].includes(item.status)).map(item => item.id).join(',');
  React.useEffect(() => {
    for (const id of pending.split(',').filter(Boolean)) void window.agentDesktop.sessionInteraction({ sessionId, action: 'inspect', id }).catch(() => {});
  }, [sessionId, pending, busy]);
  const visible = items.filter(item => item.kind === 'steer' && item.status !== 'consumed' && !restored.has(item.id));
  if (!visible.length) return null;
  return <div className="mb-2 max-h-32 space-y-1 overflow-y-auto" data-testid="session-interactions">
    {visible.map(item => <div key={item.id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span className="shrink-0">{item.status === 'accepted' && !busy ? '接收状态未确认' : labels[item.status] || item.status}</span>
      <span className="min-w-0 flex-1 truncate" title={item.prompt}>{item.prompt || `${item.details?.files?.length || 0} 个附件`}</span>
      {item.status === 'cancelled' && <button className="shrink-0 underline" onClick={() => { onRestore(item); setRestored(previous => new Set(previous).add(item.id)); }}>恢复草稿</button>}
    </div>)}
  </div>;
}

/** Kept mounted while closed so a side draft never replaces the main composer. */
export function SideQuestionPanel({ sessionId, items, open, onClose, onSend, readOnlyReason }: {
  sessionId: string; items: SessionInteraction[]; open: boolean; onClose: () => void;
  onSend: (prompt: string) => Promise<void>; readOnlyReason?: string | null;
}) {
  const [draft, setDraft] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
  const input = React.useRef<HTMLTextAreaElement>(null);
  const answerList = React.useRef<HTMLDivElement>(null);
  const lock = React.useRef(false);
  const draftRef = React.useRef(draft); draftRef.current = draft;
  const answers = items.filter(item => item.kind === 'side_question');
  const running = answers.some(item => item.status === 'running');
  React.useEffect(() => {
    if (open && answerList.current) answerList.current.scrollTop = answerList.current.scrollHeight;
  }, [open, answers.length, answers.at(-1)?.status]);
  const submit = async () => {
    const prompt = draft.trim();
    if (!prompt || lock.current || running || readOnlyReason) return;
    lock.current = true; setPending(true); setError('');
    const original = draft;
    try { await onSend(prompt); if (draftRef.current === original) setDraft(''); }
    catch (error) { setError(String((error as Error).message || error)); }
    finally { lock.current = false; setPending(false); }
  };
  if (!open) return null;
  return <SessionDialog title="侧问" closeLabel="收起侧问" onClose={onClose} className="flex h-[min(480px,60dvh)] flex-col">
    <div ref={answerList} className="min-h-0 flex-1 overflow-y-auto p-4">
      {!answers.length && <p className="text-sm text-muted-foreground">随时问问当前进展，主任务会继续进行。</p>}
      {answers.map((item, index) => <details key={item.id} open={item.status === 'running' || index === answers.length - 1} className="mb-3 rounded-lg border border-border/60 p-3 text-sm">
        <summary className="cursor-pointer break-words">{item.prompt}<span className="ml-2 text-xs text-muted-foreground">{labels[item.status] || item.status}</span></summary>
        {item.response && <div className="mt-3 min-w-0 border-t border-border/40 pt-3"><MarkdownRenderer content={item.response} sessionId={sessionId} /></div>}
        {item.error && <p className="mt-2 text-xs text-destructive">{item.error}</p>}
        {item.status === 'running' && <button type="button" className="mt-3 text-xs underline" onClick={() => {
          void window.agentDesktop.sessionInteraction({ sessionId, action: 'cancel_side', id: item.id }).catch(error => setError(String(error.message || error)));
        }}>取消侧问</button>}
      </details>)}
    </div>
    <form className="shrink-0 border-t border-border/60 p-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <textarea data-initial-focus ref={input} aria-label="侧问内容" placeholder="想了解什么？" value={draft} disabled={Boolean(readOnlyReason)} onChange={event => setDraft(event.target.value)}
        className="min-h-20 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">独立回答，不改变主任务</span>
        <button type="submit" aria-label="发送侧问" disabled={!draft.trim() || pending || running || Boolean(readOnlyReason)} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-40"><Send className="h-3.5 w-3.5" />发送</button>
      </div>
      {(error || readOnlyReason) && <p role="alert" className="mt-2 text-xs text-destructive">{error || readOnlyReason}</p>}
    </form>
  </SessionDialog>;
}
