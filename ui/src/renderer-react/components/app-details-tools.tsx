import * as React from 'react';
import { Search } from 'lucide-react';
import type { StoredApp } from '@/types';
import { AppDetailsSection, APP_DETAILS_LIST_CLASS, APP_DETAILS_ROW_CLASS } from './app-details-section';
import { ToolDescription } from './tool-description';
import { normalizeAppToolName } from '../../../../packages/app-sdk/src/tool-names.mjs';

export type AppDetailsMcpTool = { name: string; description?: string; disabled?: boolean; server: string; instanceId?: string; status?: string };

/** One tool list for native App contributions and MCP services. */
export function AppDetailsTools({ app, mcpTools = [] }: { app: StoredApp; mcpTools?: AppDetailsMcpTool[] }) {
  const [query, setQuery] = React.useState('');
  const appTitle = app.displayName || app.title || app.name;
  const effects = { read: '只读', write: '写入', destructive: '破坏性操作' };
  const tools = [
    ...(app.agentTools || []).map(tool => ({
      key: `app/${tool.id}`, name: tool.name || tool.id, title: tool.title,
      description: tool.description, kind: 'App', effect: effects[tool.effect],
      source: appTitle, status: !app.enabled ? 'App 已停用' : tool.permission && !app.grants?.includes(tool.permission) ? '未授权' : '已注册',
    })),
    ...mcpTools.map(tool => ({
      key: `mcp/${tool.instanceId || ''}/${tool.server}/${tool.name}`, name: normalizeAppToolName(tool.name, app.id || app.name), title: tool.name,
      description: tool.description, kind: 'MCP', effect: '', source: `${appTitle} · ${tool.server}`,
      status: !app.enabled ? 'App 已停用' : tool.disabled ? '已排除' : tool.status || '可用',
    })),
  ];
  if (!tools.length) return null;
  const matches = tools.filter(tool => `${tool.name} ${tool.title} ${tool.description} ${tool.source}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <AppDetailsSection title="工具" count={tools.length}>
    <label className="my-4 flex items-center gap-2 rounded-md border bg-background px-3 py-2">
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input aria-label="搜索工具" placeholder="查找工具" className="min-w-0 flex-1 bg-transparent text-sm outline-none" value={query} onChange={event => setQuery(event.target.value)} />
    </label>
    <div className={APP_DETAILS_LIST_CLASS}>
      {matches.map(tool => <article key={tool.key} data-app-tool={tool.name} data-mcp-tool={tool.kind === 'MCP' ? '' : undefined} className={APP_DETAILS_ROW_CLASS}>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium leading-6" title={tool.title && tool.title !== tool.name ? `${tool.name} ｜ ${tool.title}` : tool.name}>
            <code className="text-[13px]">{tool.name}</code>
            {tool.title && tool.title !== tool.name && <><span aria-hidden="true" className="mx-2 font-normal text-muted-foreground/60">｜</span><span className="font-normal text-muted-foreground">{tool.title}</span></>}
          </h3>
          <div className="mt-1 break-words text-xs leading-6 text-muted-foreground"><ToolDescription description={tool.description || '此工具未提供描述。'} toolName={tool.name} /></div>
          <p className="mt-1 break-words text-xs text-muted-foreground">来源：{tool.source} · {tool.kind}{tool.effect && ` · ${tool.effect}`}</p>
        </div>
        <span className="shrink-0 text-xs leading-6 text-muted-foreground">{tool.status}</span>
      </article>)}
    </div>
    {!matches.length && <p className="py-4 text-sm text-muted-foreground">没有匹配的工具。</p>}
  </AppDetailsSection>;
}
