import { Input } from '@/components/ui/input';

export function AppDiscoveryFilter({ value, onChange, query, onQuery, hideSearch = false }: {
  value: string; onChange: (value: string) => void; query: string; onQuery: (value: string) => void;
  hideSearch?: boolean;
}) {
  const minWidth = hideSearch ? 106 : 194;
  return <div className="flex flex-1 items-center justify-end gap-2" style={{ minWidth }} data-app-discovery>
    <select aria-label="应用分区" value={value} onChange={event => onChange(event.target.value)} className="h-8 w-[106px] shrink-0 rounded-md border border-input bg-background px-2 text-xs">
      <option value="all">全部应用</option>
      <option value="local">本地应用</option>
      <option value="online">在线服务</option>
    </select>
    {!hideSearch && <Input aria-label="搜索应用" placeholder="搜索名称、用途或服务" value={query} onChange={event => onQuery(event.target.value)} className="h-8 w-20 min-w-20 max-w-52 flex-1 text-xs" />}
  </div>;
}
