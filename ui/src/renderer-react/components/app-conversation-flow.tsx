import * as React from 'react';
import { GitFork, PanelLeftClose, Square } from 'lucide-react';
import { AppComposerContext } from '@/lib/app-composer';
import { EmbeddedAppView } from './embedded-app-view';
import type { BackgroundTaskInfo } from '@/types';

const labels: Record<string,string> = { running:'运行中', completed:'已完成', failed:'失败', cancelled:'已停止', killed:'已停止', interrupted:'已中断' };
export function AppConversationFlow({ sessionId, tasks, children }: { sessionId?:string; tasks:BackgroundTaskInfo[]; children:React.ReactNode }) {
  const { selection } = React.useContext(AppComposerContext);
  const entries = tasks.filter(task => task.kind === 'app' && task.appId === 'moss.workflow' && task.route);
  const [savedView, setSavedView] = React.useState<{appId:string;title:string;route:string} | null>(null);
  React.useEffect(() => {
    let active = true; setSavedView(null);
    if (sessionId) void window.agentDesktop.getSession({sessionId}).then(detail => { if (active) setSavedView((detail.history || []).filter((event:any)=>event.subtype === 'app_view').at(-1) as any || null) }).catch(() => {});
    const off = window.agentDesktop.onEvent(({sessionId:id,payload}) => { if (id === sessionId && payload.subtype === 'app_view') setSavedView(payload as any) });
    return () => { active=false; off() };
  }, [sessionId]);
  const [selected, setSelected] = React.useState('');
  const [collapsed, setCollapsed] = React.useState(() => sessionStorage.getItem(`app-flow:${sessionId}`) === 'collapsed');
  const [available, setAvailable] = React.useState(true);
  React.useEffect(() => { setSelected(''); setCollapsed(sessionStorage.getItem(`app-flow:${sessionId}`) === 'collapsed') }, [sessionId]);
  React.useEffect(() => {
    const refresh = () => void window.agentDesktop.listApps().then(apps => setAvailable(apps.some(app => (app.id === 'moss.workflow' || app.name === 'moss.workflow') && app.enabled)));
    refresh(); return window.agentDesktop.onAppsChanged(refresh);
  }, []);
  const task = entries.find(e => e.id === selected) || entries.at(-1);
  const definitionView = selection?.route ? selection : savedView;
  const preview = definitionView?.route && (!task || selected === 'preview') ? definitionView : null;
  const route = preview?.route || task?.route;
  const toggle = () => setCollapsed(value => { sessionStorage.setItem(`app-flow:${sessionId}`, value ? 'open' : 'collapsed'); return !value });
  if (!route || !available) return <>{children}</>;
  const appName = preview?.appId || task?.appId || '';
  return <div className="flex min-h-0 flex-1 flex-col" data-app-flow>
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3 text-xs">
      <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground" onClick={toggle} aria-label={collapsed ? '展开流程' : '收起流程'}><GitFork className="h-3.5 w-3.5"/>流程</button>
      <select aria-label="选择流程运行" className="min-w-0 max-w-56 truncate bg-background" value={preview ? 'preview' : task?.id} onChange={e => setSelected(e.target.value)}>
        {definitionView?.route && <option value="preview">{definitionView.title} · 定义预览</option>}
        {entries.map(entry => <option key={entry.id} value={entry.id}>{entry.description} · {labels[entry.status] || entry.status}</option>)}
      </select>
      {task?.status === 'running' && !preview && collapsed && <button className="ml-auto flex items-center gap-1 text-destructive" onClick={() => sessionId && void window.agentDesktop.killTask({sessionId,taskId:task.id})}><Square className="h-3 w-3"/>停止</button>}
    </div>
    <div className="relative flex min-h-0 flex-1">
      {!collapsed && <aside className="absolute inset-0 z-20 flex w-full min-h-0 flex-col border-r border-border bg-background @[850px]:relative @[850px]:inset-auto @[850px]:z-auto @[850px]:w-[360px] @[850px]:shrink-0">
        <button className="flex h-7 shrink-0 items-center justify-end gap-1 px-2 text-xs text-muted-foreground" onClick={toggle}><PanelLeftClose className="h-3 w-3"/>收起</button>
        <div className="min-h-0 flex-1"><EmbeddedAppView appName={appName} sessionId={sessionId} route={`${route}${route.includes('?')?'&':'?'}view=compact`} compact /></div>
      </aside>}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  </div>;
}
