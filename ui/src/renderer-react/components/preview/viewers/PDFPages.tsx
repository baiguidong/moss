import * as React from 'react';
import { ChevronLeft, ChevronRight, PanelLeft, ZoomIn, ZoomOut } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { AppComposerContext } from '@/lib/app-composer';
import type { VisualizationSelection } from '../../../../shared/visualization-annotation.mjs';
import { createOfflinePreviewUrl } from './offline-preview-url';
import type { PDFViewerProps } from './PDFViewer';
import { PreviewLinkService, renderPdfLinks } from './pdf-links';
import './pdf-pages.css';
import { compactDocumentText } from '../../../../shared/document-location.mjs';

GlobalWorkerOptions.workerSrc = workerUrl;
type PageSize = { width: number; height: number };
type Selection = { page: number; rect: { x: number; y: number; width: number; height: number }; text: string; kind: 'region' | 'text'; anchor: { x: number; y: number } };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function previewError(reason: any): string {
  if (reason?.name === 'PasswordException') return '此 PDF 需要密码，请用系统应用打开。';
  if (reason?.name === 'InvalidPDFException') return '文件不是有效 PDF，或内容已损坏。';
  if (/403|404|fetch|network/i.test(String(reason?.message || reason))) return '无法读取页面文件，请重新打开或刷新预览。';
  return '页面未能完整渲染，请重试或用系统应用打开。';
}

function PageCanvas({ pdf, number, width, height, thumbnail = false, linkService, onPaint, onError, highlightText, highlightOccurrence = 1 }: {
  pdf: PDFDocumentProxy; number: number; width: number; height: number; thumbnail?: boolean;
  linkService?: PreviewLinkService;
  highlightText?: string; highlightOccurrence?: number;
  onPaint?: () => void; onError: (message: string) => void;
}) {
  const root = React.useRef<HTMLDivElement>(null), canvas = React.useRef<HTMLCanvasElement>(null), text = React.useRef<HTMLDivElement>(null);
  const links = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  const callbacks = React.useRef({ onPaint, onError }); callbacks.current = { onPaint, onError };
  React.useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '500px' });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (!visible || !canvas.current) return;
    let active = true, render: RenderTask | undefined, layer: TextLayer | undefined;
    const target = canvas.current, textTarget = text.current, linkTarget = links.current;
    target.dataset.painted = 'false';
    void (async () => {
      const page = await pdf.getPage(number);
      if (!active) return;
      const scale = width / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12_000_000 / (viewport.width * viewport.height)));
      target.width = Math.ceil(viewport.width * ratio); target.height = Math.ceil(viewport.height * ratio);
      render = page.render({ canvas: target, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (!active) return;
      target.dataset.painted = 'true'; callbacks.current.onPaint?.();
      if (textTarget && !thumbnail) {
        textTarget.replaceChildren();
        textTarget.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit));
        layer = new TextLayer({ textContentSource: page.streamTextContent(), container: textTarget, viewport });
        await layer.render();
        if (active && highlightText) {
          const spans = [...textTarget.querySelectorAll('span')];
          const pieces = spans.map(span => compactDocumentText(span.textContent || ''));
          const quote = compactDocumentText(highlightText), allText = pieces.join('');
          let start = -1;
          for (let match = 0; match < highlightOccurrence; match++) { start = allText.indexOf(quote, start + 1); if (start < 0) break; }
          let offset = 0;
          for (const [index, span] of spans.entries()) {
            const end = offset + pieces[index].length;
            if (start >= 0 && quote && end > start && offset < start + quote.length) span.dataset.citationHighlight = 'true';
            offset = end;
          }
        }
      }
      if (linkTarget && linkService && active) {
        const linkLayer = await renderPdfLinks(page, viewport, linkService);
        if (active) linkTarget.replaceChildren(linkLayer);
      }
    })().catch(error => { if (active && error.name !== 'RenderingCancelledException') callbacks.current.onError(previewError(error)); });
    return () => { active = false; render?.cancel(); layer?.cancel(); textTarget?.replaceChildren(); linkTarget?.replaceChildren(); target.width = 0; target.height = 0; };
  }, [pdf, number, width, visible, thumbnail, linkService, highlightText, highlightOccurrence]);
  return <div ref={root} style={{ width, height }} aria-hidden={thumbnail || undefined}>
    <canvas ref={canvas} style={{ width, height }} />
    {!thumbnail && <div ref={text} className="textLayer" />}
    {!thumbnail && <div ref={links} className="moss-pdf-links" />}
  </div>;
}

