import * as React from 'react';
import { ArrowLeft, Pin, PinOff, FolderOpen, Globe2, PanelsTopLeft, ExternalLink, ListChecks, ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import './presentation-panel.css';
import { PreviewDrawer } from '@/components/preview-drawer';
import { TurnChangeCard } from '@/components/chat/turn-change-card';
import { conversationView } from '@/lib/app-conversation-workbench';
import type { PresentationResource, PresentationSnapshot, SessionTask, WorkspacePreviewData } from '@/types';

type Action = (action: { type: string; id?: string; value?: boolean }) => void;
type PresentationToolbarProps = {
  snapshot: PresentationSnapshot | null;
  action: Action;
  sessionTasks?: SessionTask[];
  tasksActive?: boolean;
  onSelectTasks?: () => void;
  onSelectPresentation?: () => void;
};

const followHelp = '开启后，Moss 生成新的文件或结果时会自动切换到最新内容；关闭后保持当前查看位置。';

export function PresentationToolbar({
  snapshot,
  action,
  sessionTasks = [],
  tasksActive = false,
  onSelectTasks,
  onSelectPresentation,
}: PresentationToolbarProps) {
  const state = snapshot?.state;
  const activeResource = snapshot?.resources.find(item => item.id === state?.activeId);
  const activeView = tasksActive ? 'tasks' : !state || state.activeId === 'workspace' ? 'workspace'
    : state?.activeId === 'browser' || activeResource?.source.type === 'browser-tab' ? 'browser' : 'results';
  const resultCount = snapshot?.resources.filter(item => item.kind !== 'collection' && item.isResult !== false).length || 0;
  const views = [
    ...(sessionTasks.length ? [{ id: 'tasks', title: '会话任务', icon: ListChecks, count: sessionTasks.length }] : []),
    { id: 'workspace', title: '工作区', icon: FolderOpen, count: 0 },
    { id: 'results', title: '结果', icon: PanelsTopLeft, count: resultCount },
    { id: 'browser', title: '浏览器', icon: Globe2, count: 0 },
  ];
  const selected = views.find(view => view.id === activeView) || views[0];
  const selectView = (id: string) => {
    if (id === 'tasks') { onSelectTasks?.(); return; }
    onSelectPresentation?.();
    action({ type: 'select', id });
  };
  const iconButton = 'flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

  return <div className="presentation-navigation min-w-0 shrink-0 border-b border-border/70" aria-label="内容导航">
    <div className={cn('presentation-navigation-row flex min-w-0 items-center gap-1 px-2 py-1.5 text-xs', sessionTasks.length > 0 && 'has-tasks')}>
      <button type="button" className={iconButton} aria-label="返回上一个内容" disabled={!state?.back.length} onClick={() => { onSelectPresentation?.(); action({ type: 'back' }); }}><ArrowLeft size={14}/></button>
      <div className="presentation-navigation-tabs min-w-0 flex-1 items-center gap-0.5">
        {views.map(({ id, title, icon: Icon, count }) => <button key={id} type="button"
          className={cn('flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', activeView === id && 'bg-muted text-primary')}
          aria-label={count ? `${title} ${count} 项` : title} aria-pressed={activeView === id} onClick={() => selectView(id)}>
          <Icon size={13}/><span>{title}</span>{count > 0 && <span className="text-muted-foreground tabular-nums">{count}</span>}
        </button>)}
      </div>
      <div className="presentation-navigation-select min-w-0 flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="切换右侧视图" className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded bg-muted px-2 text-left text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <selected.icon size={13} className="shrink-0"/><span className="truncate">{selected.title}</span>
              {selected.count > 0 && <span className="text-muted-foreground tabular-nums">{selected.count}</span>}
              <ChevronDown size={13} className="ml-auto shrink-0"/>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44" aria-label="右侧视图">
            <DropdownMenuRadioGroup value={activeView} onValueChange={selectView}>
              {views.map(({ id, title, icon: Icon, count }) => <DropdownMenuRadioItem key={id} value={id} className="text-xs">
                <Icon size={13}/><span>{title}</span>{count > 0 && <span className="ml-auto text-muted-foreground tabular-nums">{count}</span>}
              </DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <label className="flex h-7 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded px-1 text-muted-foreground hover:bg-muted" title={followHelp}>
        <input className="h-3 w-3 accent-primary" type="checkbox" checked={state?.autoFollow ?? true} onChange={e => action({ type: 'follow', value: e.target.checked })}/>
        <span>跟随新结果</span>
      </label>
      <button type="button" className={iconButton} aria-label={state?.pinnedId ? '取消固定内容' : '固定当前内容'} title={state?.pinnedId ? '取消固定' : '固定当前内容'} disabled={!state || tasksActive} onClick={() => action({ type: 'pin', value: !state?.pinnedId })}>{state?.pinnedId ? <PinOff size={14}/> : <Pin size={14}/>}</button>
    </div>
  </div>;
}

function ResourceNavigation({ resource, snapshot, action }: { resource: PresentationResource; snapshot: PresentationSnapshot; action: Action }) {
  const openedIds = new Set([...snapshot.state.openedIds, resource.id]);
  const items = snapshot.resources.filter(item => openedIds.has(item.id));
  if (items.length < 2) return <span title={resource.title} className="block truncate px-2 text-xs">{resource.title}</span>;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label="切换已打开内容" title={resource.title} className="flex h-7 w-full min-w-0 items-center gap-2 rounded px-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0 flex-1 truncate">{resource.title}</span><ChevronDown size={13} className="shrink-0"/>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-24px)]" aria-label="已打开内容">
      <DropdownMenuRadioGroup value={resource.id} onValueChange={id => action({ type: 'select', id })}>
        {items.map(item => <DropdownMenuRadioItem key={item.id} value={item.id} textValue={item.title} title={item.source.path || item.title} className="text-xs">
          <span className="min-w-0">
            <span className="block truncate">{item.title}</span>
            {item.source.path && <span className="block truncate text-muted-foreground">{item.source.path}</span>}
          </span>
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
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
    {error && <div role="status" className="px-3 py-2 text-xs text-amber-600">{error}</div>}
    <div className="min-h-0 flex-1"><PreviewDrawer
      navigation={<ResourceNavigation resource={resource} snapshot={snapshot} action={action}/>}
      headerActions={<button type="button" className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="在独立窗口打开" aria-label="在独立窗口打开" onClick={() => void window.agentDesktop.presentation.popout({ sessionId: snapshot.sessionId, artifactId: resource.id }).catch(reason => setError(String(reason)))}><ExternalLink size={14}/></button>}
      onReady={loadedKey === loadKey ? onReady : undefined} onError={loadedKey === loadKey ? onError : undefined} visible tabs={[file]} activePath={file.path} standalone onActivate={() => {}} onUpdateTab={(_path, patch) => { setFile(current => ({ ...current, ...patch })); if (file.metadata?.remote && typeof patch.metadata?.dirty === 'boolean') action({ type: 'dirty', id: resource.id, value: patch.metadata.dirty }); }} onCloseTab={() => action({ type: 'dismiss', id: resource.id })} onCloseOthers={() => {}} onCloseAll={() => action({ type: 'dismiss', id: resource.id })} onCloseDrawer={() => action({ type: 'dismiss', id: resource.id })}/></div>
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
