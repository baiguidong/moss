import * as React from 'react';
import { MousePointer2 } from 'lucide-react';
import { AppComposerContext } from '@/lib/app-composer';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { VisualizationAnnotation, VisualizationSelection } from '../../../shared/visualization-annotation.mjs';

export type OfficeEditTarget = Pick<VisualizationAnnotation, 'resourceUri' | 'artifactId' | 'revision'> & { sessionId?: string };
const wholeDocument: VisualizationSelection = { kind: 'document', selector: 'document', text: '', nearbyText: '', rect: { x: 0, y: 0, width: 1, height: 1 } };

export function OfficeEditRequest({ target, selection, selectionLabel, onSelectRegion }: {
  target: OfficeEditTarget;
  selection?: VisualizationSelection;
  selectionLabel?: string;
  onSelectRegion?: () => void;
}) {
  const { submitVisualizationAnnotation } = React.useContext(AppComposerContext);
  const [open, setOpen] = React.useState(false), [comment, setComment] = React.useState('');
  const [scope, setScope] = React.useState('document'), [error, setError] = React.useState(''), [sending, setSending] = React.useState(false);
  const request = React.useRef(''), busy = React.useRef(false);
  const identity = JSON.stringify(target), currentIdentity = React.useRef(identity); currentIdentity.current = identity;
  React.useEffect(() => { setOpen(false); setComment(''); setError(''); busy.current = false; setSending(false); }, [identity]);
  if (!target.sessionId || !(target.resourceUri || target.artifactId) || !submitVisualizationAnnotation) return null;
  const changeOpen = (value: boolean) => {
    if (busy.current) return;
    if (value) { request.current = crypto.randomUUID(); setScope(selection ? 'selection' : 'document'); setError(''); }
    setOpen(value);
  };
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild><Button variant="ghost" size="sm" className="office-request-edit h-7 shrink-0 gap-1 rounded-md px-2 text-xs" aria-label="请求修改" title="请求修改"><MousePointer2 className="h-3.5 w-3.5" /><span>请求修改</span></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-24px)] p-3" onEscapeKeyDown={event => { if (sending) event.preventDefault(); }} onInteractOutside={event => { if (sending) event.preventDefault(); }}>
      <form aria-label="请求修改" data-office-edit-request onSubmit={async event => {
        event.preventDefault(); if (busy.current || !comment.trim()) return;
        busy.current = true; setSending(true); setError('');
        try {
          const { sessionId, ...reference } = target;
          await submitVisualizationAnnotation(sessionId!, { ...reference, id: request.current, comment: comment.trim(), selection: scope === 'selection' && selection ? selection : wholeDocument, state: null });
          if (currentIdentity.current === identity) { setOpen(false); setComment(''); }
        } catch (reason) { if (currentIdentity.current === identity) setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { if (currentIdentity.current === identity) { busy.current = false; setSending(false); } }
      }}>
        <label className="flex items-center justify-between gap-2 text-xs">修改范围<select aria-label="修改范围" className="h-7 min-w-0 max-w-48 rounded border bg-background px-2" value={scope} disabled={sending} onChange={e => setScope(e.target.value)}>
          <option value="document">整份文件</option>{selection && <option value="selection">{selectionLabel || '当前选区'}</option>}
        </select></label>
        {onSelectRegion && <button type="button" className="mt-2 text-xs text-primary hover:underline" disabled={sending} onClick={() => { setOpen(false); onSelectRegion(); }}>在页面上框选区域</button>}
        <textarea autoFocus aria-label="修改要求" placeholder="描述希望如何修改…" maxLength={4000} disabled={sending} className="mt-3 block min-h-24 w-full resize-y rounded border bg-background p-2 text-sm" value={comment} onChange={e => setComment(e.target.value)} />
        {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-3 flex items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">交给当前会话修改，保留原文件</span><Button type="submit" size="sm" className="h-7 shrink-0 px-2 text-xs" disabled={sending || !comment.trim()}>{sending ? '发送中…' : '发送修改请求'}</Button></div>
      </form>
    </PopoverContent>
  </Popover>;
}
