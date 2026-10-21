import * as React from 'react';
import { ArrowLeft, Pin, PinOff, FolderOpen, Globe2, PanelsTopLeft, ExternalLink, X } from 'lucide-react';
import { PreviewDrawer } from '@/components/preview-drawer';
import { TurnChangeCard } from '@/components/chat/turn-change-card';
import { conversationView } from '@/lib/app-conversation-workbench';
import type { PresentationResource, PresentationSnapshot, WorkspacePreviewData } from '@/types';

type Action = (action: { type: string; id?: string; value?: boolean }) => void;
export function PresentationToolbar({ snapshot, action }: { snapshot: PresentationSnapshot | null; action: Action }) {
  const state = snapshot?.state;
  return <div className="flex min-w-0 flex-col gap-1.5 border-b border-border/70 px-2 py-2" aria-label="内容导航">
    <div className="flex items-center gap-1">
      <button className="rounded p-1.5 hover:bg-muted disabled:opacity-40" aria-label="返回上一个内容" disabled={!state?.back.length} onClick={() => action({ type: 'back' })}><ArrowLeft size={14}/></button>
      {([{ id: 'workspace', title: '工作区', icon: FolderOpen }, { id: 'results', title: '结果', icon: PanelsTopLeft }, { id: 'browser', title: '浏览器', icon: Globe2 }]).map(({ id, title, icon: Icon }) =>
        <button key={id} className={'flex items-center gap-1 rounded px-2 py-1.5 text-xs hover:bg-muted ' + (state?.activeId === id ? 'bg-muted text-primary' : '')} onClick={() => action({ type: 'select', id })}><Icon size={13}/>{title}{id === 'results' && snapshot?.resources.some(r => r.kind !== 'collection' && r.isResult !== false) ? <span className="text-muted-foreground">{snapshot.resources.filter(r => r.kind !== 'collection' && r.isResult !== false).length}</span> : null}</button>)}
      <button className="ml-auto rounded p-1.5 hover:bg-muted" aria-label={state?.pinnedId ? '取消固定内容' : '固定当前内容'} title={state?.pinnedId ? '取消固定' : '固定当前内容'} onClick={() => action({ type: 'pin', value: !state?.pinnedId })}>{state?.pinnedId ? <PinOff size={14}/> : <Pin size={14}/>}</button>
    </div>
    <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground"><label className="flex items-center gap-1.5"><input type="checkbox" checked={state?.autoFollow ?? true} onChange={e => action({ type: 'follow', value: e.target.checked })}/>跟随新结果</label>{state?.pinnedId ? <span>已固定当前内容</span> : null}</div>
    {Boolean(state?.openedIds.some(id => snapshot.resources.some(r => r.id === id))) && <div className="flex gap-1 overflow-x-auto" aria-label="已打开内容">{state.openedIds.map(id => {
      const item = snapshot.resources.find(r => r.id === id); if (!item) return null;
      return <button key={id} title={item.title} className={'max-w-44 shrink-0 truncate rounded px-2 py-1 text-xs ' + (id === state.activeId ? 'bg-primary/10 text-primary' : 'hover:bg-muted')} onClick={() => action({ type: 'select', id })}>{item.title}</button>;
    })}</div>}
  </div>;
}

