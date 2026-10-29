import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import type { StoredApp } from '@/types';
import { getAppWorkspacePages } from '@/lib/app-navigation';
import { confirmAppViewLeave, setAppViewGuard } from '@/lib/app-view-guard';
import { AppIcon } from '@/components/app-icon';
import { Button } from '@/components/ui/button';
import { EmbeddedAppView } from '@/components/embedded-app-view';

/** Full workspace for App-owned pages declared on a Core details App. */
export function AppWorkspaceView({ app, route, workspace, onBack, onNavigate }: {
  app: StoredApp;
  route: string;
  workspace?: string;
  onBack: () => void;
  onNavigate: (route: string) => void;
}) {
  const pages = getAppWorkspacePages(app);
  // An explicit missing/locked route must never silently open another page.
  const selected = route ? pages.find(page => page.route === route) : pages.find(page => !page.unavailableReason) || pages[0];
  const [state, setState] = React.useState({ dirty: false, busy: false });
  const onViewState = React.useCallback((next: typeof state) => { setState(next); setAppViewGuard(next); }, []);
  React.useEffect(() => () => setAppViewGuard(null), []);
  React.useEffect(() => {
    const leave = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest?.('[data-app-workspace-content]') || !target.closest?.('button,a,input,select,[role=button]')) return;
      if (!confirmAppViewLeave()) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (state.dirty || state.busy) { event.preventDefault(); event.returnValue = ''; }
    };
    document.addEventListener('click', leave, true);
    window.addEventListener('beforeunload', unload);
    return () => { document.removeEventListener('click', leave, true); window.removeEventListener('beforeunload', unload); };
  }, [state]);
  const title = app.displayName || app.title || app.name;
  return <section data-app-workspace={app.id || app.name} aria-label={title} className="flex h-full min-h-0 min-w-0 flex-col bg-background">
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
      <Button variant="ghost" size="sm" className="shrink-0 gap-1.5" aria-label="返回应用详情" disabled={state.busy} onClick={() => { if (confirmAppViewLeave()) onBack(); }}><ArrowLeft className="h-4 w-4" />返回</Button>
      <AppIcon icon={app.icon} className="h-7 w-7 shrink-0 rounded-lg" />
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
      {pages.length > 1 && <nav aria-label="应用页面" className="flex max-w-full flex-wrap items-center gap-1">
        {pages.map(page => <Button key={page.id} size="sm" variant={selected?.id === page.id ? 'secondary' : 'ghost'}
          data-app-workspace-page={page.viewId} aria-current={selected?.id === page.id ? 'page' : undefined}
          disabled={state.busy || Boolean(page.unavailableReason)} title={page.unavailableReason || undefined}
          onClick={() => { if (page.id !== selected?.id && confirmAppViewLeave()) onNavigate(page.route); }}>{page.title}</Button>)}
      </nav>}
    </header>
    <div data-app-workspace-content className="min-h-0 min-w-0 flex-1">
      {selected && !selected.unavailableReason
        ? <EmbeddedAppView key={`${app.name}/${selected.version}/${selected.id}`} appName={app.name} app={app} workspace={workspace}
          settingId={selected.settingId} version={selected.version} compact onViewState={onViewState} />
        : <p role="alert" className="p-5 text-sm text-muted-foreground">{selected?.unavailableReason || '此应用页面已不可用，请返回详情重新打开。'}</p>}
    </div>
  </section>;
}
