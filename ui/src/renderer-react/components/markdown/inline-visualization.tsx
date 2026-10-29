import * as React from 'react';
import { parseVisualizationReference } from '@/lib/inline-visualization';
import { VisualizationSurface } from '@/components/visualization/visualization-surface';

export const InlineVisualization = React.memo(function InlineVisualization({ code, sessionId }: { code: string; sessionId?: string }) {
  const reference = React.useMemo(() => parseVisualizationReference(code), [code]);
  const [content, setContent] = React.useState('');
  const [error, setError] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const [visible, setVisible] = React.useState(false);
  const container = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    // A streamed reference can be incomplete on mount, before the section
    // exists. Start observing when its resource URI becomes available.
    if (!container.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(container.current); return () => observer.disconnect();
  }, [reference?.resourceUri]);
  React.useEffect(() => {
    if (!reference || !visible) return;
    let active = true; setError(''); setContent('');
    void window.agentDesktop.preview.readFile({ sessionId, filePath: reference.resourceUri }).then(file => {
      if (file.contentType !== 'html' || file.truncated || typeof file.content !== 'string' || file.content.length > 2 * 1024 * 1024) throw new Error('作品内容不完整或格式不支持');
      if (active) setContent(file.content);
    }).catch(error => { if (active) setError(String(error.message || error)); });
    return () => { active = false; };
  }, [reference?.resourceUri, sessionId, attempt, visible]);
  if (!reference) return <p className="text-sm text-muted-foreground">可视化引用尚未完整。</p>;
  return <section ref={container} data-inline-visualization className="not-prose my-3 min-w-0 overflow-hidden rounded-xl border border-border/60" aria-label={reference.title}>
    <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate font-medium">{reference.title}</span>{sessionId && <button type="button" className="rounded px-2 py-1 hover:bg-muted" onClick={() => {
      void window.agentDesktop.presentation.open({ sessionId, input: { items: [{ resource_uri: reference.resourceUri, title: reference.title }] } }).then(result => { if (!result.ok) setError(result.error || '无法打开作品'); }).catch(error => setError(String(error.message || error)));
    }}>在右侧展开</button>}</div>
    {content && error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
    {content ? <VisualizationSurface content={content} resourceUri={reference.resourceUri} title={reference.title} sessionId={sessionId} />
      : error ? <div role="alert" className="p-4 text-sm text-muted-foreground">作品暂不可用：{error}<button type="button" className="ml-2 underline" onClick={() => setAttempt(value => value + 1)}>重试</button></div>
        : <p role="status" className="p-4 text-sm text-muted-foreground">正在载入作品…</p>}
  </section>;
});