type RendererProps = { resource: PresentationResource; snapshot: PresentationSnapshot; action: Action; onReady: () => void; onError: (message: string) => void };
type Renderer = { id: string; priority: number; supports: (resource: PresentationResource) => boolean; component: React.ComponentType<RendererProps> };
const renderers: Renderer[] = [];
export function registerPresentationRenderer(renderer: Renderer) {
  if (renderers.some(entry => entry.id === renderer.id)) throw new Error('Duplicate presentation renderer: ' + renderer.id);
  renderers.push(renderer); renderers.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function Results({ snapshot, action, resource, onReady }: Partial<RendererProps> & { snapshot: PresentationSnapshot; action: Action }) {
  React.useEffect(() => { onReady?.(); }, [onReady]);
  const members = resource?.source.memberIds;
  const resources = snapshot.resources.filter(item => members ? members.includes(item.id) : item.kind !== 'collection' && item.isResult !== false).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return <div className="flex-1 overflow-auto p-3"><h3 className="mb-3 text-sm font-medium">{resource?.title || '会话结果'}</h3>{resources.length ? resources.map(item => <button key={item.id} className="mb-2 flex w-full flex-col gap-1 rounded-lg border border-border/70 p-3 text-left hover:bg-muted/50" onClick={() => action({ type: 'select', id: item.id })}><span className="break-words text-sm">{item.title}</span><span className="break-all text-xs text-muted-foreground">{item.source.path || item.kind}</span></button>) : <p className="text-xs text-muted-foreground">文件、App 成果和本轮变更会显示在这里。</p>}</div>;
}

function FileResource({ resource, snapshot, action, onReady, onError }: RendererProps) {
  const [file, setFile] = React.useState<WorkspacePreviewData | null>(null), [error, setError] = React.useState('');
  const loadKey = JSON.stringify([snapshot.epoch, resource.id, resource.revision, resource.view, resource.location]);
  const [loadedKey, setLoadedKey] = React.useState('');
  const fileRef = React.useRef(file); fileRef.current = file;
  React.useEffect(() => {
    let active = true;
    void window.agentDesktop.presentation.load({ sessionId: snapshot.sessionId, artifactId: resource.id }).then(result => {
      if (!active) return;
      if (fileRef.current?.metadata?.dirty) { setError('文件已在外部更新，当前草稿已保留。'); return; }
      setFile(result.file); setLoadedKey(loadKey); setError('');
    }).catch(reason => { if (active) { setError(String(reason)); onError(String(reason)); } });
    return () => { active = false; };
  }, [snapshot.sessionId, snapshot.epoch, resource.id, resource.revision, resource.view, resource.location?.line, resource.location?.column, file?.metadata?.dirty, onError]);
  if (!file) return <div className="p-4 text-sm text-muted-foreground">{error || '正在加载内容…'}</div>;
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex items-center gap-2 border-b border-border/70 px-3 py-1.5"><span className="min-w-0 flex-1 truncate text-xs">{resource.title}</span><button className="rounded p-1 hover:bg-muted" title="在独立窗口打开" aria-label="在独立窗口打开" onClick={() => void window.agentDesktop.presentation.popout({ sessionId: snapshot.sessionId, artifactId: resource.id }).catch(reason => setError(String(reason)))}><ExternalLink size={14}/></button></div>
    {error && <div role="status" className="px-3 py-2 text-xs text-amber-600">{error}</div>}
    <div className="min-h-0 flex-1"><PreviewDrawer onReady={loadedKey === loadKey ? onReady : undefined} onError={loadedKey === loadKey ? onError : undefined} visible tabs={[file]} activePath={file.path} standalone onActivate={() => {}} onUpdateTab={(_path, patch) => { setFile(current => ({ ...current, ...patch })); if (file.metadata?.remote && typeof patch.metadata?.dirty === 'boolean') action({ type: 'dirty', id: resource.id, value: patch.metadata.dirty }); }} onCloseTab={() => action({ type: 'dismiss', id: resource.id })} onCloseOthers={() => {}} onCloseAll={() => action({ type: 'dismiss', id: resource.id })} onCloseDrawer={() => action({ type: 'dismiss', id: resource.id })}/></div>
  </div>;
}

function AppResource({ resource, snapshot }: RendererProps) {
  const [available, setAvailable] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    let active = true;
    const refresh = () => void window.agentDesktop.listApps().then(apps => { if (active) setAvailable(apps.some(app => (app.id || app.name) === resource.source.appId && conversationView(app))); }).catch(() => { if (active) setAvailable(false); });
    refresh(); const off = window.agentDesktop.onAppsChanged(refresh);
    return () => { active = false; off(); };
  }, [resource.source.appId]);
  return <div className="p-4"><h3 className="mb-2 text-sm font-medium">{resource.title}</h3><p className="mb-3 text-xs text-muted-foreground">{available === false ? 'App 工作台当前不可用，请检查安装状态和权限。' : '在 App 工作台中查看和操作此结果。'}</p><button disabled={!available} className="rounded border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50" onClick={() => window.dispatchEvent(new CustomEvent('moss:open-app-workbench', { detail: { sessionId: snapshot.sessionId, appId: resource.source.appId, route: resource.source.route } }))}>打开工作台</button></div>;
}

