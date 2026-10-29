import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppDetailsView } from '@/components/app-details-view';
import { AppsPanel } from '@/components/apps-panel';
import { CommonResourcesView } from '@/components/common-resources-view';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getAppPrimaryEntry } from '@/lib/app-navigation';
import { useNavigationHistory } from '@/lib/use-navigation-history';
import type { MainView } from '@/components/app-sidebar';
import type { StoredApp } from '@/types';
import '@/globals.css';
const api = window as any;
const rpc = (method: string) => (input: unknown) => api.detailsRpc(method, input);
api.agentDesktop = {
  inspectAppMcpTools: rpc('app:inspect-mcp-tools'),
  readAppSkill: rpc('app:read-skill'), setAppToolScope: rpc('app:set-tool-scope'), setAppEnabled: rpc('app:set-enabled'), setAppGrants: rpc('app:set-grants'),
  setAppInstanceEnabled: rpc('app:set-instance-enabled'), restartAppInstance: rpc('app:restart-instance'), getAppInstanceLogs: rpc('app:get-instance-logs'),
  skillHub: { getInstalled: async () => ({ success: true, data: [] }) }, expertHub: { getInstalled: async () => ({ success: true, data: [] }) },
  getAppAuthoring: async () => ({ available: false }), onAppsChanged: () => () => {},
  onAppInstallProgress: () => () => {}, getAppInstallProgress: async () => [], listBuiltinApps: async () => [],
  getAppDiscoveryPreferences: async () => ({ sections: { installed: 'all', marketplace: 'all' } }),
  setAppDiscoveryPreferences: async () => ({ sections: { installed: 'all', marketplace: 'all' } }),
};
function Fixture() {
  const [apps, setApps] = React.useState<StoredApp[]>([]), [view, setView] = React.useState<MainView>('common');
  const [draft, setDraft] = React.useState('保留原有草稿');
  const refresh = React.useCallback(async () => { setApps([await api.detailsRpc('catalog')]); }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const history = useNavigationHistory({ view, ...(view === 'app-info' ? { appName: apps[0]?.name } : {}) }, entry => { setView(entry.view); return true; });
  const launch = () => { if (getAppPrimaryEntry(apps[0])?.location === 'info') setView('app-info'); };
  return <TooltipProvider><main className="flex h-screen min-w-0 flex-col bg-background text-foreground">
    <div className="flex shrink-0 gap-4 border-b px-5 py-2 text-sm"><button onClick={() => setView('common')}>常用</button><button onClick={() => setView('apps')}>Apps</button><button disabled={!history.canGoBack} onClick={() => void history.back()}>后退</button><button disabled={!history.canGoForward} onClick={() => void history.forward()}>前进</button></div>
    <div className="min-h-0 flex-1">{!apps.length ? null : view === 'common' ? <CommonResourcesView apps={apps} onOpenApp={launch} /> : view === 'apps' ? <AppsPanel initialTab="installed" apps={apps} onLaunch={launch} onRefresh={refresh} /> : view === 'app-info' ? <AppDetailsView app={apps[0]} onBack={() => void history.back()} onRefresh={refresh} onTry={prompt => { if (prompt) setDraft(value => `${value}\n\n${prompt}`); setView('chat'); }} /> : <textarea aria-label="主会话输入" value={draft} onChange={event => setDraft(event.target.value)} />}</div>
  </main></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
