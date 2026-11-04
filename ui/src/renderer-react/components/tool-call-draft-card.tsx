import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { operationDraftStateLabel, type OperationDraft } from '@/lib/operation-drafts';

const fieldClass = 'w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring';
const format = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

/** Schema titles/descriptions only: Core does not infer business fields from tool names. */
function ArgumentsEditor({ draft, value, onChange, onValidChange }: { draft: OperationDraft; value: string; onChange(value: string): void; onValidChange(valid: boolean): void }) {
  const [raw, setRaw] = React.useState(false);
  const [invalid, setInvalid] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => onValidChange(!Object.values(invalid).some(Boolean)), [invalid, onValidChange]);
  let args: Record<string, unknown>;
  try { args = JSON.parse(value); if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(); }
  catch { return <textarea aria-label="工具参数 JSON" className={`${fieldClass} min-h-48 font-mono text-xs`} value={value} onChange={e => onChange(e.target.value)} />; }
  const properties = draft.toolCall!.schema.properties || {};
  const keys = [...new Set([...Object.keys(args), ...Object.keys(properties)])];
  const update = (key: string, next: unknown) => onChange(JSON.stringify({ ...args, [key]: next }, null, 2));
  return <div className="space-y-3">
    <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">按工具定义修改参数</span><button type="button" className="text-xs text-muted-foreground underline underline-offset-4" onClick={() => { setRaw(!raw); setInvalid({}); }}>{raw ? '表单编辑' : 'JSON 编辑'}</button></div>
    {raw ? <textarea aria-label="工具参数 JSON" className={`${fieldClass} min-h-48 font-mono text-xs`} value={value} onChange={e => onChange(e.target.value)} /> : keys.map(key => {
      const schema = properties[key] || {}, current = args[key], required = draft.toolCall!.schema.required?.includes(key);
      const label = schema.title || key;
      return <div key={key} className="space-y-1.5"><div className="flex items-center justify-between"><label className="text-xs font-medium" htmlFor={`${draft.id}-${key}`}>{label}{required ? ' *' : ''}</label>{!required && Object.hasOwn(args, key) && <button className="text-xs text-muted-foreground" type="button" onClick={() => { const next = { ...args }; delete next[key]; setInvalid(previous => ({ ...previous, [key]: false })); onChange(JSON.stringify(next, null, 2)); }}>移除此参数</button>}</div>
        {schema.description && <p className="text-xs leading-5 text-muted-foreground">{schema.description}</p>}
        {schema.enum ? <select id={`${draft.id}-${key}`} className={fieldClass} value={JSON.stringify(current) ?? ''} onChange={e => { if (e.target.value) update(key, JSON.parse(e.target.value)); }}><option value="">未设置</option>{schema.enum.map((item: unknown) => <option key={JSON.stringify(item)} value={JSON.stringify(item)}>{format(item)}</option>)}</select>
          : schema.type === 'boolean' ? <select id={`${draft.id}-${key}`} className={fieldClass} value={current === undefined ? '' : String(current)} onChange={e => { if (e.target.value) update(key, e.target.value === 'true'); }}><option value="">未设置</option><option value="true">是</option><option value="false">否</option></select>
          : schema.type === 'string' || typeof current === 'string' ? <textarea id={`${draft.id}-${key}`} className={`${fieldClass} min-h-20 resize-y`} value={String(current ?? '')} onChange={e => update(key, e.target.value)} />
          : <JsonField key={`${draft.id}-${draft.revision}-${key}-${current === undefined}`} id={`${draft.id}-${key}`} value={current} onInvalid={value => setInvalid(previous => ({ ...previous, [key]: value }))} onChange={next => update(key, next)} />}
      </div>;
    })}
  </div>;
}

