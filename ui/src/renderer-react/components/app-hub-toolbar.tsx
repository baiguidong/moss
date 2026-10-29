import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type AppHubTab = 'marketplace' | 'installed';

/** Match the skill/expert hub toolbar for both App lists. */
export function AppHubToolbar({ tab, installedCount, onChangeTab, query, onQuery, actions, navigation, busy = false, searchPlaceholder }: {
  tab: AppHubTab; installedCount: number; onChangeTab(tab: AppHubTab): void;
  query: string; onQuery(query: string): void; actions: ReactNode; navigation?: ReactNode; busy?: boolean;
  searchPlaceholder?: string;
}) {
  return <div data-app-header className="shrink-0 bg-background/92 px-4 py-1.5 backdrop-blur sm:px-5">
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {navigation || <div role="tablist" aria-label="App 来源" className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-muted/70 p-0.5">
        {(['marketplace', 'installed'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value}
          data-app-hub-tab={value} disabled={busy} onClick={() => onChangeTab(value)}
          className={cn('h-7 rounded-md px-3 text-xs font-semibold transition-colors disabled:opacity-50', tab === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {value === 'marketplace' ? '应用市场' : `已安装 ${installedCount}`}
        </button>)}
      </div>}
      <div className="relative ml-auto w-full sm:w-[300px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="搜索应用" value={query} onChange={event => onQuery(event.target.value)} className="h-8 rounded-lg pl-9 text-sm" placeholder={searchPlaceholder || (tab === 'installed' ? '搜索已安装应用' : '搜索应用名称或描述')} />
      </div>
      {actions}
    </div>
  </div>;
}
