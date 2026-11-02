import { Search } from "lucide-react";

export function AgentBrowserControls({ query, onQuery, status, onStatus, options, count, completedCount, collapsed, onCollapse }: {
  query: string; onQuery: (value: string) => void;
  status: string; onStatus: (value: string) => void;
  options: { value: string; label: string }[];
  count: number; completedCount: number; collapsed: boolean; onCollapse: () => void;
}) {
  return <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5">
    <label className="relative min-w-36 flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
      <input aria-label="搜索 Agent 或任务" placeholder="搜索 Agent 或任务…" value={query} onChange={event => onQuery(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    </label>
    <select aria-label="筛选 Agent 状态" value={status} onChange={event => onStatus(event.target.value)} className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {completedCount > 0 && status === "all" && !query.trim() ? <button type="button" aria-expanded={!collapsed} onClick={onCollapse} className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
      {collapsed ? "展开" : "收起"}已完成 ({completedCount})
    </button> : null}
    <span className="text-[10px] tabular-nums text-muted-foreground" role="status">显示 {count} 位</span>
  </div>;
}
