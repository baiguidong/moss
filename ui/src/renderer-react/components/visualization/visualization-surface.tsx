import * as React from 'react';
import { AppComposerContext } from '@/lib/app-composer';
import { boundedVisualizationState, isolatedVisualizationDocument, VISUALIZATION_CHANNEL } from '@/lib/inline-visualization';
import { normalizeVisualizationSelection, type VisualizationSelection } from '../../../shared/visualization-annotation.mjs';

type Mode = 'element' | 'text' | 'region' | null;
type Anchor = { x: number; y: number; width: number; height: number };
export function VisualizationSurface({ content, resourceUri, title, sessionId, panel = false, onReady, onError }: {
  content: string; resourceUri: string; title: string; sessionId?: string; panel?: boolean; onReady?: () => void; onError?: (message: string) => void;
}) {
  const { submitVisualizationAnnotation } = React.useContext(AppComposerContext);
  const frame = React.useRef<HTMLIFrameElement>(null), viewport = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState(360), [notice, setNotice] = React.useState('');
  const [error, setError] = React.useState(''), [attempt, setAttempt] = React.useState(0);
  const [mode, setMode] = React.useState<Mode>(null), [selection, setSelection] = React.useState<VisualizationSelection | null>(null);
  const [anchor, setAnchor] = React.useState<Anchor | null>(null), [comment, setComment] = React.useState('');
  const [sendError, setSendError] = React.useState(''), [sending, setSending] = React.useState(false);
  const [size, setSize] = React.useState({ width: 320, height: 360 });
  const annotationId = React.useRef(''), submitting = React.useRef(false);
  const key = JSON.stringify(['moss.visualization/v1', sessionId || '', resourceUri]);
  const identity = React.useMemo(() => {
    let state: unknown = null; try { state = boundedVisualizationState(JSON.parse(localStorage.getItem(key) || 'null')); } catch {}
    return { token: crypto.randomUUID(), state };
  }, [key, content, attempt]);
  const activeIdentity = React.useRef(identity); activeIdentity.current = identity;
  const state = React.useRef(identity.state);
  const ready = React.useRef(onReady); ready.current = onReady;
  const failed = React.useRef(onError); failed.current = onError;
  const post = React.useCallback((type: string, payload: unknown) => frame.current?.contentWindow?.postMessage({ channel: VISUALIZATION_CHANNEL, token: identity.token, type, payload }, '*'), [identity]);
  const changeMode = (value: Mode) => { setMode(value); setSelection(null); setAnchor(null); setComment(''); setSendError(''); post('annotation-mode', value); };
  const srcDoc = React.useMemo(() => isolatedVisualizationDocument(content, { token: identity.token, state: identity.state, dark: document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark' }), [content, identity]);
  React.useLayoutEffect(() => {
    state.current = identity.state; setError(''); setNotice(''); setMode(null); setSelection(null); setAnchor(null); setComment(''); setSendError('');
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== frame.current?.contentWindow || data?.channel !== VISUALIZATION_CHANNEL || data.token !== identity.token) return;
      if (data.type === 'ready') ready.current?.();
      if (data.type === 'resize' && Number.isFinite(data.payload)) setHeight(Math.max(200, Math.min(960, data.payload)));
      if (data.type === 'error') { const message = String(data.payload).slice(0, 400); setError(message); failed.current?.(message); }
      if (data.type === 'annotation-selection') {
        try {
          const selected = normalizeVisualizationSelection(data.payload?.selection);
          annotationId.current = crypto.randomUUID(); setSelection(selected); setSendError('');
          setComment(typeof data.payload?.prompt === 'string' ? data.payload.prompt.slice(0, 4000) : '');
        } catch { /* Ignore invalid sandbox messages. */ }
      }
      if (data.type === 'annotation-position') {
        const rect = data.payload;
        if (rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]) && Math.abs(rect[key]) <= 1e7)) setAnchor(rect);
      }
      if (data.type === 'annotation-cancel') { setMode(null); setSelection(null); setAnchor(null); }
      if (data.type === 'state') {
        const value = boundedVisualizationState(data.payload); state.current = value;
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { setNotice('当前状态仅在本次打开期间保留。'); }
        window.dispatchEvent(new CustomEvent('moss:visualization-state', { detail: { key, value, token: identity.token } }));
      }
    };
    const sync = (event: Event) => { const detail = (event as CustomEvent).detail; if (detail.key === key && detail.token !== identity.token) { state.current = boundedVisualizationState(detail.value); post('state', state.current); } };
    const theme = () => post('theme', document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark');
    const observer = new MutationObserver(theme); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    window.addEventListener('message', receive); window.addEventListener('moss:visualization-state', sync);
    return () => { observer.disconnect(); window.removeEventListener('message', receive); window.removeEventListener('moss:visualization-state', sync); };
  }, [identity, key, post]);
  React.useLayoutEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(viewport.current); return () => observer.disconnect();
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || !sessionId || !submitVisualizationAnnotation || !selection || !comment.trim()) return;
    submitting.current = true; setSending(true); setSendError('');
    try {
      await submitVisualizationAnnotation(sessionId, { id: annotationId.current, resourceUri, comment: comment.trim(), selection, state: state.current });
      if (activeIdentity.current === identity) changeMode(null);
    } catch (error) { if (activeIdentity.current === identity) setSendError(error instanceof Error ? error.message : '标注发送失败，请重试。'); }
    finally { submitting.current = false; setSending(false); }
  };
  const editorWidth = Math.min(300, Math.max(0, size.width - 16));
  const left = Math.max(8, Math.min(anchor?.x || 8, size.width - editorWidth - 8));
  const below = (anchor?.y || 0) + (anchor?.height || 0) + 8;
  const top = Math.max(8, Math.min(below + 190 <= size.height ? below : (anchor?.y || 0) - 198, size.height - 198));
  return <div data-visualization-surface className={panel ? 'flex h-full min-h-0 flex-col' : 'min-w-0'}>
    {sessionId && submitVisualizationAnnotation && <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 border-b border-border/60 px-3 py-1.5 text-xs">
      {mode ? <>{(['element', 'text', 'region'] as const).map((value, index) => <button key={value} type="button" aria-pressed={mode === value} className="rounded px-2 py-1 hover:bg-muted aria-pressed:bg-muted" onClick={() => changeMode(value)}>{['选择元素', '选择文字', '框选区域'][index]}</button>)}<button type="button" className="rounded px-2 py-1 hover:bg-muted" onClick={() => changeMode(null)}>退出标注</button></> : <button type="button" className="rounded px-2 py-1 hover:bg-muted" onClick={() => changeMode('element')}>标注修改</button>}
    </div>}
    {error && <div role="alert" className="shrink-0 px-3 py-2 text-xs text-destructive">交互内容运行出错：{error}<button type="button" className="ml-2 underline" onClick={() => setAttempt(value => value + 1)}>重试</button></div>}
    <div ref={viewport} className={panel ? 'relative min-h-0 flex-1' : 'relative'}>
      <iframe ref={frame} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={srcDoc} className="block w-full border-0" style={{ height: panel ? '100%' : height }} />
      {selection && anchor && sessionId && submitVisualizationAnnotation && <form onSubmit={submit} aria-label="标注修改" data-annotation-editor className="absolute z-20 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg" style={{ left, top, width: editorWidth, maxHeight: Math.max(180, size.height - 16), overflowY: 'auto' }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); changeMode(null); } }}>
        <label className="block text-xs">修改这处内容<textarea autoFocus aria-label="标注内容" maxLength={4000} placeholder="描述你希望如何修改…" className="mt-2 block min-h-20 w-full resize-none rounded border border-border bg-background p-2 text-sm text-foreground" value={comment} onChange={event => setComment(event.target.value)} /></label>
        {sendError && <p role="alert" className="mt-1 text-xs text-destructive">{sendError}</p>}
        <div className="mt-2 flex justify-end gap-3 text-xs"><button type="button" onClick={() => changeMode(null)}>取消</button><button type="submit" className="rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" disabled={sending || !comment.trim()}>{sending ? '发送中…' : '发送标注'}</button></div>
      </form>}
    </div>
    {notice && <p role="status" className="shrink-0 px-3 py-2 text-xs text-muted-foreground">{notice}</p>}
  </div>;
}