function DirectoryResource({ resource, snapshot, onReady, onError }: RendererProps) {
  const [items, setItems] = React.useState<Array<{ path: string; name: string; type: string }> | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let active = true;
    void window.agentDesktop.listWorkspaceDir({ sessionId: snapshot.sessionId, dirPath: resource.source.workspacePath || resource.source.path }).then(value => { if (active) { setItems(value.items); onReady(); } }).catch(reason => { if (active) { setError(String(reason)); onError(String(reason)); } });
    return () => { active = false; };
  }, [snapshot.sessionId, resource.id, resource.revision, onReady, onError]);
  return <div data-presentation-directory className="h-full overflow-auto p-3"><div className="mb-2 break-all text-xs text-muted-foreground">{resource.source.path}</div>{error || (items ? items.length ? items.map(item => <button data-directory-entry={item.path} key={item.path} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted" onClick={() => void window.agentDesktop.presentation.open({ sessionId: snapshot.sessionId, input: { items: [{ path: item.path }] } }).then(result => { if (!result.ok) setError(result.error || '内容不可用'); })}><FolderOpen size={14}/>{item.name}</button>) : '文件夹为空' : '正在读取文件夹…')}</div>;
}

function ResourceUnavailable({ resource, onError }: RendererProps) {
  React.useEffect(() => { onError('内容不可用或暂不支持嵌入预览'); }, [onError]);
  return <div className="p-4 text-sm text-muted-foreground">{resource.title} 当前不可用或暂不支持嵌入预览。</div>;
}
function TurnDiffResource({ resource, snapshot, onReady, onError }: RendererProps) {
  const [payload, setPayload] = React.useState<Awaited<ReturnType<Window['agentDesktop']['getTurnChanges']>> | null>(null);
  React.useEffect(() => {
    let active = true;
    void window.agentDesktop.getTurnChanges({ sessionId: snapshot.sessionId }).then(value => { if (active) { setPayload(value); if (value.turns.some(turn => turn.observationId === resource.source.observationId)) onReady(); else onError('这份历史变更已不可用'); } }).catch(reason => { if (active) onError(String(reason)); });
    return () => { active = false; };
  }, [snapshot.sessionId, resource.id, resource.revision, onReady, onError]);
  const change = payload?.turns.find(turn => turn.observationId === resource.source.observationId);
  return <div className="h-full overflow-auto p-2">{change ? <TurnChangeCard sessionId={snapshot.sessionId} change={change} rewindSupported={payload.rewind.supported} rewindDisabledReason={payload.rewind.reason} initiallyExpanded inset={false}/> : <p className="p-3 text-xs text-muted-foreground">{payload ? '这份历史变更已不可用。' : '正在读取变更…'}</p>}</div>;
}
registerPresentationRenderer({ id: 'files', priority: 10, supports: r => r.kind === 'file', component: FileResource });
registerPresentationRenderer({ id: 'directories', priority: 10, supports: r => r.kind === 'directory', component: DirectoryResource });
registerPresentationRenderer({ id: 'diffs', priority: 10, supports: r => r.source.type === 'turn-diff', component: TurnDiffResource });
registerPresentationRenderer({ id: 'collections', priority: 10, supports: r => r.source.type === 'collection', component: Results });
registerPresentationRenderer({ id: 'apps', priority: 10, supports: r => r.source.type === 'app-view', component: AppResource });

class ResourceBoundary extends React.Component<{ children: React.ReactNode; revision: string; onError: (message: string) => void }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidUpdate(previous: { revision: string }) { if (this.state.error && previous.revision !== this.props.revision) this.setState({ error: '' }); }
  componentDidCatch(error: Error) { this.props.onError(error.message); }
  render() { return this.state.error ? <div role="alert" className="p-4 text-sm">无法显示内容：{this.state.error}</div> : this.props.children; }
}

export function PresentationContent({ snapshot, action }: { snapshot: PresentationSnapshot; action: Action }) {
  const resource = snapshot.resources.find(item => item.id === snapshot.state.activeId);
  const request = snapshot.request?.artifactId === resource?.id && snapshot.request?.revision === resource?.revision ? snapshot.request : null;
  const onReady = React.useCallback(() => { if (request) void window.agentDesktop.presentation.acknowledge({ sessionId: snapshot.sessionId, ...request, state: 'shown' }).catch(() => {}); }, [snapshot.sessionId, request?.requestId]);
  const onError = React.useCallback((error: string) => { if (request) void window.agentDesktop.presentation.acknowledge({ sessionId: snapshot.sessionId, ...request, state: 'error', error }).catch(() => {}); }, [snapshot.sessionId, request?.requestId]);
  if (!resource || snapshot.state.activeId === 'results') return <Results snapshot={snapshot} action={action}/>;
  if (resource.availability === 'expired' || resource.availability === 'unavailable') return <ResourceUnavailable resource={resource} snapshot={snapshot} action={action} onReady={onReady} onError={onError}/>;
  const Component = renderers.find(entry => entry.supports(resource))?.component || ResourceUnavailable;
  return <ResourceBoundary key={resource.id} revision={resource.revision} onError={onError}><Component resource={resource} snapshot={snapshot} action={action} onReady={onReady} onError={onError}/></ResourceBoundary>;
}
