import React from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownRenderer } from '@/components/markdown/markdown-renderer';
import { PresentationContent, PresentationToolbar } from '@/components/presentation/presentation-panel';
import { AppComposerContext } from '@/lib/app-composer';
import { VisualizationAnnotationCard } from '@/components/visualization/annotation-card';
import type { VisualizationAnnotation } from '../../src/shared/visualization-annotation.mjs';
import { usePresentation } from '@/lib/use-presentation';
import '@/globals.css';

// Only transport and surrounding shell are fixtures. App execution, resource
// resolution, presentation lifecycle and the rendered components are real.
const api = window as any;
const listeners = new Map<string, Set<(value: any) => void>>();
const on = (name: string, callback: (value: any) => void) => {
  const set = listeners.get(name) || new Set(); set.add(callback); listeners.set(name, set);
  return () => { set.delete(callback); };
};
api.visualizationEvent = (name: string, value: any) => listeners.get(name)?.forEach(callback => callback(value));
const rpc = (method: string) => (input: unknown) => api.visualizationRpc(method, input);
api.agentDesktop = {
  presentation: { snapshot: rpc('snapshot'), load: rpc('load'), open: rpc('open'), action: rpc('action'),
    acknowledge: rpc('acknowledge'), refresh: rpc('refresh'), resolve: async () => [],
    onChanged: (callback: any) => on('presentation:changed', callback), onResult: (callback: any) => on('presentation:result', callback) },
  preview: { readFile: rpc('readFile') },
  previewHistory: { list: async () => ({ items: [] }) },
  onWorkspaceChanged: () => () => {},
};
function Example() {
  const [markdown, setMarkdown] = React.useState(''), [draft, setDraft] = React.useState(''), [visible, reveal] = React.useState(false);
  const [annotations, setAnnotations] = React.useState<VisualizationAnnotation[]>([]);
  const { snapshot, action, error } = usePresentation('visualization-session', undefined, true, () => reveal(true));
  React.useEffect(() => { api.setVisualizationMarkdown = setMarkdown; api.fixtureReady = true; }, []);
  return <AppComposerContext.Provider value={{ selection: null, select: () => {}, submitVisualizationAnnotation: async (sessionId, annotation) => {
    if (sessionId !== 'visualization-session') throw new Error('会话已切换');
    const result = await rpc('annotation')({ sessionId, annotation });
    setAnnotations(previous => [...previous, result.annotation]);
  } }}>
    <style>{`body{margin:0}.demo-shell{height:100vh;display:flex;background:var(--background);color:var(--foreground)}.demo-chat{flex:1;min-width:0;display:flex;flex-direction:column}.demo-messages{overflow:auto;flex:1;padding:28px;min-height:0}.demo-side{width:44%;min-width:320px;display:flex;flex-direction:column;border-left:1px solid var(--border)}.demo-heading{padding:14px 22px;border-bottom:1px solid var(--border);font-size:13px}.demo-compose{margin:12px 24px 20px;padding:12px;border:1px solid var(--border);border-radius:14px}.demo-compose textarea{width:100%;resize:vertical;min-height:60px;background:transparent;font-size:13px;outline:none}.demo-message{background:var(--muted);border-radius:12px;padding:12px 16px;font-size:14px;margin-bottom:24px}@media(max-width:700px){.demo-shell{height:auto;min-height:100vh;display:block}.demo-messages{padding:14px}.demo-side{width:100%;height:650px;border-left:0;border-top:1px solid var(--border)}.demo-compose{margin:12px}}`}</style>
    <div className="demo-shell">
      <main className="demo-chat"><header className="demo-heading"><strong>Moss</strong> <span className="text-muted-foreground"> / 主会话 · 创作</span></header>
        <div className="demo-messages"><div className="demo-message">请根据需求创作，完成后直接在这里展示。</div>
          {markdown && <><p className="mb-3 text-sm">作品已生成，可以在右侧查看并标注想调整的地方。</p><MarkdownRenderer sessionId="visualization-session" content={markdown} /></>}
          {annotations.map(annotation => <VisualizationAnnotationCard key={annotation.id} annotation={annotation} />)}
        </div>
        <div className="demo-compose"><textarea aria-label="主会话输入" placeholder="继续描述你想调整的地方…" value={draft} onChange={event => setDraft(event.target.value)} /><div className="text-xs text-muted-foreground">主会话输入 · 追问会保留这里的草稿</div></div>
      </main>
      {visible && snapshot?.state.visible && <aside className="demo-side" data-testid="right-panel"><PresentationToolbar snapshot={snapshot} action={action} /><div className="min-h-0 flex-1"><PresentationContent snapshot={snapshot} action={action} /></div></aside>}
      {error && <div role="alert">{error}</div>}
    </div>
  </AppComposerContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Example />);
