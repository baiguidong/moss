import * as React from 'react';
import { AlertCircle, CheckCircle2, Clock3, Loader2, RefreshCw, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { operationDraftStateLabel, type OperationDraft, type OperationDraftPatch } from '@/lib/operation-drafts';

function time(value: number) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function targetLabel(target: Record<string, unknown>) {
  const labels: Record<string, string> = { id: '目标 ID', type: '类型', name: '名称', displayName: '名称', display: '名称', tenantId: '组织', accountId: '账号', email: '邮箱', channel: '频道', threadId: '会话' };
  const values = Object.entries(target).filter(([, value]) => value !== null && value !== undefined && String(value).trim());
  return values.length ? values.map(([key, value]) => `${labels[key] || key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(' · ') : '目标待解析';
}

function DraftCard({ draft, onUpdate, onConfirm, onCancel, onQuery }: {
  draft: OperationDraft;
  onUpdate: (payload: { draftId: string; expectedRevision: number; patch: OperationDraftPatch }) => Promise<OperationDraft>;
  onConfirm: (payload: { draftId: string; expectedRevision: number }) => Promise<OperationDraft>;
  onCancel: (payload: { draftId: string; expectedRevision: number }) => Promise<OperationDraft>;
  onQuery: (payload: { draftId: string }) => Promise<OperationDraft>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [content, setContent] = React.useState(draft.content);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => { setEditing(false); setContent(draft.content); setError(''); }, [draft.id, draft.revision, draft.content]);
  const execute = async () => { setBusy(true); setError(''); try { await onConfirm({ draftId: draft.id, expectedRevision: draft.revision }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const save = async () => { setBusy(true); setError(''); try { await onUpdate({ draftId: draft.id, expectedRevision: draft.revision, patch: { content } }); setEditing(false); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const state = draft.status;
  return <article className="rounded-lg border border-border/70 bg-card/80 p-4 " data-operation-draft={draft.id}>
    <div className="flex items-start gap-3">
      <span className={cn('mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', state === 'succeeded' ? 'bg-emerald-500/10 text-emerald-600' : state === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')}>
        {state === 'executing' ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'succeeded' ? <CheckCircle2 className="h-4 w-4" /> : state === 'failed' ? <AlertCircle className="h-4 w-4" /> : <Send className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium text-foreground">{draft.title}</h2><span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{operationDraftStateLabel(state)}</span></div>
        <p className="mt-1 text-xs text-muted-foreground">{draft.channel} · {draft.accountLabel || draft.accountId || '账号待确认'}{draft.accountLabel && draft.accountId ? `（${draft.accountId}）` : ''} · 版本 {draft.revision}</p>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{time(draft.updatedAt)}</span>
    </div>
    <div className="mt-4 space-y-3 pl-11 text-sm"><div><p className="text-[11px] text-muted-foreground">目标</p><p className="mt-1 break-words text-foreground">{targetLabel(draft.target)}</p>{editing && <p className="mt-1 text-xs text-muted-foreground">如需更换账号或目标，请在来源 App 重新生成草稿。</p>}</div>
      <div><p className="text-[11px] text-muted-foreground">内容</p>{editing ? <textarea value={content} onChange={e => setContent(e.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-input bg-background p-2 text-xs outline-none focus:ring-2 focus:ring-ring" /> : <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{draft.content}</p>}</div>
      {draft.attachments.length > 0 && <div><p className="text-[11px] text-muted-foreground">附件（{draft.attachments.length}）</p><ul className="mt-1 space-y-1">{draft.attachments.map((attachment, index) => <li key={index} className="break-all" title={attachment.uri}>{attachment.name || attachment.uri}</li>)}</ul></div>}
      {state === 'unknown' && <p className="text-xs text-muted-foreground">执行结果尚未确认。请查询结果或在来源系统核实，避免重复执行。</p>}
      {draft.resultRef && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">执行回执</summary><pre className="max-h-32 overflow-auto rounded-lg bg-muted/50 p-2 text-[11px] text-muted-foreground">{JSON.stringify(draft.resultRef, null, 2)}</pre></details>}
      {draft.error && <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{draft.error}</p>}{error && <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
    </div>
    {(editing || ['draft', 'ready', 'failed', 'unknown'].includes(state)) && <footer className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border/60 pt-3 pl-11">{editing ? <><Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>取消</Button><Button size="sm" disabled={busy || !content.trim()} onClick={() => void save()}>保存修改</Button></> : <>{state === 'unknown' && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setBusy(true); void onQuery({ draftId: draft.id }).catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)); }}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />查询结果</Button>}{['draft', 'ready', 'failed'].includes(state) && <><Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(true)}>修改</Button><Button size="sm" disabled={busy || !draft.actionRefs.execute || !draft.actionRefs.validateDraft || !draft.accountId || !Object.keys(draft.target).length} onClick={() => void execute()}>{busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}确认执行</Button></>}{['draft', 'ready', 'failed'].includes(state) && <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setBusy(true); void onCancel({ draftId: draft.id, expectedRevision: draft.revision }).catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)); }}><X className="mr-1.5 h-3.5 w-3.5" />取消草稿</Button>}</>}</footer>}
  </article>;
}

export function OperationDraftPanel({ selectedDraftId }: { selectedDraftId?: string | null }) {
  const [drafts, setDrafts] = React.useState<OperationDraft[]>([]);
  const panelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!selectedDraftId || !panelRef.current) return;
    Array.from(panelRef.current.querySelectorAll<HTMLElement>('[data-operation-draft]')).find(node => node.dataset.operationDraft === selectedDraftId)?.scrollIntoView({ block: 'center' });
  }, [selectedDraftId, drafts.length]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const refresh = React.useCallback(() => { setLoading(true); void window.agentDesktop.operationDrafts.list().then(value => { setDrafts(value); setError(''); }).catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false)); }, []);
  React.useEffect(() => { refresh(); const off = window.agentDesktop.operationDrafts.onChanged(refresh); const timer = window.setInterval(refresh, 30_000); return () => { off(); window.clearInterval(timer); }; }, [refresh]);
  const call = React.useCallback(async (name: 'update' | 'confirm' | 'cancel' | 'queryResult', payload: any) => {
    const fn = window.agentDesktop.operationDrafts[name] as (input: any) => Promise<OperationDraft>;
    const result = await fn(payload); setDrafts(current => current.map(item => item.id === result.id ? result : item)); return result;
  }, []);
  return <div className="flex h-full min-h-0 flex-col bg-background" data-operation-draft-panel ref={panelRef}><header className="shrink-0 border-b border-border/70 bg-background/88 px-4 py-4 backdrop-blur sm:px-6"><div className="mx-auto max-w-[980px]"><h1 className="text-sm font-semibold text-foreground">业务操作草稿</h1><p className="mt-1 text-xs text-muted-foreground">先核对账号和目标，再执行外部操作。草稿由 App 提供数据和执行能力。</p></div></header><div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6"><div className="mx-auto max-w-[980px] space-y-3">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{loading && !drafts.length ? <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p> : drafts.length ? drafts.map(draft => <DraftCard key={draft.id} draft={draft} onUpdate={payload => call('update', payload)} onConfirm={payload => call('confirm', payload)} onCancel={payload => call('cancel', payload)} onQuery={payload => call('queryResult', payload)} />) : <div className="rounded-lg border border-dashed border-border/70 px-5 py-12 text-center text-sm text-muted-foreground">暂无业务操作草稿<div className="mt-1 text-xs text-muted-foreground/70">当 App 需要发送消息或修改业务记录时，草稿会出现在这里</div></div>}</div></div></div>;
}