export default function PDFPages({ filePath, fileVersion, title, resourceUri, sessionId, sourcePath, onReady, onError, documentLocation, locationRequest }: PDFViewerProps) {
  const { submitVisualizationAnnotation } = React.useContext(AppComposerContext);
  const root = React.useRef<HTMLDivElement>(null), scroll = React.useRef<HTMLDivElement>(null);
  const pages = React.useRef(new Map<number, HTMLDivElement>());
  const [pdf, setPdf] = React.useState<PDFDocumentProxy>(), [sizes, setSizes] = React.useState<PageSize[]>([]);
  const [error, setError] = React.useState(''), [attempt, setAttempt] = React.useState(0);
  const [linkError, setLinkError] = React.useState('');
  const [citationError, setCitationError] = React.useState('');
  const [citation, setCitation] = React.useState<{ page: number; text?: string; occurrence?: number }>();
  const [page, setPage] = React.useState(1), [pageInput, setPageInput] = React.useState('1');
  const [rail, setRail] = React.useState(false), [zoom, setZoom] = React.useState('width');
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [selecting, setSelecting] = React.useState(false), [selection, setSelection] = React.useState<Selection | null>(null);
  const [comment, setComment] = React.useState(''), [sending, setSending] = React.useState(false), [sendError, setSendError] = React.useState('');
  const annotationId = React.useRef(''), submitting = React.useRef(false);
  const drag = React.useRef<{ page: number; x: number; y: number } | null>(null);
  const callbacks = React.useRef({ onReady, onError }); callbacks.current = { onReady, onError };
  const canAnnotate = Boolean(resourceUri && sessionId && submitVisualizationAnnotation);
  const stateKey = JSON.stringify(['moss.pdf/v1', sessionId || '', resourceUri || sourcePath || filePath]);
  const handledCitation = React.useRef<string | undefined>(undefined);
  const initialPage = React.useRef(1), restored = React.useRef(false), ready = React.useRef(false);
  const requestedPage = React.useRef(1), programmaticScrollUntil = React.useRef(0);
  React.useEffect(() => {
    try { const state = JSON.parse(localStorage.getItem(stateKey) || '{}'); initialPage.current = Math.max(1, Number(state.page) || 1); handledCitation.current = state.locationKey; if (['width', 'page', '0.5', '0.75', '1', '1.25', '1.5', '2'].includes(state.zoom)) setZoom(state.zoom); setRail(state.rail !== false); } catch {}
  }, [stateKey]);
  React.useEffect(() => {
    let active = true; setError(''); setLinkError(''); setPdf(undefined); setSizes([]); ready.current = false; restored.current = false;
    const assets = new URL(import.meta.env.DEV ? '/pdfjs-assets/' : './pdfjs-assets/', document.baseURI).href;
    const url = new URL(createOfflinePreviewUrl(filePath), document.baseURI);
    if (fileVersion !== undefined) url.searchParams.set('v', String(fileVersion));
    const task = getDocument({ cMapUrl: assets + 'cmaps/', cMapPacked: true, standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/', url: url.href, isEvalSupported: false });
    void task.promise.then(async document => {
      const dimensions: PageSize[] = [];
      for (let i = 1; i <= document.numPages; i++) {
        const p = await document.getPage(i); if (!active) return;
        const v = p.getViewport({ scale: 1 }); dimensions.push({ width: v.width, height: v.height });
      }
      if (active) { setSizes(dimensions); setPdf(document); }
    }).catch(reason => { if (active) { const message = previewError(reason); setError(message); callbacks.current.onError?.(message); } });
    return () => { active = false; void task.destroy(); };
  }, [filePath, fileVersion, attempt]);
  React.useLayoutEffect(() => {
    if (!scroll.current) return;
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(scroll.current); return () => observer.disconnect();
  }, [pdf, error]);
  const go = React.useCallback((value: number, clearLinkError = true) => {
    const next = clamp(Math.round(value) || 1, 1, sizes.length || 1);
    requestedPage.current = next; programmaticScrollUntil.current = performance.now() + 150;
    const node = pages.current.get(next);
    if (node && scroll.current) scroll.current.scrollTop += node.getBoundingClientRect().top - scroll.current.getBoundingClientRect().top - 20;
    setPage(next); setPageInput(String(next)); setSelection(null); if (clearLinkError) setLinkError('');
  }, [sizes.length]);
  const linkService = React.useMemo(() => pdf ? new PreviewLinkService(pdf, go, () => requestedPage.current, setLinkError) : undefined, [pdf, go]);
  React.useLayoutEffect(() => {
    if (!pdf || !viewport.width || !viewport.height) return;
    go(restored.current ? requestedPage.current : initialPage.current, false); restored.current = true;
  }, [pdf, go, zoom, viewport.width, viewport.height]);
  const locationKey = JSON.stringify([documentLocation, locationRequest]);
  React.useEffect(() => {
    if (!pdf || !viewport.width || !viewport.height) return;
    let active = true;
    setCitation(undefined); setCitationError('');
    const location = documentLocation;
    if (handledCitation.current === locationKey) return;
    if (!location?.page && !location?.text && !location?.sheet) return;
    void (async () => {
      if (location.sheet) { setCitationError('此文件不支持工作表定位'); return; }
      if (location.page && location.page > pdf.numPages) { setCitationError(`引用的第 ${location.page} 页不存在，文件共 ${pdf.numPages} 页`); return; }
      let target = location.page, occurrence = location.occurrence || 1;
      if (location.text) {
        const quote = compactDocumentText(location.text);
        const candidates = target ? [target] : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
        let found = false;
        for (const number of candidates) {
          const content = await (await pdf.getPage(number)).getTextContent();
          if (!active) return;
          const allText = compactDocumentText(content.items.map(item => 'str' in item ? item.str : '').join(''));
          let count = 0, offset = -1;
          while (quote && (offset = allText.indexOf(quote, offset + 1)) >= 0) count++;
          if (count >= occurrence) { target = number; found = true; break; }
          occurrence -= count;
        }
        if (!found) {
          if (target) go(target);
          setCitationError('未找到引用文字；文件可能已修改，或该页是扫描图片。'); return;
        }
      }
      if (active && target) { handledCitation.current = locationKey; go(target); setCitation({ page: target, text: location.text, occurrence }); }
    })().catch(reason => { if (active) setCitationError('无法定位引用：' + String(reason.message || reason)); });
    return () => { active = false; };
  }, [pdf, go, locationKey, Boolean(viewport.width && viewport.height)]);
  React.useEffect(() => {
    if (!pdf) return;
    try { localStorage.setItem(stateKey, JSON.stringify({ page, zoom, rail, locationKey: handledCitation.current })); } catch {}
  }, [page, zoom, rail, pdf, stateKey, citation]);
  const painted = () => { if (!ready.current) { ready.current = true; callbacks.current.onReady?.(); } };
  const fail = (message: string) => { setError(message); callbacks.current.onError?.(message); };
  const factor = (size: PageSize) => zoom === 'width' ? Math.max(1, viewport.width - 40) / size.width : zoom === 'page' ? Math.min(Math.max(1, viewport.width - 40) / size.width, Math.max(1, viewport.height - 40) / size.height) : Number(zoom);
  const zoomStep = (step: number) => { const current = sizes[page - 1] ? factor(sizes[page - 1]) : 1; setZoom(String(clamp(Math.round((current + step) * 4) / 4, 0.25, 3))); setSelection(null); };
  const choose = (value: Selection) => { annotationId.current = crypto.randomUUID(); setSelection(value); setComment(''); setSendError(''); };
  const point = (event: React.PointerEvent<HTMLDivElement>) => { const box = event.currentTarget.getBoundingClientRect(); return { x: clamp((event.clientX - box.left) / box.width, 0, 1), y: clamp((event.clientY - box.top) / box.height, 0, 1) }; };
  const anchor = (x: number, y: number) => { const box = root.current!.getBoundingClientRect(); return { x: x - box.left, y: y - box.top }; };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (submitting.current || !selection || !resourceUri || !sessionId || !submitVisualizationAnnotation || !comment.trim()) return;
    submitting.current = true; setSending(true); setSendError('');
    try {
      const size = sizes[selection.page - 1];
      const selected: VisualizationSelection = { kind: selection.kind, pageNumber: selection.page, selector: `page:${selection.page}`, text: selection.text.slice(0, 2000), nearbyText: `第 ${selection.page} 页`, rect: { x: selection.rect.x * size.width, y: selection.rect.y * size.height, width: selection.rect.width * size.width, height: selection.rect.height * size.height } };
      await submitVisualizationAnnotation(sessionId, { id: annotationId.current, resourceUri, comment: comment.trim(), selection: selected, state: { pageNumber: selection.page, pageWidth: size.width, pageHeight: size.height, coordinateSpace: 'pdf-points' } });
      setSelection(null); setSelecting(false);
    } catch (reason) { setSendError(String(reason instanceof Error ? reason.message : reason)); }
    finally { submitting.current = false; setSending(false); }
  };
  const control = 'inline-flex h-7 shrink-0 items-center justify-center rounded px-1.5 hover:bg-muted disabled:opacity-30';
  return <div ref={root} data-pdf-preview className="moss-pdf relative flex h-full min-h-0 flex-col bg-background" aria-label={title} onKeyDown={event => { if (event.key === 'Escape') { setSelecting(false); setSelection(null); } }}>
    <div className="moss-pdf-toolbar flex shrink-0 flex-wrap items-center gap-1 border-b border-border/70 px-3 py-1.5 text-xs">
      <button className={control} aria-label="页面缩略图" aria-pressed={rail} onClick={() => setRail(!rail)}><PanelLeft size={15} /></button>
      <button className={control} aria-label="上一页" disabled={!pdf || page <= 1} onClick={() => go(page - 1)}><ChevronLeft size={16} /></button>
      <form onSubmit={event => { event.preventDefault(); go(Number(pageInput)); }} className="flex items-center gap-1"><input aria-label="页码" inputMode="numeric" value={pageInput} disabled={!pdf} onChange={event => setPageInput(event.target.value)} onBlur={() => go(Number(pageInput))} className="h-6 w-9 rounded border border-border bg-background text-center" /><span data-pdf-page-count>/ {sizes.length || '…'}</span></form>
      <button className={control} aria-label="下一页" disabled={!pdf || page >= sizes.length} onClick={() => go(page + 1)}><ChevronRight size={16} /></button>
      <span className="mx-1 h-4 border-l border-border" />
      <button className={control} aria-label="缩小" onClick={() => zoomStep(-0.25)}><ZoomOut size={15} /></button>
      <select aria-label="页面缩放" className="h-7 max-w-24 rounded bg-transparent text-xs" value={zoom} onChange={event => { setZoom(event.target.value); setSelection(null); }}>
        <option value="width">适合宽度</option><option value="page">整页</option>
        {Array.from(new Set(['0.25', '0.5', '0.75', '1', '1.25', '1.5', '2', '3', ...(!['width', 'page'].includes(zoom) ? [zoom] : [])])).sort((a,b) => Number(a)-Number(b)).map(value => <option key={value} value={value}>{Math.round(Number(value) * 100)}%</option>)}
      </select>
      <button className={control} aria-label="放大" onClick={() => zoomStep(0.25)}><ZoomIn size={15} /></button>
      {canAnnotate && <button disabled={!pdf} className={`${control} ml-auto`} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelection(null); }}>{selecting ? '退出标注' : '标注修改'}</button>}
    </div>
    {selecting && <p role="status" className="shrink-0 border-b border-border/60 px-3 py-1 text-xs text-muted-foreground">在页面上框选需要修改的内容</p>}
    {linkError && <p role="alert" className="shrink-0 border-b border-border/60 px-3 py-1 text-xs text-destructive">{linkError}</p>}
    {citationError && <p role="alert" className="shrink-0 border-b border-border/60 px-3 py-1 text-xs text-destructive">{citationError}</p>}
    {error ? <div role="alert" className="m-auto max-w-sm p-6 text-sm"><p>页面预览失败：{error}</p><button className="mt-3 underline" onClick={() => setAttempt(value => value + 1)}>重试预览</button></div> : !pdf ? <div className="m-auto p-5 text-sm text-muted-foreground">正在渲染页面…</div> : <div className="flex min-h-0 flex-1">
      {rail && <nav aria-label="页面缩略图" className="moss-pdf-rail w-28 shrink-0 overflow-y-auto border-r border-border/70 bg-muted/30 p-2">
        {sizes.map((size, i) => <button key={i} aria-label={`转到第 ${i + 1} 页`} aria-current={page === i + 1 ? 'page' : undefined} className="mb-3 flex w-full flex-col items-center gap-1 rounded p-1 text-[10px] hover:bg-muted aria-[current=page]:bg-primary/15" onClick={() => go(i + 1)}><div className="max-w-full overflow-hidden bg-white shadow-sm"><PageCanvas pdf={pdf} number={i + 1} width={64} height={64 * size.height / size.width} thumbnail onError={fail} /></div>{i + 1}</button>)}
      </nav>}
      <div ref={scroll} data-pdf-scroll className="min-h-0 min-w-0 flex-1 overflow-auto bg-muted/50" onScroll={() => {
        if (!scroll.current || performance.now() < programmaticScrollUntil.current) return; const top = scroll.current.getBoundingClientRect().top + 28;
        let best = 1, distance = Infinity;
        pages.current.forEach((node, number) => { const box = node.getBoundingClientRect(); const d = box.top <= top && box.bottom > top ? 0 : Math.abs(box.top - top); if (d < distance) { distance = d; best = number; } });
        requestedPage.current = best; setPage(best); setPageInput(String(best)); setSelection(null);
      }}>
        <div className="flex min-w-full w-max flex-col items-center gap-5 p-5">
          {sizes.map((size, index) => { const number = index + 1, scale = factor(size), width = size.width * scale, height = size.height * scale;
            return <div key={number} ref={node => { if (node) pages.current.set(number, node); else pages.current.delete(number); }} data-pdf-page={number} data-citation-page={citation?.page === number || undefined} data-selecting={selecting} className="moss-pdf-page" role="region" aria-label={`第 ${number} 页`} style={{ width, height }}
              onPointerDown={event => { if (!selecting || event.button !== 0) return; const p = point(event); drag.current = { page: number, ...p }; event.currentTarget.setPointerCapture(event.pointerId); setSelection(null); event.preventDefault(); }}
              onPointerMove={event => { if (!drag.current || drag.current.page !== number) return; const p = point(event), start = drag.current; setSelection({ page: number, rect: { x: Math.min(start.x,p.x), y: Math.min(start.y,p.y), width: Math.abs(start.x-p.x), height: Math.abs(start.y-p.y) }, text: '', kind: 'region', anchor: anchor(event.clientX,event.clientY) }); }}
              onPointerCancel={() => { drag.current = null; setSelection(null); }}
              onPointerUp={event => {
                if (drag.current) { const start = drag.current, p = point(event); drag.current = null; if (Math.abs(p.x-start.x)*width < 5 || Math.abs(p.y-start.y)*height < 5) { setSelection(null); return; } choose({ page: number, rect: { x: Math.min(start.x,p.x), y: Math.min(start.y,p.y), width: Math.abs(start.x-p.x), height: Math.abs(start.y-p.y) }, text: '', kind: 'region', anchor: anchor(event.clientX,event.clientY) }); return; }
                if (!canAnnotate || (event.target as Element).closest('a')) return; const selected = window.getSelection(); if (!selected?.toString().trim() || !event.currentTarget.contains(selected.anchorNode) || !event.currentTarget.contains(selected.focusNode)) return;
                const box = selected.getRangeAt(0).getBoundingClientRect(), origin = event.currentTarget.getBoundingClientRect();
                choose({ page: number, rect: { x: clamp((box.left-origin.left)/width,0,1), y: clamp((box.top-origin.top)/height,0,1), width: Math.min(1,box.width/width), height: Math.min(1,box.height/height) }, text: selected.toString(), kind: 'text', anchor: anchor(box.left,box.bottom) });
              }}>
              <PageCanvas pdf={pdf} number={number} width={width} height={height} linkService={linkService} highlightText={citation?.page === number ? citation.text : undefined} highlightOccurrence={citation?.occurrence} onPaint={painted} onError={fail} />
              {selection?.page === number && <div className="pointer-events-none absolute border-2 border-primary bg-primary/10" style={{ left: selection.rect.x * width, top: selection.rect.y * height, width: selection.rect.width * width, height: selection.rect.height * height }} />}
            </div>;
          })}
        </div>
      </div>
    </div>}
    {selection && !drag.current && canAnnotate && <form aria-label="标注修改" data-annotation-editor onSubmit={submit} className="absolute z-20 w-72 max-w-[calc(100%-16px)] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg" style={{ left: clamp(selection.anchor.x,8,(root.current?.clientWidth || 320)-296), top: clamp(selection.anchor.y+8,48,(root.current?.clientHeight || 500)-220) }}>
      <label className="text-xs">修改第 {selection.page} 页这处内容<textarea autoFocus aria-label="标注内容" value={comment} onChange={event => setComment(event.target.value)} maxLength={4000} placeholder="描述你希望如何修改…" className="mt-2 block min-h-20 w-full resize-none rounded border border-border bg-background p-2 text-sm" /></label>
      {sendError && <p role="alert" className="mt-1 text-xs text-destructive">{sendError}</p>}
      <div className="mt-2 flex justify-end gap-3 text-xs"><button type="button" onClick={() => setSelection(null)}>取消</button><button type="submit" disabled={sending || !comment.trim()} className="rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50">{sending ? '发送中…' : '发送标注'}</button></div>
    </form>}
  </div>;
}
