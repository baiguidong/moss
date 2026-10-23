import * as React from 'react';
import { X } from 'lucide-react';
import { ComposerResourceSelectionArea } from '@/components/composer-resource-selection-area';
import { AppToolSelectionContext, getAppToolServices, parseAppServiceKey, toolAppId, toolAppTitle } from '@/lib/app-tool-selection';
import type { Project, StoredApp } from '@/types';

type Selection = Pick<Project, 'appIds' | 'appServiceIds'>;
export function setProjectAppServices(value: Partial<Selection>, appId: string, ids: string[]): Selection {
  return {
    appIds: (value.appIds || []).filter(id => id !== appId),
    appServiceIds: [...new Set([...(value.appServiceIds || []).filter(id => parseAppServiceKey(id)?.appId !== appId), ...ids])],
  };
}

export function ProjectAppDefaultsPicker({ apps, value, onChange, loading = false }: {
  apps: StoredApp[]; value: Partial<Selection>; onChange: (patch: Selection) => void; loading?: boolean;
}) {
  const parent = React.useContext(AppToolSelectionContext);
  const appIds = value.appIds || [], appServiceIds = value.appServiceIds || [];
  const selections = [
    ...appIds.map(id => ({ id, title: apps.find(app => toolAppId(app) === id) ? toolAppTitle(apps.find(app => toolAppId(app) === id)!) : id, service: false })),
    ...appServiceIds.map(id => {
      const app = apps.find(app => toolAppId(app) === parseAppServiceKey(id)?.appId);
      const service = app && getAppToolServices(app).find(item => item.id === id);
      return { id, title: app ? `${toolAppTitle(app)} / ${service?.title || parseAppServiceKey(id)?.serviceId}` : id, service: true };
    }),
  ];
  return <div className="space-y-2.5 border-t border-border pt-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">App</span>
      <AppToolSelectionContext.Provider value={{ apps, selectedIds: appIds, selectedServiceIds: appServiceIds,
        enabled: true, pending: loading, nextTurn: false, openManager: parent.openManager,
        toggle: id => onChange({ appIds: appIds.includes(id) ? appIds.filter(item => item !== id) : [...appIds, id], appServiceIds }),
        toggleService: id => onChange({ appIds, appServiceIds: appServiceIds.includes(id) ? appServiceIds.filter(item => item !== id) : [...appServiceIds, id] }),
        setServices: (appId, ids) => onChange(setProjectAppServices(value, appId, ids)),
      }}><ComposerResourceSelectionArea /></AppToolSelectionContext.Provider>
    </div>
    <p className="text-xs text-muted-foreground">新会话默认使用的 App 和子服务。</p>
    <div className="flex flex-wrap gap-1.5">{selections.map(item => <span key={item.id} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
      <span className="truncate">{item.title}</span>
      <button type="button" aria-label={`移除 ${item.title}`} onClick={() => onChange({ appIds: item.service ? appIds : appIds.filter(id => id !== item.id), appServiceIds: item.service ? appServiceIds.filter(id => id !== item.id) : appServiceIds })}><X className="h-3 w-3" /></button>
    </span>)}</div>
  </div>;
}

export function ProjectAppDefaults({ value, onChange }: { value: Partial<Project>; onChange: (patch: Partial<Project>) => void }) {
  const [apps, setApps] = React.useState<StoredApp[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let disposed = false, request = 0;
    const refresh = async () => {
      const current = ++request;
      try { const apps = await window.agentDesktop.listApps(); if (!disposed && current === request) { setApps(apps); setError(''); } }
      catch (error) { if (!disposed && current === request) setError(String(error instanceof Error ? error.message : error)); }
      finally { if (!disposed && current === request) setLoading(false); }
    };
    void refresh();
    const off = window.agentDesktop.onAppsChanged(() => { void refresh(); });
    return () => { disposed = true; off(); };
  }, []);
  return <><ProjectAppDefaultsPicker apps={apps} value={value} onChange={onChange} loading={loading} />
    {error && <p className="text-xs text-destructive">{error}</p>}</>;
}
