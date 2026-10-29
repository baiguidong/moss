import * as React from 'react';
import { Search, Wrench } from 'lucide-react';
import { ToolDescription } from '@/components/tool-description';

export type AppToolListItem = {
  id: string;
  name: string;
  title?: string;
  description?: string;
  status?: string;
  effect?: string;
  source?: string;
  mcp?: boolean;
};

/** Shared presentation for native App tools and cached MCP tools. No discovery. */
export function AppToolList({ tools, loading = false, label = '工具列表' }: {
  tools: AppToolListItem[]; loading?: boolean; label?: string;
}) {
  const [query, setQuery] = React.useState('');
  const visible = tools.filter(tool => `${tool.name} ${tool.title || ''} ${tool.description || ''}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="space-y-3" aria-label={label} data-app-tool-list>
    <label className="flex items-center gap-2 rounded-md border bg-background px-3 py-2"><Search className="h-4 w-4 shrink-0 text-muted-foreground" /><input aria-label="搜索工具" placeholder="查找工具" className="min-w-0 flex-1 bg-transparent text-sm outline-none" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="max-h-[28rem] overflow-y-auto overscroll-contain divide-y">{visible.map(tool => <article data-app-tool data-mcp-tool={tool.mcp || undefined} key={tool.id} className="flex gap-3 py-4">
      <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0">
        <h4 className="break-all text-sm font-medium" aria-label={`工具名称：${tool.name}`}>{tool.name}{tool.status && <span className="ml-2 text-xs font-normal text-muted-foreground">{tool.status}</span>}</h4>
        {(tool.title || tool.effect) && <p className="mt-1 text-xs text-muted-foreground">{[tool.title !== tool.name ? tool.title : '', tool.effect].filter(Boolean).join(' · ')}</p>}
        <div className="mt-1.5 break-words text-xs leading-6 text-muted-foreground"><ToolDescription description={tool.description || '此工具未提供描述。'} toolName={tool.name} /></div>
        {tool.source && <p className="mt-1 text-xs text-muted-foreground">{tool.source}</p>}
      </div>
    </article>)}</div>
    {!visible.length && <p className="text-sm text-muted-foreground">{query ? '没有匹配的工具。' : loading ? '正在读取工具…' : '暂无工具。'}</p>}
  </section>;
}
