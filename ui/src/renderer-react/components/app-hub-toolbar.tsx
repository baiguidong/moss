import type { ReactNode } from 'react';
import { ResourceHubSearch } from '@/components/resource-hub-search';
import { cn } from '@/lib/utils';

export type AppHubTab = 'marketplace' | 'installed';

/** Match the skill/expert hub toolbar for both App lists. */
export function AppHubToolbar({ tab, installedCount, onChangeTab, query, onQuery, actions, refresh, navigation, busy = false, searchPlaceholder, searchVisible = true }: {
  tab: AppHubTab; installedCount: number; onChangeTab(tab: AppHubTab): void;
  query: string; onQuery(query: string): void; actions: ReactNode; navigation?: ReactNode; busy?: boolean;
  searchPlaceholder?: string;
  refresh?: ReactNode;
  searchVisible?: boolean;
}) {
  return <div data-app-header className="shrink-0 bg-background/92 backdrop-blur">
    <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-wrap items-center gap-1.5 px-4 py-1.5 sm:px-5">
      {navigation || <div role="tablist" aria-label="App 来源" className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-muted/70 p-0.5">
        {(['marketplace', 'installed'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value}
          data-app-hub-tab={value} disabled={busy} onClick={() => onChangeTab(value)}
          className={cn('h-7 rounded-md px-3 text-xs font-semibold transition-colors disabled:opacity-50', tab === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {value === 'marketplace' ? '应用市场' : `已安装 ${installedCount}`}
        </button>)}
      </div>}
      <ResourceHubSearch value={query} onChange={onQuery} label="搜索应用" placeholder={searchPlaceholder || (tab === 'installed' ? '搜索已安装应用' : '搜索应用名称或描述')} refresh={refresh} visible={searchVisible} />
      <div className="ml-auto flex items-center gap-1.5">{actions}</div>
    </div>
  </div>;
}
