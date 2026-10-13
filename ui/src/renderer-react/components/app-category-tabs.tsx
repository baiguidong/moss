import * as React from 'react';
import { groupApps } from '@/lib/app-categories';
import { cn } from '@/lib/utils';

export function AppCategoryTabs({ apps, value, onChange, panelId }: {
  apps: Array<{ category?: string }>;
  value: string;
  onChange: (value: string) => void;
  panelId: string;
}) {
  const tabs = [{ id: 'all', label: '全部', count: apps.length },
    ...groupApps(apps).map(group => ({ id: group.id, label: group.label, count: group.apps.length }))];
  const selected = tabs.some(tab => tab.id === value) ? value : 'all';
  React.useEffect(() => { if (selected !== value) onChange(selected); }, [selected, value, onChange]);
  return <div role="tablist" aria-label="App 分类" className="flex min-w-0 gap-1.5 overflow-x-auto py-1 [scrollbar-width:none]">
    {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`${panelId}-${tab.id}`} aria-controls={panelId}
      aria-selected={selected === tab.id} tabIndex={selected === tab.id ? 0 : -1} onClick={() => onChange(tab.id)}
      onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); onChange(tabs[next].id);
        document.getElementById(`${panelId}-${tabs[next].id}`)?.focus();
      }}
      className={cn('flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected === tab.id ? 'bg-foreground text-background' : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground')}>
      {tab.label}<span className="text-[10px] tabular-nums opacity-60">{tab.count}</span>
    </button>)}
  </div>;
}
