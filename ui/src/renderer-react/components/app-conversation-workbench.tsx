import * as React from 'react';
import { ArrowLeft, GitBranch } from 'lucide-react';
import { AppComposerContext } from '@/lib/app-composer';
import { conversationView, conversationWorkbenchEntries, conversationWorkbenchRoute, type ConversationWorkbenchEntry } from '@/lib/app-conversation-workbench';
import { EmbeddedAppView } from './embedded-app-view';
import type { BackgroundTaskInfo, StoredApp } from '@/types';

const labels: Record<string, string> = { running: '进行中', completed: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断' };
export function useAppConversationWorkbench(sessionId: string | undefined, tasks: BackgroundTaskInfo[]) {
  const { selection } = React.useContext(AppComposerContext);
  const [apps, setApps] = React.useState<StoredApp[]>([]);
  const [ledger, setLedger] = React.useState<{ sessionId?: string; events: any[] }>({ events: [] });
  const [choice, setChoice] = React.useState<{ sessionId?: string; key: string }>({ key: '' });
  const [visibility, setVisibility] = React.useState<{ sessionId?: string; open: boolean; mounted: boolean }>({ open: false, mounted: false });
  React.useEffect(() => {
    let active = true;
    const refresh = () => void window.agentDesktop.listApps().then(value => { if (active) setApps(value) }).catch(() => {});
    refresh(); const off = window.agentDesktop.onAppsChanged(refresh);
    return () => { active = false; off() };
  }, []);
  React.useEffect(() => {
    let active = true; const arrived: any[] = [];
    setLedger({ sessionId, events: [] });
    setVisibility({ sessionId, open: false, mounted: false });
    setChoice({ sessionId, key: sessionStorage.getItem(`app-workbench:${sessionId}`) || '' });
    const relevant = (event: any) => ['app_view', 'app_task'].includes(event.subtype);
    const merge = (events: any[]) => [...new Map(events.filter(relevant).map(event => [event.uuid || `${event.appId}:${event.route}:${event.appTaskId}`, event])).values()];
    if (sessionId) void window.agentDesktop.getSession({ sessionId }).then(detail => {
      if (active) setLedger({ sessionId, events: merge([...(detail.history || []), ...arrived]) });
    }).catch(() => {});
    const off = window.agentDesktop.onEvent(({ sessionId: id, payload }) => {
      if (id !== sessionId || !relevant(payload)) return;
      arrived.push(payload); setLedger(previous => ({ sessionId, events: merge([...(previous.sessionId === sessionId ? previous.events : []), payload]) }));
    });
    return () => { active = false; off() };
  }, [sessionId]);
  const events = ledger.sessionId === sessionId ? ledger.events : [];
  // Match task IDs against this session's ledger, including events that arrive
  // during the initial read, so changing sessions cannot expose a stale task list.
  const taskIds = new Set(events.filter(event => event.subtype === 'app_task').map(event => event.appTaskId));
  const entries = conversationWorkbenchEntries(apps, events.filter(event => event.subtype === 'app_view'), tasks.filter(task => taskIds.has(task.id)), selection);
  const entry = entries.find(item => choice.sessionId === sessionId && item.key === choice.key) || entries.find(item => item.status === 'running') || entries[0];
  const open = visibility.sessionId === sessionId && visibility.open && Boolean(entry);
  const mounted = visibility.sessionId === sessionId && visibility.mounted && Boolean(entry);
  const show = () => setVisibility({ sessionId, open: true, mounted: true });
  const close = React.useCallback(() => setVisibility(previous => ({ ...previous, open: false })), []);
  const select = (key: string) => { setChoice({ sessionId, key }); sessionStorage.setItem(`app-workbench:${sessionId}`, key) };
  React.useEffect(() => window.agentDesktop.onAppPrepareComposer(payload => { if (payload.sessionId === sessionId) close() }), [sessionId, close]);
  return { entries, entry, open, mounted, show, close, select, appIds: new Set(apps.filter(conversationView).map(app => app.id || app.name)) };
}

export function AppWorkbenchButton({ entries, entry, open, onClick }: { entries: ConversationWorkbenchEntry[]; entry?: ConversationWorkbenchEntry; open: boolean; onClick: () => void }) {
  if (!entry) return null;
  const running = entries.filter(item => item.status === 'running').length;
  const status = running ? `${running} 个进行中` : entry.kind === 'preview' ? '预览' : '回看';
  return <button type="button" data-app-workbench-entry aria-label={`${open ? '返回会话' : `打开${entry.viewTitle}工作台`}`} aria-pressed={open} onClick={onClick}
    className="inline-flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 text-xs hover:bg-muted">
    <GitBranch className="h-3.5 w-3.5 shrink-0"/><span>{entry.viewTitle}</span><span className="hidden text-muted-foreground sm:inline">· {status}</span>
  </button>;
}

export function AppConversationWorkbench({ sessionId, entries, entry, onSelect, onClose }: { sessionId?: string; entries: ConversationWorkbenchEntry[]; entry: ConversationWorkbenchEntry; onSelect: (key: string) => void; onClose: () => void }) {
  return <section className="flex h-full min-h-0 flex-1 flex-col bg-background" aria-label={`${entry.viewTitle}工作台`} data-app-workbench>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
      <button type="button" onClick={onClose} aria-label="返回聊天" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs hover:bg-muted"><ArrowLeft className="h-3.5 w-3.5"/>返回聊天</button>
      <select aria-label="选择会话中的工作流" value={entry.key} onChange={event => onSelect(event.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs">
        {entries.map(item => <option key={item.key} value={item.key}>{item.title} · {item.kind === 'preview' ? '预览' : `${labels[item.status || ''] || item.status} · ${new Date(item.timestamp || 0).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}</option>)}
      </select>
    </div>
    <div className="min-h-0 flex-1"><EmbeddedAppView appName={entry.appId} sessionId={sessionId} route={conversationWorkbenchRoute(entry.viewRoute, entry.route)} compact /></div>
  </section>;
}
