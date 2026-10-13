import * as React from 'react';
import { groupApps } from '@/lib/app-categories';

export function AppCategoryFilter({ apps, value, onChange }: {
  apps: Array<{ category?: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const groups = groupApps(apps);
  return (
    <select aria-label="App 分类" className="h-8 max-w-full rounded-md border border-input bg-background px-2 text-xs"
      value={value} onChange={event => onChange(event.target.value)}>
      <option value="all">全部分类（{apps.length}）</option>
      {groups.map(group => <option key={group.id} value={group.id}>{group.label}（{group.apps.length}）</option>)}
      {value !== 'all' && !groups.some(group => group.id === value) && <option value={value}>当前分类（0）</option>}
    </select>
  );
}
