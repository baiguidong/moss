import { RefreshCcw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getAppToolbarSettingsEntry } from '@/lib/app-navigation';
import type { StoredApp } from '@/types';

/** The Host opens the App's declared settings view; the App owns its UI. */
export function AppSettingsButton({ app, onOpenSettings }: { app: StoredApp; onOpenSettings?: (route: string) => void }) {
  const entry = getAppToolbarSettingsEntry(app);
  if (!entry) return null;
  return <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 rounded-xl px-2.5 text-xs" data-app-settings={app.id || app.name}
    disabled={Boolean(entry.unavailableReason) || !onOpenSettings} title={entry.unavailableReason || '打开应用设置'}
    onClick={() => onOpenSettings?.(entry.route)}><Settings2 className="h-3.5 w-3.5" />设置</Button>;
}

export function AppToolbarActions({ app, onRefresh, onOpenSettings }: { app?: StoredApp; onRefresh: () => void; onOpenSettings?: (route: string) => void }) {
  return <div className="flex shrink-0 items-center gap-2" data-app-toolbar-actions>
    {app && <AppSettingsButton app={app} onOpenSettings={onOpenSettings} />}
    <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-xl px-2.5 text-xs" onClick={onRefresh}>
      <RefreshCcw className="h-3.5 w-3.5" />刷新
    </Button>
  </div>;
}