function JsonField({ id, value, onChange, onInvalid }: { id: string; value: unknown; onChange(value: unknown): void; onInvalid(invalid: boolean): void }) {
  const [text, setText] = React.useState(value === undefined ? '' : JSON.stringify(value, null, 2));
  const [error, setError] = React.useState('');
  return <><textarea id={id} className={`${fieldClass} min-h-20 font-mono text-xs`} placeholder="JSON 值" value={text} onChange={event => {
    setText(event.target.value);
    try { const next = JSON.parse(event.target.value); setError(''); onInvalid(false); onChange(next); } catch { onInvalid(true); setError('请输入有效的 JSON；也可切换到 JSON 编辑。'); }
  }} />{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</>;
}

export function ToolCallDraftCard({ draft: incoming }: { draft: OperationDraft }) {
  const [draft, setDraft] = React.useState(incoming);
  const [editing, setEditing] = React.useState(false), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [args, setArgs] = React.useState(JSON.stringify(incoming.toolCall!.arguments, null, 2));
  const [valid, setValid] = React.useState(true);
  React.useEffect(() => { setDraft(incoming); setArgs(JSON.stringify(incoming.toolCall!.arguments, null, 2)); setEditing(false); }, [incoming.id, incoming.revision]);
  async function action(name: 'update' | 'confirm' | 'cancel') {
    setBusy(true); setError('');
    try {
      const result = await window.agentDesktop.operationDrafts[name]({ draftId: draft.id, expectedRevision: draft.revision,
        ...(name === 'update' ? { patch: { arguments: JSON.parse(args) } } : {}) } as any);
      setDraft(result); setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <article data-operation-draft={draft.id} className="rounded-lg border border-border bg-background p-4 text-sm">
    <header className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{draft.title}</h3><span className="text-xs text-muted-foreground">{draft.status === 'draft' ? '等待确认' : operationDraftStateLabel(draft.status)}</span></header>
    <p className="mt-1 break-all text-xs text-muted-foreground">{draft.appId} · {draft.toolCall?.server || 'App 工具'}</p>
    <div className="mt-4">{editing ? <ArgumentsEditor draft={draft} value={args} onChange={setArgs} onValidChange={setValid} /> : <dl className="max-h-80 space-y-3 overflow-auto">{Object.entries(draft.toolCall!.arguments).map(([key, value]) => <div key={key}><dt className="text-xs text-muted-foreground">{draft.toolCall!.schema.properties?.[key]?.title || key}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{format(value)}</dd></div>)}{!Object.keys(draft.toolCall!.arguments).length && <p className="text-xs text-muted-foreground">此工具无需参数。</p>}</dl>}</div>
    {draft.status === 'draft' && <p className="mt-3 text-xs text-muted-foreground">尚未调用工具。确认后将使用上面的参数执行一次。</p>}
    {draft.status === 'returned' && <p className="mt-3 text-xs text-muted-foreground">工具已返回结果，具体业务状态请查看下方结果和会话回复。</p>}
    {draft.status === 'unknown' && <p className="mt-3 text-xs text-muted-foreground">调用结果尚未确认，请到来源系统核实。此处不会重复执行。</p>}
    {draft.resultRef != null && <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground">工具返回结果</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3">{JSON.stringify(draft.resultRef, null, 2)}</pre></details>}
    {(error || draft.error) && <p role="alert" className="mt-3 whitespace-pre-wrap text-xs text-destructive">{error || draft.error}</p>}
    {draft.status === 'draft' && <footer className="mt-4 flex justify-end gap-2 border-t border-border/60 pt-3">{editing ? <><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setArgs(JSON.stringify(draft.toolCall!.arguments, null, 2)); }}>放弃修改</Button><Button size="sm" disabled={busy || !valid} onClick={() => void action('update')}>保存修改</Button></> : <><Button size="sm" variant="ghost" disabled={busy} onClick={() => void action('cancel')}>取消草稿</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>修改参数</Button><Button size="sm" disabled={busy} onClick={() => void action('confirm')}>{busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}确认执行</Button></>}</footer>}
  </article>;
}

export const PendingToolDraftContext = React.createContext<ReadonlySet<string>>(new Set());

export function useSessionToolCallDrafts(sessionId?: string) {
  const [drafts, setDrafts] = React.useState<OperationDraft[]>([]);
  React.useEffect(() => {
    let active = true; setDrafts([]);
    const api = window.agentDesktop.operationDrafts;
    if (!sessionId || !api) return;
    const refresh = () => { void api.list().then(items => { if (active) setDrafts(items.filter(d => d.kind === 'tool-call' && d.toolCall?.sessionId === sessionId).slice(0, 20).reverse()); }).catch(() => {}); };
    refresh(); const off = api.onChanged(refresh);
    return () => { active = false; off(); };
  }, [sessionId]);
  return drafts;
}

export function SessionToolCallDrafts({ drafts }: { drafts: OperationDraft[] }) {
  return drafts.length ? (
    <div className="my-4 space-y-3" aria-label="会话工具草稿">
      {drafts.map(draft => (
        <div
          key={draft.id}
          className="assistant-message group flex items-start justify-start gap-2"
          style={{ marginBottom: 'var(--chat-message-spacing, 10px)' }}
        >
          <img
            src="./build/icon.png"
            alt="Moss"
            className="assistant-message-avatar h-7 w-7 shrink-0 self-start rounded-sm object-contain"
            draggable={false}
          />
          <div data-message-shell="assistant" className="relative flex w-full min-w-0 flex-col items-start gap-2">
            <div data-message-body="assistant" className="w-full min-w-0 max-w-full text-foreground select-text">
              <ToolCallDraftCard draft={draft} />
            </div>
          </div>
        </div>
      ))}
    </div>
  ) : null;
}
